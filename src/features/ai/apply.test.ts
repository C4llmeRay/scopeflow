import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { listDamages, saveDamage } from '../../db/damages';
import { saveJob } from '../../db/jobs';
import { capturePhoto, getPhoto, setPhotoCaption, softDeletePhoto } from '../../db/photos';
import { saveRoom } from '../../db/rooms';
import { APP_SCHEMA } from '../../db/schema';
import type { RunResult, SqlParam, SqliteAdapter } from '../../db/sqlite-adapter';
import type { LocalDatabase } from '../../db/types';
import { SqliteOutboxStore } from '../../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../../sync/uploads';
import { applyPhotoClassification } from './apply';

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
const makeId = () => `ai-${++seq}`;

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
      id: 'room-1', companyId: 'co-1', jobId: 'job-1', name: 'Master Bedroom',
      lengthIn: 144, widthIn: 168, heightIn: 96,
    },
    1_000,
  );
  return db;
}

const shoot = (db: LocalDatabase, id: string, roomId: string | null = 'room-1') =>
  capturePhoto(
    db,
    {
      id, companyId: 'co-1', jobId: 'job-1', roomId,
      localUri: `file:///cam/${id}.jpg`, localThumbUri: `file:///cam/${id}-t.jpg`,
    },
    1_000,
  );

const classification = (over: Record<string, unknown> = {}) => ({
  damages: [
    { material: 'Drywall', affectedHeightIn: 14, confidence: 0.85, observation: 'Staining' },
  ],
  waterCategory: 'cat_2',
  waterClass: 'class_2',
  caption: 'Water line on the north wall',
  noDamageVisible: false,
  ...over,
});

