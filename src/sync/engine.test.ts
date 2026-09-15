import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncEngine } from './engine';
import { MemoryOutboxStore } from './memory-store';
import type { NewOutboxEntry, OutboxEntry, PushResult, SyncTransport } from './types';

/** A transport whose answers the test dictates, recording what it was asked to push. */
class FakeTransport implements SyncTransport {
  pushed: OutboxEntry[] = [];
  private answers: PushResult[] = [];
  private fallback: PushResult = { ok: true };

  answerWith(...answers: PushResult[]): this {
    this.answers = [...answers];
    return this;
  }

  alwaysAnswer(result: PushResult): this {
    this.fallback = result;
    return this;
  }

  async push(entry: OutboxEntry): Promise<PushResult> {
    this.pushed.push({ ...entry, payload: { ...entry.payload } });
    return this.answers.shift() ?? this.fallback;
  }
}

const ok: PushResult = { ok: true };
const transient: PushResult = { ok: false, kind: 'transient', message: 'network unreachable' };
const permanent: PushResult = { ok: false, kind: 'permanent', message: 'row violates RLS policy' };

const room = (id: string, payload: Record<string, unknown> = {}): NewOutboxEntry => ({
  entity: 'rooms',
  entityId: id,
  op: 'upsert',
  payload: { name: 'Master Bedroom', ...payload },
});

/** Backoff with the randomness pinned, so delays are exact. */
const fixedBackoff = { baseMs: 1_000, capMs: 60_000, jitter: () => 1 };

describe('SyncEngine — the happy path', () => {
  let store: MemoryOutboxStore;
  let transport: FakeTransport;
  let clock: number;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new MemoryOutboxStore();
    transport = new FakeTransport();
    clock = 1_000_000;
    engine = new SyncEngine(store, transport, {
      now: () => clock,
      backoff: fixedBackoff,
    });
  });

  it('drains an empty queue without touching the transport', async () => {
    const result = await engine.drain();
    expect(result).toEqual({ synced: 0, failed: 0, retried: 0, stop: 'drained' });
    expect(transport.pushed).toHaveLength(0);
  });

  it('pushes every queued entry and reports the queue drained', async () => {
    await store.enqueue(room('r1'), clock);
    await store.enqueue(room('r2'), clock);

    const result = await engine.drain();

    expect(result.synced).toBe(2);
    expect(result.stop).toBe('drained');
    expect(await store.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('pushes in FIFO order, so a room lands before its openings', async () => {
    await store.enqueue(room('r1'), clock);
    await store.enqueue(
      { entity: 'openings', entityId: 'o1', op: 'upsert', payload: { roomId: 'r1' } },
      clock,
    );
    await store.enqueue(
      { entity: 'openings', entityId: 'o2', op: 'upsert', payload: { roomId: 'r1' } },
      clock,
    );

    await engine.drain();

    expect(transport.pushed.map((e) => e.entityId)).toEqual(['r1', 'o1', 'o2']);
  });
});

describe('SyncEngine — offline', () => {
  it('attempts nothing and says so', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(room('r1'), 0);

    const engine = new SyncEngine(store, transport, { isOnline: () => false });
    const result = await engine.drain();

    expect(result.stop).toBe('offline');
    expect(result.synced).toBe(0);
    expect(transport.pushed).toHaveLength(0);
    // Crucially, nothing was lost.
    expect(await store.counts()).toEqual({ pending: 1, failed: 0 });
  });

  it('accepts an async connectivity check', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(room('r1'), 0);
    const engine = new SyncEngine(store, new FakeTransport(), {
      isOnline: async () => false,
    });
    expect((await engine.drain()).stop).toBe('offline');
  });
});

describe('SyncEngine — transient failure', () => {
  let store: MemoryOutboxStore;
  let transport: FakeTransport;
  let clock: number;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new MemoryOutboxStore();
    transport = new FakeTransport();
    clock = 0;
    engine = new SyncEngine(store, transport, {
      now: () => clock,
      backoff: fixedBackoff,
    });
  });

  it('schedules a retry and stops the line', async () => {
    await store.enqueue(room('r1'), clock);
    await store.enqueue(room('r2'), clock);
    transport.answerWith(transient);

    const result = await engine.drain();

    expect(result).toMatchObject({ synced: 0, retried: 1, failed: 0, stop: 'blocked' });
    // r2 was never attempted — it may depend on r1.
    expect(transport.pushed.map((e) => e.entityId)).toEqual(['r1']);
  });

  it('holds the entry back until the backoff expires', async () => {
    await store.enqueue(room('r1'), clock);
    transport.answerWith(transient);

    await engine.drain();
    expect(transport.pushed).toHaveLength(1);

    // Still inside the backoff window: nothing is due.
    clock += 500;
    const waiting = await engine.drain();
    expect(waiting.stop).toBe('waiting');
    expect(transport.pushed).toHaveLength(1);

    // Past it: the entry is retried and succeeds.
    clock += 1_000;
    transport.alwaysAnswer(ok);
    const after = await engine.drain();
    expect(after.synced).toBe(1);
    expect(transport.pushed).toHaveLength(2);
  });

  it('backs off further on each successive failure', async () => {
    await store.enqueue(room('r1'), clock);
    transport.alwaysAnswer(transient);

    await engine.drain();
    expect((await store.all())[0].nextAttemptAt).toBe(1_000); // base

    clock = 1_000;
    await engine.drain();
    expect((await store.all())[0].nextAttemptAt).toBe(3_000); // +2000

    clock = 3_000;
    await engine.drain();
    expect((await store.all())[0].nextAttemptAt).toBe(7_000); // +4000
  });

  it('gives up after maxAttempts and parks the entry as failed', async () => {
    engine = new SyncEngine(store, transport, {
      now: () => clock,
      backoff: fixedBackoff,
      maxAttempts: 3,
    });
    await store.enqueue(room('r1'), clock);
    transport.alwaysAnswer(transient);

    for (let i = 0; i < 5; i++) {
      await engine.drain();
      clock += 120_000;
    }

    const counts = await store.counts();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
    expect((await store.all())[0].lastError).toMatch(/gave up after 3 attempts/);
  });
});

