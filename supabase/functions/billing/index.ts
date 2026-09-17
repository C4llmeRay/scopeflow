/**
 * Starting a subscription, and managing one.
 *
 * Two actions, and between them they are the whole payment surface:
 *
 *   checkout — a Stripe Checkout URL to open. Card details never touch the app
 *              or this function, which is the entire reason to do it this way:
 *              a solo developer does not want a PCI scope.
 *   portal   — a Stripe Billing Portal URL. Updating a card, changing a plan,
 *              cancelling, downloading invoices — all of it is Stripe's page,
 *              none of it is a screen anybody here has to build or maintain.
 *
 * What this function does NOT do is write subscription state. Nothing here
 * marks a company as paid. A Checkout session that completes is a promise, not
 * a payment; the webhook is where the truth arrives. Writing 'active' from the
 * success redirect is how you end up giving away subscriptions to anyone who
 * can open a URL.
 *
 * Deno. Deployed with `supabase functions deploy billing`.
 */

import Stripe from 'npm:stripe@19.2.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

interface RequestBody {
  action: 'checkout' | 'portal';
  /** Where Stripe sends the browser back to. The app's deep link. */
  returnUrl?: string;
}

/** The app's own scheme, per app.json, plus what a dev build uses. */
const ALLOWED_RETURN_PREFIXES = ['scopeflow://', 'exp://', 'http://localhost'];

const DEFAULT_RETURN_URL = 'scopeflow://billing';

/**
 * A redirect target is attacker-controlled input, even behind auth. Constrain
 * it to this app's own scheme so the function cannot be used to bounce someone
 * off a Stripe page onto an arbitrary site.
 */
function safeReturnUrl(candidate: string | undefined): string {
  if (!candidate) return DEFAULT_RETURN_URL;
  return ALLOWED_RETURN_PREFIXES.some((prefix) => candidate.startsWith(prefix))
    ? candidate
    : DEFAULT_RETURN_URL;
}

/**
 * Stripe will not redirect to a custom URI scheme — `success_url` must be
 * http(s), and a `scopeflow://` value is rejected when the session is created,
 * not when the customer returns. So Stripe is pointed at the billing-return
 * function, which is https, and that page sends the browser on to the app.
 *
 * The Billing Portal is different: its `return_url` accepts the deep link
 * directly, so it does not need the hop.
 */
function stripeRedirect(deepLink: string, status: 'success' | 'cancel'): string {
  const base = Deno.env.get('SUPABASE_URL')!;
  return (
    `${base}/functions/v1/billing-return` +
    `?to=${encodeURIComponent(deepLink)}&status=${status}`
  );
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const priceId = Deno.env.get('STRIPE_PRICE_ID');
  if (!secretKey || !priceId) {
    return json({ error: 'billing is not configured on the server' }, 503);
  }

  // ---- Who is asking -------------------------------------------------------
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not authenticated' }, 401);

  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'not authenticated' }, 401);

  const { data: profile } = await caller
    .from('profiles')
    .select('company_id')
    .eq('id', auth.user.id)
    .single();

  if (!profile?.company_id) return json({ error: 'no company for this user' }, 403);
  const companyId = profile.company_id as string;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'malformed request' }, 400);
  }

  // RLS already restricts this read to the caller's own company; the filter is
  // belt and braces, not the security boundary.
  const { data: company } = await caller
    .from('companies')
    .select('name, email, stripe_customer_id')
    .eq('id', companyId)
    .single();

  if (!company) return json({ error: 'no company for this user' }, 403);

  const stripe = new Stripe(secretKey, { apiVersion: '2025-10-29.clover' });
  const returnUrl = safeReturnUrl(body.returnUrl);

  // The customer id is billing state, so the app cannot write it — this
  // function holds the service role for that one column.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    let customerId = company.stripe_customer_id as string | null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: (company.name as string) || undefined,
        email: (company.email as string | null) ?? auth.user.email ?? undefined,
        // Carried so a person looking at the Stripe dashboard can find the
        // company without a lookup table, and so a support conversation about
        // a charge can start from the charge.
        metadata: { company_id: companyId, user_id: auth.user.id },
      });
      customerId = customer.id;

      await admin
        .from('companies')
        .update({ stripe_customer_id: customerId })
        .eq('id', companyId);
    }

    if (body.action === 'portal') {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return json({ url: session.url });
    }

    if (body.action === 'checkout') {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: stripeRedirect(returnUrl, 'success'),
        cancel_url: stripeRedirect(returnUrl, 'cancel'),
        // The ONLY link between a Stripe customer and a ScopeFlow company at
        // the moment a subscription is born. The webhook reads it back.
        client_reference_id: companyId,
        subscription_data: { metadata: { company_id: companyId } },
        // A contractor buying a business tool needs the invoice to carry their
        // business name and, in most of the US, their tax details.
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
      });

      if (!session.url) return json({ error: 'Stripe did not return a checkout URL' }, 502);
      return json({ url: session.url });
    }

    return json({ error: `unknown action ${String(body.action)}` }, 400);
  } catch (error) {
    // Stripe's messages are written for developers, not contractors. Log the
    // real one, return something a person can act on.
    console.error('billing failed', error);
    return json({ error: 'Could not reach the payment provider. Try again in a moment.' }, 502);
  }
});