describe('applyPhotoClassification', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    seq = 0;
    db = await makeDb();
  });

  it('turns findings into damage records tagged as coming from a photo', async () => {
    await shoot(db, 'p1');
    const result = await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);

    expect(result).toMatchObject({ damagesAdded: 1, alreadyKnown: 0, captionWritten: true });

    const damages = await listDamages(db, 'room-1');
    expect(damages).toHaveLength(1);
    expect(damages[0]).toMatchObject({
      material: 'Drywall',
      affectedHeightIn: 14,
      source: 'ai_photo',
      photoId: 'p1',
      waterCategory: 'cat_2',
      waterClass: 'class_2',
    });
    expect(damages[0].aiConfidence).toBeCloseTo(0.85, 3);
  });

  it('writes a caption when the contractor has not', async () => {
    await shoot(db, 'p1');
    await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);
    expect((await getPhoto(db, 'p1'))?.caption).toBe('Water line on the north wall');
  });

  it('never overwrites a caption the contractor wrote', async () => {
    await shoot(db, 'p1');
    await setPhotoCaption(db, 'p1', 'My own words', 1_500);

    const result = await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);
    expect(result?.captionWritten).toBe(false);
    expect((await getPhoto(db, 'p1'))?.caption).toBe('My own words');
  });

  it('does not duplicate a material the contractor already recorded', async () => {
    await shoot(db, 'p1');
    await saveDamage(
      db,
      { id: 'd-manual', companyId: 'co-1', roomId: 'room-1', material: 'Drywall' },
      1_500,
    );

    const result = await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);
    expect(result).toMatchObject({ damagesAdded: 0, alreadyKnown: 1 });
    expect(await listDamages(db, 'room-1')).toHaveLength(1);
  });

  it('does not restate a category the room already has', async () => {
    await shoot(db, 'p1');
    await saveDamage(
      db,
      {
        id: 'd-manual', companyId: 'co-1', roomId: 'room-1', material: 'Carpet',
        waterCategory: 'cat_3', waterClass: 'class_3',
      },
      1_500,
    );

    await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);
    const added = (await listDamages(db, 'room-1')).find((d) => d.material === 'Drywall');
    // The contractor said cat_3; the photo guessed cat_2. The human wins.
    expect(added?.waterCategory).toBe('cat_3');
  });

  it('captions an untagged photo but holds its findings until it is sorted', async () => {
    await shoot(db, 'p1', null);
    const result = await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000);

    expect(result).toMatchObject({ captionWritten: true, damagesAdded: 0 });
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });

  it('records nothing for a photo with no damage in it', async () => {
    await shoot(db, 'p1');
    const result = await applyPhotoClassification(
      db,
      'p1',
      classification({ damages: [], noDamageVisible: true, caption: 'Hallway, undamaged' }),
      makeId,
      'co-1',
      2_000,
    );

    expect(result).toMatchObject({ damagesAdded: 0, noDamageVisible: true });
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });

  it('drops a material outside the taxonomy rather than storing it', async () => {
    await shoot(db, 'p1');
    await applyPhotoClassification(
      db,
      'p1',
      classification({ damages: [{ material: 'Unobtainium', confidence: 0.99 }] }),
      makeId,
      'co-1',
      2_000,
    );
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });

  it('drops a finding the model was barely confident about', async () => {
    await shoot(db, 'p1');
    await applyPhotoClassification(
      db,
      'p1',
      classification({ damages: [{ material: 'Drywall', confidence: 0.05 }] }),
      makeId,
      'co-1',
      2_000,
    );
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });

  it('adds several materials from one photograph', async () => {
    await shoot(db, 'p1');
    await applyPhotoClassification(
      db,
      'p1',
      classification({
        damages: [
          { material: 'Drywall', confidence: 0.9, affectedHeightIn: 14 },
          { material: 'Carpet', confidence: 0.8 },
          { material: 'Baseboard', confidence: 0.7 },
        ],
      }),
      makeId,
      'co-1',
      2_000,
    );
    expect(await listDamages(db, 'room-1')).toHaveLength(3);
  });

  it('reports nothing for a photo that has been deleted', async () => {
    await shoot(db, 'p1');
    await softDeletePhoto(db, 'p1', 1_500);
    expect(await applyPhotoClassification(db, 'p1', classification(), makeId, 'co-1', 2_000))
      .toBeNull();
  });

  it('reports nothing for a photo that never existed', async () => {
    expect(await applyPhotoClassification(db, 'nope', classification(), makeId, 'co-1', 2_000))
      .toBeNull();
  });

  it('survives a response that is not the shape it promised', async () => {
    await shoot(db, 'p1');
    for (const junk of [null, 'nope', 42, {}]) {
      const result = await applyPhotoClassification(db, 'p1', junk, makeId, 'co-1', 2_000);
      expect(result?.damagesAdded).toBe(0);
    }
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });
});

