import type * as SQLite from 'expo-sqlite';

import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';

/** Binds the adapter to expo-sqlite. The Node counterpart lives in the tests. */
export function expoSqliteAdapter(db: SQLite.SQLiteDatabase): SqliteAdapter {
  return {
    async exec(sql: string): Promise<void> {
      await db.execAsync(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return db.getAllAsync<T>(sql, params);
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      let result!: T;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result;
    },
  };
}
