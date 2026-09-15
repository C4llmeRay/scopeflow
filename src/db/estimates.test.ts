/**
 * Phase 2 end to end, against real SQLite.
 *
 * Measure a room, say what got wet, auto-scope it against the contractor's own
 * price list, price it, freeze it. The headline test reproduces the build
 * plan's worked example from stored data rather than from a fixture — if the
 * chain from geometry to net claim ever breaks, it breaks here.
 */

import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { computeRoom } from '../core/measure';
import { ft } from '../core/units';
import { buildScope } from '../features/scope/templates';
import { SqliteOutboxStore } from '../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../sync/uploads';
import {
  createEstimateVersion,
  EstimateIsFrozen,
  getEstimate,
  listEstimates,
  markEstimateSent,
  nextVersion,
  priceJob,
} from './estimates';
import { getJob, saveJob, type JobRecord } from './jobs';
import {
  applyScopeToRoom,
  listLineItems,
  saveLineItem,
  setLineItemStatus,
  softDeleteLineItem,
} from './line-items';
import { applyPriceImport, listPriceItems, savePriceItem } from './price-items';
import { saveRoom } from './rooms';
import { APP_SCHEMA } from './schema';
import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';
import type { LocalDatabase } from './types';

function nodeAdapter(): SqliteAdapter {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      return { changes: Number(db.prepare(sql).run(...params).changes) };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('begin');
      try {
        const r = await fn();
        db.exec('commit');
        return r;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
}

async function makeDb(): Promise<LocalDatabase> {
  const adapter = nodeAdapter();
  await adapter.exec(APP_SCHEMA);
  return {
    adapter,
    outbox: await SqliteOutboxStore.create(adapter),
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
}

let counter = 0;
const makeId = () => `id-${++counter}`;

/** The plan's price list, with the material/labor split it actually uses. */
const PRICE_CSV = [
  'Code,Description,Unit,Category,Material Cost,Labor Cost',
  'WTR-EXT,"Water extraction, carpeted floor",SF,Mitigation,0,0.62',
  'FCC-RMV,Remove carpet,SF,Flooring,0,0.32',
  'FCC-PAD,Remove and dispose carpet pad,SF,Flooring,0,0.28',
  'DRY-FC2,"Drywall flood cut and remove, 2 ft",SF,Drywall,0,1.86',
  'INS-R13,"R-13 batt insulation, remove and replace",SF,Insulation,0.95,0.47',
  'EQP-DEH,"Dehumidifier, per day",DA,Equipment,0,88.00',
  'EQP-AM,"Air mover, per day",DA,Equipment,0,26.50',
  'DRY-HTF,"Drywall hang, tape, float and texture",SF,Drywall,1.30,1.44',
  'PNT-W2,"Paint walls, two coats",SF,Paint,0.35,0.57',
  'FCC-CPT,"Carpet with pad, replace",SF,Flooring,3.20,0.90',
  'BAS-RR,"Baseboard, remove and replace",LF,Trim,2.40,1.45',
].join('\n');

async function seedJobAndPrices(db: LocalDatabase): Promise<JobRecord> {
  const job = await saveJob(
    db,
    {
      id: 'job-1',
      companyId: 'co-1',
      propertyAddress1: '1812 Water Street',
      claimNo: 'CLM-2026-884120',
      carrier: 'Lone Star Mutual',
      opPct: 20,
      taxPct: 7,
      taxBase: 'materials',
      deductibleCents: 100_000,
    },
    1_000,
  );

  const { importPriceList } = await import('../features/pricing/import');
  await applyPriceImport(db, 'co-1', importPriceList(PRICE_CSV).items, makeId, 1_000);
  return job;
}

describe('the plan worked example, from stored data', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
  });

  it('measures, scopes, prices and freezes a bedroom', async () => {
    const job = await seedJobAndPrices(db);

    // 12 x 14 x 8 with a door, a window and a 2 ft flood cut.
    await saveRoom(
      db,
      {
        id: 'room-1',
        companyId: 'co-1',
        jobId: 'job-1',
        name: 'Master Bedroom',
        lengthIn: ft(12),
        widthIn: ft(14),
        heightIn: ft(8),
        floodCutHeightIn: ft(2),
      },
      1_000,
    );

    const quantities = computeRoom({
      lengthIn: ft(12),
      widthIn: ft(14),
      heightIn: ft(8),
      openings: [
        { kind: 'door', widthIn: 36, heightIn: 80 },
        { kind: 'window', widthIn: 48, heightIn: 36 },
      ],
      floodCutHeightIn: ft(2),
    });

    const scope = buildScope({
      quantities,
      materials: ['Carpet', 'Carpet pad', 'Drywall', 'Insulation', 'Baseboard'],
      waterCategory: 'cat_2',
      waterClass: 'class_2',
      floodCutHeightIn: ft(2),
    });

    const priceItems = await listPriceItems(db, 'co-1');
    const { created, skipped } = await applyScopeToRoom(
      db,
      { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' },
      scope,
      priceItems,
      makeId,
      1_000,
    );

    expect(skipped).toEqual([]);
    expect(created).toHaveLength(11);

    const { totals } = await priceJob(db, job);

    // Quantities came from geometry, prices from the imported list.
    expect(totals.lines.find((l) => l.code === 'FCC-CPT')?.qty).toBe(168);
    expect(totals.lines.find((l) => l.code === 'DRY-FC2')?.qty).toBe(104);
    expect(totals.lines.find((l) => l.code === 'PNT-W2')?.qty).toBe(384);
    expect(totals.lines.find((l) => l.code === 'BAS-RR')?.qty).toBe(49);

    // Every figure reconciles.
    expect(totals.materialSubtotalCents + totals.laborSubtotalCents).toBe(
      totals.lineSubtotalCents,
    );
    expect(totals.rcvCents).toBe(
      totals.lineSubtotalCents + totals.opCents + totals.taxCents,
    );
    expect(totals.acvCents).toBe(totals.rcvCents - totals.depreciationCents);
    expect(totals.netClaimCents).toBe(
      Math.max(0, totals.acvCents - totals.deductibleCents),
    );

    const estimate = await createEstimateVersion(db, job, makeId, 2_000);
    expect(estimate.version).toBe(1);
    expect(estimate.status).toBe('draft');
    expect(estimate.netClaimCents).toBe(totals.netClaimCents);
  });
});

