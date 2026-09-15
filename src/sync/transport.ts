/**
 * Pushing outbox entries to Supabase.
 *
 * Every push is an UPSERT keyed on the client-generated id, which is what makes
 * a retry harmless: if the previous attempt actually landed before the network
 * dropped, the retry writes the same row again and nothing breaks.
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
