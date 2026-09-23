/**
 * The two switches a demo needs, independent of whether a backend exists.
 *
 *   EXPO_PUBLIC_AI_MODE=demo|claude   Which answers the AI buttons. Defaults to
 *                                     demo with no backend and claude with one.
 *   EXPO_PUBLIC_DEMO_TOOLS=1          Keeps "Load a sample job" once a backend
 *                                     is configured. Always on without one.
 *
 * Both are read as literal `process.env.EXPO_PUBLIC_*` expressions because
 * Expo inlines them at build time and only recognises that exact form.
 */

import { isSupabaseConfigured } from './supabase';

/** True when the AI buttons are answered by on-device rules, not Claude. */
export function isDemoAi(): boolean {
  const mode = process.env.EXPO_PUBLIC_AI_MODE;
  // With nothing to call, there is no choice to make.
  if (!isSupabaseConfigured()) return true;
  return mode === 'demo';
}

/** True when demo helpers — the sample job — are offered. */
export function showDemoTools(): boolean {
  return !isSupabaseConfigured() || process.env.EXPO_PUBLIC_DEMO_TOOLS === '1';
}
