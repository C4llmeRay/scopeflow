/**
 * Turning a Stripe event into ScopeFlow's subscription state.
 *
 * Pure, and deliberately so. This is the one piece of billing where being
 * wrong is expensive in both directions — a contractor locked out of sending
 * on a Friday afternoon, or one sending for free for a year — and it is the
 * one piece that can be tested without Stripe, without a network and without a
 * database. So it holds every decision, and the Edge Function around it holds
 * none: verify the signature, call this, write what it says.
 *
 * No Deno APIs are used here on purpose, so the app's own Vitest suite runs the
 * exact code that ships in the function rather than a copy of it.
 */

/** Matches public.subscription_status in the schema. */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

/** The events worth acting on. Everything else Stripe sends is noise to us. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** The slice of a Stripe event this module reads. */
export interface StripeEventLike {
  id: string;
  type: string;
  /** Stripe's own epoch seconds for the event. Ordering is judged by this. */
  created: number;
  data: { object: Record<string, unknown> };
}

export interface BillingUpdate {
  status: SubscriptionStatus;
  /** ISO, or null when Stripe did not give one. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string | null;
}

export type Decision =
  /** Write this. `customerId` says whose row. */
  | { kind: 'apply'; customerId: string; update: BillingUpdate }
  /**
   * A checkout finished. The company is identified by the reference we put on
   * the session ourselves, which is the only moment a customer id and a company
   * id are ever seen together.
   */
  | { kind: 'link'; customerId: string; companyId: string; subscriptionId: string | null }
  /** Nothing to do, and that is fine. `why` exists to be logged. */
  | { kind: 'ignore'; why: string };

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Stripe sends either an id or an expanded object wherever a reference sits. */
const idOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') return str((value as { id?: unknown }).id);
  return null;
};

const isoFromEpochSeconds = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;

/**
 * Reads the end of the paid period off a subscription.
 *
 * This is version-dependent and it matters: Stripe moved `current_period_end`
 * off the subscription and onto each subscription item in the 2025-03-31 API
 * version. Reading only the old location against a new API version yields null
 * silently — and a null period end is what the grace-period logic measures
 * from, so the failure lands as contractors being locked out for no reason.
 * Read both, prefer whichever is there.
 */
export function periodEndOf(subscription: Record<string, unknown>): string | null {
  const top = isoFromEpochSeconds(subscription.current_period_end);
  if (top) return top;

  const items = subscription.items as { data?: unknown[] } | undefined;
  const first = items?.data?.[0] as Record<string, unknown> | undefined;
  return first ? isoFromEpochSeconds(first.current_period_end) : null;
}

/**
 * Stripe's subscription status, in ScopeFlow's terms.
 *
 * Null means "do not write anything" — not every Stripe status has an opinion
 * about entitlement, and overwriting a perfectly good trial because a first
 * card charge is still in flight is worse than doing nothing.
 */
export function mapStatus(stripeStatus: string): SubscriptionStatus | null {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      // Stripe is still retrying. The grace period in entitlement.ts outlasts
      // those retries, so a recoverable failure never blocks a real job.
      return 'past_due';
    case 'unpaid':
      // Retries exhausted. Still 'past_due' rather than a hard stop, because
      // the grace clock runs from the period end — which by now is a week gone,
      // so this expires on its own within days. No special case needed.
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
      // The very first payment has not settled. The company is mid-trial and
      // working; saying nothing is correct.
      return null;
    case 'incomplete_expired':
    case 'paused':
      return 'expired';
    default:
      return null;
  }
}

/**
 * What to do about one event.
 *
 * Replay protection and ordering are NOT decided here — they need the database.
 * This answers only "what does this event mean", which is the part worth
 * testing exhaustively.
 */
export function decide(event: StripeEventLike): Decision {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { kind: 'ignore', why: `unhandled event type ${event.type}` };
  }

  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const customerId = idOf(object.customer);
    // We set this ourselves when creating the session. It is the only link
    // between a Stripe customer and a ScopeFlow company, so an absent one is a
    // session somebody else created, not ours.
    const companyId = str(object.client_reference_id);

    if (!customerId || !companyId) {
      return { kind: 'ignore', why: 'checkout session with no customer or company reference' };
    }
    if (object.mode !== 'subscription') {
      return { kind: 'ignore', why: `checkout session in ${String(object.mode)} mode` };
    }

    return { kind: 'link', customerId, companyId, subscriptionId: idOf(object.subscription) };
  }

  const customerId = idOf(object.customer);
  if (!customerId) {
    return { kind: 'ignore', why: 'subscription event with no customer' };
  }

  if (event.type === 'customer.subscription.deleted') {
    // Deletion is unambiguous whatever the status field says, and it is the one
    // event that must never be dropped: it is how a subscription actually ends.
    return {
      kind: 'apply',
      customerId,
      update: {
        status: 'canceled',
        currentPeriodEnd: periodEndOf(object),
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: str(object.id),
      },
    };
  }

  const stripeStatus = str(object.status);
  if (!stripeStatus) {
    return { kind: 'ignore', why: 'subscription event with no status' };
  }

  const status = mapStatus(stripeStatus);
  if (!status) {
    return { kind: 'ignore', why: `stripe status ${stripeStatus} has no opinion on entitlement` };
  }

  return {
    kind: 'apply',
    customerId,
    update: {
      status,
      currentPeriodEnd: periodEndOf(object),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      stripeSubscriptionId: str(object.id),
    },
  };
}

/**
 * Whether an event should be applied given what has already been applied.
 *
 * Stripe does not promise order. Two updates in the same second can arrive
 * backwards, and the second one to land would otherwise win — which is how a
 * cancellation gets undone by the `active` event that preceded it.
 *
 * Equal timestamps are allowed through: Stripe's `created` has one-second
 * resolution, so two genuinely distinct events often share one, and dropping
 * the later of those would lose real changes. A true replay is caught by the
 * event id instead, which is exact.
 */
export function isStale(event: StripeEventLike, lastAppliedIso: string | null): boolean {
  if (!lastAppliedIso) return false;
  const last = Date.parse(lastAppliedIso);
  if (Number.isNaN(last)) return false;
  return event.created * 1000 < last;
}

export const eventCreatedIso = (event: StripeEventLike): string =>
  new Date(event.created * 1000).toISOString();
