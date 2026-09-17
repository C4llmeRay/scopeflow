/**
 * What a contractor is entitled to, and when to ask them for money.
 *
 * One decision shapes all of this: THE TRIAL GATES SENDING, NOT WORKING.
 *
 * A contractor can always measure, photograph, scope and price a job, and can
 * always read everything they have ever recorded — expired or not. What lapses
 * is the ability to send a new estimate. Two reasons, and both matter:
 *
 *   * Their data is theirs. Holding a claim hostage to a card on file is how
 *     you earn a chargeback and a review that costs you ten customers.
 *   * The ask lands at the right moment. Somebody who has just walked a house
 *     and is looking at a finished $12,000 estimate knows exactly what the
 *     subscription is worth. Somebody staring at a locked empty app does not.
 */

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

export interface BillingState {
  status: SubscriptionStatus;
  /** Epoch ms. When the trial runs out, for a contractor who has not paid. */
  trialEndsAt: number | null;
  /** Epoch ms. What the last successful payment bought. */
  currentPeriodEnd: number | null;
  /**
   * Set once Stripe knows this period is the last one.
   *
   * Stripe does not flip a cancelled subscription to `canceled` at the moment
   * somebody clicks cancel — it stays `active` and carries this flag until the
   * period actually runs out. Reading only the status would tell a contractor
   * who cancelled this morning that nothing had changed.
   */
  cancelAtPeriodEnd?: boolean;
}

export const TRIAL_DAYS = 14;

/**
 * How long a failed payment keeps working. Cards expire, banks decline for
 * nothing, and a contractor standing in front of a homeowner is the worst
 * possible moment to find out. Stripe retries over about a week; this outlasts
 * that so a recoverable failure never blocks a real job.
 */
export const PAST_DUE_GRACE_DAYS = 10;

const DAY = 86_400_000;

export interface Entitlement {
  /** The only thing the trial actually gates. */
  canSendEstimates: boolean;
  /** Always true. Their work is theirs. */
  canWork: true;
  /** Whole days left, floored. Null when nothing is counting down. */
  daysLeft: number | null;
  /** True once it is fair to put a subscribe button in front of them. */
  shouldPrompt: boolean;
  /** True when the prompt should be impossible to miss. */
  urgent: boolean;
  /** One sentence, in the contractor's terms. */
  message: string;
}

const daysBetween = (from: number, to: number): number =>
  Math.max(0, Math.floor((to - from) / DAY));

export function startTrial(now: number = Date.now()): BillingState {
  return {
    status: 'trialing',
    trialEndsAt: now + TRIAL_DAYS * DAY,
    currentPeriodEnd: null,
  };
}

export function entitlement(state: BillingState, now: number = Date.now()): Entitlement {
  const base = { canWork: true as const };

  switch (state.status) {
    case 'active': {
      // A paid subscription whose period has run out without renewing is a
      // webhook that has not arrived yet, not a contractor to lock out.
      const left = state.currentPeriodEnd ? daysBetween(now, state.currentPeriodEnd) : null;

      if (state.cancelAtPeriodEnd) {
        // Still paid up, still sending — but it stops on a known date, and
        // saying so is the difference between a renewal and a surprise.
        return {
          ...base,
          canSendEstimates: true,
          daysLeft: left,
          shouldPrompt: true,
          urgent: left !== null && left <= 3,
          message:
            left === null
              ? 'Your subscription is set to end.'
              : `Your subscription ends in ${left} ${left === 1 ? 'day' : 'days'}. ` +
                'Resubscribe any time before then and nothing changes.',
        };
      }

      return {
        ...base,
        canSendEstimates: true,
        daysLeft: left,
        shouldPrompt: false,
        urgent: false,
        message: 'Subscribed.',
      };
    }

    case 'trialing': {
      const endsAt = state.trialEndsAt ?? now;
      const left = daysBetween(now, endsAt);

      if (now >= endsAt) {
        return {
          ...base,
          canSendEstimates: false,
          daysLeft: 0,
          shouldPrompt: true,
          urgent: true,
          message:
            'Your trial has ended. Everything you have measured is still here — ' +
            'subscribe to send estimates again.',
        };
      }

      return {
        ...base,
        canSendEstimates: true,
        daysLeft: left,
        // Nagging from day one is how a trial gets uninstalled. The ask starts
        // in the last week, once they have actually used it on something.
        shouldPrompt: left <= 7,
        urgent: left <= 3,
        message:
          left === 0
            ? 'Last day of your trial.'
            : `${left} ${left === 1 ? 'day' : 'days'} left in your trial.`,
      };
    }

    case 'past_due': {
      const graceEnds = (state.currentPeriodEnd ?? now) + PAST_DUE_GRACE_DAYS * DAY;
      const left = daysBetween(now, graceEnds);

      if (now >= graceEnds) {
        return {
          ...base,
          canSendEstimates: false,
          daysLeft: 0,
          shouldPrompt: true,
          urgent: true,
          message:
            'Your payment did not go through. Your jobs are all still here — ' +
            'update your card to send estimates again.',
        };
      }

      return {
        ...base,
        canSendEstimates: true,
        daysLeft: left,
        shouldPrompt: true,
        urgent: left <= 3,
        message:
          `Your last payment did not go through. You have ${left} ` +
          `${left === 1 ? 'day' : 'days'} to update your card.`,
      };
    }

    case 'canceled': {
      // Cancelling stops the renewal, it does not void what was already paid
      // for. They keep sending until the period they bought runs out.
      const end = state.currentPeriodEnd;
      if (end !== null && now < end) {
        const left = daysBetween(now, end);
        return {
          ...base,
          canSendEstimates: true,
          daysLeft: left,
          shouldPrompt: true,
          urgent: left <= 3,
          message: `Cancelled. You can send estimates for another ${left} ${left === 1 ? 'day' : 'days'}.`,
        };
      }
      return {
        ...base,
        canSendEstimates: false,
        daysLeft: 0,
        shouldPrompt: true,
        urgent: true,
        message: 'Your subscription has ended. Your jobs are all still here.',
      };
    }

    case 'expired':
    default:
      return {
        ...base,
        canSendEstimates: false,
        daysLeft: 0,
        shouldPrompt: true,
        urgent: true,
        message: 'Subscribe to send estimates. Everything you have recorded stays put.',
      };
  }
}

/** Shown on the send screen when sending is not available. */
export function blockedReason(entry: Entitlement): string | null {
  return entry.canSendEstimates ? null : entry.message;
}
