/**
 * Voice notes, and the part of the upload queue they share with photos.
 *
 * The routing test at the bottom exists because getting it wrong fails
 * silently: the audio lands in storage and the row never learns about it, so
 * the note shows "saved on this phone" forever while the bytes sit on the
 * server.
 */

import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { SyncEngine } from '../sync/engine';
import { SqliteOutboxStore } from '../sync/sqlite-store';
import {
  createUploadTransport,
  readUploadPayload,
  UPLOAD_QUEUE_TABLE,
  type BinaryUploader,
  type UploadPayload,
} from '../sync/uploads';
import { capturePhoto, getPhoto, markVariantUploaded } from './photos';
import { APP_SCHEMA } from './schema';
import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';
import type { LocalDatabase } from './types';
import {
  getVoiceNote,
  listVoiceNotes,
  markVoiceNoteUploaded,
  saveVoiceNote,
  setTranscript,
  softDeleteVoiceNote,
  voiceStoragePathFor,
} from './voice-notes';

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
  await adapter.run(
    `insert into jobs (id, company_id, peril, status, created_at, updated_at)
     values ('job-1', 'co-1', 'water', 'inspecting', 0, 0)`,
  );
  await adapter.run(
    `insert into rooms (id, company_id, job_id, name, length_in, width_in, height_in, created_at, updated_at)
     values ('room-1', 'co-1', 'job-1', 'Master Bedroom', 144, 168, 96, 0, 0)`,
  );
  return {
    adapter,
    outbox: await SqliteOutboxStore.create(adapter),
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
}

const note = (id: string, over = {}) => ({
  id,
  companyId: 'co-1',
  jobId: 'job-1',
  roomId: 'room-1',
  localUri: `file:///rec/${id}.m4a`,
  durationMs: 7_400,
  ...over,
});

class FakeUploader implements BinaryUploader {
  uploaded: UploadPayload[] = [];
  async upload(payload: UploadPayload): Promise<void> {
    this.uploaded.push(payload);
  }
}

describe('saveVoiceNote', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('stores the note and queues the audio without any network', async () => {
    const saved = await saveVoiceNote(db, note('v1'), 1_000);

    expect(saved).toMatchObject({
      id: 'v1',
      roomId: 'room-1',
      durationMs: 7_400,
      uploadState: 'pending',
      transcript: null,
    });
    expect(await db.outbox.all()).toHaveLength(1);
    expect(await db.uploads.all()).toHaveLength(1);
  });

  it('does not make audio wait for Wi-Fi, because the transcript is behind it', async () => {
    await saveVoiceNote(db, note('v1'), 1_000);
    const [entry] = await db.uploads.all();
    expect(entry.payload.requiresUnmetered).toBe(false);
    expect(entry.payload.contentType).toBe('audio/m4a');
  });

  it('keeps the device path off the wire', async () => {
    await saveVoiceNote(db, note('v1'), 1_000);
    const [row] = await db.outbox.all();
    expect(row.payload.local_uri).toBeUndefined();
    expect(row.payload.job_id).toBe('job-1');
  });

  it('allows a note tagged to the whole job rather than a room', async () => {
    const saved = await saveVoiceNote(db, note('v1', { roomId: null }), 1_000);
    expect(saved.roomId).toBeNull();
  });

  it('derives a storage path under the company folder', () => {
    expect(voiceStoragePathFor({ companyId: 'co-1', jobId: 'job-1', id: 'v1' })).toBe(
      'co-1/job-1/voice-v1.m4a',
    );
  });

  it('fills in the transcript when it comes back from sync', async () => {
    await saveVoiceNote(db, note('v1'), 1_000);
    await setTranscript(db, 'v1', 'North wall drywall is wet about four feet up.', 2_000);

    expect((await getVoiceNote(db, 'v1'))?.transcript).toBe(
      'North wall drywall is wet about four feet up.',
    );
    expect((await db.outbox.all())[0].payload.transcript).toBe(
      'North wall drywall is wet about four feet up.',
    );
  });

  it('hides a deleted note but keeps the row', async () => {
    await saveVoiceNote(db, note('v1'), 1_000);
    await softDeleteVoiceNote(db, 'v1', 2_000);

    expect(await listVoiceNotes(db, 'job-1')).toHaveLength(0);
    expect(await getVoiceNote(db, 'v1')).not.toBeNull();
  });

  it('marks the note uploaded and records its path', async () => {
    await saveVoiceNote(db, note('v1'), 1_000);
    await markVoiceNoteUploaded(db, 'v1', 'co-1/job-1/voice-v1.m4a', 2_000);

    const saved = await getVoiceNote(db, 'v1');
    expect(saved?.uploadState).toBe('uploaded');
    expect(saved?.storagePath).toBe('co-1/job-1/voice-v1.m4a');
  });
});

describe('the shared upload queue', () => {
  it('says which table each entry belongs to', async () => {
    const db = await makeDb();
    await capturePhoto(
      db,
      {
        id: 'p1',
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        localUri: 'file:///cam/p1.jpg',
        localThumbUri: 'file:///cam/p1-thumb.jpg',
      },
      1_000,
    );
    await saveVoiceNote(db, note('v1'), 1_000);

    const entries = await db.uploads.all();
    const owners = entries.map((e) => readUploadPayload(e).entity);
    expect(owners).toEqual(['photos', 'photos', 'voice_notes']);
  });

  it('marks a photo and a voice note on the right table each', async () => {
    const db = await makeDb();
    const uploader = new FakeUploader();

    await capturePhoto(
      db,
      {
        id: 'p1',
        companyId: 'co-1',
        jobId: 'job-1',
        roomId: 'room-1',
        localUri: 'file:///cam/p1.jpg',
        localThumbUri: 'file:///cam/p1-thumb.jpg',
      },
      1_000,
    );
    await saveVoiceNote(db, note('v1'), 1_000);

    // The same dispatch the app uses.
    const engine = new SyncEngine(
      db.uploads,
      createUploadTransport(uploader, {
        isUnmetered: () => true,
        onUploaded: (p) =>
          p.entity === 'voice_notes'
            ? markVoiceNoteUploaded(db, p.recordId, p.remotePath, 2_000)
            : markVariantUploaded(db, p.recordId, p.variant, p.remotePath, 2_000),
      }),
      { stopOnTransientFailure: false },
    );

    const result = await engine.drain();
    expect(result.synced).toBe(3);

    const photo = await getPhoto(db, 'p1');
    expect(photo).toMatchObject({ uploadState: 'uploaded', originalState: 'uploaded' });

    // The bug this test exists for: routing the voice note through the photo
    // marker leaves it pending forever while its bytes sit on the server.
    const voice = await getVoiceNote(db, 'v1');
    expect(voice?.uploadState).toBe('uploaded');
    expect(voice?.storagePath).toBe('co-1/job-1/voice-v1.m4a');
  });

  it('parks an entry whose table owns no binaries', async () => {
    const db = await makeDb();
    await db.uploads.enqueue(
      {
        entity: 'rooms',
        entityId: 'r1:original',
        op: 'upsert',
        payload: {
          recordId: 'r1',
          variant: 'original',
          localUri: 'file:///x',
          remotePath: 'co-1/job-1/x',
        },
      },
      0,
    );

    const engine = new SyncEngine(
      db.uploads,
      createUploadTransport(new FakeUploader(), {
        isUnmetered: () => true,
        onUploaded: async () => {},
      }),
      { stopOnTransientFailure: false },
    );

    const result = await engine.drain();
    expect(result.failed).toBe(1);
    expect((await db.uploads.all())[0].lastError).toMatch(/has no binaries/);
  });
});
