/**
 * Additive migrations for the on-device schema.
 *
 * `APP_SCHEMA` is all `create table if not exists`, which is correct for a
 * fresh install and silently useless for one that already exists: adding a
 * column to the SQL does nothing to a database that was created before the
 * column was written. The first person to hit that is a contractor mid-job
 * whose queries start failing on a column that "obviously" exists.
 *
 * So: run the schema, then bring an older database forward. Only ever additive
 * — a column is added, never dropped or retyped. Anything that genuinely needs
 * a table rebuilt gets written here deliberately, not inferred.
 *
 * Deliberately not a version counter. A counter records what a database has
 * been told; `pragma table_info` records what it actually has, and those come
 * apart the moment a migration half-applies. Asking the database is cheap.
 */

import type { SqliteAdapter } from './sqlite-adapter';

interface ColumnAddition {
  table: string;
  column: string;
  /** The column definition, exactly as it reads in APP_SCHEMA. */
  definition: string;
}

/**
 * Columns added after the schema first shipped.
 *
 * SQLite's `alter table add column` cannot add a NOT NULL column without a
 * default, so every entry here carries one. Keep them in the same order they
 * were introduced; the list is append-only.
 */
export const COLUMN_ADDITIONS: readonly ColumnAddition[] = [
  // Phase 6, billing. Stripe knows whether a subscription is set to lapse at
  // the end of the period; without this the app has to describe a cancelled
  // subscription that is still live as though it were already dead.
  {
    table: 'companies',
    column: 'cancel_at_period_end',
    definition: 'integer not null default 0',
  },
];

async function columnsOf(adapter: SqliteAdapter, table: string): Promise<Set<string>> {
  // pragma table_info returns nothing at all for a table that does not exist,
  // which is the answer we want: nothing to add to a table nobody has.
  const rows = await adapter.all<{ name: string }>(`pragma table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

/**
 * Brings an existing database up to the current schema. Idempotent: running it
 * against an already-current database does nothing and costs one pragma per
 * distinct table.
 *
 * Returns what it added, so a caller can log it. Nothing is returned on a fresh
 * install, because `create table` already included every column.
 */
export async function applyColumnAdditions(adapter: SqliteAdapter): Promise<string[]> {
  const applied: string[] = [];
  const seen = new Map<string, Set<string>>();

  for (const addition of COLUMN_ADDITIONS) {
    let existing = seen.get(addition.table);
    if (!existing) {
      existing = await columnsOf(adapter, addition.table);
      seen.set(addition.table, existing);
    }

    // An absent table means the schema has not been created yet, or the table
    // was removed. Either way there is nothing to alter.
    if (existing.size === 0 || existing.has(addition.column)) continue;

    await adapter.exec(
      `alter table ${addition.table} add column ${addition.column} ${addition.definition}`,
    );
    existing.add(addition.column);
    applied.push(`${addition.table}.${addition.column}`);
  }

  return applied;
}
