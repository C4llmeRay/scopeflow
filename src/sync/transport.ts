/**
 * Pushing outbox entries to Supabase.
 *
 * A full row is an UPSERT keyed on the client-generated id, which is what makes
 * a retry harmless: if the previous attempt actually landed before the network
 * dropped, the retry writes the same row again and nothing breaks. A partial
 * write (a patch, or any company change) is an UPDATE, which is just as safe to
 * repeat.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyPushError } from './classify';
import type { OutboxEntry, PushResult, SyncTransport } from './types';

export function createSupabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    async push(entry: OutboxEntry): Promise<PushResult> {
      try {
        if (entry.op === 'purge') {
          const { error } = await client.from(entry.entity).delete().eq('id', entry.entityId);
          if (error) return { ok: false, ...classifyPushError(error) };
          return { ok: true };
        }

        // A company row always exists on the server — bootstrap_company makes
        // it at first sign-in — and RLS gives the app no INSERT on companies,
        // so an upsert (INSERT ... ON CONFLICT) is refused outright. Same for a
        // patch: a partial payload has to be an UPDATE. See SyncOp.
        if (entry.op === 'patch' || entry.entity === 'companies') {
          const { id: _id, ...changes } = entry.payload;
          const { error } = await client.from(entry.entity).update(changes).eq('id', entry.entityId);
          if (error) return { ok: false, ...classifyPushError(error) };
          return { ok: true };
        }

        const { error } = await client
          .from(entry.entity)
          .upsert({ ...entry.payload, id: entry.entityId }, { onConflict: 'id' });

        if (error) return { ok: false, ...classifyPushError(error) };
        return { ok: true };
      } catch (caught) {
        // fetch itself failed — airplane mode, DNS, a captive portal.
        return { ok: false, ...classifyPushError(caught) };
      }
    },
  };
}
