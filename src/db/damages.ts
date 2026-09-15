/**
 * The damages repository — what is wrong, where, and how bad.
 *
 * `material` is text rather than an enum on purpose: the taxonomy will churn
 * through beta, and a migration for every new material is friction you do not
 * need in week three. `source` records whether a human or a model produced the
 * record, which is what lets the UI mark AI findings as suggestions.
 */

import { softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export type WaterCategory = 'cat_1' | 'cat_2' | 'cat_3';
export type WaterClass = 'class_1' | 'class_2' | 'class_3' | 'class_4';
export type DamageSource = 'manual' | 'ai_photo' | 'ai_voice';

/** IICRC S500 in the words a contractor uses out loud. */
export const WATER_CATEGORY_LABELS: Record<WaterCategory, string> = {
  cat_1: 'Cat 1 — clean',
  cat_2: 'Cat 2 — grey',
  cat_3: 'Cat 3 — black',
};

export const WATER_CLASS_LABELS: Record<WaterClass, string> = {
  class_1: 'Class 1 — least absorption',
  class_2: 'Class 2 — whole room, up the wall',
  class_3: 'Class 3 — from above, saturated',
  class_4: 'Class 4 — deeply bound materials',
};

/** The materials a water loss actually touches, in the order they get checked. */
export const COMMON_MATERIALS = [
  'Carpet',
  'Carpet pad',
  'Laminate',
  'Hardwood',
  'Vinyl plank',
  'Tile',
  'Subfloor',
  'Drywall',
  'Insulation',
  'Baseboard',
  'Ceiling',
  'Cabinet',
  'Door',
  'Trim',
] as const;

export interface DamageRecord {
  id: string;
  companyId: string;
  roomId: string;
  photoId: string | null;
  material: string;
  waterCategory: WaterCategory | null;
  waterClass: WaterClass | null;
  affectedPct: number | null;
  affectedHeightIn: number | null;
  moisturePct: number | null;
  notes: string | null;
  source: DamageSource;
  aiConfidence: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveDamageInput {
  id: string;
  companyId: string;
  roomId: string;
  material: string;
  photoId?: string | null;
  waterCategory?: WaterCategory | null;
  waterClass?: WaterClass | null;
  affectedPct?: number | null;
  affectedHeightIn?: number | null;
  moisturePct?: number | null;
  notes?: string | null;
  source?: DamageSource;
  aiConfidence?: number | null;
}

interface DamageRow {
  id: string;
  company_id: string;
  room_id: string;
  photo_id: string | null;
  material: string;
  water_category: string | null;
  water_class: string | null;
  affected_pct: number | null;
  affected_height_in: number | null;
  moisture_pct: number | null;
  notes: string | null;
  source: string;
  ai_confidence: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: DamageRow): DamageRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    roomId: row.room_id,
    photoId: row.photo_id,
    material: row.material,
    waterCategory: row.water_category as WaterCategory | null,
    waterClass: row.water_class as WaterClass | null,
    affectedPct: row.affected_pct,
    affectedHeightIn: row.affected_height_in,
    moisturePct: row.moisture_pct,
    notes: row.notes,
    source: row.source as DamageSource,
    aiConfidence: row.ai_confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function saveDamage(
  db: LocalDatabase,
  input: SaveDamageInput,
  now: number = Date.now(),
): Promise<DamageRecord> {
  await upsertRecord(
    db,
    {
      entity: 'damages',
      id: input.id,
      companyId: input.companyId,
      columns: {
        room_id: input.roomId,
        photo_id: input.photoId ?? null,
        material: input.material,
        water_category: input.waterCategory ?? null,
        water_class: input.waterClass ?? null,
        affected_pct: input.affectedPct ?? null,
        affected_height_in: input.affectedHeightIn ?? null,
        moisture_pct: input.moisturePct ?? null,
        notes: input.notes ?? null,
        source: input.source ?? 'manual',
        ai_confidence: input.aiConfidence ?? null,
      },
    },
    now,
  );

  const damage = await getDamage(db, input.id);
  if (!damage) throw new Error(`damage ${input.id} vanished immediately after being saved`);
  return damage;
}

export async function listDamages(db: LocalDatabase, roomId: string): Promise<DamageRecord[]> {
  const rows = await db.adapter.all<DamageRow>(
    `select * from damages where room_id = ? and deleted_at is null order by created_at`,
    [roomId],
  );
  return rows.map(toRecord);
}

export async function getDamage(db: LocalDatabase, id: string): Promise<DamageRecord | null> {
  const [row] = await db.adapter.all<DamageRow>(`select * from damages where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function softDeleteDamage(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'damages', id, now);
}

/**
 * The deepest water line recorded in a room, which is what the flood cut height
 * should be measured against. Null when nothing has been measured yet.
 */
export async function deepestWaterLineIn(
  db: LocalDatabase,
  roomId: string,
): Promise<number | null> {
  const [row] = await db.adapter.all<{ max_height: number | null }>(
    `select max(affected_height_in) as max_height from damages
      where room_id = ? and deleted_at is null`,
    [roomId],
  );
  return row?.max_height ?? null;
}
