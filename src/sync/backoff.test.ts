import { describe, expect, it } from 'vitest';

import { backoffDelayMs, DEFAULT_BACKOFF } from './backoff';

describe('backoffDelayMs', () => {
  const opts = { baseMs: 1_000, capMs: 60_000, jitter: () => 1 };

  it('starts at the base delay', () => {
    expect(backoffDelayMs(1, opts)).toBe(1_000);
  });

  it('doubles each attempt', () => {
    expect(backoffDelayMs(2, opts)).toBe(2_000);
    expect(backoffDelayMs(3, opts)).toBe(4_000);
    expect(backoffDelayMs(4, opts)).toBe(8_000);
  });

  it('clamps at the cap rather than growing without bound', () => {
    expect(backoffDelayMs(20, opts)).toBe(60_000);
    expect(backoffDelayMs(200, opts)).toBe(60_000);
    expect(Number.isFinite(backoffDelayMs(2_000, opts))).toBe(true);
  });

  it('keeps jitter to the lower half of the window', () => {
    expect(backoffDelayMs(3, { ...opts, jitter: () => 0 })).toBe(2_000);
    expect(backoffDelayMs(3, { ...opts, jitter: () => 1 })).toBe(4_000);
  });

  it('stays inside the documented bounds for every attempt', () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      for (let i = 0; i < 20; i++) {
        const d = backoffDelayMs(attempt, DEFAULT_BACKOFF);
        expect(d).toBeGreaterThanOrEqual(DEFAULT_BACKOFF.baseMs / 2);
        expect(d).toBeLessThanOrEqual(DEFAULT_BACKOFF.capMs);
      }
    }
  });

  it('rejects a nonsense attempt number', () => {
    expect(() => backoffDelayMs(0, opts)).toThrow(/attempt/);
    expect(() => backoffDelayMs(1.5, opts)).toThrow(/attempt/);
  });
});
