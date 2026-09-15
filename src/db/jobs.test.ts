import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { computeRoom } from '../core/measure';
import { SqliteOutboxStore } from '../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../sync/uploads';
import { saveDamage, deepestWaterLineIn, listDamages, softDeleteDamage } from './damages';
import {
  canTransition,
  getJob,
  InvalidJobTransition,
  jobSubtitle,
  jobSummaries,
  jobTitle,
  listJobs,
  saveJob,
  setJobStatus,
  softDeleteJob,
  type JobStatus,
} from './jobs';
import { listOpenings, saveOpening, softDeleteOpening, toCoreOpenings } from './openings';
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

const job = (id: string, over = {}) => ({
  id,
  companyId: 'co-1',
  propertyAddress1: '1812 Water Street',
  propertyCity: 'Austin',
  propertyState: 'TX',
  claimNo: 'CLM-2026-884120',
  ...over,
});

describe('saveJob', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('creates a job that starts inspecting, offline', async () => {
    const created = await saveJob(db, job('j1'), 1_000);

    expect(created).toMatchObject({
      id: 'j1',
      status: 'inspecting',
      peril: 'water',
      propertyAddress1: '1812 Water Street',
    });
    expect(await db.outbox.all()).toHaveLength(1);
  });

  it('defaults the money terms a contractor rarely changes', async () => {
    const created = await saveJob(db, job('j1'), 1_000);
    expect(created).toMatchObject({ opPct: 20, taxPct: 0, taxBase: 'materials', deductibleCents: 0 });
  });

  it('carries per-job money terms when they are given', async () => {
    const created = await saveJob(
      db,
      job('j1', { opPct: 0, taxPct: 8.25, deductibleCents: 250_000 }),
      1_000,
    );
    expect(created).toMatchObject({ opPct: 0, taxPct: 8.25, deductibleCents: 250_000 });
  });

  it('lists the most recently touched job first', async () => {
    await saveJob(db, job('j1'), 1_000);
    await saveJob(db, job('j2'), 2_000);
    await saveJob(db, job('j1', { carrier: 'Lone Star Mutual' }), 3_000);

    expect((await listJobs(db, 'co-1')).map((j) => j.id)).toEqual(['j1', 'j2']);
  });

  it('keeps one company out of another', async () => {
    await saveJob(db, job('j1'), 1_000);
    await saveJob(db, { ...job('j2'), companyId: 'co-2' }, 1_000);

    expect(await listJobs(db, 'co-1')).toHaveLength(1);
    expect(await listJobs(db, 'co-2')).toHaveLength(1);
  });

  it('hides a soft-deleted job but keeps the row', async () => {
    await saveJob(db, job('j1'), 1_000);
    await softDeleteJob(db, 'j1', 2_000);

    expect(await listJobs(db, 'co-1')).toHaveLength(0);
    expect(await getJob(db, 'j1')).not.toBeNull();
  });
});

describe('job titles', () => {
  it('leads with the address', () => {
    expect(jobTitle({ propertyAddress1: '1812 Water Street', claimNo: 'X' } as never)).toBe(
      '1812 Water Street',
    );
  });

  it('falls back to the claim number, then to a placeholder', () => {
    expect(jobTitle({ propertyAddress1: null, claimNo: 'CLM-1' } as never)).toBe('Claim CLM-1');
    expect(jobTitle({ propertyAddress1: '  ', claimNo: null } as never)).toBe('Untitled job');
  });

  it('builds a city and state subtitle', () => {
    expect(jobSubtitle({ propertyCity: 'Austin', propertyState: 'TX' } as never)).toBe('Austin, TX');
    expect(jobSubtitle({ propertyCity: null, propertyState: null } as never)).toBe('');
  });
});

