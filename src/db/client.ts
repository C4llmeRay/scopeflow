import * as SQLite from 'expo-sqlite';

import { SqliteOutboxStore } from '../sync/sqlite-store';
import { AI_QUEUE_TABLE } from '../features/ai/queue';
import { UPLOAD_QUEUE_TABLE } from '../sync/uploads';
import { isDemoAi } from '../lib/demo-mode';
import { claimDatabase } from './claim';
import { expoSqliteAdapter } from './expo-adapter';
import { applyColumnAdditions } from './migrate';
import { APP_SCHEMA } from './schema';
import type { LocalDatabase } from './types';

export type { LocalDatabase } from './types';

export const DATABASE_NAME = 'scopeflow.db';

/**
 * Set only for the hosted web demo (scripts/export-portable.mjs). The page may
 * be mounted twice at once by whatever embeds it, and expo-sqlite's browser
 * storage allows one live instance per site — so each visit gets its own
 * in-memory database instead, which also means every visitor starts clean.
 */
const EPHEMERAL = process.env.EXPO_PUBLIC_EPHEMERAL_DB === '1';

let opened: Promise<LocalDatabase> | null = null;

/**
 * Opens the local database, creates its tables, and brings an older database
 * forward. Idempotent and memoised: every caller gets the same connection.
 */
export function openLocalDatabase(): Promise<LocalDatabase> {
  opened ??= (async () => {
    // On web, waits for this tab's turn at the files. Instant on a phone.
    if (!EPHEMERAL) await claimDatabase();
    const db = await SQLite.openDatabaseAsync(EPHEMERAL ? ':memory:' : DATABASE_NAME);
    const adapter = expoSqliteAdapter(db);
    await adapter.exec(APP_SCHEMA);
    // `if not exists` does nothing for a database that already exists, so an
    // install from before a column was added needs it added explicitly.
    await applyColumnAdditions(adapter);
    return {
      adapter,
      outbox: await SqliteOutboxStore.create(adapter),
      uploads: await SqliteOutboxStore.create(adapter, UPLOAD_QUEUE_TABLE),
      // With the demo AI there is no model to queue work for; queued photos
      // would only fail at the server and show up as needing attention.
      ai: isDemoAi() ? undefined : await SqliteOutboxStore.create(adapter, AI_QUEUE_TABLE),
    };
  })();
  return opened;
}

/** Test and development helper. Drops the memoised connection. */
export function resetLocalDatabaseHandle(): void {
  opened = null;
}
