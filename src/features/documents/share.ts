/**
 * Publishing an estimate as a link.
 *
 * A capability URL: the path carries a UUID, and holding the link is what grants
 * access. That is a deliberate trade — an adjuster will not create an account to
 * read an estimate, and the alternative is emailing a PDF, which is no more
 * private. Revoking works by deleting the object.
 */

import { getSupabase } from '../../lib/supabase';
import { newId } from '../../lib/id';
import { patchRecord } from '../../db/repository';
import type { EstimateRecord } from '../../db/estimates';
import type { LocalDatabase } from '../../db/types';

export const SHARE_BUCKET = 'estimate-shares';

/** `<company>/<uuid>.html` — the company folder is what the RLS policy keys on. */
export function sharePathFor(companyId: string, token: string = newId()): string {
  return `${companyId}/${token}.html`;
}

export interface PublishedShare {
  path: string;
  url: string;
}

export async function publishEstimateShare(
  db: LocalDatabase,
  estimate: EstimateRecord,
  html: string,
  now: number = Date.now(),
): Promise<PublishedShare> {
  const supabase = getSupabase();
  // Reuse the path if one exists, so re-publishing updates the link the
  // adjuster already has rather than stranding it.
  const path = estimate.sharePath ?? sharePathFor(estimate.companyId);

  const { error } = await supabase.storage
    .from(SHARE_BUCKET)
    .upload(path, new TextEncoder().encode(html), {
      contentType: 'text/html',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(SHARE_BUCKET).getPublicUrl(path);
  await patchRecord(db, 'estimates', estimate.id, { share_path: path }, now);

  return { path, url: data.publicUrl };
}

/** Takes the link down. The estimate row itself is untouched. */
export async function revokeEstimateShare(
  db: LocalDatabase,
  estimate: EstimateRecord,
  now: number = Date.now(),
): Promise<void> {
  if (!estimate.sharePath) return;

  const { error } = await getSupabase().storage.from(SHARE_BUCKET).remove([estimate.sharePath]);
  if (error) throw error;

  await patchRecord(db, 'estimates', estimate.id, { share_path: null }, now);
}

export function shareUrlFor(estimate: EstimateRecord): string | null {
  if (!estimate.sharePath) return null;
  try {
    return getSupabase().storage.from(SHARE_BUCKET).getPublicUrl(estimate.sharePath).data.publicUrl;
  } catch {
    // Supabase is not configured; the estimate still exists as a PDF.
    return null;
  }
}
