/**
 * The two switches a demo needs, independent of whether a backend exists.
 *
 *   EXPO_PUBLIC_AI_MODE=demo|claude   Which answers the AI buttons. Defaults to
 *                                     demo with no backend and claude with one.
 *   EXPO_PUBLIC_DEMO_TOOLS=1          Keeps "Load a sample job" once a backend
 *                                     is configured. Always on without one.
 *   EXPO_PUBLIC_ESTIMATING=1          Shows the estimating features — measured
 *                                     rooms, damage sheet, pricing, estimates.
 *                                     Off by default: the product is photos
 *                                     for Xactimate, which does the estimate.
 *   EXPO_PUBLIC_EMAIL_CODES=1         Offers "email me a code" on the sign-in
 *                                     screen. Off by default: it needs working
 *                                     email (custom SMTP on a free project).
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

/** True when sign-in may offer an emailed code as well as a password. */
export function emailCodesEnabled(): boolean {
  return process.env.EXPO_PUBLIC_EMAIL_CODES === '1';
}

/** True when the estimating half of the app is shown. See the header. */
export function estimatingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ESTIMATING === '1';
}
