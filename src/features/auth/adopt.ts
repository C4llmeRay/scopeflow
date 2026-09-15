/**
 * Adopting work done before signing in.
 *
 * Until now the app used a placeholder company id, so anybody who has been
 * testing has local jobs, rooms, photos and prices filed under it. Signing in
 * hands them a real company id, and without this every one of those rows would
 * be orphaned: invisible to the screens, and refused by RLS if it ever tried to
 * sync.
 *
 * Three things have to move together, and the third is the one that is easy to
 * miss: the rows, the company profile, and THE PENDING OUTBOX PAYLOADS. Queued
 * entries carry a copy of the old company id inside their JSON, and a push
 * carrying the wrong tenant is refused by the server permanently.
 */

import type { LocalDatabase } from '../../db/types';

/** The placeholder every pre-auth install used. */
export const PLACEHOLDER_COMPANY_ID = 'co-1';

/** Every table that files rows under a company. */
const TENANT_TABLES = [
  'jobs',
  'rooms',
  'openings',
  'photos',
  'damages',
  'voice_notes',
  'price_items',
  'line_items',
  'estimates',
] as const;

/** The queues whose payloads embed a company id. */
const QUEUE_TABLES = ['sync_outbox', 'upload_queue', 'ai_queue'] as const;

export interface AdoptionResult {
  /** Rows re-filed under the real company. */
  rowsMoved: number;
  /** Queued pushes rewritten to the real tenant. */
  queueEntriesRewritten: number;
  /** True when a profile the contractor had filled in was carried across. */
  profileCarried: boolean;
}

async function tableExists(db: LocalDatabase, name: string): Promise<boolean> {
  const rows = await db.adapter.all<{ n: number }>(
    `select count(*) as n from sqlite_master where type = 'table' and name = ?`,
    [name],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Moves everything filed under `fromId` to `toId`. Safe to run more than once:
 * once the placeholder holds nothing, it does nothing.
 */
export async function adoptLocalData(
  db: LocalDatabase,
  toId: string,
  fromId: string = PLACEHOLDER_COMPANY_ID,
  now: number = Date.now(),
): Promise<AdoptionResult> {
  const result: AdoptionResult = {
    rowsMoved: 0,
    queueEntriesRewritten: 0,
    profileCarried: false,
  };

  if (fromId === toId) return result;

  return db.adapter.transaction(async () => {
    // ---- The profile they filled in -------------------------------------
    const [placeholder] = await db.adapter.all<Record<string, unknown>>(
      `select * from companies where id = ?`,
      [fromId],
    );

    if (placeholder) {
      const [real] = await db.adapter.all<{ id: string; name: string }>(
        `select id, name from companies where id = ?`,
        [toId],
      );

      // Only carry the profile across when the contractor actually filled one
      // in, and never over the top of a real one that already has a name.
      const hadProfile = String(placeholder.name ?? '').trim() !== '';
      if (hadProfile && (!real || !real.name.trim())) {
        // On a first sign-in the real company row has not synced down yet, so
        // this has to create it rather than assume it is there. An update that
        // silently matched nothing would lose the whole profile.
        await db.adapter.run(
          `insert into companies (id, company_id, name, created_at, updated_at)
           values (?, ?, '', ?, ?)
           on conflict(id) do nothing`,
          [toId, toId, now, now],
        );

        await db.adapter.run(
          `update companies set
             name = ?, license_no = ?, logo_url = ?, phone = ?, email = ?,
             address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
             default_op_pct = ?, default_tax_pct = ?, default_tax_base = ?,
             estimate_terms = ?, ai_job_ceiling_cents = ?, updated_at = ?
           where id = ?`,
          [
            placeholder.name as string,
            (placeholder.license_no ?? null) as string | null,
            (placeholder.logo_url ?? null) as string | null,
            (placeholder.phone ?? null) as string | null,
            (placeholder.email ?? null) as string | null,
            (placeholder.address_line1 ?? null) as string | null,
            (placeholder.address_line2 ?? null) as string | null,
            (placeholder.city ?? null) as string | null,
            (placeholder.state ?? null) as string | null,
            (placeholder.postal_code ?? null) as string | null,
            placeholder.default_op_pct as number,
            placeholder.default_tax_pct as number,
            placeholder.default_tax_base as string,
            (placeholder.estimate_terms ?? null) as string | null,
            placeholder.ai_job_ceiling_cents as number,
            now,
            toId,
          ],
        );
        result.profileCarried = true;
      }

      await db.adapter.run(`delete from companies where id = ?`, [fromId]);
    }

    // ---- The rows --------------------------------------------------------
    for (const table of TENANT_TABLES) {
      const moved = await db.adapter.run(
        `update ${table} set company_id = ? where company_id = ?`,
        [toId, fromId],
      );
      result.rowsMoved += moved.changes;
    }

    // ---- The queued pushes ----------------------------------------------
    // A pending entry carries the old company id inside its JSON payload. Left
    // alone, the server would refuse it as belonging to another tenant, and the
    // engine would park it as a permanent failure.
    for (const table of QUEUE_TABLES) {
      if (!(await tableExists(db, table))) continue;

      const rewritten = await db.adapter.run(
        `update ${table}
            set payload = replace(payload, ?, ?), updated_at = ?
          where state = 'pending' and payload like ?`,
        [`"company_id":"${fromId}"`, `"company_id":"${toId}"`, now, `%"company_id":"${fromId}"%`],
      );
      result.queueEntriesRewritten += rewritten.changes;
    }

    return result;
  });
}

/** Whether there is anything filed under the placeholder worth adopting. */
export async function hasOrphanedData(
  db: LocalDatabase,
  fromId: string = PLACEHOLDER_COMPANY_ID,
): Promise<boolean> {
  for (const table of TENANT_TABLES) {
    const [row] = await db.adapter.all<{ n: number }>(
      `select count(*) as n from ${table} where company_id = ?`,
      [fromId],
    );
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}
