import { describe, expect, it } from 'vitest';

import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('pads the seconds', () => {
    expect(formatDuration(7_000)).toBe('0:07');
    expect(formatDuration(65_000)).toBe('1:05');
  });

  it('rounds down to the whole second', () => {
    expect(formatDuration(7_999)).toBe('0:07');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('keeps counting in minutes past an hour, so a runaway recording is obvious', () => {
    expect(formatDuration(3_753_000)).toBe('62:33');
  });

  it('is safe with nothing, or with nonsense', () => {
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
