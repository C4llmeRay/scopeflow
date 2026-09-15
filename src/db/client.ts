import * as SQLite from 'expo-sqlite';

import { SqliteOutboxStore } from '../sync/sqlite-store';
import { AI_QUEUE_TABLE } from '../features/ai/queue';
import { UPLOAD_QUEUE_TABLE } from '../sync/uploads';
import { expoSqliteAdapter } from './expo-adapter';
import { APP_SCHEMA } from './schema';
import type { LocalDatabase } from './types';

export type { LocalDatabase } from './types';

export const DATABASE_NAME = 'scopeflow.db';

let opened: Promise<LocalDatabase> | null = null;

/**
 * Opens the local database and creates its tables. Idempotent and memoised:
 * every caller gets the same connection, and every statement is `if not exists`.
 */
export function openLocalDatabase(): Promise<LocalDatabase> {
  opened ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    const adapter = expoSqliteAdapter(db);
    await adapter.exec(APP_SCHEMA);
    return {
      adapter,
      outbox: await SqliteOutboxStore.create(adapter),
      uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
      ai: await SqliteOutboxStore.create(adapter, AI_QUEUE_TABLE),
    };
  })();
  return opened;
}

/** Test and development helper. Drops the memoised connection. */
export function resetLocalDatabaseHandle(): void {
  opened = null;
}
