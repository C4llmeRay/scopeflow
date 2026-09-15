import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, created on first use.
 *
 * Lazy on purpose: a missing environment variable should fail when something
 * actually tries to reach the network, with a message that says what to do —
 * not at import time, which would take the whole bundle down before a single
 * screen renders. The app is meant to work with no backend reachable at all.
 *
 * The anon key is safe to ship: it is a public identifier and every table is
 * behind RLS. The service role key is not, and must never appear in this app.
 * Anything needing elevated privilege goes through an Edge Function.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set ' +
        'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client = createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // There is no browser URL to parse a session out of in a native app.
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** True when there is something to sync to. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
}
