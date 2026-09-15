/**
 * The shape every repository write follows.
 *
 * Write the local row and enqueue the outbox entry inside ONE transaction, then
 * return. Nothing awaits the network; nothing can fail because the network is
 * down. Rooms established this pattern by hand — this is that pattern, factored
 * out before four more repositories copy it slightly differently.
 */

import type { SqlParam } from './sqlite-adapter';
import type { SyncEntity } from '../sync/types';
import type { LocalDatabase } from './types';

/** Local rows keep epoch millis; the server wants timestamptz. */
export const iso = (ms: number): string => new Date(ms).toISOString();

export interface RecordSpec {
  /** Table name, the same on the phone and on the server. */
  entity: SyncEntity;
  id: string;
  companyId: string;
  /** Local column values, snake_case, already in storage form. */
  columns: Record<string, SqlParam>;
  /**
   * Values that replace their column counterpart on the wire — a JSON column
   * sent as a real object, an epoch column sent as ISO.
   */
  payloadOverrides?: Record<string, unknown>;
  /** Columns that stay on the phone. A file:// path means nothing to the server. */
  localOnly?: readonly string[];
}

/**
 * Column and table names are compile-time constants from the repositories, never
 * user input, so interpolating them is safe. Every value is bound.
 */
export async function upsertRecord(
  db: LocalDatabase,
  spec: RecordSpec,
  now: number,
): Promise<void> {
  const columns: Record<string, SqlParam> = {
    id: spec.id,
    company_id: spec.companyId,
    ...spec.columns,
  };

  const names = Object.keys(columns);
  const placeholders = names.map(() => '?').join(', ');
  const assignments = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`)
    .join(', ');

  const sql =
    `insert into ${spec.entity} (${names.join(', ')}, created_at, updated_at)\n` +
    `values (${placeholders}, ?, ?)\n` +
    `on conflict(id) do update set ${assignments}, updated_at = excluded.updated_at, deleted_at = null`;

  const localOnly = new Set(spec.localOnly ?? []);
  // The companies table IS the tenant, so it has no company_id column on the
  // server. Every other table is scoped by one.
  const payload: Record<string, unknown> =
    spec.entity === 'companies' ? {} : { company_id: spec.companyId };
  for (const [name, value] of Object.entries(spec.columns)) {
    if (!localOnly.has(name)) payload[name] = value;
  }
  Object.assign(payload, spec.payloadOverrides);
  payload.updated_at = iso(now);
  payload.deleted_at = null;

  await db.adapter.transaction(async () => {
    await db.adapter.run(sql, [...Object.values(columns), now, now]);
    await db.outbox.enqueue(
      { entity: spec.entity, entityId: spec.id, op: 'upsert', payload },
      now,
    );
  });
}

/**
 * Soft delete, so the undo toast has something to restore. The server sees an
 * upsert setting deleted_at, never a DELETE — a room that was measured is part
 * of the claim's history even after the contractor removes it.
 */
export async function softDeleteRecord(
  db: LocalDatabase,
  entity: SyncEntity,
  id: string,
  now: number,
): Promise<boolean> {
  return db.adapter.transaction(async () => {
    const [row] = await db.adapter.all<{ company_id: string }>(
      `select company_id from ${entity} where id = ?`,
      [id],
    );
    if (!row) return false;

    await db.adapter.run(`update ${entity} set deleted_at = ?, updated_at = ? where id = ?`, [
      now,
      now,
      id,
    ]);
    await db.outbox.enqueue(
      {
        entity,
        entityId: id,
        op: 'upsert',
        payload: { company_id: row.company_id, deleted_at: iso(now), updated_at: iso(now) },
      },
      now,
    );
    return true;
  });
}

export async function restoreRecord(
  db: LocalDatabase,
  entity: SyncEntity,
  id: string,
  now: number,
): Promise<boolean> {
  return db.adapter.transaction(async () => {
    const [row] = await db.adapter.all<{ company_id: string }>(
      `select company_id from ${entity} where id = ?`,
      [id],
    );
    if (!row) return false;

    await db.adapter.run(`update ${entity} set deleted_at = null, updated_at = ? where id = ?`, [
      now,
      id,
    ]);
    await db.outbox.enqueue(
      {
        entity,
        entityId: id,
        op: 'upsert',
        payload: { company_id: row.company_id, deleted_at: null, updated_at: iso(now) },
      },
      now,
    );
    return true;
  });
}

/** Patches a few columns locally and queues the same patch for the server. */
export async function patchRecord(
  db: LocalDatabase,
  entity: SyncEntity,
  id: string,
  columns: Record<string, SqlParam>,
  now: number,
  payloadOverrides: Record<string, unknown> = {},
): Promise<boolean> {
  const names = Object.keys(columns);
  if (names.length === 0) return false;

  return db.adapter.transaction(async () => {
    const [row] = await db.adapter.all<{ company_id: string }>(
      `select company_id from ${entity} where id = ?`,
      [id],
    );
    if (!row) return false;

    const assignments = names.map((name) => `${name} = ?`).join(', ');
    await db.adapter.run(
      `update ${entity} set ${assignments}, updated_at = ? where id = ?`,
      [...Object.values(columns), now, id],
    );

    await db.outbox.enqueue(
      {
        entity,
        entityId: id,
        op: 'upsert',
        payload: {
          company_id: row.company_id,
          ...columns,
          ...payloadOverrides,
          updated_at: iso(now),
        },
      },
      now,
    );
    return true;
  });
}
