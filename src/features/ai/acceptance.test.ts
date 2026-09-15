import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { saveDamage, softDeleteDamage } from '../../db/damages';
import { saveJob } from '../../db/jobs';
import { saveLineItem, setLineItemStatus, softDeleteLineItem } from '../../db/line-items';
import { saveRoom } from '../../db/rooms';
import { APP_SCHEMA } from '../../db/schema';
import type { RunResult, SqlParam, SqliteAdapter } from '../../db/sqlite-adapter';
import type { LocalDatabase } from '../../db/types';
import { SqliteOutboxStore } from '../../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../../sync/uploads';
import {
  ACCEPTANCE_FLOOR,
  acceptanceRates,
  describeAcceptance,
  MIN_SAMPLE,
} from './acceptance';

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
  const db: LocalDatabase = {
    adapter,
    outbox: await SqliteOutboxStore.create(adapter),
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
  await saveJob(db, { id: 'job-1', companyId: 'co-1' }, 1_000);
  await saveRoom(
    db,
    {
      id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Room',
      lengthIn: 120, widthIn: 120, heightIn: 96,
    },
    1_000,
  );
  return db;
}

const aiLine = (db: LocalDatabase, lineId: string) =>
  saveLineItem(
    db,
    {
      id: lineId, companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
      code: 'FCC-CPT', description: 'Carpet', unit: 'SF', qty: 100,
      origin: 'ai', aiConfidence: 0.8,
    },
    1_000,
  );

const aiDamage = (db: LocalDatabase, damageId: string, source: 'ai_photo' | 'ai_voice') =>
  saveDamage(
    db,
    { id: damageId, companyId: 'co-1', roomId: 'room-1', material: 'Drywall', source },
    1_000,
  );

const rateFor = async (db: LocalDatabase, feature: string) =>
  (await acceptanceRates(db, 'co-1')).find((e) => e.feature === feature)!;

describe('acceptanceRates — scope suggestions', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('reports nothing before anything has been suggested', async () => {
    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.rate).toBeNull();
    expect(entry.reviewed).toBe(0);
    expect(entry.belowFloor).toBe(false);
  });

  it('counts a suggestion nobody has answered as pending, not as a rejection', async () => {
    await aiLine(db, 'l1');
    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.pending).toBe(1);
    expect(entry.reviewed).toBe(0);
    expect(entry.rate).toBeNull();
  });

  it('counts an accepted suggestion', async () => {
    await aiLine(db, 'l1');
    await setLineItemStatus(db, 'l1', 'accepted', 2_000);

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry).toMatchObject({ accepted: 1, reviewed: 1, pending: 0, rate: 1 });
  });

  it('counts deleting a suggestion as rejecting it', async () => {
    await aiLine(db, 'l1');
    await softDeleteLineItem(db, 'l1', 2_000);

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.accepted).toBe(0);
    expect(entry.reviewed).toBe(1);
    expect(entry.rate).toBe(0);
  });

  it('counts an explicit rejection', async () => {
    await aiLine(db, 'l1');
    await setLineItemStatus(db, 'l1', 'rejected', 2_000);
    expect((await rateFor(db, 'suggest_scope')).rate).toBe(0);
  });

  it('ignores lines the contractor wrote themselves', async () => {
    await saveLineItem(
      db,
      {
        id: 'manual-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'BAS-RR', description: 'Baseboard', unit: 'LF', qty: 40, origin: 'manual',
      },
      1_000,
    );
    expect((await rateFor(db, 'suggest_scope')).reviewed).toBe(0);
  });

  it('ignores lines the deterministic template produced', async () => {
    await saveLineItem(
      db,
      {
        id: 't-1', companyId: 'co-1', jobId: 'job-1', roomId: 'room-1',
        code: 'BAS-RR', description: 'Baseboard', unit: 'LF', qty: 40, origin: 'template',
      },
      1_000,
    );
    expect((await rateFor(db, 'suggest_scope')).reviewed).toBe(0);
  });

  it('computes the rate across a mixed history', async () => {
    for (let i = 0; i < 7; i++) {
      await aiLine(db, `keep-${i}`);
      await setLineItemStatus(db, `keep-${i}`, 'accepted', 2_000);
    }
    for (let i = 0; i < 3; i++) {
      await aiLine(db, `drop-${i}`);
      await softDeleteLineItem(db, `drop-${i}`, 2_000);
    }

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.reviewed).toBe(10);
    expect(entry.rate).toBeCloseTo(0.7, 5);
    expect(entry.belowFloor).toBe(false);
  });
});

