/**
 * The Stripe event mapping — the code that actually ships in the webhook.
 *
 * Imported straight out of supabase/functions/_shared rather than copied, so
 * there is exactly one implementation and these tests are evidence about it.
 * The module is pure TypeScript with no Deno APIs precisely so this can work.
 *
 * What is worth testing here is not the happy path. It is the four ways a
 * webhook integration quietly goes wrong: a replayed event, a reordered pair,
 * a Stripe status nobody thought about, and a field that moved between API
 * versions.
 */

import { describe, expect, it } from 'vitest';

import {
  decide,
  eventCreatedIso,
  isStale,
  mapStatus,
  periodEndOf,
  type StripeEventLike,
} from '../../../supabase/functions/_shared/subscription';

const JAN_1 = 1_767_225_600; // 2026-01-01T00:00:00Z, epoch seconds
const FEB_1 = 1_769_904_000; // 2026-02-01T00:00:00Z

const event = (
  type: string,
  object: Record<string, unknown>,
  created = JAN_1,
): StripeEventLike => ({ id: 'evt_1', type, created, data: { object } });

const subscription = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  cancel_at_period_end: false,
  current_period_end: FEB_1,
  ...over,
});

describe('mapStatus', () => {
  it('passes the statuses that mean the same thing straight through', () => {
    expect(mapStatus('trialing')).toBe('trialing');
    expect(mapStatus('active')).toBe('active');
    expect(mapStatus('past_due')).toBe('past_due');
    expect(mapStatus('canceled')).toBe('canceled');
  });

  it('treats unpaid as past_due, letting the grace clock expire it', () => {
    // Retries are exhausted, but the grace period runs from the period end,
    // which is already a week gone — so this lapses on its own in days.
    expect(mapStatus('unpaid')).toBe('past_due');
  });

  it('says nothing about a first charge still in flight', () => {
    // A company in `incomplete` is mid-trial and working. Overwriting a good
    // trial because a card authorisation has not settled would lock out
    // somebody who has done nothing wrong.
    expect(mapStatus('incomplete')).toBeNull();
  });

  it('expires a subscription that never started or was paused', () => {
    expect(mapStatus('incomplete_expired')).toBe('expired');
    expect(mapStatus('paused')).toBe('expired');
  });

  it('says nothing about a status it has never heard of', () => {
    // Stripe adds statuses. Guessing at one is how an unknown value becomes a
    // lockout; doing nothing leaves the contractor exactly as they were.
    expect(mapStatus('some_future_status')).toBeNull();
  });
});

describe('periodEndOf', () => {
  it('reads the classic top-level field', () => {
    expect(periodEndOf(subscription())).toBe('2026-02-01T00:00:00.000Z');
  });

  it('falls back to the subscription item, where Stripe moved it in 2025-03-31', () => {
    // This is the bug that does not announce itself: against a newer API
    // version the top-level field is simply absent, periodEnd comes back null,
    // and the grace-period maths silently measures from nothing.
    const moved = subscription({
      current_period_end: undefined,
      items: { data: [{ current_period_end: FEB_1 }] },
    });
    expect(periodEndOf(moved)).toBe('2026-02-01T00:00:00.000Z');
  });

  it('returns null rather than an epoch date when there is nothing to read', () => {
    expect(periodEndOf(subscription({ current_period_end: undefined }))).toBeNull();
    expect(periodEndOf(subscription({ current_period_end: 0 }))).toBeNull();
  });
});