describe('priceJob', () => {
  let db: LocalDatabase;
  let job: JobRecord;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      {
        id: 'room-1',
        companyId: 'co-1',
        jobId: 'job-1',
        name: 'Master Bedroom',
        lengthIn: ft(12),
        widthIn: ft(14),
        heightIn: ft(8),
      },
      1_000,
    );
  });

  const addLine = (over: Record<string, unknown> = {}) =>
    saveLineItem(
      db,
      {
        id: makeId(),
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        code: 'FCC-CPT',
        description: 'Carpet with pad, replace',
        unit: 'SF',
        qty: 100,
        materialUnitCents: 320,
        laborUnitCents: 90,
        ...over,
      },
      1_000,
    );

  it('prices nothing when the scope is empty', async () => {
    const { totals } = await priceJob(db, job);
    expect(totals.lineSubtotalCents).toBe(0);
    expect(totals.netClaimCents).toBe(0);
  });

  it('prices only accepted lines', async () => {
    await addLine();
    await addLine({ status: 'suggested' });
    await addLine({ status: 'rejected' });

    const { totals, suggestedCount } = await priceJob(db, job);
    expect(totals.lines).toHaveLength(1);
    expect(suggestedCount).toBe(1);
  });

  it('keeps an AI line out of the total until a human taps it', async () => {
    await addLine({ origin: 'ai', status: 'accepted', aiConfidence: 0.9 });

    // The repository forces an AI line to suggested regardless of what was asked.
    const [line] = await listLineItems(db, 'job-1');
    expect(line.status).toBe('suggested');

    const before = await priceJob(db, job);
    expect(before.totals.lineSubtotalCents).toBe(0);

    await setLineItemStatus(db, line.id, 'accepted', 2_000);
    const after = await priceJob(db, job);
    expect(after.totals.lineSubtotalCents).toBe(41_000);
  });

  it('ignores a deleted line', async () => {
    const line = await addLine();
    await softDeleteLineItem(db, line.id, 2_000);
    expect((await priceJob(db, job)).totals.lineSubtotalCents).toBe(0);
  });

  it('applies the job money terms, not the company defaults', async () => {
    await addLine({ qty: 100, materialUnitCents: 100, laborUnitCents: 0 });
    const noOp = await saveJob(db, { id: 'job-1', companyId: 'co-1', opPct: 0, taxPct: 0 }, 2_000);

    const { totals } = await priceJob(db, noOp);
    expect(totals.opCents).toBe(0);
    expect(totals.taxCents).toBe(0);
  });
});

