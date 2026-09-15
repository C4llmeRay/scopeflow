/**
 * What a call costs, and the ceiling that stops a bad one running away.
 *
 * From the plan: "The failure mode that hurts is not cost per estimate — it is
 * a retry loop on one bad photo quietly burning your API budget overnight."
 * So spend is metered per job, and the ceiling is enforced before the call is
 * made rather than discovered on the invoice.
 */

/** Claude Opus 5, in cents per million tokens. */
export const PRICING = {
  /** Uncached input. */
  inputCentsPerMTok: 500,
  outputCentsPerMTok: 2_500,
  /** A cache read is a tenth of input. */
  cacheReadCentsPerMTok: 50,
  /** Writing the cache costs a quarter more than plain input. */
  cacheWriteCentsPerMTok: 625,
} as const;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Cost in whole cents, rounded up so an estimate never reads as free. */
export function costCents(usage: TokenUsage): number {
  const millionths =
    usage.inputTokens * PRICING.inputCentsPerMTok +
    usage.outputTokens * PRICING.outputCentsPerMTok +
    (usage.cacheReadTokens ?? 0) * PRICING.cacheReadCentsPerMTok +
    (usage.cacheCreationTokens ?? 0) * PRICING.cacheWriteCentsPerMTok;

  const cents = millionths / 1_000_000;
  return cents > 0 ? Math.max(1, Math.ceil(cents)) : 0;
}

/**
 * Per-job ceiling. The plan sizes a twelve-room house at one to three dollars,
 * so five dollars is generous headroom for a large job and still catches a
 * runaway loop long before it matters.
 */
export const DEFAULT_JOB_CEILING_CENTS = 500;

export type SpendDecision =
  | { allowed: true; remainingCents: number }
  | { allowed: false; reason: string; spentCents: number; ceilingCents: number };

export function checkSpend(
  spentCents: number,
  ceilingCents: number = DEFAULT_JOB_CEILING_CENTS,
): SpendDecision {
  if (spentCents >= ceilingCents) {
    return {
      allowed: false,
      reason:
        `This job has used $${(spentCents / 100).toFixed(2)} of its ` +
        `$${(ceilingCents / 100).toFixed(2)} AI budget. Raise the limit in settings to carry on.`,
      spentCents,
      ceilingCents,
    };
  }
  return { allowed: true, remainingCents: ceilingCents - spentCents };
}

/** For the settings screen: what a job has cost so far, in dollars. */
export const formatSpend = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
