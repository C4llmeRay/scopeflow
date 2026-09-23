import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { createSupabaseTransport } from './transport';
import type { OutboxEntry } from './types';

/** Records which PostgREST verb each push used. */
function fakeClient() {
  const calls: { table: string; verb: string; body?: unknown; id?: unknown }[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(body: unknown) {
          calls.push({ table, verb: 'upsert', body });
          return Promise.resolve({ error: null });
        },
        update(body: unknown) {
          return {
            eq(_col: string, id: unknown) {
              calls.push({ table, verb: 'update', body, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq(_col: string, id: unknown) {
              calls.push({ table, verb: 'delete', id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({
  seq: 1,
  entity: 'photos',
  entityId: 'p1',
  op: 'upsert',
  payload: {},
  state: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('the Supabase transport', () => {
  it('sends a full row as an upsert keyed on its id', async () => {
    const { client, calls } = fakeClient();
    await createSupabaseTransport(client).push(entry({ payload: { job_id: 'j1' } }));
    expect(calls).toEqual([{ table: 'photos', verb: 'upsert', body: { job_id: 'j1', id: 'p1' } }]);
  });

  it('sends a patch as an UPDATE, so missing NOT NULL columns cannot fail it', async () => {
    const { client, calls } = fakeClient();
    await createSupabaseTransport(client).push(
      entry({ op: 'patch', payload: { thumb_path: 'a/b.jpg', upload_state: 'uploaded' } }),
    );
    expect(calls).toEqual([
      { table: 'photos', verb: 'update', body: { thumb_path: 'a/b.jpg', upload_state: 'uploaded' }, id: 'p1' },
    ]);
  });

  it('always updates a company, which the app may never insert', async () => {
    const { client, calls } = fakeClient();
    await createSupabaseTransport(client).push(
      entry({ entity: 'companies', entityId: 'c1', payload: { id: 'c1', name: 'Summit' } }),
    );
    expect(calls).toEqual([{ table: 'companies', verb: 'update', body: { name: 'Summit' }, id: 'c1' }]);
  });
});
