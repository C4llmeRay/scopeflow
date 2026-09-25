/**
 * Photo capture and the binary upload queue, against real SQLite.
 *
 * The behaviours that matter here are the ones a contractor would notice:
 * capture never waits on the network, the derivative uploads before the
 * original, originals hold for Wi-Fi, and one unreachable photo does not stop
 * the rest.
 */

import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { SyncEngine } from '../sync/engine';
import { SqliteOutboxStore } from '../sync/sqlite-store';
import type { OutboxStore } from '../sync/types';
import {
  createUploadTransport,
  UPLOAD_QUEUE_TABLE,
  type BinaryUploader,
  type UploadPayload,
} from '../sync/uploads';
import {
  assignPhotoToRoom,
  capturePhoto,
  getPhoto,
  labelPhoto,
  listPhotos,
  markVariantUploaded,
  pendingUploadCount,
  setPhotoCaption,
  softDeletePhoto,
  storagePathFor,
  uploadKey,
} from './photos';
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

type PhotoDb = LocalDatabase & { uploads: OutboxStore };

async function makeDb(): Promise<PhotoDb> {
  const adapter = nodeAdapter();
  await adapter.exec(APP_SCHEMA);
  const outbox = await SqliteOutboxStore.create(adapter);
  const uploads = await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE);
  await adapter.run(
    `insert into jobs (id, company_id, peril, status, created_at, updated_at)
     values ('job-1', 'co-1', 'water', 'inspecting', 0, 0)`,
  );
  await adapter.run(
    `insert into rooms (id, company_id, job_id, name, length_in, width_in, height_in, created_at, updated_at)
     values ('room-1', 'co-1', 'job-1', 'Master Bedroom', 144, 168, 96, 0, 0)`,
  );
  return { adapter, outbox, uploads };
}

const shot = (id: string, over: Partial<Parameters<typeof capturePhoto>[1]> = {}) => ({
  id,
  companyId: 'co-1',
  jobId: 'job-1',
  roomId: 'room-1',
  localUri: `file:///cam/${id}.jpg`,
  localThumbUri: `file:///cam/${id}-thumb.jpg`,
  ...over,
});

/** Records what it was asked to upload; fails on demand. */
class FakeUploader implements BinaryUploader {
  uploaded: UploadPayload[] = [];
  failWith: Error | null = null;

  async upload(payload: UploadPayload): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.uploaded.push(payload);
  }
}

describe('capturePhoto', () => {
  let db: PhotoDb;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('stores the row and queues both binaries without any network', async () => {
    const photo = await capturePhoto(db, shot('p1'), 1_000);

    expect(photo).toMatchObject({
      id: 'p1',
      roomId: 'room-1',
      uploadState: 'pending',
      originalState: 'pending',
      localUri: 'file:///cam/p1.jpg',
    });

    // One row on the outbox, two binaries on the upload queue.
    expect(await db.outbox.all()).toHaveLength(1);
    const queued = await db.uploads.all();
    expect(queued.map((e) => e.entityId)).toEqual([
      uploadKey('p1', 'thumb'),
      uploadKey('p1', 'original'),
    ]);
  });

  it('queues the derivative before the original', async () => {
    await capturePhoto(db, shot('p1'), 1_000);
    const [first, second] = await db.uploads.all();
    expect(first.payload.variant).toBe('thumb');
    expect(first.payload.requiresUnmetered).toBe(false);
    expect(second.payload.variant).toBe('original');
    expect(second.payload.requiresUnmetered).toBe(true);
  });

  it('keeps device file paths off the wire', async () => {
    await capturePhoto(db, shot('p1'), 1_000);
    const [row] = await db.outbox.all();
    expect(row.payload.local_uri).toBeUndefined();
    expect(row.payload.local_thumb_uri).toBeUndefined();
    expect(row.payload.job_id).toBe('job-1');
  });

  it('sends the capture time as ISO, preserving when the shot was taken', async () => {
    await capturePhoto(db, shot('p1', { takenAt: 1_700_000_000_000 }), 9_999);
    const [row] = await db.outbox.all();
    expect(row.payload.taken_at).toBe('2023-11-14T22:13:20.000Z');
    expect((await getPhoto(db, 'p1'))?.takenAt).toBe(1_700_000_000_000);
  });

  it('keeps GPS on the record, because a photo is evidence', async () => {
    await capturePhoto(db, shot('p1', { gpsLat: 30.2672, gpsLng: -97.7431 }), 1_000);
    const photo = await getPhoto(db, 'p1');
    expect(photo?.gpsLat).toBeCloseTo(30.2672, 4);
    expect(photo?.gpsLng).toBeCloseTo(-97.7431, 4);
  });

  it('allows an untagged photo, for rapid capture before sorting', async () => {
    const photo = await capturePhoto(db, shot('p1', { roomId: null }), 1_000);
    expect(photo.roomId).toBeNull();
    expect(await listPhotos(db, 'job-1', null)).toHaveLength(1);
  });

  it('derives storage paths that cannot drift from the row', () => {
    const target = { companyId: 'co-1', jobId: 'job-1', id: 'p1' };
    expect(storagePathFor(target, 'thumb')).toBe('co-1/job-1/p1-thumb.jpg');
    expect(storagePathFor(target, 'original')).toBe('co-1/job-1/p1-original.jpg');
  });
});