describe('decide', () => {
  it('ignores event types it does not handle', () => {
    const decision = decide(event('invoice.created', {}));
    expect(decision.kind).toBe('ignore');
  });

  it('links a completed checkout to the company that started it', () => {
    const decision = decide(
      event('checkout.session.completed', {
        customer: 'cus_123',
        client_reference_id: 'co-uuid',
        subscription: 'sub_123',
        mode: 'subscription',
      }),
    );

    expect(decision).toEqual({
      kind: 'link',
      customerId: 'cus_123',
      companyId: 'co-uuid',
      subscriptionId: 'sub_123',
    });
  });

  it('refuses a checkout session that carries no company reference', () => {
    // Somebody else's session, or one created outside the app. Writing a
    // subscription against a guessed company is unrecoverable.
    const decision = decide(
      event('checkout.session.completed', {
        customer: 'cus_123',
        mode: 'subscription',
      }),
    );
    expect(decision.kind).toBe('ignore');
  });

  it('ignores a one-off payment checkout', () => {
    const decision = decide(
      event('checkout.session.completed', {
        customer: 'cus_123',
        client_reference_id: 'co-uuid',
        mode: 'payment',
      }),
    );
    expect(decision.kind).toBe('ignore');
  });

  it('applies an active subscription', () => {
    const decision = decide(event('customer.subscription.updated', subscription()));

    expect(decision).toEqual({
      kind: 'apply',
      customerId: 'cus_123',
      update: {
        status: 'active',
        currentPeriodEnd: '2026-02-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: 'sub_123',
      },
    });
  });

  it('carries cancel_at_period_end, which Stripe sets while still active', () => {
    // The trap: somebody cancels and Stripe leaves status 'active' until the
    // period runs out. Reading only the status tells them nothing changed.
    const decision = decide(
      event('customer.subscription.updated', subscription({ cancel_at_period_end: true })),
    );

    expect(decision.kind).toBe('apply');
    if (decision.kind !== 'apply') return;
    expect(decision.update.status).toBe('active');
    expect(decision.update.cancelAtPeriodEnd).toBe(true);
  });

  it('cancels on deletion whatever the status field says', () => {
    const decision = decide(
      event('customer.subscription.deleted', subscription({ status: 'active' })),
    );

    expect(decision.kind).toBe('apply');
    if (decision.kind !== 'apply') return;
    expect(decision.update.status).toBe('canceled');
  });

  it('accepts an expanded customer object as well as a bare id', () => {
    const decision = decide(
      event('customer.subscription.updated', subscription({ customer: { id: 'cus_123' } })),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind !== 'apply') return;
    expect(decision.customerId).toBe('cus_123');
  });

  it('ignores a subscription event with no customer to attribute it to', () => {
    const decision = decide(event('customer.subscription.updated', subscription({ customer: null })));
    expect(decision.kind).toBe('ignore');
  });

  it('leaves the company alone when the status has no opinion', () => {
    const decision = decide(
      event('customer.subscription.updated', subscription({ status: 'incomplete' })),
    );
    expect(decision.kind).toBe('ignore');
  });
});

describe('isStale', () => {
  it('lets anything through when nothing has been applied yet', () => {
    expect(isStale(event('customer.subscription.updated', {}), null)).toBe(false);
  });

  it('drops an event older than the one already applied', () => {
    // The reordering failure: an `active` event created before a cancellation
    // arrives after it, and without this would undo the cancellation.
    const older = event('customer.subscription.updated', {}, JAN_1);
    expect(isStale(older, '2026-02-01T00:00:00.000Z')).toBe(true);
  });

  it('allows an event with the same timestamp as the last applied', () => {
    // Stripe's `created` has one-second resolution, so two genuinely different
    // events routinely share one. Dropping the second loses a real change; a
    // true replay is caught exactly by the event id instead.
    const same = event('customer.subscription.updated', {}, JAN_1);
    expect(isStale(same, eventCreatedIso(same))).toBe(false);
  });

  it('applies an event newer than the last applied', () => {
    const newer = event('customer.subscription.updated', {}, FEB_1);
    expect(isStale(newer, '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('does not drop everything because a stored timestamp is unreadable', () => {
    const any = event('customer.subscription.updated', {}, JAN_1);
    expect(isStale(any, 'not a date')).toBe(false);
  });
});
