/**
 * In-memory outbox.
 *
 * Two jobs: it backs the sync tests, and it is the executable specification the
 * SQLite store has to match. When the two disagree, this one is right.
 */

import {
  isWrite,
  mergedOp,
  type NewOutboxEntry,
  type OutboxCounts,
  type OutboxEntry,
  type OutboxStore,
} from './types';

export class MemoryOutboxStore implements OutboxStore {
  private entries: OutboxEntry[] = [];
  private nextSeq = 1;

  async enqueue(entry: NewOutboxEntry, now: number): Promise<void> {
    // Coalesce: a contractor dragging a dimension field should produce one
    // push, not forty. Last write wins, so merging the payloads is the whole
    // conflict resolution strategy.
    const existing = this.entries.find(
      (e) =>
        e.state === 'pending' &&
        e.entity === entry.entity &&
        e.entityId === entry.entityId &&
        (e.op === entry.op || (isWrite(e.op) && isWrite(entry.op))),
    );

    if (existing) {
      existing.op = mergedOp(existing.op, entry.op);
      existing.payload = { ...existing.payload, ...entry.payload };
      existing.revision += 1;
      existing.updatedAt = now;
      return;
    }

    this.entries.push({
      seq: this.nextSeq++,
      entity: entry.entity,
      entityId: entry.entityId,
      op: entry.op,
      payload: { ...entry.payload },
      state: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async nextDue(now: number): Promise<OutboxEntry | null> {
    const due = this.entries
      .filter((e) => e.state === 'pending' && e.nextAttemptAt <= now)
      .sort((a, b) => a.seq - b.seq)[0];
    // A copy, so the engine cannot mutate queue state by accident.
    return due ? { ...due, payload: { ...due.payload } } : null;
  }

  async markSynced(seq: number, revision: number, now: number): Promise<boolean> {
    const entry = this.find(seq);
    if (entry.revision !== revision) return false;
    entry.state = 'synced';
    entry.lastError = null;
    entry.updatedAt = now;
    return true;
  }

  async markRetry(seq: number, nextAttemptAt: number, error: string, now: number): Promise<void> {
    const entry = this.find(seq);
    entry.attempts += 1;
    entry.nextAttemptAt = nextAttemptAt;
    entry.lastError = error;
    entry.updatedAt = now;
  }

  async markFailed(seq: number, error: string, now: number): Promise<void> {
    const entry = this.find(seq);
    entry.state = 'failed';
    entry.lastError = error;
    entry.updatedAt = now;
  }

  async counts(): Promise<OutboxCounts> {
    return {
      pending: this.entries.filter((e) => e.state === 'pending').length,
      failed: this.entries.filter((e) => e.state === 'failed').length,
    };
  }

  async requeueFailed(now: number): Promise<number> {
    const failed = this.entries.filter((e) => e.state === 'failed');
    for (const entry of failed) {
      entry.state = 'pending';
      entry.attempts = 0;
      entry.nextAttemptAt = now;
      entry.lastError = null;
      entry.updatedAt = now;
    }
    return failed.length;
  }

  async all(): Promise<readonly OutboxEntry[]> {
    return this.entries.map((e) => ({ ...e, payload: { ...e.payload } }));
  }

  private find(seq: number): OutboxEntry {
    const entry = this.entries.find((e) => e.seq === seq);
    if (!entry) throw new Error(`outbox entry ${seq} not found`);
    return entry;
  }
}