describe('photo housekeeping', () => {
  it('re-tags a photo to another room', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1', { roomId: null }), 1_000);
    await assignPhotoToRoom(db, 'p1', 'room-1', 2_000);

    expect((await getPhoto(db, 'p1'))?.roomId).toBe('room-1');
    expect((await db.outbox.all())[0].payload.room_id).toBe('room-1');
  });

  it('captions a photo', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1'), 1_000);
    await setPhotoCaption(db, 'p1', 'Water line at 14 inches, north wall', 2_000);
    expect((await getPhoto(db, 'p1'))?.caption).toBe('Water line at 14 inches, north wall');
  });

  it('soft-deletes rather than purging, because photos are evidence', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1'), 1_000);
    await softDeletePhoto(db, 'p1', 2_000);

    expect(await listPhotos(db, 'job-1')).toHaveLength(0);
    expect(await getPhoto(db, 'p1')).not.toBeNull();
    const last = (await db.outbox.all()).at(-1);
    expect(last?.op).toBe('upsert');
  });

  it('counts photos still waiting on a binary', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1'), 1_000);
    await capturePhoto(db, shot('p2'), 1_000);
    expect(await pendingUploadCount(db, 'job-1')).toBe(2);

    await markVariantUploaded(db, 'p1', 'thumb', 'co-1/job-1/p1-thumb.jpg', 2_000);
    await markVariantUploaded(db, 'p1', 'original', 'co-1/job-1/p1-original.jpg', 2_000);
    expect(await pendingUploadCount(db, 'job-1')).toBe(1);
  });
});