describe('applyScopeToRoom', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    await seedJobAndPrices(db);
    await saveRoom(
      db,
      {
        id: 'room-1',
        companyId: 'co-1',
        jobId: 'job-1',
        name: 'Room',
        lengthIn: ft(10),
        widthIn: ft(10),
        heightIn: ft(8),
      },
      1_000,
    );
  });

  it('reports codes the contractor has no price for instead of inventing them', async () => {
    const priceItems = await listPriceItems(db, 'co-1');
    const { created, skipped } = await applyScopeToRoom(
      db,
      { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' },
      [
        { code: 'FCC-CPT', qty: 100, reason: 'Carpet replaced' },
        { code: 'WTR-ABM', qty: 100, reason: 'Category 3 treatment' },
      ],
      priceItems,
      makeId,
      1_000,
    );

    expect(created.map((l) => l.code)).toEqual(['FCC-CPT']);
    expect(skipped.map((l) => l.code)).toEqual(['WTR-ABM']);
  });

  it('copies the price rather than referencing it', async () => {
    const priceItems = await listPriceItems(db, 'co-1');
    await applyScopeToRoom(
      db,
      { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' },
      [{ code: 'FCC-CPT', qty: 100, reason: 'Carpet' }],
      priceItems,
      makeId,
      1_000,
    );

    // The contractor raises their carpet price after scoping.
    const carpet = priceItems.find((p) => p.code === 'FCC-CPT')!;
    await savePriceItem(
      db,
      { ...carpet, materialCostCents: 999, description: carpet.description },
      2_000,
    );

    const [line] = await listLineItems(db, 'job-1');
    expect(line.materialUnitCents).toBe(320);
  });

  it('carries the reason onto the line, so the scope explains itself', async () => {
    const priceItems = await listPriceItems(db, 'co-1');
    await applyScopeToRoom(
      db,
      { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' },
      [{ code: 'FCC-CPT', qty: 100, reason: 'Carpet replaced' }],
      priceItems,
      makeId,
      1_000,
    );
    expect((await listLineItems(db, 'job-1'))[0].note).toBe('Carpet replaced');
  });

  it('replaces its own previous template lines but leaves manual ones alone', async () => {
    const priceItems = await listPriceItems(db, 'co-1');
    const context = { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' };

    await saveLineItem(
      db,
      {
        id: 'manual-1',
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        code: 'BAS-RR',
        description: 'Baseboard the contractor added by hand',
        unit: 'LF',
        qty: 40,
        origin: 'manual',
      },
      1_000,
    );

    await applyScopeToRoom(db, context, [{ code: 'FCC-CPT', qty: 100, reason: 'a' }], priceItems, makeId, 1_000);
    await applyScopeToRoom(db, context, [{ code: 'FCC-RMV', qty: 100, reason: 'b' }], priceItems, makeId, 2_000);

    const codes = (await listLineItems(db, 'job-1')).map((l) => l.code).sort();
    expect(codes).toEqual(['BAS-RR', 'FCC-RMV']);
  });
});

describe('estimate versions', () => {
  let db: LocalDatabase;
  let job: JobRecord;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
    await saveLineItem(
      db,
      {
        id: 'line-1',
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        code: 'FCC-CPT',
        description: 'Carpet with pad, replace',
        unit: 'SF',
        qty: 100,
        materialUnitCents: 320,
        laborUnitCents: 90,
      },
      1_000,
    );
  });

  it('numbers versions from one', async () => {
    expect(await nextVersion(db, 'job-1')).toBe(1);
    const first = await createEstimateVersion(db, job, makeId, 2_000);
    expect(first.version).toBe(1);
    expect(await nextVersion(db, 'job-1')).toBe(2);
  });

  it('freezes the scope into the snapshot', async () => {
    const estimate = await createEstimateVersion(db, job, makeId, 2_000);

    expect(estimate.snapshot.job.claimNo).toBe('CLM-2026-884120');
    expect(estimate.snapshot.rooms).toHaveLength(1);
    expect(estimate.snapshot.lines).toHaveLength(1);
    expect(estimate.snapshot.lines[0]).toMatchObject({
      code: 'FCC-CPT',
      qty: 100,
      materialUnitCents: 320,
      totalCents: 41_000,
    });
  });

  it('does not change a sent estimate when the scope is edited afterwards', async () => {
    const estimate = await createEstimateVersion(db, job, makeId, 2_000);
    const sent = await markEstimateSent(db, estimate.id, 'adjuster@carrier.test', 3_000);
    const frozenTotal = sent.rcvCents;
    const frozenLines = sent.snapshot.lines.length;

    // The contractor re-measures and adds work.
    await saveLineItem(
      db,
      {
        id: 'line-2',
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        code: 'BAS-RR',
        description: 'Baseboard',
        unit: 'LF',
        qty: 40,
        materialUnitCents: 240,
        laborUnitCents: 145,
      },
      4_000,
    );

    const reloaded = (await listEstimates(db, 'job-1')).find((e) => e.id === estimate.id)!;
    expect(reloaded.rcvCents).toBe(frozenTotal);
    expect(reloaded.snapshot.lines).toHaveLength(frozenLines);

    // The live price moved; the sent document did not.
    const live = await priceJob(db, job);
    expect(live.totals.rcvCents).toBeGreaterThan(frozenTotal);
  });

  it('refuses to send the same version twice', async () => {
    const estimate = await createEstimateVersion(db, job, makeId, 2_000);
    await markEstimateSent(db, estimate.id, 'adjuster@carrier.test', 3_000);

    await expect(
      markEstimateSent(db, estimate.id, 'someone@else.test', 4_000),
    ).rejects.toThrow(EstimateIsFrozen);
  });

  it('supersedes the earlier version when a new one is cut', async () => {
    const first = await createEstimateVersion(db, job, makeId, 2_000);
    await markEstimateSent(db, first.id, 'adjuster@carrier.test', 3_000);

    const second = await createEstimateVersion(db, job, makeId, 4_000);
    expect(second.version).toBe(2);

    const versions = await listEstimates(db, 'job-1');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.find((v) => v.version === 1)?.status).toBe('superseded');
  });

  it('keeps every version, because a claim history is evidence', async () => {
    await createEstimateVersion(db, job, makeId, 2_000);
    await createEstimateVersion(db, job, makeId, 3_000);
    await createEstimateVersion(db, job, makeId, 4_000);
    expect(await listEstimates(db, 'job-1')).toHaveLength(3);
  });
});

