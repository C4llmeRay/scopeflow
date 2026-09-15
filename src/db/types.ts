import type { OutboxStore } from '../sync/types';
import type { SqliteAdapter } from './sqlite-adapter';

/**
 * The local database handle the repositories take.
 *
 * Declared here rather than in client.ts so that repository code — and its
 * tests — never has to import expo-sqlite, which cannot load in Node.
 *
 * Two queues, deliberately: `outbox` carries JSON rows, `uploads` carries photo
 * and audio binaries. A 4 MB original on one bar of signal must never hold up
 * the room rows queued behind it.
 */
export interface LocalDatabase {
  adapter: SqliteAdapter;
  outbox: OutboxStore;
  uploads: OutboxStore;
  /**
   * Queued model work. Optional because every repository test builds a database
   * without one, and nothing below the AI feature needs it.
   */
  ai?: OutboxStore;
}