describe('acceptanceRates — the 60% floor from the plan', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('does not judge a feature on too few answers', async () => {
    // Everything rejected, but only three of them.
    for (let i = 0; i < 3; i++) {
      await aiLine(db, `drop-${i}`);
      await softDeleteLineItem(db, `drop-${i}`, 2_000);
    }

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.rate).toBe(0);
    expect(entry.belowFloor).toBe(false);
    expect(entry.reviewed).toBeLessThan(MIN_SAMPLE);
  });

  it('flags a feature once there is enough evidence against it', async () => {
    for (let i = 0; i < 4; i++) {
      await aiLine(db, `keep-${i}`);
      await setLineItemStatus(db, `keep-${i}`, 'accepted', 2_000);
    }
    for (let i = 0; i < 6; i++) {
      await aiLine(db, `drop-${i}`);
      await softDeleteLineItem(db, `drop-${i}`, 2_000);
    }

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.reviewed).toBe(10);
    expect(entry.rate).toBeCloseTo(0.4, 5);
    expect(entry.belowFloor).toBe(true);
  });

  it('does not flag a feature sitting exactly on the floor', async () => {
    for (let i = 0; i < 6; i++) {
      await aiLine(db, `keep-${i}`);
      await setLineItemStatus(db, `keep-${i}`, 'accepted', 2_000);
    }
    for (let i = 0; i < 4; i++) {
      await aiLine(db, `drop-${i}`);
      await softDeleteLineItem(db, `drop-${i}`, 2_000);
    }

    const entry = await rateFor(db, 'suggest_scope');
    expect(entry.rate).toBeCloseTo(ACCEPTANCE_FLOOR, 5);
    expect(entry.belowFloor).toBe(false);
  });
});

describe('acceptanceRates — photo and voice findings', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('counts a kept photo finding as accepted and a deleted one as rejected', async () => {
    await aiDamage(db, 'd1', 'ai_photo');
    await aiDamage(db, 'd2', 'ai_photo');
    await softDeleteDamage(db, 'd2', 2_000);

    const entry = await rateFor(db, 'classify_photo');
    expect(entry).toMatchObject({ accepted: 1, reviewed: 2, rate: 0.5 });
  });

  it('keeps photo and voice findings apart', async () => {
    await aiDamage(db, 'd1', 'ai_photo');
    await aiDamage(db, 'd2', 'ai_voice');
    await softDeleteDamage(db, 'd2', 2_000);

    expect((await rateFor(db, 'classify_photo')).rate).toBe(1);
    expect((await rateFor(db, 'extract_voice')).rate).toBe(0);
  });

  it('ignores damage the contractor recorded by hand', async () => {
    await saveDamage(
      db,
      { id: 'd1', companyId: 'co-1', roomId: 'room-1', material: 'Carpet', source: 'manual' },
      1_000,
    );
    expect((await rateFor(db, 'classify_photo')).reviewed).toBe(0);
  });

  it('reports all three features every time', async () => {
    const entries = await acceptanceRates(db, 'co-1');
    expect(entries.map((e) => e.feature)).toEqual([
      'classify_photo',
      'suggest_scope',
      'extract_voice',
    ]);
  });
});

describe('describeAcceptance', () => {
  const entry = (over = {}) => ({
    feature: 'suggest_scope' as const,
    reviewed: 0,
    accepted: 0,
    pending: 0,
    rate: null,
    belowFloor: false,
    ...over,
  });

  it('says nothing has been suggested yet', () => {
    expect(describeAcceptance(entry())).toBe('nothing suggested yet');
  });

  it('says how many are waiting on a human', () => {
    expect(describeAcceptance(entry({ pending: 3 }))).toBe('3 waiting on you');
  });

  it('reads as a percentage of what was answered', () => {
    expect(describeAcceptance(entry({ reviewed: 20, accepted: 15, rate: 0.75 }))).toBe(
      '75% of 20',
    );
  });

  it('says plainly when the sample is too small to mean anything', () => {
    expect(describeAcceptance(entry({ reviewed: 3, accepted: 1, rate: 1 / 3 }))).toMatch(
      /too few to judge/,
    );
  });
});