describe('applyPriceImport', () => {
  it('updates a code in place on a second import rather than duplicating it', async () => {
    counter = 0;
    const db = await makeDb();
    const { importPriceList } = await import('../features/pricing/import');

    const first = await applyPriceImport(
      db,
      'co-1',
      importPriceList(PRICE_CSV).items,
      makeId,
      1_000,
    );
    expect(first).toEqual({ added: 11, updated: 0 });

    const raised = PRICE_CSV.replace('3.20,0.90', '3.85,0.95');
    const second = await applyPriceImport(
      db,
      'co-1',
      importPriceList(raised).items,
      makeId,
      2_000,
    );
    expect(second).toEqual({ added: 0, updated: 11 });

    const items = await listPriceItems(db, 'co-1');
    expect(items).toHaveLength(11);
    expect(items.find((i) => i.code === 'FCC-CPT')?.materialCostCents).toBe(385);
  });

  it('marks an imported row as the contractor own, never a seed row', async () => {
    counter = 0;
    const db = await makeDb();
    const { importPriceList } = await import('../features/pricing/import');
    await applyPriceImport(db, 'co-1', importPriceList(PRICE_CSV).items, makeId, 1_000);

    expect((await listPriceItems(db, 'co-1')).every((i) => !i.isSeed)).toBe(true);
  });
});

