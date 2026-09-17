/**
 * The waiting rules behind "we're confirming your payment…".
 *
 * A fake clock throughout: a test that really waits twenty seconds for a
 * timeout is a test nobody runs.
 */

import { describe, expect, it } from 'vitest';

import { pollUntil } from './poll';

/**
 * A clock that only moves when something sleeps. Nothing here depends on wall
 * time, so the whole suite runs in microseconds and never flakes on a slow
 * machine.
 */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('pollUntil', () => {
  it('reads once and returns immediately when it is already done', async () => {
    const clock = fakeClock();
    const result = await pollUntil({
      read: async () => 'active',
      done: (v) => v === 'active',
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toEqual({ value: 'active', settled: true, reads: 1 });
    // Never slept, so a webhook that beat us costs the contractor nothing.
    expect(clock.now()).toBe(0);
  });

  it('keeps reading until the answer changes', async () => {
    const clock = fakeClock();
    const answers = ['trialing', 'trialing', 'active'];
    let i = 0;

    const result = await pollUntil({
      read: async () => answers[i++],
      done: (v) => v === 'active',
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.settled).toBe(true);
    expect(result.value).toBe('active');
    expect(result.reads).toBe(3);
    // Two waits between three reads, not three.
    expect(clock.now()).toBe(2_000);
  });

  it('gives up at the deadline and hands back the last thing it saw', async () => {
    const clock = fakeClock();
    const result = await pollUntil({
      read: async () => 'trialing',
      done: (v) => v === 'active',
      timeoutMs: 5_000,
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    // Not an exception: "it has not arrived yet" is a different thing to tell
    // somebody than "this failed", and only one of them is true.
    expect(result.settled).toBe(false);
    expect(result.value).toBe('trialing');
  });

  it('terminates rather than looping forever when nothing ever settles', async () => {
    const clock = fakeClock();
    const result = await pollUntil({
      read: async () => 'never',
      done: () => false,
      timeoutMs: 20_000,
      intervalMs: 1_500,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.settled).toBe(false);
    // 20s / 1.5s, plus the immediate read at zero.
    expect(result.reads).toBe(15);
  });

  it('still reads once with a zero timeout', async () => {
    // So "check now" and "wait for it" are the same call with one number
    // changed, rather than two code paths that can drift apart.
    const clock = fakeClock();
    const result = await pollUntil({
      read: async () => 'trialing',
      done: (v) => v === 'active',
      timeoutMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.reads).toBe(1);
    expect(result.settled).toBe(false);
  });

  it('accepts a read that fails by returning null, without dying', async () => {
    // pullBillingState returns null when offline rather than throwing, and the
    // poller has to survive a run of them — a contractor in a basement coming
    // back from Stripe is exactly when this happens.
    const clock = fakeClock();
    const answers: (string | null)[] = [null, null, 'active'];
    let i = 0;

    const result = await pollUntil({
      read: async () => answers[i++],
      done: (v) => v === 'active',
      intervalMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.settled).toBe(true);
    expect(result.reads).toBe(3);
  });

  it('lets a read throw rather than swallowing a real bug', async () => {
    // Retrying through an exception would turn a programming error into twenty
    // seconds of silent retries and then a shrug.
    await expect(
      pollUntil({
        read: async () => {
          throw new Error('boom');
        },
        done: () => true,
        now: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toThrow('boom');
  });
});
