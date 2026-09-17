/**
 * Bringing billing state down from the server.
 *
 * ScopeFlow's sync is one-directional by design — the phone is the source of
 * truth and the outbox pushes. Billing is the one exception, and it has to be:
 * the contractor's phone is not allowed to decide whether the contractor has
 * paid. Stripe decides, the webhook writes it, and it has to travel the other
 * way to be of any use.
 *
 * So these columns are pulled, never pushed, and written straight to the local
 * row WITHOUT an outbox entry. Queueing them would send server-owned state back
 * to the server, where the trigger in the billing migration would reject it —
 * as a permanent failure, which is the kind that needs a human to clear.
 */

import { getCompany, type CompanyRecord } from '../../db/companies';
import type { LocalDatabase } from '../../db/types';
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase';
import type { SubscriptionStatus } from './entitlement';
import { pollUntil } from './poll';

/** Exactly the columns Stripe owns. Nothing else is touched. */
const BILLING_COLUMNS =
  'subscription_status, trial_ends_at, current_period_end, cancel_at_period_end';

interface BillingRow {
  subscription_status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

/** ISO on the wire, epoch milliseconds on the phone. */
const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Reads billing state from the server and writes it locally.
 *
 * Returns the refreshed company, or null when there is nothing to read — no
 * backend configured, no signal, no row yet. Null is not an error the caller
 * should surface: it means "carry on with what you have", which for a
 * contractor mid-trial is exactly right.
 */
export async function pullBillingState(
  db: LocalDatabase,
  companyId: string,
  now: number = Date.now(),
): Promise<CompanyRecord | null> {
  if (!isSupabaseConfigured()) return null;

  let row: BillingRow | null = null;
  try {
    const { data, error } = await getSupabase()
      .from('companies')
      .select(BILLING_COLUMNS)
      .eq('id', companyId)
      .maybeSingle();

    if (error) return null;
    row = data as BillingRow | null;
  } catch {
    // Offline. The local copy is what a contractor keeps working from, and it
    // is deliberately generous: an expired card does not stop them measuring.
    return null;
  }

  if (!row) return null;

  await db.adapter.run(
    `update companies
        set subscription_status  = ?,
            trial_ends_at        = ?,
            current_period_end   = ?,
            cancel_at_period_end = ?,
            updated_at           = ?
      where id = ?`,
    [
      row.subscription_status,
      ms(row.trial_ends_at),
      ms(row.current_period_end),
      row.cancel_at_period_end ? 1 : 0,
      now,
      companyId,
    ],
  );

  return getCompany(db, companyId);
}

/**
 * Waits for the subscription to become something new after a Stripe checkout.
 *
 * The gap this closes is real and it is the whole reason a paid customer might
 * think the payment failed: Stripe sends the browser back to the app the
 * instant the card clears, but the webhook that records it is a separate
 * delivery arriving a beat later. Between those two moments the app still says
 * "subscribe", and a contractor who has just been charged reads that as the
 * charge not working.
 *
 * So the app waits, briefly, and only after a checkout — never on a normal
 * screen load. If nothing arrives it says so honestly rather than pretending.
 */
export async function waitForSubscription(
  db: LocalDatabase,
  companyId: string,
  options: {
    /** Statuses that mean "it worked". */
    accept?: readonly SubscriptionStatus[];
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<CompanyRecord | null> {
  const accept = options.accept ?? (['active', 'trialing'] as const);

  const { value } = await pollUntil<CompanyRecord | null>({
    read: () => pullBillingState(db, companyId),
    done: (company) => company !== null && accept.includes(company.subscriptionStatus),
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    sleep: options.sleep,
    now: options.now,
  });

  return value;
}