describe('seedPriceListIfEmpty', () => {
  it('fills an empty list and covers every code the scope engine proposes', async () => {
    counter = 0;
    const db = await makeDb();
    const { seedPriceListIfEmpty } = await import('./price-items');

    const installed = await seedPriceListIfEmpty(db, 'co-1', makeId, 1_000);
    expect(installed).toBeGreaterThan(0);

    const codes = new Set((await listPriceItems(db, 'co-1')).map((i) => i.code));

    // Every code buildScope can emit, across categories and material sets.
    const proposed = new Set<string>();
    const quantities = computeRoom({
      lengthIn: ft(12),
      widthIn: ft(14),
      heightIn: ft(8),
      floodCutHeightIn: ft(2),
    });
    const materials = [
      'Carpet', 'Carpet pad', 'Drywall', 'Insulation', 'Baseboard', 'Ceiling', 'Subfloor',
    ];
    for (const category of ['cat_1', 'cat_2', 'cat_3'] as const) {
      for (const line of buildScope({
        quantities,
        materials,
        waterCategory: category,
        waterClass: 'class_2',
        floodCutHeightIn: ft(2),
      })) {
        proposed.add(line.code);
      }
    }

    const missing = [...proposed].filter((code) => !codes.has(code));
    expect(missing).toEqual([]);
  });

  it('never overwrites a list the contractor has already imported', async () => {
    counter = 0;
    const db = await makeDb();
    const { seedPriceListIfEmpty } = await import('./price-items');
    const { importPriceList } = await import('../features/pricing/import');

    await applyPriceImport(db, 'co-1', importPriceList(PRICE_CSV).items, makeId, 1_000);
    expect(await seedPriceListIfEmpty(db, 'co-1', makeId, 2_000)).toBe(0);
    expect(await listPriceItems(db, 'co-1')).toHaveLength(11);
  });
});

describe('updateLineItemPricing', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
  });

  it('changes the quantity and the total follows', async () => {
    const { updateLineItemPricing } = await import('./line-items');
    const priceItems = await listPriceItems(db, 'co-1');
    await applyScopeToRoom(
      db,
      { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' },
      [{ code: 'FCC-CPT', qty: 100, reason: 'Carpet' }],
      priceItems,
      makeId,
      1_000,
    );

    const [line] = await listLineItems(db, 'job-1');
    await updateLineItemPricing(
      db,
      line.id,
      { qty: 168, wastePct: 10, materialUnitCents: 320, laborUnitCents: 90 },
      2_000,
    );

    const job = (await getJob(db, 'job-1'))!;
    const { totals } = await priceJob(db, job);
    // 168 + 10% waste = 184.8 SF at $4.10
    expect(totals.lines[0].billedQty).toBe(184.8);
    expect(totals.lineSubtotalCents).toBe(75_768);
  });

  it('turns a hand-edited template line into a manual one, so re-scoping leaves it alone', async () => {
    const { updateLineItemPricing } = await import('./line-items');
    const priceItems = await listPriceItems(db, 'co-1');
    const context = { companyId: 'co-1', jobId: 'job-1', roomId: 'room-1' };

    await applyScopeToRoom(db, context, [{ code: 'FCC-CPT', qty: 100, reason: 'a' }], priceItems, makeId, 1_000);
    const [line] = await listLineItems(db, 'job-1');
    await updateLineItemPricing(
      db,
      line.id,
      { qty: 250, wastePct: 0, materialUnitCents: 320, laborUnitCents: 90 },
      2_000,
    );

    await applyScopeToRoom(db, context, [{ code: 'FCC-RMV', qty: 100, reason: 'b' }], priceItems, makeId, 3_000);

    const remaining = await listLineItems(db, 'job-1');
    expect(remaining.map((l) => l.code).sort()).toEqual(['FCC-CPT', 'FCC-RMV']);
    expect(remaining.find((l) => l.code === 'FCC-CPT')?.qty).toBe(250);
  });

  it('refuses nonsense rather than storing it', async () => {
    const { updateLineItemPricing } = await import('./line-items');
    await saveLineItem(
      db,
      {
        id: 'line-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'X', description: 'X', unit: 'SF', qty: 1,
      },
      1_000,
    );
    const ok = { qty: 1, wastePct: 0, materialUnitCents: 0, laborUnitCents: 0 };

    await expect(updateLineItemPricing(db, 'line-1', { ...ok, qty: -1 })).rejects.toThrow(/qty/);
    await expect(updateLineItemPricing(db, 'line-1', { ...ok, wastePct: 250 })).rejects.toThrow(/wastePct/);
    await expect(
      updateLineItemPricing(db, 'line-1', { ...ok, materialUnitCents: -5 }),
    ).rejects.toThrow(/negative/);
  });
});

