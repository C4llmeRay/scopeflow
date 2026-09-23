/**
 * Offline sync — the contract.
 *
 * The phone is the source of truth during an inspection. Every write lands in
 * SQLite first and in the outbox; this engine drains the outbox when there is
 * signal. Nothing in the UI ever blocks on the network.
 *
 * The conflict model is deliberately, almost aggressively simple, because
 * offline sync is where solo projects disappear for three weeks:
 *
 *   * Last-write-wins per record. No field-level merging, no CRDTs, no vector
 *     clocks. Two people editing the same room on the same job is not a
 *     scenario the MVP has — it ships single-user.
 *   * Every record carries a client-generated UUID, so a push is an UPSERT and
 *     retrying one that actually succeeded is harmless.
 *   * Photos are append-only. Their rows are never updated or deleted remotely.
 *   * Strict FIFO with head-of-line blocking on transient failure, so a room
 *     always lands before the openings that reference it.
 */

/** The tables that sync. Photo binaries upload separately from their rows. */
export type SyncEntity =
  | 'companies'
  | 'jobs'
  | 'rooms'
  | 'openings'
  | 'photos'
  | 'damages'
  | 'voice_notes'
  | 'price_items'
  | 'line_items'
  | 'estimates';

/**
 * Only 'upsert' exists in the normal path. Deletes are soft — an upsert that
 * sets deleted_at — which is what makes undo work and what keeps a claim's
 * history intact. 'purge' is reserved for the storage cleanup job.
 */
export type SyncOp = 'upsert' | 'patch' | 'purge';

/**
 * 'patch' is a partial write to a row the server already has — a status, an
 * upload path. It must go as an UPDATE: as an upsert, Postgres checks NOT NULL
 * on the insert half before it ever looks for the existing row, so a payload
 * without job_id fails even though the row is there.
 */
export const isWrite = (op: SyncOp): boolean => op === 'upsert' || op === 'patch';

/**
 * One pending write per record. Merging keeps them in order: a patch queued
 * behind an unsent upsert rides along with it, and an upsert that arrives
 * behind a pending patch turns it back into an upsert carrying both.
 */
export const mergedOp = (a: SyncOp, b: SyncOp): SyncOp =>
  a === 'upsert' || b === 'upsert' ? 'upsert' : 'patch';

export type OutboxState = 'pending' | 'synced' | 'failed';

export interface OutboxEntry {
  /** Monotonic. Defines drain order, which is also FK order. */
  seq: number;
  entity: SyncEntity;
  /** Client-generated UUID of the record. The remote primary key. */
  entityId: string;
  op: SyncOp;
  payload: Record<string, unknown>;
  state: OutboxState;
  attempts: number;
  /** Epoch ms. The entry is invisible to the drain until this time. */
  nextAttemptAt: number;
  lastError: string | null;
  /**
   * Bumped every time a later edit merges into this entry. The drain captures
   * it before pushing and hands it back to markSynced, so an edit that lands
   * while the push is in flight is never mistaken for having been sent.
   */
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type NewOutboxEntry = Pick<OutboxEntry, 'entity' | 'entityId' | 'op' | 'payload'>;

/**
 * Why a push failed, which decides whether it is worth trying again.
 *
 *   transient  network down, timeout, 5xx, rate limit. Retry with backoff.
 *   permanent  4xx: a validation error, an RLS refusal, a broken foreign key.
 *              Retrying cannot fix it, so the entry is parked as failed and
 *              surfaced in the UI rather than retried until the heat death of
 *              the universe.
 */
export type PushFailureKind = 'transient' | 'permanent';

export type PushResult =
  | { ok: true }
  | { ok: false; kind: PushFailureKind; message: string };

export interface SyncTransport {
  push(entry: OutboxEntry): Promise<PushResult>;
}

export interface OutboxStore {
  /**
   * Adds an entry. If a pending upsert for the same record is already queued
   * and not currently being retried, the payloads MERGE into that entry rather
   * than adding another — a contractor holding down a key on a dimension field
   * should not produce forty round trips.
   */
  enqueue(entry: NewOutboxEntry, now: number): Promise<void>;
  /** Oldest pending entry that is due. Null when the queue is empty or all due times are in the future. */
  nextDue(now: number): Promise<OutboxEntry | null>;
  /**
   * Marks the entry sent. Returns false and leaves it pending if `revision` no
   * longer matches — meaning an edit merged in while the push was in flight, so
   * what landed on the server is already stale and must be pushed again.
   */
  markSynced(seq: number, revision: number, now: number): Promise<boolean>;
  markRetry(seq: number, nextAttemptAt: number, error: string, now: number): Promise<void>;
  markFailed(seq: number, error: string, now: number): Promise<void>;
  counts(): Promise<OutboxCounts>;
  /** Moves failed entries back to pending. For the "retry all" button. */
  requeueFailed(now: number): Promise<number>;
  /**
   * Every entry, in queue order. Backs the debug screen — when a contractor
   * says "it didn't save", being able to look at the queue is the difference
   * between a diagnosis and a guess.
   */
  all(): Promise<readonly OutboxEntry[]>;
}

export interface OutboxCounts {
  pending: number;
  failed: number;
}

/** Why a drain pass stopped. Drives the sync chip in the UI. */
export type DrainStop =
  | 'drained' // queue is empty, everything is up to date
  | 'waiting' // entries remain but are in backoff
  | 'blocked' // a transient failure stopped the line; will resume
  | 'offline' // no connectivity, nothing was attempted
  | 'budget'; // hit maxEntriesPerPass, more work remains

export interface DrainResult {
  synced: number;
  failed: number;
  retried: number;
  stop: DrainStop;
}
