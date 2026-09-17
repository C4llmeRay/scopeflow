/**
 * The headline number, and the ways it could lie.
 */

import { describe, expect, it } from 'vitest';

import {
  humanDuration,
  median,
  MIN_SAMPLE,
  timeToEstimate,
  type JobTiming,
} from './time-to-estimate';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const job = (id: string, minutes: number | null, startedAt = 0): JobTiming => ({
  jobId: id,
  startedAt,
  firstEstimateAt: minutes === null ? null : startedAt + minutes * MINUTE,
});

describe('median', () => {
  it('takes the middle of an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the middle two of an even count', () => {
    // Rounded, because the caller is milliseconds and a half-millisecond
    // median is noise in a number that gets rendered as "1.5 hours".
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([10, 20])).toBe(15);
  });

  it('has no answer for nothing', () => {
    expect(median([])).toBeNull();
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('humanDuration', () => {
  it('rounds to minutes under an hour', () => {
    expect(humanDuration(25 * MINUTE)).toBe('25 min');
  });

  it('keeps one decimal below ten hours, where the difference matters', () => {
    expect(humanDuration(90 * MINUTE)).toBe('1.5 hours');
    expect(humanDuration(HOUR)).toBe('1 hour');
  });

  it('switches to days once the number stops meaning anything in hours', () => {
    expect(humanDuration(3 * 24 * HOUR)).toBe('3 days');
  });

  it('does not claim a precision it does not have', () => {
    expect(humanDuration(30_000)).toBe('under a minute');
  });
});

describe('timeToEstimate', () => {
  it('reports the median of jobs that reached an estimate', () => {
    const result = timeToEstimate([job('a', 40), job('b', 60), job('c', 200)]);

    expect(result.sample).toBe(3);
    expect(result.medianMs).toBe(60 * MINUTE);
    expect(result.label).toContain('1 hour');
  });

  it('is not dragged by one job left open over a weekend', () => {
    // The reason this is a median. A single Friday-to-Monday job moves a mean
    // by hours and would make the app look slow at the exact moment a
    // contractor is deciding whether to keep paying for it.
    const withOutlier = timeToEstimate([
      job('a', 40),
      job('b', 60),
      job('c', 50),
      job('d', 3 * 24 * 60),
    ]);

    expect(withOutlier.medianMs).toBe(55 * MINUTE);
  });

  it('ignores jobs that never reached an estimate rather than counting them slow', () => {
    // A cancelled claim is not the app being slow.
    const result = timeToEstimate([job('a', 40), job('b', 60), job('c', 50), job('d', null)]);

    expect(result.sample).toBe(3);
    expect(result.unfinished).toBe(1);
  });

  it('refuses to draw a conclusion from two jobs', () => {
    const result = timeToEstimate([job('a', 40), job('b', 60)]);

    expect(result.medianMs).toBeNull();
    expect(result.label).toBe(`2 of ${MIN_SAMPLE} jobs — not enough to judge yet`);
  });

  it('says plainly when there is nothing yet', () => {
    expect(timeToEstimate([]).label).toBe('No estimates yet');
    expect(timeToEstimate([job('a', null)]).label).toBe('No estimates yet');
  });

  it('drops a backwards duration instead of reporting an instant estimate', () => {
    // Clock skew between devices, or a backdated import. Either way, "0 min
    // from walking in to a priced estimate" is a claim nobody achieved.
    const skewed: JobTiming = { jobId: 'x', startedAt: 1_000, firstEstimateAt: 500 };
    const result = timeToEstimate([skewed, job('a', 40), job('b', 60), job('c', 50)]);

    expect(result.sample).toBe(3);
    expect(result.medianMs).toBe(50 * MINUTE);
  });
});