describe('recording the carrier answer', () => {
  let db: LocalDatabase;
  let job: JobRecord;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
    await saveLineItem(
      db,
      {
        id: 'line-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'FCC-CPT', description: 'Carpet', unit: 'SF', qty: 100,
        materialUnitCents: 320, laborUnitCents: 90,
      },
      1_000,
    );
  });

  it('marks a sent version approved without touching a figure', async () => {
    const { recordEstimateOutcome } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);
    const sent = await markEstimateSent(db, created.id, 'adjuster@carrier.test', 3_000);

    const approved = await recordEstimateOutcome(db, created.id, 'approved', 4_000);
    expect(approved.status).toBe('approved');
    expect(approved.rcvCents).toBe(sent.rcvCents);
    expect(approved.snapshot.lines).toHaveLength(sent.snapshot.lines.length);
  });

  it('records a rejection too', async () => {
    const { recordEstimateOutcome } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);
    await markEstimateSent(db, created.id, 'adjuster@carrier.test', 3_000);
    expect((await recordEstimateOutcome(db, created.id, 'rejected', 4_000)).status).toBe('rejected');
  });

  it('refuses to approve something that was never sent', async () => {
    const { recordEstimateOutcome } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);
    await expect(recordEstimateOutcome(db, created.id, 'approved', 3_000)).rejects.toThrow(
      /has not been sent/,
    );
  });

  it('finds the version the carrier is actually answering', async () => {
    const { latestSentEstimate } = await import('./estimates');
    expect(await latestSentEstimate(db, 'job-1')).toBeNull();

    const first = await createEstimateVersion(db, job, makeId, 2_000);
    await markEstimateSent(db, first.id, 'a@b.test', 3_000);
    // A newer draft exists but has not gone out, so the sent one still answers.
    await createEstimateVersion(db, job, makeId, 4_000);

    expect((await latestSentEstimate(db, 'job-1'))?.id).toBe(first.id);
  });
});

