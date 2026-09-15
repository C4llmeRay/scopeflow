/**
 * The company the signed-in contractor belongs to.
 *
 * Re-exported from the auth layer so the screens have one import for it, and so
 * that the day this becomes a company switcher, it changes in one place.
 */

import { getCompany, saveCompany, type CompanyRecord } from '../../db/companies';
import type { LocalDatabase } from '../../db/types';
import { currentCompanyId, peekCompanyId } from '../auth/current';

export { currentCompanyId, peekCompanyId };

/**
 * Makes sure a company row exists locally before anything tries to read one.
 *
 * On a signed-in install the real row syncs down, but it may not have arrived
 * yet — and the first thing that needs it is the estimate letterhead, which is
 * a terrible moment to discover the problem.
 */
export async function ensureCompany(db: LocalDatabase): Promise<CompanyRecord> {
  const id = currentCompanyId();

  const existing = await getCompany(db, id);
  if (existing) return existing;

  const created = await saveCompany(db, { id, name: '' });

  // The trial clock starts locally too, so a contractor whose company row has
  // not synced yet still gets their fourteen days rather than an expired app.
  const { TRIAL_DAYS } = await import('../billing/entitlement');
  await db.adapter.run(
    `update companies set trial_ends_at = ? where id = ? and trial_ends_at is null`,
    [Date.now() + TRIAL_DAYS * 86_400_000, id],
  );

  return (await getCompany(db, id)) ?? created;
}
