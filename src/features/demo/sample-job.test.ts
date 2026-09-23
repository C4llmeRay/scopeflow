import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { getCompany, saveCompany } from '../../db/companies';
import { listDamages } from '../../db/damages';
import { priceJob } from '../../db/estimates';
import { getJob } from '../../db/jobs';
import { listLineItems } from '../../db/line-items';
import { listPhotos } from '../../db/photos';
import { listRooms } from '../../db/rooms';
import { APP_SCHEMA } from '../../db/schema';
import type { RunResult, SqlParam, SqliteAdapter } from '../../db/sqlite-adapter';
import type { LocalDatabase } from '../../db/types';
import { listVoiceNotes } from '../../db/voice-notes';
import { SqliteOutboxStore } from '../../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../../sync/uploads';
import { demoNarrative, demoScopeSuggestion } from '../ai/demo';
import { isProfileComplete } from '../settings/company-form';
import { createSampleJob } from './sample-job';

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

let seq = 0;
const makeId = () => `demo-${++seq}`;

async function makeDb(): Promise<LocalDatabase> {
  const adapter = nodeAdapter();
  await adapter.exec(APP_SCHEMA);
  return {
    adapter,
    outbox: await SqliteOutboxStore.create(adapter),
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
}

const NOW = Date.UTC(2026, 8, 23, 15, 0, 0);

describe('the sample job', () => {
  let db: LocalDatabase;
  beforeEach(async () => {
    db = await makeDb();
  });

  it('is a complete walk-through: rooms, photos, notes and a damage sheet', async () => {
    const { jobId } = await createSampleJob(db, 'co-1', makeId, NOW);

    const job = await getJob(db, jobId);
    expect(job?.propertyAddress1).toBe('1418 Maple Avenue');

    const rooms = await listRooms(db, jobId);
    expect(rooms.map((r) => r.name)).toEqual(['Family room', 'Bedroom', 'Laundry']);

    for (const room of rooms) {
      expect((await listDamages(db, room.id)).length).toBeGreaterThan(0);
    }

    const photos = await listPhotos(db, jobId);
    expect(photos.filter((p) => p.roomId === null)).toHaveLength(1);
    expect(photos.every((p) => p.localUri?.startsWith('data:image/svg+xml'))).toBe(true);

    const notes = await listVoiceNotes(db, jobId);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => (n.transcript ?? '').length > 0)).toBe(true);
  });

  it('prices from geometry, and leaves the AI lines waiting on a human', async () => {
    const { jobId } = await createSampleJob(db, 'co-1', makeId, NOW);
    const lines = await listLineItems(db, jobId);

    const suggested = lines.filter((l) => l.status === 'suggested');
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.every((l) => l.origin === 'ai')).toBe(true);

    const job = (await getJob(db, jobId))!;
    const pricing = await priceJob(db, job);
    expect(pricing.suggestedCount).toBe(suggested.length);
    expect(pricing.totals.netClaimCents).toBeGreaterThan(0);
    // The carpet is aged, so depreciation shows on the estimate.
    expect(pricing.totals.depreciationCents).toBeGreaterThan(0);
  });

  it('fills in a blank profile but never overwrites a real one', async () => {
    await createSampleJob(db, 'co-1', makeId, NOW);
    expect(isProfileComplete(await getCompany(db, 'co-1'))).toBe(true);

    const other = await makeDb();
    await saveCompany(other, { id: 'co-2', name: 'Real Co', phone: '555' });
    const { createdProfile } = await createSampleJob(other, 'co-2', makeId, NOW);
    expect(createdProfile).toBe(false);
    expect((await getCompany(other, 'co-2'))?.name).toBe('Real Co');
  });
});

describe('the demo AI', () => {
  const quantities = {
    floorSf: 261, ceilingSf: 261, perimeterLf: 65, grossWallSf: 520, netWallSf: 470,
    baseboardLf: 60, floodCutSf: 120, volumeCf: 2088,
  } as Parameters<typeof demoScopeSuggestion>[0]['quantities'];

  it('names a measure, never a number, and only uses codes it was given', () => {
    const result = demoScopeSuggestion(
      {
        roomName: 'Family room', quantities, materials: ['Carpet', 'Drywall', 'Baseboard'],
        waterCategory: 'cat_2', waterClass: 'class_3', floodCutHeightIn: 24, alreadyScoped: [],
      },
      ['EQP-MON', 'CLN-FIN'],
    );
    expect(result.lines.map((l) => l.code).sort()).toEqual(['CLN-FIN', 'EQP-MON']);
    for (const line of result.lines) {
      expect(Object.keys(line).sort()).toEqual(['code', 'confidence', 'measure', 'reason']);
    }
  });

  it('does not repeat what the template already scoped', () => {
    const result = demoScopeSuggestion(
      {
        roomName: 'Room', quantities, materials: ['Drywall'], waterCategory: 'cat_1',
        waterClass: 'class_2', floodCutHeightIn: 0, alreadyScoped: ['EQP-MON'],
      },
      ['EQP-MON', 'CLN-FIN'],
    );
    expect(result.lines.map((l) => l.code)).toEqual(['CLN-FIN']);
  });

  it('writes a narrative from what was recorded, without inventing a cause', () => {
    const { narrative } = demoNarrative({
      propertyAddress: '1 Test St', peril: 'water', dateOfLoss: '2026-09-21',
      rooms: [{ name: 'Bedroom', materials: ['Carpet'] }, { name: 'Hall', materials: [] }],
      totalCents: 100,
    });
    expect(narrative).toContain('1 Test St');
    expect(narrative).toContain('1 of 2 inspected rooms were affected');
    expect(narrative.length).toBeLessThanOrEqual(1200);
  });
});