describe('the job lifecycle, end to end', () => {
  it('walks inspecting to closed and keeps the estimate in step', async () => {
    counter = 0;
    const db = await makeDb();
    const { recordEstimateOutcome, latestSentEstimate } = await import('./estimates');
    const { setJobStatus, canTransition, JOB_STATUS_FLOW } = await import('./jobs');

    let job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
    await saveLineItem(
      db,
      {
        id: 'line-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'FCC-CPT', description: 'Carpet', unit: 'SF', qty: 100,
        materialUnitCents: 320, laborUnitCents: 90,
      },
      1_000,
    );

    expect(job.status).toBe('inspecting');

    // Freeze a version — the job is being estimated now.
    const estimate = await createEstimateVersion(db, job, makeId, 2_000);
    job = await setJobStatus(db, 'job-1', 'estimating', 2_000);
    expect(job.status).toBe('estimating');

    // Send it.
    await markEstimateSent(db, estimate.id, 'adjuster@carrier.test', 3_000);
    job = await setJobStatus(db, 'job-1', 'sent', 3_000);

    // The carrier approves: the job and the sent version move together.
    job = await setJobStatus(db, 'job-1', 'approved', 4_000);
    const sent = await latestSentEstimate(db, 'job-1');
    await recordEstimateOutcome(db, sent!.id, 'approved', 4_000);
    expect((await getEstimate(db, estimate.id))?.status).toBe('approved');

    // Work finishes.
    job = await setJobStatus(db, 'job-1', 'closed', 5_000);
    expect(job.status).toBe('closed');

    // Closed is terminal, and the UI offers nothing because the flow offers nothing.
    expect(JOB_STATUS_FLOW.closed).toEqual([]);
    expect(canTransition('closed', 'estimating')).toBe(false);

    // The frozen document is untouched by any of it.
    const frozen = await getEstimate(db, estimate.id);
    expect(frozen?.rcvCents).toBe(estimate.rcvCents);
    expect(frozen?.snapshot.lines).toHaveLength(estimate.snapshot.lines.length);
  });

  it('records a lost job as a rejected estimate', async () => {
    counter = 0;
    const db = await makeDb();
    const { recordEstimateOutcome, latestSentEstimate } = await import('./estimates');
    const { setJobStatus } = await import('./jobs');

    const job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
    await saveLineItem(
      db,
      {
        id: 'line-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'FCC-CPT', description: 'Carpet', unit: 'SF', qty: 100,
        materialUnitCents: 320, laborUnitCents: 90,
      },
      1_000,
    );

    const estimate = await createEstimateVersion(db, job, makeId, 2_000);
    await markEstimateSent(db, estimate.id, 'adjuster@carrier.test', 3_000);
    await setJobStatus(db, 'job-1', 'estimating', 3_100);
    await setJobStatus(db, 'job-1', 'sent', 3_200);
    await setJobStatus(db, 'job-1', 'lost', 4_000);

    const sent = await latestSentEstimate(db, 'job-1');
    await recordEstimateOutcome(db, sent!.id, 'rejected', 4_000);
    expect((await getEstimate(db, estimate.id))?.status).toBe('rejected');
  });

  it('lets a rejected job be revived, because carriers change their minds', async () => {
    counter = 0;
    const db = await makeDb();
    const { setJobStatus } = await import('./jobs');

    await seedJobAndPrices(db);
    await setJobStatus(db, 'job-1', 'lost', 2_000);
    const revived = await setJobStatus(db, 'job-1', 'inspecting', 3_000);
    expect(revived.status).toBe('inspecting');
  });
});

describe('the summary of loss', () => {
  let db: LocalDatabase;
  let job: JobRecord;

  beforeEach(async () => {
    counter = 0;
    db = await makeDb();
    job = await seedJobAndPrices(db);
    await saveRoom(
      db,
      { id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room', lengthIn: ft(10), widthIn: ft(10), heightIn: ft(8) },
      1_000,
    );
    await saveLineItem(
      db,
      {
        id: 'line-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'FCC-CPT', description: 'Carpet', unit: 'SF', qty: 100,
        materialUnitCents: 320, laborUnitCents: 90,
      },
      1_000,
    );
  });

  it('writes onto a draft', async () => {
    const { setEstimateNarrative } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);

    const updated = await setEstimateNarrative(db, created.id, '  Supply line failure.  ', 3_000);
    expect(updated.narrative).toBe('Supply line failure.');
  });

  it('clears the narrative when handed nothing', async () => {
    const { setEstimateNarrative } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);
    await setEstimateNarrative(db, created.id, 'Something', 3_000);
    expect((await setEstimateNarrative(db, created.id, '   ', 4_000)).narrative).toBeNull();
  });

  it('refuses to change what an adjuster has already read', async () => {
    const { setEstimateNarrative } = await import('./estimates');
    const created = await createEstimateVersion(db, job, makeId, 2_000);
    await setEstimateNarrative(db, created.id, 'The original wording.', 3_000);
    await markEstimateSent(db, created.id, 'adjuster@carrier.test', 4_000);

    await expect(setEstimateNarrative(db, created.id, 'Rewritten.', 5_000)).rejects.toThrow(
      EstimateIsFrozen,
    );
    expect((await getEstimate(db, created.id))?.narrative).toBe('The original wording.');
  });
});