describe('the upload queue', () => {
  let db: PhotoDb;
  let uploader: FakeUploader;
  let unmetered: boolean;
  let clock: number;

  const makeEngine = () =>
    new SyncEngine(
      db.uploads,
      createUploadTransport(uploader, {
        isUnmetered: () => unmetered,
        onUploaded: (p) => markVariantUploaded(db, p.recordId, p.variant, p.remotePath, clock),
      }),
      {
        now: () => clock,
        backoff: { baseMs: 1_000, capMs: 60_000, jitter: () => 0 },
        stopOnTransientFailure: false,
      },
    );

  beforeEach(async () => {
    db = await makeDb();
    uploader = new FakeUploader();
    unmetered = true;
    clock = 1_000;
  });

  it('uploads both variants and records their paths', async () => {
    await capturePhoto(db, shot('p1'), clock);
    const result = await makeEngine().drain();

    expect(result.synced).toBe(2);
    expect(uploader.uploaded.map((u) => u.variant)).toEqual(['thumb', 'original']);

    const photo = await getPhoto(db, 'p1');
    expect(photo).toMatchObject({
      uploadState: 'uploaded',
      originalState: 'uploaded',
      thumbPath: 'co-1/job-1/p1-thumb.jpg',
      storagePath: 'co-1/job-1/p1-original.jpg',
    });
  });

  it('holds originals on a metered connection but still sends derivatives', async () => {
    unmetered = false;
    await capturePhoto(db, shot('p1'), clock);

    const result = await makeEngine().drain();

    expect(uploader.uploaded.map((u) => u.variant)).toEqual(['thumb']);
    expect(result.synced).toBe(1);
    expect(result.retried).toBe(1);

    const photo = await getPhoto(db, 'p1');
    expect(photo?.uploadState).toBe('uploaded');
    expect(photo?.originalState).toBe('pending');
  });

  it('sends the held originals once Wi-Fi returns', async () => {
    unmetered = false;
    await capturePhoto(db, shot('p1'), clock);
    await makeEngine().drain();

    unmetered = true;
    clock += 120_000;
    const result = await makeEngine().drain();

    expect(result.synced).toBe(1);
    expect((await getPhoto(db, 'p1'))?.originalState).toBe('uploaded');
  });

  it('does not let one unreachable photo hold up the others', async () => {
    await capturePhoto(db, shot('p1'), clock);
    await capturePhoto(db, shot('p2'), clock);

    // Every upload fails transiently on this pass.
    uploader.failWith = new TypeError('Network request failed');
    const blocked = await makeEngine().drain();

    // All four entries were attempted rather than stopping at the first, and
    // the pass ends as 'waiting' — everything is queued in backoff, not stuck.
    expect(blocked.retried).toBe(4);
    expect(blocked.stop).toBe('waiting');
    expect(uploader.uploaded).toHaveLength(0);

    // With the network back, the same pass clears all four.
    uploader.failWith = null;
    clock += 120_000;
    expect((await makeEngine().drain()).synced).toBe(4);
  });

  it('parks a malformed entry instead of retrying it forever', async () => {
    await db.uploads.enqueue(
      { entity: 'photos', entityId: 'broken', op: 'upsert', payload: { variant: 'thumb' } },
      clock,
    );
    const result = await makeEngine().drain();

    expect(result.failed).toBe(1);
    expect((await db.uploads.all())[0].lastError).toMatch(/incomplete payload/);
  });

  it('queues nothing for a photo with no derivative yet', async () => {
    await capturePhoto(db, shot('p1', { localThumbUri: null }), clock);
    const queued = await db.uploads.all();
    expect(queued.map((e) => e.payload.variant)).toEqual(['original']);
  });
});

describe('labelling for Xactimate', () => {
  it('keeps the name the camera gave a photo', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1', { title: 'Master Bedroom - Water line' }), 1_000);
    expect((await getPhoto(db, 'p1'))?.title).toBe('Master Bedroom - Water line');
  });

  it('writes room, name and description as one patch for the server', async () => {
    const db = await makeDb();
    await capturePhoto(db, shot('p1'), 1_000);
    const [row] = await db.outbox.all();
    await db.outbox.markSynced(row.seq, row.revision, 1_000);

    await labelPhoto(
      db,
      'p1',
      { roomId: null, title: 'Front of risk', caption: 'Front elevation.' },
      2_000,
    );

    expect(await getPhoto(db, 'p1')).toMatchObject({
      roomId: null,
      title: 'Front of risk',
      caption: 'Front elevation.',
    });
    const pending = (await db.outbox.all()).filter((e) => e.state === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].op).toBe('patch');
    expect(pending[0].payload).toMatchObject({
      room_id: null,
      title: 'Front of risk',
      caption: 'Front elevation.',
    });
  });
});
