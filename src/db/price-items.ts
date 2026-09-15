/**
 * The price list repository.
 *
 * A contractor's own numbers, which they trust more than anything shipped. The
 * code is the natural key — a CSV has no ids — so an import matches on code and
 * updates in place rather than creating a second row a contractor then has to
 * hunt down.
 */

import type { PriceItemDraft } from '../features/pricing/import';
import { softDeleteRecord, upsertRecord } from './repository';
import type { LocalDatabase } from './types';

export interface PriceItemRecord {
  id: string;
  companyId: string;
  code: string;
  description: string;
  unit: string;
  category: string | null;
  materialCostCents: number;
  laborCostCents: number;
  wastePct: number;
  usefulLifeYears: number | null;
  isSeed: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SavePriceItemInput {
  id: string;
  companyId: string;
  code: string;
  description: string;
  unit: string;
  category?: string | null;
  materialCostCents?: number;
  laborCostCents?: number;
  wastePct?: number;
  usefulLifeYears?: number | null;
  isSeed?: boolean;
}

interface PriceItemRow {
  id: string;
  company_id: string;
  code: string;
  description: string;
  unit: string;
  category: string | null;
  material_cost_cents: number;
  labor_cost_cents: number;
  waste_pct: number;
  useful_life_years: number | null;
  is_seed: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toRecord(row: PriceItemRow): PriceItemRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    category: row.category,
    materialCostCents: row.material_cost_cents,
    laborCostCents: row.labor_cost_cents,
    wastePct: row.waste_pct,
    usefulLifeYears: row.useful_life_years,
    isSeed: row.is_seed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** What one unit costs all in. Only ever used for display. */
export const unitPriceCents = (item: PriceItemRecord): number =>
  item.materialCostCents + item.laborCostCents;

export async function savePriceItem(
  db: LocalDatabase,
  input: SavePriceItemInput,
  now: number = Date.now(),
): Promise<PriceItemRecord> {
  await upsertRecord(
    db,
    {
      entity: 'price_items',
      id: input.id,
      companyId: input.companyId,
      columns: {
        code: input.code,
        description: input.description,
        unit: input.unit,
        category: input.category ?? null,
        material_cost_cents: input.materialCostCents ?? 0,
        labor_cost_cents: input.laborCostCents ?? 0,
        waste_pct: input.wastePct ?? 0,
        useful_life_years: input.usefulLifeYears ?? null,
        is_seed: input.isSeed ? 1 : 0,
      },
      // Postgres wants a real boolean, not SQLite's 0/1.
      payloadOverrides: { is_seed: Boolean(input.isSeed) },
    },
    now,
  );

  const item = await getPriceItem(db, input.id);
  if (!item) throw new Error(`price item ${input.id} vanished immediately after being saved`);
  return item;
}

export async function getPriceItem(
  db: LocalDatabase,
  id: string,
): Promise<PriceItemRecord | null> {
  const [row] = await db.adapter.all<PriceItemRow>(`select * from price_items where id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function getPriceItemByCode(
  db: LocalDatabase,
  companyId: string,
  code: string,
): Promise<PriceItemRecord | null> {
  const [row] = await db.adapter.all<PriceItemRow>(
    `select * from price_items
      where company_id = ? and upper(code) = upper(?) and deleted_at is null`,
    [companyId, code],
  );
  return row ? toRecord(row) : null;
}

export async function listPriceItems(
  db: LocalDatabase,
  companyId: string,
  search?: string,
): Promise<PriceItemRecord[]> {
  if (search?.trim()) {
    const like = `%${search.trim().toLowerCase()}%`;
    const rows = await db.adapter.all<PriceItemRow>(
      `select * from price_items
        where company_id = ? and deleted_at is null
          and (lower(code) like ? or lower(description) like ? or lower(category) like ?)
        order by category, code`,
      [companyId, like, like, like],
    );
    return rows.map(toRecord);
  }

  const rows = await db.adapter.all<PriceItemRow>(
    `select * from price_items
      where company_id = ? and deleted_at is null
      order by category, code`,
    [companyId],
  );
  return rows.map(toRecord);
}

export async function countPriceItems(db: LocalDatabase, companyId: string): Promise<number> {
  const [row] = await db.adapter.all<{ n: number }>(
    `select count(*) as n from price_items where company_id = ? and deleted_at is null`,
    [companyId],
  );
  return row?.n ?? 0;
}

export async function softDeletePriceItem(
  db: LocalDatabase,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await softDeleteRecord(db, 'price_items', id, now);
}

export interface ImportSummary {
  added: number;
  updated: number;
}

/**
 * Applies imported drafts to the price list, matching on code.
 *
 * Re-importing a corrected spreadsheet is the normal case, not the exception:
 * a contractor updates their numbers every quarter and expects the second
 * import to replace the first, not to double it.
 */
export async function applyPriceImport(
  db: LocalDatabase,
  companyId: string,
  drafts: readonly PriceItemDraft[],
  makeId: () => string,
  now: number = Date.now(),
): Promise<ImportSummary> {
  let added = 0;
  let updated = 0;

  for (const draft of drafts) {
    const existing = await getPriceItemByCode(db, companyId, draft.code);
    if (existing) updated++;
    else added++;

    await savePriceItem(
      db,
      {
        id: existing?.id ?? makeId(),
        companyId,
        code: draft.code,
        description: draft.description,
        unit: draft.unit,
        category: draft.category,
        materialCostCents: draft.materialCostCents,
        laborCostCents: draft.laborCostCents,
        wastePct: draft.wastePct,
        usefulLifeYears: draft.usefulLifeYears,
        // An imported row is the contractor's own, never a seed row, even when
        // it replaces one.
        isSeed: false,
      },
      now,
    );
  }

  return { added, updated };
}

/**
 * Installs the starter list into an empty price list.
 *
 * Only ever runs when the contractor has nothing, so it can never overwrite
 * imported numbers. Seed rows are flagged, and the UI says plainly that they
 * are a starting point rather than regional pricing.
 */
export async function seedPriceListIfEmpty(
  db: LocalDatabase,
  companyId: string,
  makeId: () => string,
  now: number = Date.now(),
): Promise<number> {
  if ((await countPriceItems(db, companyId)) > 0) return 0;

  const { SEED_PRICE_LIST } = await import('../features/pricing/seed-list');
  for (const item of SEED_PRICE_LIST) {
    await savePriceItem(
      db,
      {
        id: makeId(),
        companyId,
        code: item.code,
        description: item.description,
        unit: item.unit,
        category: item.category,
        materialCostCents: item.materialCostCents,
        laborCostCents: item.laborCostCents,
        wastePct: item.wastePct,
        usefulLifeYears: item.usefulLifeYears,
        isSeed: true,
      },
      now,
    );
  }
  return SEED_PRICE_LIST.length;
}