describe('job status flow', () => {
  const allow: [JobStatus, JobStatus][] = [
    ['inspecting', 'estimating'],
    ['estimating', 'sent'],
    ['sent', 'approved'],
    ['approved', 'closed'],
    ['sent', 'estimating'],
    ['lost', 'inspecting'],
  ];

  const deny: [JobStatus, JobStatus][] = [
    ['inspecting', 'sent'],
    ['inspecting', 'approved'],
    ['estimating', 'approved'],
    ['closed', 'estimating'],
    ['closed', 'inspecting'],
  ];

  it.each(allow)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(deny)('refuses %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats staying put as allowed', () => {
    expect(canTransition('sent', 'sent')).toBe(true);
  });

  it('moves a job forward and queues the change', async () => {
    const db = await makeDb();
    await saveJob(db, job('j1'), 1_000);

    const updated = await setJobStatus(db, 'j1', 'estimating', 2_000);
    expect(updated.status).toBe('estimating');
    expect((await getJob(db, 'j1'))?.status).toBe('estimating');
    expect((await db.outbox.all())[0].payload.status).toBe('estimating');
  });

  it('refuses a jump a contractor cannot come back from', async () => {
    const db = await makeDb();
    await saveJob(db, job('j1'), 1_000);

    await expect(setJobStatus(db, 'j1', 'approved', 2_000)).rejects.toThrow(InvalidJobTransition);
    expect((await getJob(db, 'j1'))?.status).toBe('inspecting');
  });

  it('explains the refusal in words a person can read', async () => {
    const db = await makeDb();
    await saveJob(db, job('j1'), 1_000);
    await expect(setJobStatus(db, 'j1', 'closed', 2_000)).rejects.toThrow(
      /cannot go from Inspecting to Closed/,
    );
  });
});

describe('jobSummaries', () => {
  it('counts rooms per job in one query', async () => {
    const db = await makeDb();
    await saveJob(db, job('j1'), 1_000);
    await saveJob(db, job('j2'), 1_000);
    await saveRoom(
      db,
      { id: 'r1', companyId: 'co-1', jobId: 'j1', name: 'A', lengthIn: 120, widthIn: 120, heightIn: 96 },
      1_000,
    );
    await saveRoom(
      db,
      { id: 'r2', companyId: 'co-1', jobId: 'j1', name: 'B', lengthIn: 120, widthIn: 120, heightIn: 96 },
      1_000,
    );

    const summaries = await jobSummaries(db, 'co-1');
    expect(summaries.get('j1')?.rooms).toBe(2);
    expect(summaries.get('j2')?.rooms).toBe(0);
  });
});

describe('openings', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
    await saveJob(db, job('j1'), 1_000);
    await saveRoom(
      db,
      {
        id: 'r1',
        companyId: 'co-1',
        jobId: 'j1',
        name: 'Master Bedroom',
        lengthIn: 144,
        widthIn: 168,
        heightIn: 96,
      },
      1_000,
    );
  });

  it('saves a door and a window against a room', async () => {
    await saveOpening(
      db,
      { id: 'o1', companyId: 'co-1', roomId: 'r1', kind: 'door', widthIn: 36, heightIn: 80 },
      1_000,
    );
    await saveOpening(
      db,
      { id: 'o2', companyId: 'co-1', roomId: 'r1', kind: 'window', widthIn: 48, heightIn: 36 },
      1_000,
    );

    const openings = await listOpenings(db, 'r1');
    expect(openings.map((o) => o.kind)).toEqual(['door', 'window']);
    expect(openings[0].count).toBe(1);
  });

  it('stores an unset override as null, meaning "use the default for this kind"', async () => {
    await saveOpening(
      db,
      { id: 'o1', companyId: 'co-1', roomId: 'r1', kind: 'window', widthIn: 48, heightIn: 36 },
      1_000,
    );
    const [opening] = await listOpenings(db, 'r1');
    expect(opening.deductsWall).toBeNull();
    expect(opening.deductsBase).toBeNull();
    expect(toCoreOpenings([opening])).toEqual([
      { kind: 'window', widthIn: 48, heightIn: 36, count: 1 },
    ]);
  });

  it('round-trips an explicit override through SQLite booleans', async () => {
    await saveOpening(
      db,
      {
        id: 'o1',
        companyId: 'co-1',
        roomId: 'r1',
        kind: 'window',
        widthIn: 48,
        heightIn: 36,
        deductsBase: true,
        deductsWall: false,
      },
      1_000,
    );
    const [opening] = await listOpenings(db, 'r1');
    expect(opening.deductsBase).toBe(true);
    expect(opening.deductsWall).toBe(false);
    expect(toCoreOpenings([opening])[0]).toMatchObject({ deductsBase: true, deductsWall: false });
  });

  it('sends real booleans to the server, not SQLite 0/1', async () => {
    await saveOpening(
      db,
      {
        id: 'o1',
        companyId: 'co-1',
        roomId: 'r1',
        kind: 'door',
        widthIn: 36,
        heightIn: 80,
        deductsBase: true,
      },
      1_000,
    );
    const entry = (await db.outbox.all()).find((e) => e.entityId === 'o1');
    expect(entry?.payload.deducts_base).toBe(true);
    expect(entry?.payload.deducts_wall).toBeNull();
  });

  it('feeds the measurement engine and reproduces the worked example', async () => {
    await saveOpening(
      db,
      { id: 'o1', companyId: 'co-1', roomId: 'r1', kind: 'door', widthIn: 36, heightIn: 80 },
      1_000,
    );
    await saveOpening(
      db,
      { id: 'o2', companyId: 'co-1', roomId: 'r1', kind: 'window', widthIn: 48, heightIn: 36 },
      1_000,
    );

    const quantities = computeRoom({
      lengthIn: 144,
      widthIn: 168,
      heightIn: 96,
      openings: toCoreOpenings(await listOpenings(db, 'r1')),
      floodCutHeightIn: 24,
    });

    expect(quantities).toMatchObject({ netWallSf: 384, baseboardLf: 49, floodCutSf: 104 });
  });

  it('drops a deleted opening out of the quantities', async () => {
    await saveOpening(
      db,
      { id: 'o1', companyId: 'co-1', roomId: 'r1', kind: 'door', widthIn: 36, heightIn: 80 },
      1_000,
    );
    await softDeleteOpening(db, 'o1', 2_000);

    expect(await listOpenings(db, 'r1')).toHaveLength(0);
    const quantities = computeRoom({
      lengthIn: 144,
      widthIn: 168,
      heightIn: 96,
      openings: toCoreOpenings(await listOpenings(db, 'r1')),
    });
    expect(quantities.baseboardLf).toBe(52);
  });
});

