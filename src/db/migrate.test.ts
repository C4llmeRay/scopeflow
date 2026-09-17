/**
 * The additive migration path, against real SQLite.
 *
 * The case that matters is the one `create table if not exists` cannot handle:
 * a database that already exists, created before a column was added to the
 * schema. That database is on a phone with a day's work in it, so the migration
 * has to add the column without touching a row.
 */

import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { applyColumnAdditions, COLUMN_ADDITIONS } from './migrate';
import { APP_SCHEMA } from './schema';
import type { RunResult, SqlParam, SqliteAdapter } from './sqlite-adapter';

function nodeAdapter(): SqliteAdapter {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      return { changes: Number(db.prepare(sql).run(...params).changes) };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('begin');
      try {
        const r = await fn();
        db.exec('commit');
        return r;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
}

/** The companies table as it stood before Phase 6, with no billing extras. */
const OLD_COMPANIES = `
create table companies (
  id                   text primary key,
  company_id           text not null,
  name                 text not null,
  subscription_status  text not null default 'trialing',
  trial_ends_at        integer,
  current_period_end   integer,
  created_at           integer not null,
  updated_at           integer not null
);
`;

const columnNames = async (adapter: SqliteAdapter, table: string) =>
  (await adapter.all<{ name: string }>(`pragma table_info(${table})`)).map((r) => r.name);

describe('applyColumnAdditions', () => {
  it('adds a missing column to a database that predates it', async () => {
    const adapter = nodeAdapter();
    await adapter.exec(OLD_COMPANIES);

    expect(await columnNames(adapter, 'companies')).not.toContain('cancel_at_period_end');

    const applied = await applyColumnAdditions(adapter);

    expect(applied).toContain('companies.cancel_at_period_end');
    expect(await columnNames(adapter, 'companies')).toContain('cancel_at_period_end');
  });

  it('keeps the rows that were already there', async () => {
    const adapter = nodeAdapter();
    await adapter.exec(OLD_COMPANIES);
    await adapter.run(
      `insert into companies (id, company_id, name, created_at, updated_at)
       values ('co-1', 'co-1', 'Ridgeline Restoration', 1, 1)`,
    );

    await applyColumnAdditions(adapter);

    const [row] = await adapter.all<{ name: string; cancel_at_period_end: number }>(
      `select name, cancel_at_period_end from companies where id = 'co-1'`,
    );
    expect(row.name).toBe('Ridgeline Restoration');
    // The default fills in for a row written before the column existed.
    expect(row.cancel_at_period_end).toBe(0);
  });

  it('is a no-op the second time', async () => {
    const adapter = nodeAdapter();
    await adapter.exec(OLD_COMPANIES);

    expect(await applyColumnAdditions(adapter)).toHaveLength(1);
    expect(await applyColumnAdditions(adapter)).toEqual([]);
  });

  it('does nothing to a fresh database, because the schema already has it', async () => {
    const adapter = nodeAdapter();
    await adapter.exec(APP_SCHEMA);

    // If this ever fails, a column was added to COLUMN_ADDITIONS without being
    // added to APP_SCHEMA, so a new install would be missing it.
    expect(await applyColumnAdditions(adapter)).toEqual([]);
  });

  it('skips a table that does not exist rather than throwing', async () => {
    const adapter = nodeAdapter();
    // No tables at all.
    expect(await applyColumnAdditions(adapter)).toEqual([]);
  });

  it('declares a default for every addition, since SQLite demands one', () => {
    for (const addition of COLUMN_ADDITIONS) {
      if (addition.definition.includes('not null')) {
        expect(addition.definition).toContain('default');
      }
    }
  });
});
