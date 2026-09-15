/**
 * Runs the outbox specification against real SQLite.
 *
 * node:sqlite here, expo-sqlite on the phone — same SQL either way, so the
 * queries that actually ship are exercised in CI instead of only in a basement.
 */

import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import type { RunResult, SqlParam, SqliteAdapter } from '../db/sqlite-adapter';
import { runOutboxStoreConformance } from './outbox-conformance';
import { SqliteOutboxStore } from './sqlite-store';

function nodeSqliteAdapter(): SqliteAdapter {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
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

const makeStore = () => SqliteOutboxStore.create(nodeSqliteAdapter());

runOutboxStoreConformance('SqliteOutboxStore', makeStore);

describe('SqliteOutboxStore — storage specifics', () => {
  it('is idempotent about creating its schema', async () => {
    const db = nodeSqliteAdapter();
    await SqliteOutboxStore.create(db);
    const store = await SqliteOutboxStore.create(db);
    await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'upsert', payload: {} }, 0);
    expect(await store.all()).toHaveLength(1);
  });

  it('assigns monotonically increasing sequence numbers', async () => {
    const store = await makeStore();
    for (const id of ['r1', 'r2', 'r3']) {
      await store.enqueue({ entity: 'rooms', entityId: id, op: 'upsert', payload: {} }, 0);
    }
    const seqs = (await store.all()).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
  });

  it('survives a payload with quotes, newlines and unicode', async () => {
    const store = await makeStore();
    const payload = {
      notes: `Cat 2 — "supply line" failure\nWater at 14" on the north wall.\nO'Brien residence`,
      name: 'Chambre à coucher',
    };
    await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'upsert', payload }, 0);
    expect((await store.nextDue(0))?.payload).toEqual(payload);
  });

  it('prunes old synced entries without touching pending ones', async () => {
    const store = await makeStore();
    await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'upsert', payload: {} }, 0);
    await store.enqueue({ entity: 'rooms', entityId: 'r2', op: 'upsert', payload: {} }, 0);
    const all = await store.all();
    await store.markSynced(all[0].seq, all[0].revision, 1_000);

    expect(await store.pruneSynced(5_000)).toBe(1);
    const remaining = await store.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].entityId).toBe('r2');
  });

  it('keeps recently synced entries so the debug screen has history', async () => {
    const store = await makeStore();
    await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'upsert', payload: {} }, 0);
    const [entry] = await store.all();
    await store.markSynced(entry.seq, entry.revision, 10_000);

    expect(await store.pruneSynced(5_000)).toBe(0);
    expect(await store.all()).toHaveLength(1);
  });
});
