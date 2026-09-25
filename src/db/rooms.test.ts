/**
 * The offline spine, end to end, against real SQLite.
 *
 * This is the plan's Day 4 acceptance test, minus the airplane: create a room
 * with no connectivity, confirm it is on the phone and queued, then turn the
 * radio back on and confirm it reaches the server intact.
 */

import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it } from 'vitest';

import { SyncEngine } from '../sync/engine';
import { SqliteOutboxStore } from '../sync/sqlite-store';
import { UPLOAD_QUEUE_TABLE } from '../sync/uploads';
import type { OutboxEntry, PushResult, SyncTransport } from '../sync/types';
import {
  addNamedRoom,
  getRoom,
  isMeasured,
  listRooms,
  restoreRoom,
  saveRoom,
  softDeleteRoom,
} from './rooms';
import { APP_SCHEMA } from './schema';
import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';
import type { LocalDatabase } from './types';

function nodeAdapter(): SqliteAdapter {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('begin');
      try {
        const result = await fn();
        db.exec('commit');
        return result;
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
  };
}

async function makeDb(): Promise<LocalDatabase> {
  const adapter = nodeAdapter();
  await adapter.exec(APP_SCHEMA);
  const outbox = await SqliteOutboxStore.create(adapter);
  await adapter.run(
    `insert into jobs (id, company_id, peril, status, created_at, updated_at)
     values ('job-1', 'co-1', 'water', 'inspecting', 0, 0)`,
  );
  return {
    adapter,
    outbox,
    uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
  };
}

/** The master bedroom from the plan's worked example. */
const bedroom = {
  id: 'room-1',
  companyId: 'co-1',
  jobId: 'job-1',
  name: 'Master Bedroom',
  lengthIn: 144,
  widthIn: 168,
  heightIn: 96,
  floodCutHeightIn: 24,
};

describe('saveRoom — offline', () => {
  let db: LocalDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('writes the room locally and queues it, without any network', async () => {
    const saved = await saveRoom(db, bedroom, 1_000);

    expect(saved).toMatchObject({
      id: 'room-1',
      name: 'Master Bedroom',
      lengthIn: 144,
      widthIn: 168,
      heightIn: 96,
      floodCutHeightIn: 24,
    });

    const queued = await db.outbox.all();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entity: 'rooms', entityId: 'room-1', op: 'upsert' });
  });

  it('sends the server ISO timestamps, not epoch millis', async () => {
    await saveRoom(db, bedroom, 1_700_000_000_000);
    const [entry] = await db.outbox.all();
    expect(entry.payload.updated_at).toBe('2023-11-14T22:13:20.000Z');
  });

  it('round-trips offsets through both the row and the payload', async () => {
    const offsets = [
      { name: 'Stair bulkhead', op: 'subtract' as const, depthIn: 24, widthIn: 36 },
    ];
    const saved = await saveRoom(db, { ...bedroom, offsets }, 1_000);

    expect(saved.offsets).toEqual(offsets);
    expect((await getRoom(db, 'room-1'))?.offsets).toEqual(offsets);
    expect((await db.outbox.all())[0].payload.offsets).toEqual(offsets);
  });

  it('coalesces rapid edits into one queued push', async () => {
    await saveRoom(db, { ...bedroom, lengthIn: 100 }, 1_000);
    await saveRoom(db, { ...bedroom, lengthIn: 120 }, 1_100);
    await saveRoom(db, { ...bedroom, lengthIn: 144 }, 1_200);

    const queued = await db.outbox.all();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.length_in).toBe(144);
    expect((await getRoom(db, 'room-1'))?.lengthIn).toBe(144);
  });

  it('updates an existing room rather than duplicating it', async () => {
    await saveRoom(db, bedroom, 1_000);
    await saveRoom(db, { ...bedroom, name: 'Primary Bedroom' }, 2_000);

    const rooms = await listRooms(db, 'job-1');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].name).toBe('Primary Bedroom');
  });

  it('keeps the local row and the outbox entry atomic', async () => {
    // A room whose job does not exist violates the foreign key, so the insert
    // throws. The transaction must roll back, leaving nothing queued.
    await expect(
      saveRoom(db, { ...bedroom, id: 'room-2', jobId: 'does-not-exist' }, 1_000),
    ).rejects.toThrow();

    expect(await getRoom(db, 'room-2')).toBeNull();
    expect(await db.outbox.all()).toHaveLength(0);
  });
});

describe('listRooms', () => {
  it('orders by sort order then creation', async () => {
    const db = await makeDb();
    await saveRoom(db, { ...bedroom, id: 'r-b', name: 'Hallway', sortOrder: 2 }, 1_000);
    await saveRoom(db, { ...bedroom, id: 'r-a', name: 'Master Bedroom', sortOrder: 1 }, 2_000);
    await saveRoom(db, { ...bedroom, id: 'r-c', name: 'Bathroom', sortOrder: 3 }, 3_000);

    expect((await listRooms(db, 'job-1')).map((r) => r.name)).toEqual([
      'Master Bedroom',
      'Hallway',
      'Bathroom',
    ]);
  });

  it('hides soft-deleted rooms', async () => {
    const db = await makeDb();
    await saveRoom(db, bedroom, 1_000);
    await softDeleteRoom(db, 'room-1', 2_000);

    expect(await listRooms(db, 'job-1')).toHaveLength(0);
    // The row is still there, which is what makes undo possible.
    expect(await getRoom(db, 'room-1')).not.toBeNull();
  });
});

