/**
 * The line items repository — the scope itself.
 *
 * Code, description, unit and both unit costs are COPIED from the price item at
 * the moment the line is created, and the price item id is kept only for
 * traceability. That is deliberate: editing the price list next quarter must
 * not silently rewrite a scope that has already been priced and sent.
 */

import { patchRecord, softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';
import type { PriceItemRecord } from './price-items';
import type { ScopeLine } from '../features/scope/templates';

export type LineItemOrigin = 'manual' | 'template' | 'ai';
export type LineItemStatus = 'suggested' | 'accepted' | 'rejected';

export interface LineItemRecord {
  id: string;
  companyId: string;
  jobId: string;
  roomId: string | null;
  priceItemId: string | null;
  code: string;
  description: string;
  unit: string;
  qty: number;
  wastePct: number;
  materialUnitCents: number;
  laborUnitCents: number;
  ageYears: number | null;
  usefulLifeYears: number | null;
  depreciationRecoverable: boolean;
  origin: LineItemOrigin;
  status: LineItemStatus;
  aiConfidence: number | null;
  note: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SaveLineItemInput {
  id: string;
  companyId: string;
  jobId: string;
  roomId?: string | null;
  priceItemId?: string | null;
  code: string;
  description: string;
  unit: string;
  qty: number;
  wastePct?: number;
  materialUnitCents?: number;
  laborUnitCents?: number;
  ageYears?: number | null;
  usefulLifeYears?: number | null;
  depreciationRecoverable?: boolean;
  origin?: LineItemOrigin;
  status?: LineItemStatus;
  aiConfidence?: number | null;
  note?: string | null;
  sortOrder?: number;
}

interface LineItemRow {
  id: string;
  company_id: string;
  job_id: string;
  room_id: string | null;
  price_item_id: string | null;
  code: string;
  description: string;
  unit: string;
  qty: number;
  waste_pct: number;
  material_unit_cents: number;
  labor_unit_cents: number;
  age_years: number | null;
  useful_life_years: number | null;
  depreciation_recoverable: number;
  origin: string;
  status: string;
  ai_confidence: number | null;
  note: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: LineItemRow): LineItemRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    jobId: row.job_id,
    roomId: row.room_id,
    priceItemId: row.price_item_id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    qty: row.qty,
    wastePct: row.waste_pct,
    materialUnitCents: row.material_unit_cents,
    laborUnitCents: row.labor_unit_cents,
    ageYears: row.age_years,
    usefulLifeYears: row.useful_life_years,
    depreciationRecoverable: row.depreciation_recoverable === 1,
    origin: row.origin as LineItemOrigin,
    status: row.status as LineItemStatus,
    aiConfidence: row.ai_confidence,
    note: row.note,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function saveLineItem(
  db: LocalDatabase,
  input: SaveLineItemInput,
  now: number = Date.now(),
): Promise<LineItemRecord> {
  // The plan's rule, enforced on the way in as well as in Postgres: anything a
  // model proposed starts as a suggestion and needs a human tap.
  const origin = input.origin ?? 'manual';
  const status = origin === 'ai' ? 'suggested' : (input.status ?? 'accepted');

  await upsertRecord(
    db,
    {
      entity: 'line_items',
      id: input.id,
      companyId: input.companyId,
      columns: {
        job_id: input.jobId,
        room_id: input.roomId ?? null,
        price_item_id: input.priceItemId ?? null,
        code: input.code,
        description: input.description,
        unit: input.unit,
        qty: input.qty,
        waste_pct: input.wastePct ?? 0,
        material_unit_cents: input.materialUnitCents ?? 0,
        labor_unit_cents: input.laborUnitCents ?? 0,
        age_years: input.ageYears ?? null,
        useful_life_years: input.usefulLifeYears ?? null,
        depreciation_recoverable: input.depreciationRecoverable === false ? 0 : 1,
        origin,
        status,
        ai_confidence: input.aiConfidence ?? null,
        note: input.note ?? null,
        sort_order: input.sortOrder ?? 0,
      },
      payloadOverrides: {
        depreciation_recoverable: input.depreciationRecoverable !== false,
      },
    },
    now,
  );

  const item = await getLineItem(db, input.id);
  if (!item) throw new Error(`line item ${input.id} vanished immediately after being saved`);
  return item;
}

export async function getLineItem(
  db: LocalDatabase,
  id: string,
): Promise<LineItemRecord | null> {
  const [row] = await db.adapter.all<LineItemRow>(`select * from line_items where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function listLineItems(
  db: LocalDatabase,
  jobId: string,
): Promise<LineItemRecord[]> {
  const rows = await db.adapter.all<LineItemRow>(
    `select * from line_items
      where job_id = ? and deleted_at is null
      order by sort_order, created_at`,
    [jobId],
  );
  return rows.map(toRecord);
}

export async function listRoomLineItems(
  db: LocalDatabase,
  roomId: string,
): Promise<LineItemRecord[]> {
  const rows = await db.adapter.all<LineItemRow>(
    `select * from line_items
      where room_id = ? and deleted_at is null
      order by sort_order, created_at`,
    [roomId],
  );
  return rows.map(toRecord);
}

export async function setLineItemStatus(
  db: LocalDatabase,
  id: string,
  status: LineItemStatus,
  now: number = Date.now(),
): Promise<void> {
  await patchRecord(db, 'line_items', id, { status }, now);
}

export async function setLineItemQty(
  db: LocalDatabase,
  id: string,
  qty: number,
  now: number = Date.now(),
): Promise<void> {
  if (qty < 0) throw new RangeError(`qty must be >= 0, received ${qty}`);
  await patchRecord(db, 'line_items', id, { qty }, now);
}

/**
 * Edits the quantity and the prices on one line.
 *
 * A contractor overrides these constantly: the template's quantity is a
 * starting point, and a price gets bumped for one job without touching the
 * price list. Editing here never writes back to the price item — the copy on
 * the line is the authority once it exists.
 */
export async function updateLineItemPricing(
  db: LocalDatabase,
  id: string,
  next: {
    qty: number;
    wastePct: number;
    materialUnitCents: number;
    laborUnitCents: number;
  },
  now: number = Date.now(),
): Promise<void> {
  if (next.qty < 0) throw new RangeError(`qty must be >= 0, received ${next.qty}`);
  if (next.wastePct < 0 || next.wastePct > 100) {
    throw new RangeError(`wastePct must be 0-100, received ${next.wastePct}`);
  }
  if (next.materialUnitCents < 0 || next.laborUnitCents < 0) {
    throw new RangeError('unit costs cannot be negative');
  }

  await patchRecord(
    db,
    'line_items',
    id,
    {
      qty: next.qty,
      waste_pct: next.wastePct,
      material_unit_cents: next.materialUnitCents,
      labor_unit_cents: next.laborUnitCents,
      // A hand-edited line is no longer the template's to replace on re-scope.
      origin: 'manual',
    },
    now,
  );
}

export async function softDeleteLineItem(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'line_items', id, now);
}

export interface ApplyScopeResult {
  created: LineItemRecord[];
  /** Proposed codes with no matching price item — reported, never invented. */
  skipped: ScopeLine[];
}

/**
 * Turns proposed scope lines into real line items for a room.
 *
 * A line is only created when its code exists in the contractor's price list.
 * Anything else is reported back so the UI can say "three items need prices"
 * rather than quietly producing a scope with holes in it.
 */
export async function applyScopeToRoom(
  db: LocalDatabase,
  context: { companyId: string; jobId: string; roomId: string },
  lines: readonly ScopeLine[],
  priceItems: readonly PriceItemRecord[],
  makeId: () => string,
  now: number = Date.now(),
): Promise<ApplyScopeResult> {
  const byCode = new Map(priceItems.map((item) => [item.code.toUpperCase(), item]));
  const created: LineItemRecord[] = [];
  const skipped: ScopeLine[] = [];

  // Replace whatever the template put here last time; anything a human touched
  // has already been edited into a manual line and is left alone.
  const existing = await listRoomLineItems(db, context.roomId);
  for (const item of existing) {
    if (item.origin === 'template') await softDeleteLineItem(db, item.id, now);
  }

  let order = 0;
  for (const line of lines) {
    const priceItem = byCode.get(line.code.toUpperCase());
    if (!priceItem) {
      skipped.push(line);
      continue;
    }

    created.push(
      await saveLineItem(
        db,
        {
          id: makeId(),
          companyId: context.companyId,
          jobId: context.jobId,
          roomId: context.roomId,
          priceItemId: priceItem.id,
          // Copied, not referenced: a later price change must not rewrite this.
          code: priceItem.code,
          description: priceItem.description,
          unit: priceItem.unit,
          qty: line.qty,
          wastePct: priceItem.wastePct,
          materialUnitCents: priceItem.materialCostCents,
          laborUnitCents: priceItem.laborCostCents,
          usefulLifeYears: priceItem.usefulLifeYears,
          origin: 'template',
          status: 'accepted',
          note: line.reason,
          sortOrder: order++,
        },
        now,
      ),
    );
  }

  return { created, skipped };
}
