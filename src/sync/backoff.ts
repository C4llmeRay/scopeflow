/**
 * Retry backoff for the outbox drain.
 *
 * Equal jitter: half the delay is deterministic, half is random. Pure
 * exponential backoff makes every phone that lost signal in the same dead spot
 * retry at the same instant; full jitter throws away the growth guarantee. Equal
 * jitter keeps both.
 */

export interface BackoffOptions {
  /** Delay after the first failure, before jitter. */
  baseMs: number;
  /** Ceiling on the deterministic part. */
  capMs: number;
  /** Returns 0..1. Injectable so tests are deterministic. */
  jitter: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 2_000,
  // Five minutes. A contractor who walks out of a dead spot should not wait an
  // hour for the queue to notice.
  capMs: 300_000,
  jitter: Math.random,
};

/**
 * Delay before retry number `attempt` (1-based: attempt 1 is the first retry).
 * Returns a value in [d/2, d] where d = min(capMs, baseMs * 2^(attempt-1)).
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a whole number >= 1, received ${attempt}`);
  }
  const { baseMs, capMs, jitter } = options;

  // Cap the exponent before computing the power, so a long-dead queue cannot
  // overflow to Infinity on the way to being clamped.
  const maxShift = Math.max(0, Math.ceil(Math.log2(Math.max(capMs, 1) / Math.max(baseMs, 1))));
  const shift = Math.min(attempt - 1, maxShift);

  const uncapped = baseMs * 2 ** shift;
  const deterministic = Math.min(capMs, uncapped);

  return Math.round(deterministic / 2 + jitter() * (deterministic / 2));
}