describe('applyVoiceExtraction', () => {
  let db: LocalDatabase;

  const speak = (id: string, transcript: string, roomId: string | null = 'room-1') =>
    (async () => {
      const { saveVoiceNote, setTranscript } = await import('../../db/voice-notes');
      await saveVoiceNote(
        db,
        { id, companyId: 'co-1', jobId: 'job-1', roomId, localUri: `file:///rec/${id}.m4a` },
        1_000,
      );
      await setTranscript(db, id, transcript, 1_100);
    })();

  const extraction = (over: Record<string, unknown> = {}) => ({
    damages: [
      { material: 'Drywall', affectedHeightIn: 48, confidence: 0.85, observation: 'Wet four feet up' },
    ],
    waterCategory: 'cat_2',
    waterClass: 'class_2',
    notes: ['Lockbox code is 4412'],
    ...over,
  });

  beforeEach(async () => {
    seq = 0;
    db = await makeDb();
  });

  it('turns what was said into damage records tagged as coming from a voice note', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'North wall drywall is wet about four feet up');

    const result = await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000);
    expect(result).toMatchObject({ damagesAdded: 1, alreadyKnown: 0 });

    const damages = await listDamages(db, 'room-1');
    expect(damages[0]).toMatchObject({
      material: 'Drywall',
      affectedHeightIn: 48,
      source: 'ai_voice',
    });
  });

  it('hands back what was said that was not damage, without storing it as scope', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'x');

    const result = await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000);
    expect(result?.notes).toEqual(['Lockbox code is 4412']);

    // A lockbox code is not a material and must never become one.
    const damages = await listDamages(db, 'room-1');
    expect(damages.map((d) => d.material)).toEqual(['Drywall']);
  });

  it('confirms rather than duplicates a material already recorded', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'x');
    await saveDamage(
      db,
      { id: 'd-manual', companyId: 'co-1', roomId: 'room-1', material: 'Drywall' },
      1_500,
    );

    const result = await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000);
    expect(result).toMatchObject({ damagesAdded: 0, alreadyKnown: 1 });
    expect(await listDamages(db, 'room-1')).toHaveLength(1);
  });

  it('keeps side notes for a job-wide recording with no room to attach to', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'x', null);

    const result = await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000);
    expect(result).toMatchObject({ damagesAdded: 0 });
    expect(result?.notes).toEqual(['Lockbox code is 4412']);
  });

  it('lets the contractor category win over what the recogniser heard', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'x');
    await saveDamage(
      db,
      {
        id: 'd-manual', companyId: 'co-1', roomId: 'room-1', material: 'Carpet',
        waterCategory: 'cat_3',
      },
      1_500,
    );

    await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000);
    const added = (await listDamages(db, 'room-1')).find((d) => d.material === 'Drywall');
    expect(added?.waterCategory).toBe('cat_3');
  });

  it('reports nothing for a note that has been deleted', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    const { softDeleteVoiceNote } = await import('../../db/voice-notes');
    await speak('v1', 'x');
    await softDeleteVoiceNote(db, 'v1', 1_500);

    expect(await applyVoiceExtraction(db, 'v1', extraction(), makeId, 'co-1', 2_000)).toBeNull();
  });

  it('survives a response that is not the shape it promised', async () => {
    const { applyVoiceExtraction } = await import('./apply');
    await speak('v1', 'x');
    for (const junk of [null, 'nope', 42]) {
      const result = await applyVoiceExtraction(db, 'v1', junk, makeId, 'co-1', 2_000);
      expect(result?.damagesAdded).toBe(0);
    }
    expect(await listDamages(db, 'room-1')).toHaveLength(0);
  });
});

describe('the AI queue dispatches by entity', () => {
  it('reads a photo task and a voice task apart', async () => {
    const { readClassifyTask, readVoiceTask } = await import('./queue');

    const photoEntry = {
      seq: 1, entity: 'photos' as const, entityId: 'p1', op: 'upsert' as const,
      payload: { photoId: 'p1', jobId: 'job-1' },
      state: 'pending' as const, attempts: 0, nextAttemptAt: 0, lastError: null,
      revision: 1, createdAt: 0, updatedAt: 0,
    };
    expect(readClassifyTask(photoEntry)).toEqual({ photoId: 'p1', jobId: 'job-1' });

    const voiceEntry = { ...photoEntry, entity: 'voice_notes' as const, payload: { voiceNoteId: 'v1', jobId: 'job-1' } };
    expect(readVoiceTask(voiceEntry)).toEqual({ voiceNoteId: 'v1', jobId: 'job-1' });
  });

  it('refuses an incomplete payload rather than guessing', async () => {
    const { readClassifyTask, readVoiceTask } = await import('./queue');
    const bare = {
      seq: 1, entity: 'photos' as const, entityId: 'x', op: 'upsert' as const, payload: {},
      state: 'pending' as const, attempts: 0, nextAttemptAt: 0, lastError: null,
      revision: 1, createdAt: 0, updatedAt: 0,
    };
    expect(() => readClassifyTask(bare)).toThrow(/incomplete payload/);
    expect(() => readVoiceTask(bare)).toThrow(/incomplete payload/);
  });
});
