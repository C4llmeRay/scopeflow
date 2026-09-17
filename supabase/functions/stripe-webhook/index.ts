/**
 * The Stripe webhook — the only thing in ScopeFlow that may say a company has paid.
 *
 * Every rule this file follows exists because of a specific way webhook
 * handlers fail in production:
 *
 *   1. VERIFY THE SIGNATURE FIRST. This endpoint is public and unauthenticated
 *      — it has to be, Stripe has no session. Without signature verification,
 *      anyone who learns the URL can POST themselves a subscription.
 *
 *   2. NO JWT. Supabase verifies a JWT on functions by default and Stripe does
 *      not send one. This function must be deployed with --no-verify-jwt, or
 *      every event is rejected with a 401 and the first anyone knows is a
 *      customer who paid and cannot send.
 *
 *   3. AT LEAST ONCE, NOT EXACTLY ONCE. A slow response means Stripe retries.
 *      The event id is a primary key here, so a replay is recognised.
 *
 *   4. NO ORDERING PROMISE. Two updates a second apart can arrive backwards.
 *      An event older than the last one applied is recorded and dropped.
 *
 *   5. ALWAYS 200 ONCE THE SIGNATURE IS GOOD. A 500 on an event we simply do
 *      not care about makes Stripe retry it for days and eventually disable the
 *      endpoint — taking the events that do matter down with it.
 *
 * Deno. Deployed with:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 */

import Stripe from 'npm:stripe@19.2.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  decide,
  eventCreatedIso,
  isStale,
  type StripeEventLike,
} from '../_shared/subscription.ts';

const ok = (body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ received: true, ...body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('POST only', { status: 405 });
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const signingSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secretKey || !signingSecret) {
    console.error('stripe webhook is not configured');
    return new Response('not configured', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  // The RAW body. Parsing it first and re-serialising would change the bytes
  // and the signature would never verify again.
  const payload = await request.text();

  const stripe = new Stripe(secretKey, { apiVersion: '2025-10-29.clover' });

  let event: StripeEventLike;
  try {
    // Async because Deno has Web Crypto rather than Node's synchronous crypto.
    // constructEvent (the synchronous one) throws here, and the symptom is
    // every event failing verification for no apparent reason.
    event = (await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      signingSecret,
    )) as unknown as StripeEventLike;
  } catch (error) {
    // A bad signature is either a misconfigured signing secret or somebody
    // probing. Both deserve a 400 and no detail.
    console.error('signature verification failed', error);
    return new Response('bad signature', { status: 400 });
  }

  // Past this line the event is genuinely from Stripe, so the answer is 200
  // whatever we decide to do with it.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // ---- Replay check ------------------------------------------------------
    // Claim the event id first. The primary key makes this atomic, which also
    // covers two concurrent deliveries of the same event racing each other —
    // exactly what happens when our first response was merely slow, not failed.
    const claim = await admin
      .from('stripe_events')
      .insert({
        id: event.id,
        type: event.type,
        company_id: null,
        event_created_at: eventCreatedIso(event),
        outcome: 'processing',
      })
      .select('id')
      .single();

    if (claim.error) {
      // 23505 is unique_violation: we have seen this event before.
      if (claim.error.code === '23505') {
        return ok({ duplicate: true });
      }
      throw claim.error;
    }

    const decision = decide(event);

    if (decision.kind === 'ignore') {
      await admin
        .from('stripe_events')
        .update({ outcome: 'ignored' })
        .eq('id', event.id);
      return ok({ ignored: decision.why });
    }

    // ---- A checkout completing: bind the customer to the company -----------
    if (decision.kind === 'link') {
      await admin
        .from('companies')
        .update({
          stripe_customer_id: decision.customerId,
          stripe_subscription_id: decision.subscriptionId,
        })
        .eq('id', decision.companyId);

      // Deliberately no status write. The subscription events that follow this
      // one carry the real state, and they carry a period end this does not.
      await admin
        .from('stripe_events')
        .update({ company_id: decision.companyId, outcome: 'linked' })
        .eq('id', event.id);

      return ok({ linked: decision.companyId });
    }

    // ---- A subscription change ---------------------------------------------
    const { data: company } = await admin
      .from('companies')
      .select('id, last_billing_event_at')
      .eq('stripe_customer_id', decision.customerId)
      .maybeSingle();

    if (!company) {
      // An event about a customer we have never linked. Usually the
      // subscription event beating checkout.session.completed to the door;
      // Stripe will redeliver the subscription state on the next change, and
      // the checkout link is what repairs it. Recorded so it is findable.
      await admin
        .from('stripe_events')
        .update({ outcome: 'unknown_customer' })
        .eq('id', event.id);
      return ok({ unknownCustomer: decision.customerId });
    }

    // ---- Ordering check ----------------------------------------------------
    if (isStale(event, company.last_billing_event_at as string | null)) {
      await admin
        .from('stripe_events')
        .update({ company_id: company.id, outcome: 'stale' })
        .eq('id', event.id);
      return ok({ stale: true });
    }

    const { error: writeError } = await admin
      .from('companies')
      .update({
        subscription_status: decision.update.status,
        current_period_end: decision.update.currentPeriodEnd,
        cancel_at_period_end: decision.update.cancelAtPeriodEnd,
        stripe_subscription_id: decision.update.stripeSubscriptionId,
        last_billing_event_at: eventCreatedIso(event),
      })
      .eq('id', company.id);

    if (writeError) throw writeError;

    await admin
      .from('stripe_events')
      .update({ company_id: company.id, outcome: 'applied' })
      .eq('id', event.id);

    return ok({ applied: decision.update.status });
  } catch (error) {
    console.error('webhook processing failed', event.id, event.type, error);

    // The claim row would otherwise mark a failed event as already seen, and
    // Stripe's retry — the thing that would have fixed it — would be treated
    // as a duplicate and dropped. Release the claim so the retry can work.
    await admin.from('stripe_events').delete().eq('id', event.id);

    // A 500 here is correct: this is OUR failure, and a retry can fix it.
    return new Response('processing failed', { status: 500 });
  }
});