describe('damages', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
    await saveJob(db, job('j1'), 1_000);
    await saveRoom(
      db,
      { id: 'r1', companyId: 'co-1', jobId: 'j1', name: 'A', lengthIn: 144, widthIn: 168, heightIn: 96 },
      1_000,
    );
  });

  it('records a damage with its category and class', async () => {
    const damage = await saveDamage(
      db,
      {
        id: 'd1',
        companyId: 'co-1',
        roomId: 'r1',
        material: 'Drywall',
        waterCategory: 'cat_2',
        waterClass: 'class_2',
        affectedHeightIn: 14,
        moisturePct: 31.5,
      },
      1_000,
    );

    expect(damage).toMatchObject({
      material: 'Drywall',
      waterCategory: 'cat_2',
      waterClass: 'class_2',
      affectedHeightIn: 14,
      source: 'manual',
    });
  });

  it('defaults to a manual source with no confidence', async () => {
    const damage = await saveDamage(
      db,
      { id: 'd1', companyId: 'co-1', roomId: 'r1', material: 'Carpet' },
      1_000,
    );
    expect(damage.source).toBe('manual');
    expect(damage.aiConfidence).toBeNull();
  });

  it('marks an AI finding with its source and confidence', async () => {
    const damage = await saveDamage(
      db,
      {
        id: 'd1',
        companyId: 'co-1',
        roomId: 'r1',
        material: 'Drywall',
        source: 'ai_photo',
        aiConfidence: 0.82,
        photoId: null,
      },
      1_000,
    );
    expect(damage.source).toBe('ai_photo');
    expect(damage.aiConfidence).toBeCloseTo(0.82, 3);
  });

  it('finds the deepest water line, which is what the flood cut follows', async () => {
    await saveDamage(
      db,
      { id: 'd1', companyId: 'co-1', roomId: 'r1', material: 'Drywall', affectedHeightIn: 14 },
      1_000,
    );
    await saveDamage(
      db,
      { id: 'd2', companyId: 'co-1', roomId: 'r1', material: 'Insulation', affectedHeightIn: 22 },
      1_000,
    );
    await saveDamage(
      db,
      { id: 'd3', companyId: 'co-1', roomId: 'r1', material: 'Carpet', affectedHeightIn: null },
      1_000,
    );

    expect(await deepestWaterLineIn(db, 'r1')).toBe(22);
  });

  it('returns no water line when nothing has been measured', async () => {
    expect(await deepestWaterLineIn(db, 'r1')).toBeNull();
  });

  it('ignores a deleted damage when finding the water line', async () => {
    await saveDamage(
      db,
      { id: 'd1', companyId: 'co-1', roomId: 'r1', material: 'Drywall', affectedHeightIn: 40 },
      1_000,
    );
    await softDeleteDamage(db, 'd1', 2_000);

    expect(await listDamages(db, 'r1')).toHaveLength(0);
    expect(await deepestWaterLineIn(db, 'r1')).toBeNull();
  });
});