describe('SyncEngine — permanent failure', () => {
  it('parks the bad row and keeps going, so one row cannot wedge the queue', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(room('r1'), 0);
    await store.enqueue(room('r2'), 0);
    await store.enqueue(room('r3'), 0);
    transport.answerWith(ok, permanent, ok);

    const engine = new SyncEngine(store, transport, { backoff: fixedBackoff });
    const result = await engine.drain();

    expect(result).toMatchObject({ synced: 2, failed: 1, stop: 'drained' });
    expect(transport.pushed.map((e) => e.entityId)).toEqual(['r1', 'r2', 'r3']);
    expect((await store.all())[1].lastError).toBe('row violates RLS policy');
  });

  it('never retries a permanent failure', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport().alwaysAnswer(permanent);
    await store.enqueue(room('r1'), 0);

    const engine = new SyncEngine(store, transport, { backoff: fixedBackoff });
    await engine.drain();
    await engine.drain();

    expect(transport.pushed).toHaveLength(1);
  });

  it('can requeue failed entries for a retry-all button', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport().alwaysAnswer(permanent);
    await store.enqueue(room('r1'), 0);

    const engine = new SyncEngine(store, transport, { backoff: fixedBackoff });
    await engine.drain();
    expect((await store.counts()).failed).toBe(1);

    expect(await store.requeueFailed(0)).toBe(1);
    transport.alwaysAnswer(ok);
    const result = await engine.drain();

    expect(result.synced).toBe(1);
    expect(await store.counts()).toEqual({ pending: 0, failed: 0 });
  });
});

describe('SyncEngine — edits during a push', () => {
  it('does not lose an edit that lands while the push is in flight', async () => {
    const store = new MemoryOutboxStore();
    let clock = 0;

    // The transport edits the record mid-push, standing in for a contractor
    // typing while the request is on the wire.
    const transport: SyncTransport = {
      async push() {
        await store.enqueue(room('r1', { widthIn: 168 }), clock);
        return ok;
      },
    };

    await store.enqueue(room('r1', { widthIn: 144 }), clock);
    const engine = new SyncEngine(store, transport, {
      now: () => clock,
      backoff: fixedBackoff,
      maxEntriesPerPass: 1,
    });

    const result = await engine.drain();

    // The push landed, but it carried stale data, so the entry stays pending.
    expect(result.synced).toBe(0);
    const entry = (await store.all())[0];
    expect(entry.state).toBe('pending');
    expect(entry.payload.widthIn).toBe(168);
  });
});

describe('SyncEngine — concurrency and budget', () => {
  it('refuses to run two drains at once', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(room('r1'), 0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: SyncTransport = {
      async push() {
        await gate;
        return ok;
      },
    };

    const engine = new SyncEngine(store, transport, { backoff: fixedBackoff });
    const first = engine.drain();
    const second = await engine.drain();

    expect(second).toMatchObject({ synced: 0, stop: 'blocked' });
    release();
    expect((await first).synced).toBe(1);
  });

  it('stops at the per-pass budget and reports more work remains', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    for (let i = 0; i < 5; i++) await store.enqueue(room(`r${i}`), 0);

    const engine = new SyncEngine(store, transport, {
      backoff: fixedBackoff,
      maxEntriesPerPass: 2,
    });
    const result = await engine.drain();

    expect(result).toMatchObject({ synced: 2, stop: 'budget' });
    expect((await store.counts()).pending).toBe(3);
  });

  it('reports progress as it goes', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(room('r1'), 0);
    await store.enqueue(room('r2'), 0);

    const onProgress = vi.fn();
    const engine = new SyncEngine(store, transport, { backoff: fixedBackoff, onProgress });
    await engine.drain();

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ synced: 2 });
  });
});
