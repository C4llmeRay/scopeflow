/**
 * The rooms repository.
 *
 * Geometry is stored as the three numbers the contractor typed plus offsets.
 * Every derived quantity comes from src/core/measure.ts at read time — one
 * source of truth for geometry, and it is the one with tests around it.
 */

import type { Offset } from '../core/measure';
import { restoreRecord, softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export interface RoomRecord {
  id: string;
  companyId: string;
  jobId: string;
  name: string;
  level: string | null;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  ceilingType: string;
  ceilingMultiplier: number;
  flooringType: string | null;
  offsets: Offset[];
  floodCutHeightIn: number;
  sortOrder: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveRoomInput {
  id: string;
  companyId: string;
  jobId: string;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  level?: string | null;
  ceilingType?: string;
  ceilingMultiplier?: number;
  flooringType?: string | null;
  offsets?: Offset[];
  floodCutHeightIn?: number;
  sortOrder?: number;
  notes?: string | null;
}

interface RoomRow {
  id: string;
  company_id: string;
  job_id: string;
  name: string;
  level: string | null;
  length_in: number;
  width_in: number;
  height_in: number;
  ceiling_type: string;
  ceiling_multiplier: number;
  flooring_type: string | null;
  offsets: string;
  flood_cut_height_in: number;
  sort_order: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    jobId: row.job_id,
    name: row.name,
    level: row.level,
    lengthIn: row.length_in,
    widthIn: row.width_in,
    heightIn: row.height_in,
    ceilingType: row.ceiling_type,
    ceilingMultiplier: row.ceiling_multiplier,
    flooringType: row.flooring_type,
    offsets: JSON.parse(row.offsets) as Offset[],
    floodCutHeightIn: row.flood_cut_height_in,
    sortOrder: row.sort_order,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function saveRoom(
  db: LocalDatabase,
  input: SaveRoomInput,
  now: number = Date.now(),
): Promise<RoomRecord> {
  const offsets = input.offsets ?? [];

  await upsertRecord(
    db,
    {
      entity: 'rooms',
      id: input.id,
      companyId: input.companyId,
      columns: {
        job_id: input.jobId,
        name: input.name,
        level: input.level ?? null,
        length_in: input.lengthIn,
        width_in: input.widthIn,
        height_in: input.heightIn,
        ceiling_type: input.ceilingType ?? 'flat',
        ceiling_multiplier: input.ceilingMultiplier ?? 1,
        flooring_type: input.flooringType ?? null,
        offsets: JSON.stringify(offsets),
        flood_cut_height_in: input.floodCutHeightIn ?? 0,
        sort_order: input.sortOrder ?? 0,
        notes: input.notes ?? null,
      },
      // The column is a JSON string; the server column is jsonb. A dimension of
      // zero means "not measured" — a room that is only a name — and goes to
      // the server as NULL, which its positive-size checks allow.
      payloadOverrides: {
        offsets,
        ...(input.lengthIn > 0 ? {} : { length_in: null }),
        ...(input.widthIn > 0 ? {} : { width_in: null }),
        ...(input.heightIn > 0 ? {} : { height_in: null }),
      },
    },
    now,
  );

  const room = await getRoom(db, input.id);
  if (!room) throw new Error(`room ${input.id} vanished immediately after being saved`);
  return room;
}

/** True once the room has real dimensions, rather than only a name. */
export const isMeasured = (room: Pick<RoomRecord, 'lengthIn' | 'widthIn' | 'heightIn'>): boolean =>
  room.lengthIn > 0 && room.widthIn > 0 && room.heightIn > 0;

/**
 * A room that is only a name — what a contractor taps while photographing. It
 * can be measured later; until then the dimensions are zero here and NULL on
 * the server.
 */
export async function addNamedRoom(
  db: LocalDatabase,
  input: { id: string; companyId: string; jobId: string; name: string; sortOrder?: number },
  now: number = Date.now(),
): Promise<RoomRecord> {
  return saveRoom(
    db,
    { ...input, name: input.name.trim(), lengthIn: 0, widthIn: 0, heightIn: 0 },
    now,
  );
}

export async function listRooms(db: LocalDatabase, jobId: string): Promise<RoomRecord[]> {
  const rows = await db.adapter.all<RoomRow>(
    `select * from rooms
      where job_id = ? and deleted_at is null
      order by sort_order, created_at`,
    [jobId],
  );
  return rows.map(toRecord);
}

export async function getRoom(db: LocalDatabase, id: string): Promise<RoomRecord | null> {
  const [row] = await db.adapter.all<RoomRow>(`select * from rooms where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function softDeleteRoom(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'rooms', id, now);
}

/** Restores a soft-deleted room. Backs the undo toast. */
export async function restoreRoom(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await restoreRecord(db, 'rooms', id, now);
}
