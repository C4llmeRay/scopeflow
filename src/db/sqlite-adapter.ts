/**
 * The narrow slice of SQLite the sync layer needs.
 *
 * Deliberately tiny, and deliberately not expo-sqlite: the outbox is the one
 * place where a bug loses a contractor's afternoon, so its SQL is exercised in
 * Node against node:sqlite by the same conformance suite the in-memory store
 * passes. On the phone the very same code runs against expo-sqlite.
 */

export type SqlParam = string | number | null;

export interface RunResult {
  changes: number;
}

export interface SqliteAdapter {
  /** Multi-statement DDL. No parameters. */
  exec(sql: string): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  /**
   * Runs `fn` in a transaction, rolling back if it throws.
   *
   * This is what keeps a local write and its outbox entry atomic. Without it, a
   * crash in the gap between the two leaves a change that exists on the phone
   * and will never reach the server — the silent data loss that kills trust in
   * a field app permanently.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
