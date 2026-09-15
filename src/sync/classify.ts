/**
 * Deciding whether a failed push is worth trying again.
 *
 * Getting this wrong is expensive in both directions. Call a permanent failure
 * transient and the queue retries a broken row forever while the contractor
 * watches a spinner. Call a transient failure permanent and a row that would
 * have synced fine the moment signal returned is parked as failed instead.
 */

import type { PushFailureKind } from './types';

/** The shape of a PostgREST error, without depending on the Supabase types here. */
export interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  status?: number | null;
}

/** Postgres SQLSTATE class prefixes that mean "the server had a bad moment". */
const TRANSIENT_SQLSTATE_CLASSES = [
  '08', // connection exception
  '40', // transaction rollback, including serialization failure and deadlock
  '53', // insufficient resources
  '57', // operator intervention, including admin shutdown
  '58', // system error
];

export function classifyPushError(error: unknown): { kind: PushFailureKind; message: string } {
  // Checked first: every field of PostgrestLikeError is optional, so an Error
  // is assignable to it at the type level and narrowing the other way around
  // collapses to never.
  if (!isPostgrestLike(error)) {
    // Nothing came back from the server, so fetch itself failed: airplane mode,
    // DNS, a captive portal at the job site. Always worth retrying.
    if (error instanceof Error) {
      return { kind: 'transient', message: error.message || 'network request failed' };
    }
    return { kind: 'transient', message: String(error) };
  }

  const code = error.code ?? '';
  const status = error.status ?? 0;
  const message = error.message || error.details || `push failed (${code || status})`;

  // Rate limiting and server errors: back off and try again.
  if (status === 429 || (status >= 500 && status <= 599)) {
    return { kind: 'transient', message };
  }

  if (TRANSIENT_SQLSTATE_CLASSES.includes(code.slice(0, 2))) {
    return { kind: 'transient', message };
  }

  // Everything else the server actually answered — a constraint violation, an
  // RLS refusal, a malformed request, a missing column — will fail identically
  // on every retry. Park it and surface it.
  return { kind: 'permanent', message };
}

function isPostgrestLike(value: unknown): value is PostgrestLikeError {
  if (typeof value !== 'object' || value === null) return false;
  return 'code' in value || 'details' in value || 'status' in value;
}
