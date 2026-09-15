/**
 * The outbox drain.
 *
 * Pure orchestration: the store, the transport, the clock and the connectivity
 * check are all injected, which is why the whole retry/ordering/backoff
 * behaviour is covered by fast Node tests instead of only being observable on a
 * phone in a basement.
 */

import { backoffDelayMs, DEFAULT_BACKOFF, type BackoffOptions } from './backoff';
import type { DrainResult, OutboxStore, SyncTransport } from './types';

export interface SyncEngineOptions {
  /** Epoch ms. Injectable for tests. */
  now?: () => number;
  /** False short-circuits the pass without touching the transport. */
  isOnline?: () => boolean | Promise<boolean>;
  backoff?: BackoffOptions;
  /**
   * How many times an entry is retried before it is parked as failed. Ten
   * attempts at the default backoff spans roughly forty minutes of dead signal.
   */
  maxAttempts?: number;
  /** Ceiling on entries per pass, so a huge queue cannot hold the app hostage. */
  maxEntriesPerPass?: number;
  /**
   * Whether a transient failure stops the whole pass. True for the row outbox,
   * where a room must land before the openings that reference it. False for the
   * upload queue, where binaries have no dependencies on one another and one
   * unreachable photo must not hold up the rest.
   */
  stopOnTransientFailure?: boolean;
  /** Called after every state change, for the sync chip. */
  onProgress?: (result: DrainResult) => void;
}

export class SyncEngine {
  private readonly store: OutboxStore;
  private readonly transport: SyncTransport;
  private readonly now: () => number;
  private readonly isOnline: () => boolean | Promise<boolean>;
  private readonly backoff: BackoffOptions;
  private readonly maxAttempts: number;
  private readonly maxEntriesPerPass: number;
  private readonly stopOnTransientFailure: boolean;
  private readonly onProgress?: (result: DrainResult) => void;

  /** Guards against two drains running at once. */
  private draining = false;

  constructor(store: OutboxStore, transport: SyncTransport, options: SyncEngineOptions = {}) {
    this.store = store;
    this.transport = transport;
    this.now = options.now ?? Date.now;
    this.isOnline = options.isOnline ?? (() => true);
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.maxEntriesPerPass = options.maxEntriesPerPass ?? 200;
    this.stopOnTransientFailure = options.stopOnTransientFailure ?? true;
    this.onProgress = options.onProgress;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Pushes queued entries until the queue is empty, something blocks, or the
   * per-pass budget runs out. Safe to call often: a second concurrent call
   * returns immediately rather than double-pushing.
   */
  async drain(): Promise<DrainResult> {
    if (this.draining) {
      return { synced: 0, failed: 0, retried: 0, stop: 'blocked' };
    }
    this.draining = true;

    const result: DrainResult = { synced: 0, failed: 0, retried: 0, stop: 'drained' };

    try {
      if (!(await this.isOnline())) {
        result.stop = 'offline';
        return result;
      }

      for (let processed = 0; processed < this.maxEntriesPerPass; processed++) {
        const now = this.now();
        const entry = await this.store.nextDue(now);

        if (!entry) {
          // Nothing due. Distinguish "all done" from "everything is in backoff",
          // because the UI says very different things about each.
          const { pending } = await this.store.counts();
          result.stop = pending > 0 ? 'waiting' : 'drained';
          return result;
        }

        const push = await this.transport.push(entry);

        if (push.ok) {
          const settled = await this.store.markSynced(entry.seq, entry.revision, this.now());
          if (settled) {
            result.synced++;
          }
          // When settled is false the record was edited mid-flight. The entry
          // stays pending and the next iteration pushes the newer payload;
          // pushes are idempotent upserts, so sending it twice costs nothing.
          this.onProgress?.(result);
          continue;
        }

        if (push.kind === 'permanent') {
          // Retrying cannot fix a validation error or an RLS refusal. Park it,
          // surface it, and keep going — one bad row must not wedge the queue.
          await this.store.markFailed(entry.seq, push.message, this.now());
          result.failed++;
          this.onProgress?.(result);
          continue;
        }

        // Transient. Retry, or give up after enough attempts.
        const attempts = entry.attempts + 1;
        if (attempts >= this.maxAttempts) {
          await this.store.markFailed(
            entry.seq,
            `gave up after ${attempts} attempts: ${push.message}`,
            this.now(),
          );
          result.failed++;
          this.onProgress?.(result);
          continue;
        }

        const delay = backoffDelayMs(attempts, this.backoff);
        await this.store.markRetry(
          entry.seq,
          this.now() + delay,
          push.message,
          this.now(),
        );
        result.retried++;
        this.onProgress?.(result);

        if (this.stopOnTransientFailure) {
          // Head-of-line blocking is deliberate for the row outbox. Later
          // entries may reference this record — a room's openings, a job's
          // rooms — so pushing past a transient failure would produce foreign
          // key errors that look permanent and would park good rows as failed.
          result.stop = 'blocked';
          return result;
        }
        // Uploads have no dependencies on one another, so the pass carries on
        // and this entry comes back around once its backoff expires.
      }

      result.stop = 'budget';
      return result;
    } finally {
      this.draining = false;
      this.onProgress?.(result);
    }
  }
}
