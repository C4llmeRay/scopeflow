/**
 * The openings repository — doors, windows, archways and missing walls.
 *
 * These exist for one reason: they change the quantities. A door removes wall
 * area AND breaks the baseboard run; a window removes wall area but baseboard
 * runs underneath it. That rule lives in src/core/measure.ts, and the null
 * columns here mean "use the default for this kind" rather than a stored guess.
 */

import type { Opening, OpeningKind } from '../core/measure';
import { softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export interface OpeningRecord {
  id: string;
  companyId: string;
  roomId: string;
  kind: OpeningKind;
  widthIn: number;
  heightIn: number;
  count: number;
  deductsWall: boolean | null;
  deductsBase: boolean | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveOpeningInput {
  id: string;
  companyId: string;
  roomId: string;
  kind: OpeningKind;
  widthIn: number;
  heightIn: number;
  count?: number;
  deductsWall?: boolean | null;
  deductsBase?: boolean | null;
}

interface OpeningRow {
  id: string;
  company_id: string;
  room_id: string;
  kind: string;
  width_in: number;
  height_in: number;
  count: number;
  deducts_wall: number | null;
  deducts_base: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** SQLite has no boolean; 0/1/null round-trips through these. */
const fromBit = (v: number | null): boolean | null => (v === null ? null : v === 1);
const toBit = (v: boolean | null | undefined): number | null =>
  v === null || v === undefined ? null : v ? 1 : 0;

function toRecord(row: OpeningRow): OpeningRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    roomId: row.room_id,
    kind: row.kind as OpeningKind,
    widthIn: row.width_in,
    heightIn: row.height_in,
    count: row.count,
    deductsWall: fromBit(row.deducts_wall),
    deductsBase: fromBit(row.deducts_base),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Converts stored openings into what the measurement engine takes. Null
 * overrides are dropped rather than passed as null, so the engine applies its
 * own per-kind default.
 */
export function toCoreOpenings(records: readonly OpeningRecord[]): Opening[] {
  return records.map((record) => {
    const opening: Opening = {
      kind: record.kind,
      widthIn: record.widthIn,
      heightIn: record.heightIn,
      count: record.count,
    };
    if (record.deductsWall !== null) opening.deductsWall = record.deductsWall;
    if (record.deductsBase !== null) opening.deductsBase = record.deductsBase;
    return opening;
  });
}

export async function saveOpening(
  db: LocalDatabase,
  input: SaveOpeningInput,
  now: number = Date.now(),
): Promise<OpeningRecord> {
  await upsertRecord(
    db,
    {
      entity: 'openings',
      id: input.id,
      companyId: input.companyId,
      columns: {
        room_id: input.roomId,
        kind: input.kind,
        width_in: input.widthIn,
        height_in: input.heightIn,
        count: input.count ?? 1,
        deducts_wall: toBit(input.deductsWall),
        deducts_base: toBit(input.deductsBase),
      },
      // Postgres wants real booleans, not SQLite's 0/1.
      payloadOverrides: {
        deducts_wall: input.deductsWall ?? null,
        deducts_base: input.deductsBase ?? null,
      },
    },
    now,
  );

  const opening = await getOpening(db, input.id);
  if (!opening) throw new Error(`opening ${input.id} vanished immediately after being saved`);
  return opening;
}

export async function listOpenings(
  db: LocalDatabase,
  roomId: string,
): Promise<OpeningRecord[]> {
  const rows = await db.adapter.all<OpeningRow>(
    `select * from openings where room_id = ? and deleted_at is null order by created_at`,
    [roomId],
  );
  return rows.map(toRecord);
}

export async function getOpening(
  db: LocalDatabase,
  id: string,
): Promise<OpeningRecord | null> {
  const [row] = await db.adapter.all<OpeningRow>(`select * from openings where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function softDeleteOpening(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'openings', id, now);
}
