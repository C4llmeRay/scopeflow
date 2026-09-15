import { describe, expect, it } from 'vitest';

import {
  blockedReason,
  entitlement,
  PAST_DUE_GRACE_DAYS,
  startTrial,
  TRIAL_DAYS,
  type BillingState,
} from './entitlement';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const inDays = (n: number) => NOW + n * DAY;

const state = (over: Partial<BillingState> = {}): BillingState => ({
  status: 'trialing',
  trialEndsAt: inDays(14),
  currentPeriodEnd: null,
  ...over,
});

describe('the rule that never changes', () => {
  const everyState: BillingState[] = [
    state({ status: 'trialing', trialEndsAt: inDays(-100) }),
    state({ status: 'active', currentPeriodEnd: inDays(30) }),
    state({ status: 'past_due', currentPeriodEnd: inDays(-100) }),
    state({ status: 'canceled', currentPeriodEnd: inDays(-100) }),
    state({ status: 'expired' }),
  ];

  it('never stops a contractor working, in any billing state', () => {
    for (const billing of everyState) {
      expect(entitlement(billing, NOW).canWork, billing.status).toBe(true);
    }
  });

  it('never suggests their data is gone', () => {
    for (const billing of everyState) {
      const { message } = entitlement(billing, NOW);
      expect(message).not.toMatch(/delete|lost|erased|removed/i);
    }
  });

  it('tells a locked-out contractor their work is still there', () => {
    for (const billing of everyState) {
      const entry = entitlement(billing, NOW);
      if (!entry.canSendEstimates) {
        expect(entry.message, billing.status).toMatch(/still here|stays put|all still here/i);
      }
    }
  });
});

describe('startTrial', () => {
  it('gives the contractor the full fourteen days', () => {
    const fresh = startTrial(NOW);
    expect(fresh.status).toBe('trialing');
    expect(entitlement(fresh, NOW).daysLeft).toBe(TRIAL_DAYS);
    expect(entitlement(fresh, NOW).canSendEstimates).toBe(true);
  });
});

describe('trialing', () => {
  it('says nothing for the first week', () => {
    const entry = entitlement(state({ trialEndsAt: inDays(14) }), NOW);
    expect(entry.shouldPrompt).toBe(false);
    expect(entry.urgent).toBe(false);
  });

  it('starts asking in the last week, once it has been used on something', () => {
    expect(entitlement(state({ trialEndsAt: inDays(8) }), NOW).shouldPrompt).toBe(false);
    expect(entitlement(state({ trialEndsAt: inDays(7) }), NOW).shouldPrompt).toBe(true);
  });

  it('gets loud in the last three days', () => {
    expect(entitlement(state({ trialEndsAt: inDays(4) }), NOW).urgent).toBe(false);
    expect(entitlement(state({ trialEndsAt: inDays(3) }), NOW).urgent).toBe(true);
  });

  it('counts down in whole days a person would say', () => {
    expect(entitlement(state({ trialEndsAt: inDays(5) }), NOW).message).toBe(
      '5 days left in your trial.',
    );
    expect(entitlement(state({ trialEndsAt: inDays(1) }), NOW).message).toBe(
      '1 day left in your trial.',
    );
    expect(entitlement(state({ trialEndsAt: NOW + 3_600_000 }), NOW).message).toBe(
      'Last day of your trial.',
    );
  });

  it('stops sending the moment the trial runs out', () => {
    const entry = entitlement(state({ trialEndsAt: NOW }), NOW);
    expect(entry.canSendEstimates).toBe(false);
    expect(entry.urgent).toBe(true);
  });

  it('still lets them work after it runs out', () => {
    expect(entitlement(state({ trialEndsAt: inDays(-30) }), NOW).canWork).toBe(true);
  });
});

describe('active', () => {
  it('sends, and says nothing about money', () => {
    const entry = entitlement(state({ status: 'active', currentPeriodEnd: inDays(20) }), NOW);
    expect(entry).toMatchObject({ canSendEstimates: true, shouldPrompt: false, urgent: false });
  });

  it('does not lock out a paid subscriber whose renewal webhook is late', () => {
    // The period lapsed but Stripe has not told us anything. Locking them out
    // over our own missing webhook would be our bug, charged to them.
    const entry = entitlement(state({ status: 'active', currentPeriodEnd: inDays(-2) }), NOW);
    expect(entry.canSendEstimates).toBe(true);
  });
});

describe('past_due', () => {
  it('keeps working through the grace period, because banks decline for nothing', () => {
    const entry = entitlement(state({ status: 'past_due', currentPeriodEnd: NOW }), NOW);
    expect(entry.canSendEstimates).toBe(true);
    expect(entry.daysLeft).toBe(PAST_DUE_GRACE_DAYS);
    expect(entry.shouldPrompt).toBe(true);
  });

  it('outlasts a card retry cycle, so a recoverable failure never blocks a job', () => {
    // Stripe retries over roughly a week.
    expect(PAST_DUE_GRACE_DAYS).toBeGreaterThan(7);
  });

  it('stops sending once the grace period is gone', () => {
    const entry = entitlement(
      state({ status: 'past_due', currentPeriodEnd: inDays(-PAST_DUE_GRACE_DAYS - 1) }),
      NOW,
    );
    expect(entry.canSendEstimates).toBe(false);
    expect(entry.message).toMatch(/update your card/i);
  });

  it('says how long is left to fix it', () => {
    const entry = entitlement(state({ status: 'past_due', currentPeriodEnd: inDays(-4) }), NOW);
    expect(entry.message).toMatch(/6 days to update your card/);
  });
});

describe('canceled', () => {
  it('honours the period they already paid for', () => {
    const entry = entitlement(state({ status: 'canceled', currentPeriodEnd: inDays(12) }), NOW);
    expect(entry.canSendEstimates).toBe(true);
    expect(entry.daysLeft).toBe(12);
    expect(entry.message).toMatch(/another 12 days/);
  });

  it('stops once that period is over', () => {
    const entry = entitlement(state({ status: 'canceled', currentPeriodEnd: inDays(-1) }), NOW);
    expect(entry.canSendEstimates).toBe(false);
    expect(entry.message).toMatch(/still here/i);
  });

  it('stops immediately when nothing was ever paid for', () => {
    expect(
      entitlement(state({ status: 'canceled', currentPeriodEnd: null }), NOW).canSendEstimates,
    ).toBe(false);
  });
});

describe('expired', () => {
  it('asks plainly and promises the work is safe', () => {
    const entry = entitlement(state({ status: 'expired' }), NOW);
    expect(entry.canSendEstimates).toBe(false);
    expect(entry.message).toMatch(/stays put/i);
  });
});

describe('blockedReason', () => {
  it('says nothing while sending works', () => {
    expect(blockedReason(entitlement(state(), NOW))).toBeNull();
  });

  it('gives the reason when it does not', () => {
    expect(blockedReason(entitlement(state({ status: 'expired' }), NOW))).toMatch(/Subscribe/);
  });
});