describe('soft delete and undo', () => {
  // The row already synced, so the delete is a partial write to it: an UPDATE
  // setting deleted_at. Never a DELETE, and never an upsert, whose insert half
  // would fail NOT NULL on the columns this payload leaves out.
  it('queues a delete as an update of deleted_at, never a DELETE', async () => {
    const db = await makeDb();
    await saveRoom(db, bedroom, 1_000);
    const [entry] = await db.outbox.all();
    await db.outbox.markSynced(entry.seq, entry.revision, 1_000);

    await softDeleteRoom(db, 'room-1', 2_000);

    const queued = (await db.outbox.all()).filter((e) => e.state === 'pending');
    expect(queued).toHaveLength(1);
    expect(queued[0].op).toBe('patch');
    expect(queued[0].payload.deleted_at).toBe('1970-01-01T00:00:02.000Z');
  });

  it('restores the room and clears deleted_at on the server too', async () => {
    const db = await makeDb();
    await saveRoom(db, bedroom, 1_000);
    await softDeleteRoom(db, 'room-1', 2_000);
    await restoreRoom(db, 'room-1', 3_000);

    expect(await listRooms(db, 'job-1')).toHaveLength(1);
    const latest = (await db.outbox.all()).at(-1);
    expect(latest?.payload.deleted_at).toBeNull();
  });

  it('does nothing for a room that is not there', async () => {
    const db = await makeDb();
    await expect(softDeleteRoom(db, 'nope', 1_000)).resolves.toBeUndefined();
    expect(await db.outbox.all()).toHaveLength(0);
  });
});

describe('the airplane mode scenario', () => {
  it('survives losing signal, then syncs everything when it comes back', async () => {
    const db = await makeDb();
    const pushed: OutboxEntry[] = [];
    let online = false;

    const transport: SyncTransport = {
      async push(entry): Promise<PushResult> {
        if (!online) return { ok: false, kind: 'transient', message: 'network unreachable' };
        pushed.push(entry);
        return { ok: true };
      },
    };

    let clock = 1_000;
    const engine = new SyncEngine(db.outbox, transport, {
      now: () => clock,
      isOnline: () => online,
      backoff: { baseMs: 1_000, capMs: 60_000, jitter: () => 0 },
    });

    // In the basement: measure three rooms with no signal.
    await saveRoom(db, { ...bedroom, id: 'r1', name: 'Master Bedroom' }, clock);
    await saveRoom(db, { ...bedroom, id: 'r2', name: 'Upstairs Hallway' }, clock);
    await saveRoom(db, { ...bedroom, id: 'r3', name: 'Hall Bathroom' }, clock);

    const offlinePass = await engine.drain();
    expect(offlinePass.stop).toBe('offline');
    expect(pushed).toHaveLength(0);

    // Everything is safely on the phone and nothing is lost.
    expect(await listRooms(db, 'job-1')).toHaveLength(3);
    expect(await db.outbox.counts()).toEqual({ pending: 3, failed: 0 });

    // Back in the truck.
    online = true;
    clock += 60_000;
    const onlinePass = await engine.drain();

    expect(onlinePass).toMatchObject({ synced: 3, failed: 0, stop: 'drained' });
    expect(pushed.map((e) => e.payload.name)).toEqual([
      'Master Bedroom',
      'Upstairs Hallway',
      'Hall Bathroom',
    ]);
    expect(await db.outbox.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('keeps queued work across a restart, because the queue is on disk', async () => {
    // One adapter, two "app launches" sharing the same database file.
    const adapter = nodeAdapter();
    await adapter.exec(APP_SCHEMA);
    await adapter.run(
      `insert into jobs (id, company_id, peril, status, created_at, updated_at)
       values ('job-1', 'co-1', 'water', 'inspecting', 0, 0)`,
    );

    const uploads = await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE);
    const first: LocalDatabase = { adapter, outbox: await SqliteOutboxStore.create(adapter), uploads };
    await saveRoom(first, bedroom, 1_000);

    // Force quit. Reopen: a fresh store over the same storage.
    const second: LocalDatabase = { adapter, outbox: await SqliteOutboxStore.create(adapter), uploads };

    expect(await listRooms(second, 'job-1')).toHaveLength(1);
    expect(await second.outbox.counts()).toEqual({ pending: 1, failed: 0 });
    expect((await second.outbox.nextDue(2_000))?.payload.name).toBe('Master Bedroom');
  });
});

describe('a room that is only a name', () => {
  it('is stored unmeasured, and reaches the server with no dimensions', async () => {
    const db = await makeDb();
    const room = await addNamedRoom(
      db,
      { id: 'room-9', companyId: 'co-1', jobId: 'job-1', name: '  Kitchen ' },
      1_000,
    );

    expect(room.name).toBe('Kitchen');
    expect(isMeasured(room)).toBe(false);
    const [entry] = (await db.outbox.all()).filter((e) => e.entityId === 'room-9');
    expect(entry.payload).toMatchObject({ length_in: null, width_in: null, height_in: null });
  });

  it('counts as measured once it has all three dimensions', async () => {
    const db = await makeDb();
    expect(isMeasured(await saveRoom(db, bedroom, 1_000))).toBe(true);
  });
});
