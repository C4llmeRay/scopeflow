/**
 * How often the contractor actually takes the model's advice.
 *
 * Straight from the plan: "Track suggestion acceptance rate per feature;
 * anything under 60% gets cut, not tuned forever." This is the number that
 * decides whether a feature ships, so it is derived from what the contractor
 * did rather than from anything the model reported about itself.
 *
 * Derived rather than stored in its own table: a line item already records
 * whether it came from a model and whether a human accepted it, and a damage
 * record already records its source. A second source of truth would only give
 * the two a chance to disagree.
 */

import type { LocalDatabase } from '../../db/types';

/** Below this, per the plan, the feature is hurting more than helping. */
export const ACCEPTANCE_FLOOR = 0.6;

export type AiFeature = 'classify_photo' | 'suggest_scope' | 'extract_voice';

export interface FeatureAcceptance {
  feature: AiFeature;
  /** Suggestions the contractor has answered one way or the other. */
  reviewed: number;
  accepted: number;
  /** Still waiting on a human. Not counted in the rate. */
  pending: number;
  /** Null until there is something to divide by. */
  rate: number | null;
  /** True once there is enough evidence AND the rate is below the floor. */
  belowFloor: boolean;
}

/** Fewer than this and a rate is noise, not a signal. */
export const MIN_SAMPLE = 10;

function summarise(
  feature: AiFeature,
  accepted: number,
  rejected: number,
  pending: number,
): FeatureAcceptance {
  const reviewed = accepted + rejected;
  const rate = reviewed > 0 ? accepted / reviewed : null;
  return {
    feature,
    reviewed,
    accepted,
    pending,
    rate,
    belowFloor: reviewed >= MIN_SAMPLE && rate !== null && rate < ACCEPTANCE_FLOOR,
  };
}

/**
 * Scope suggestions: a line the model proposed, and whether a human accepted
 * it. A deleted line counts as a rejection — removing it IS the rejection.
 */
async function scopeAcceptance(
  db: LocalDatabase,
  companyId: string,
): Promise<FeatureAcceptance> {
  const [row] = await db.adapter.all<{
    accepted: number;
    rejected: number;
    pending: number;
  }>(
    `select
       sum(case when status = 'accepted' and deleted_at is null then 1 else 0 end) as accepted,
       sum(case when status = 'rejected' or deleted_at is not null then 1 else 0 end) as rejected,
       sum(case when status = 'suggested' and deleted_at is null then 1 else 0 end) as pending
     from line_items
     where company_id = ? and origin = 'ai'`,
    [companyId],
  );

  return summarise('suggest_scope', row?.accepted ?? 0, row?.rejected ?? 0, row?.pending ?? 0);
}

/**
 * Photo and voice findings: a damage record the model produced, and whether the
 * contractor kept it. Deleting it is the rejection.
 */
async function damageAcceptance(
  db: LocalDatabase,
  companyId: string,
  feature: AiFeature,
  source: 'ai_photo' | 'ai_voice',
): Promise<FeatureAcceptance> {
  const [row] = await db.adapter.all<{ kept: number; removed: number }>(
    `select
       sum(case when deleted_at is null then 1 else 0 end) as kept,
       sum(case when deleted_at is not null then 1 else 0 end) as removed
     from damages
     where company_id = ? and source = ?`,
    [companyId, source],
  );

  // A damage record has no pending state: it is created only once a human has
  // reviewed the finding, so everything here has already been answered.
  return summarise(feature, row?.kept ?? 0, row?.removed ?? 0, 0);
}

export async function acceptanceRates(
  db: LocalDatabase,
  companyId: string,
): Promise<FeatureAcceptance[]> {
  return [
    await damageAcceptance(db, companyId, 'classify_photo', 'ai_photo'),
    await scopeAcceptance(db, companyId),
    await damageAcceptance(db, companyId, 'extract_voice', 'ai_voice'),
  ];
}

export const FEATURE_LABELS: Record<AiFeature, string> = {
  classify_photo: 'Damage from photos',
  suggest_scope: 'Suggested line items',
  extract_voice: 'Damage from voice notes',
};

/** "72% of 25" — how the rate reads in the UI. */
export function describeAcceptance(entry: FeatureAcceptance): string {
  if (entry.rate === null) {
    return entry.pending > 0 ? `${entry.pending} waiting on you` : 'nothing suggested yet';
  }
  const pct = Math.round(entry.rate * 100);
  const sample = entry.reviewed < MIN_SAMPLE ? ' — too few to judge' : '';
  return `${pct}% of ${entry.reviewed}${sample}`;
}
