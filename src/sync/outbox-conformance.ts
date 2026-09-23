/**
 * The outbox specification, as an executable suite.
 *
 * Both stores run it: the in-memory one that backs the engine tests, and the
 * SQLite one that ships. If they ever diverge, one of them fails here rather
 * than silently losing a room in a basement six weeks from now.
 *
 * Not named *.test.ts on purpose — it is imported by the two store test files,
 * not collected on its own.
 */

import { describe, expect, it } from 'vitest';

import type { NewOutboxEntry, OutboxStore } from './types';

const room = (id: string, payload: Record<string, unknown> = {}): NewOutboxEntry => ({
  entity: 'rooms',
  entityId: id,
  op: 'upsert',
  payload,
});

export function runOutboxStoreConformance(
  name: string,
  makeStore: () => Promise<OutboxStore>,
): void {
  describe(`${name} — coalescing`, () => {
    it('merges repeated edits of one record into a single entry', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1', { lengthIn: 100 }), 0);
      await store.enqueue(room('r1', { lengthIn: 144 }), 1);
      await store.enqueue(room('r1', { widthIn: 168 }), 2);

      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0].payload).toEqual({ lengthIn: 144, widthIn: 168 });
      expect(all[0].revision).toBe(3);
    });

    it('keeps separate records separate', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      await store.enqueue(room('r2'), 0);
      expect(await store.all()).toHaveLength(2);
    });

    it('keeps the original queue position when merging', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      await store.enqueue(room('r2'), 0);
      await store.enqueue(room('r1', { lengthIn: 144 }), 1);

      expect((await store.all()).map((e) => e.entityId)).toEqual(['r1', 'r2']);
    });

    it('does not merge into an entry that already failed', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1', { lengthIn: 100 }), 0);
      const [first] = await store.all();
      await store.markFailed(first.seq, 'nope', 0);
      await store.enqueue(room('r1', { lengthIn: 144 }), 1);

      const all = await store.all();
      expect(all).toHaveLength(2);
      expect(all[0].state).toBe('failed');
      expect(all[1].state).toBe('pending');
      expect(all[1].payload).toEqual({ lengthIn: 144 });
    });

    it('does not merge a write with a purge', async () => {
      const store = await makeStore();
      await store.enqueue({ entity: 'photos', entityId: 'p1', op: 'upsert', payload: { a: 1 } }, 0);
      await store.enqueue({ entity: 'photos', entityId: 'p1', op: 'purge', payload: {} }, 0);
      expect(await store.all()).toHaveLength(2);
    });

    it('folds a patch into an unsent upsert, which stays an upsert', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1', { name: 'Den', lengthIn: 100 }), 0);
      await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'patch', payload: { lengthIn: 144 } }, 1);

      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0].op).toBe('upsert');
      expect(all[0].payload).toEqual({ name: 'Den', lengthIn: 144 });
    });

    it('turns a pending patch into an upsert when a full row follows it', async () => {
      const store = await makeStore();
      await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'patch', payload: { lengthIn: 144 } }, 0);
      await store.enqueue(room('r1', { name: 'Den', lengthIn: 150 }), 1);

      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0].op).toBe('upsert');
      // The later full row wins, so an old patch can never overwrite it.
      expect(all[0].payload).toEqual({ name: 'Den', lengthIn: 150 });
    });

    it('keeps two patches a patch', async () => {
      const store = await makeStore();
      await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'patch', payload: { a: 1 } }, 0);
      await store.enqueue({ entity: 'rooms', entityId: 'r1', op: 'patch', payload: { b: 2 } }, 1);

      const all = await store.all();
      expect(all).toHaveLength(1);
      expect(all[0].op).toBe('patch');
      expect(all[0].payload).toEqual({ a: 1, b: 2 });
    });
  });

  describe(`${name} — due entries`, () => {
    it('returns nothing when the queue is empty', async () => {
      const store = await makeStore();
      expect(await store.nextDue(0)).toBeNull();
    });

    it('returns the oldest due entry first', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      await store.enqueue(room('r2'), 0);
      expect((await store.nextDue(0))?.entityId).toBe('r1');
    });

    it('hides an entry that is still in backoff', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      const [entry] = await store.all();
      await store.markRetry(entry.seq, 5_000, 'timeout', 0);

      expect(await store.nextDue(4_999)).toBeNull();
      expect((await store.nextDue(5_000))?.entityId).toBe('r1');
    });

    it('skips entries that are synced or failed', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      await store.enqueue(room('r2'), 0);
      await store.enqueue(room('r3'), 0);
      const all = await store.all();
      await store.markSynced(all[0].seq, all[0].revision, 0);
      await store.markFailed(all[1].seq, 'bad', 0);

      expect((await store.nextDue(0))?.entityId).toBe('r3');
    });

    it('round-trips the payload intact', async () => {
      const store = await makeStore();
      const payload = {
        name: "Kid's Room",
        lengthIn: 144,
        offsets: [{ op: 'subtract', depthIn: 24, widthIn: 36 }],
        notes: null,
        vaulted: true,
      };
      await store.enqueue(room('r1', payload), 0);
      expect((await store.nextDue(0))?.payload).toEqual(payload);
    });
  });

  describe(`${name} — revisions`, () => {
    it('marks synced when the revision still matches', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      const entry = await store.nextDue(0);

      expect(await store.markSynced(entry!.seq, entry!.revision, 0)).toBe(true);
      expect((await store.all())[0].state).toBe('synced');
    });

    it('refuses, and stays pending, when the record changed mid-flight', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1', { lengthIn: 144 }), 0);
      const entry = await store.nextDue(0);

      await store.enqueue(room('r1', { lengthIn: 168 }), 1);

      expect(await store.markSynced(entry!.seq, entry!.revision, 1)).toBe(false);
      const [after] = await store.all();
      expect(after.state).toBe('pending');
      expect(after.payload.lengthIn).toBe(168);
    });
  });

  describe(`${name} — retry bookkeeping`, () => {
    it('increments attempts and records the error', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      const [entry] = await store.all();

      await store.markRetry(entry.seq, 1_000, 'timeout', 0);
      await store.markRetry(entry.seq, 3_000, 'timeout again', 1_000);

      const [after] = await store.all();
      expect(after.attempts).toBe(2);
      expect(after.nextAttemptAt).toBe(3_000);
      expect(after.lastError).toBe('timeout again');
    });

    it('clears the error when the entry finally succeeds', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      const [entry] = await store.all();
      await store.markRetry(entry.seq, 1_000, 'timeout', 0);

      const current = await store.nextDue(1_000);
      await store.markSynced(current!.seq, current!.revision, 1_000);

      expect((await store.all())[0].lastError).toBeNull();
    });
  });

  describe(`${name} — counts and requeue`, () => {
    it('counts pending and failed, ignoring synced', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      await store.enqueue(room('r2'), 0);
      await store.enqueue(room('r3'), 0);
      const all = await store.all();
      await store.markSynced(all[0].seq, all[0].revision, 0);
      await store.markFailed(all[1].seq, 'bad', 0);

      expect(await store.counts()).toEqual({ pending: 1, failed: 1 });
    });

    it('resets attempts when requeueing failures', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      const [entry] = await store.all();
      await store.markRetry(entry.seq, 9_000, 'timeout', 0);
      await store.markFailed(entry.seq, 'gave up', 0);

      expect(await store.requeueFailed(100)).toBe(1);
      const [after] = await store.all();
      expect(after).toMatchObject({
        state: 'pending',
        attempts: 0,
        nextAttemptAt: 100,
        lastError: null,
      });
    });

    it('requeues nothing when there are no failures', async () => {
      const store = await makeStore();
      await store.enqueue(room('r1'), 0);
      expect(await store.requeueFailed(0)).toBe(0);
    });
  });
}
