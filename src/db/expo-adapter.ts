import type * as SQLite from 'expo-sqlite';

import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';

/**
 * Binds the adapter to expo-sqlite. The Node counterpart lives in the tests.
 *
 * Transactions take turns. There is one connection, and withTransactionAsync
 * only issues BEGIN and COMMIT on it — so two flows that each open one at the
 * same moment (sign-in moving local data across while a screen saves its
 * company row) collide with "cannot start a transaction within a transaction".
 * No repository nests transactions, so a plain queue cannot deadlock.
 */
export function expoSqliteAdapter(db: SQLite.SQLiteDatabase): SqliteAdapter {
  let turn: Promise<unknown> = Promise.resolve();

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
      const run = async () => {
        let result!: T;
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
        return result;
      };
      const mine = turn.then(run, run);
      // The next one waits for this one, whether it committed or rolled back.
      turn = mine.catch(() => undefined);
      return mine;
    },
  };
}
