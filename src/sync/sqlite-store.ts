/**
 * The outbox, on SQLite. This is the one that ships.
 *
 * Behaviour is specified by src/sync/outbox-conformance.ts, which this store and
 * MemoryOutboxStore both have to pass.
 */

import type { SqliteAdapter } from '../db/sqlite-adapter';
import type {
  NewOutboxEntry,
  OutboxCounts,
  OutboxEntry,
  OutboxState,
  OutboxStore,
  SyncEntity,
  SyncOp,
} from './types';

export const DEFAULT_OUTBOX_TABLE = 'sync_outbox';

/**
 * The same queue shape, under any table name.
 *
 * Two queues use it: sync_outbox for JSON rows, and upload_queue for photo and
 * audio binaries. They are separate because a 4 MB photo on one bar of signal
 * must not hold up the room rows queued behind it.
 */
export const outboxSchema = (table: string): string => `
create table if not exists ${table} (
  seq             integer primary key autoincrement,
  entity          text    not null,
  entity_id       text    not null,
  op              text    not null,
  payload         text    not null,
  state           text    not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at integer not null,
  last_error      text,
  revision        integer not null default 1,
  created_at      integer not null,
  updated_at      integer not null
);

-- Covers the drain's only hot query: oldest due pending entry.
create index if not exists ${table}_due_idx
  on ${table} (state, next_attempt_at, seq);

-- Covers the coalescing lookup on every write the app makes.
create index if not exists ${table}_record_idx
  on ${table} (entity, entity_id, state);
`;

interface OutboxRow {
  seq: number;
  entity: string;
  entity_id: string;
  op: string;
  payload: string;
  state: string;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    seq: row.seq,
    entity: row.entity as SyncEntity,
    entityId: row.entity_id,
    op: row.op as SyncOp,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    state: row.state as OutboxState,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteOutboxStore implements OutboxStore {
  constructor(
    private readonly db: SqliteAdapter,
    private readonly table: string = DEFAULT_OUTBOX_TABLE,
  ) {}

  static async create(
    db: SqliteAdapter,
    table: string = DEFAULT_OUTBOX_TABLE,
  ): Promise<SqliteOutboxStore> {
    await db.exec(outboxSchema(table));
    return new SqliteOutboxStore(db, table);
  }

  async enqueue(entry: NewOutboxEntry, now: number): Promise<void> {
    // Coalesce into a pending entry for the same record, so holding a key down
    // in a dimension field produces one push rather than forty.
    const [existing] = await this.db.all<OutboxRow>(
      `select * from ${this.table}
        where entity = ? and entity_id = ? and op = ? and state = 'pending'
        order by seq limit 1`,
      [entry.entity, entry.entityId, entry.op],
    );

    if (existing) {
      const merged = { ...(JSON.parse(existing.payload) as object), ...entry.payload };
      await this.db.run(
        `update ${this.table}
            set payload = ?, revision = revision + 1, updated_at = ?
          where seq = ?`,
        [JSON.stringify(merged), now, existing.seq],
      );
      return;
    }

    await this.db.run(
      `insert into ${this.table}
         (entity, entity_id, op, payload, state, attempts, next_attempt_at,
          last_error, revision, created_at, updated_at)
       values (?, ?, ?, ?, 'pending', 0, ?, null, 1, ?, ?)`,
      [entry.entity, entry.entityId, entry.op, JSON.stringify(entry.payload), now, now, now],
    );
  }

  async nextDue(now: number): Promise<OutboxEntry | null> {
    const [row] = await this.db.all<OutboxRow>(
      `select * from ${this.table}
        where state = 'pending' and next_attempt_at <= ?
        order by seq limit 1`,
      [now],
    );
    return row ? toEntry(row) : null;
  }

  async markSynced(seq: number, revision: number, now: number): Promise<boolean> {
    // The revision guard is what stops an edit that landed mid-flight from
    // being silently marked as sent.
    const result = await this.db.run(
      `update ${this.table}
          set state = 'synced', last_error = null, updated_at = ?
        where seq = ? and revision = ?`,
      [now, seq, revision],
    );
    return result.changes > 0;
  }

  async markRetry(seq: number, nextAttemptAt: number, error: string, now: number): Promise<void> {
    await this.db.run(
      `update ${this.table}
          set attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ?
        where seq = ?`,
      [nextAttemptAt, error, now, seq],
    );
  }

  async markFailed(seq: number, error: string, now: number): Promise<void> {
    await this.db.run(
      `update ${this.table} set state = 'failed', last_error = ?, updated_at = ? where seq = ?`,
      [error, now, seq],
    );
  }

  async counts(): Promise<OutboxCounts> {
    const rows = await this.db.all<{ state: string; n: number }>(
      `select state, count(*) as n from ${this.table} group by state`,
    );
    const by = (s: string) => rows.find((r) => r.state === s)?.n ?? 0;
    return { pending: by('pending'), failed: by('failed') };
  }

  async requeueFailed(now: number): Promise<number> {
    const result = await this.db.run(
      `update ${this.table}
          set state = 'pending', attempts = 0, next_attempt_at = ?, last_error = null, updated_at = ?
        where state = 'failed'`,
      [now, now],
    );
    return result.changes;
  }

  async all(): Promise<readonly OutboxEntry[]> {
    const rows = await this.db.all<OutboxRow>(`select * from ${this.table} order by seq`);
    return rows.map(toEntry);
  }

  /** Housekeeping: synced entries are only kept so the debug screen has history. */
  async pruneSynced(olderThan: number): Promise<number> {
    const result = await this.db.run(
      `delete from ${this.table} where state = 'synced' and updated_at < ?`,
      [olderThan],
    );
    return result.changes;
  }
}
