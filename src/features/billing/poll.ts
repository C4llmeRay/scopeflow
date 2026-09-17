/**
 * Waiting for something that arrives by another route.
 *
 * Split out from sync.ts for one reason: sync.ts imports the Supabase client,
 * which imports AsyncStorage, which cannot load in Node — so anything living
 * beside it is untestable. The timing rules here are exactly the part worth
 * testing, so they live where the test runner can reach them.
 */

export interface PollOptions<T> {
  /** Reads the current value. Called at least once, immediately. */
  read: () => Promise<T>;
  /** True when the value is what we were waiting for. */
  done: (value: T) => boolean;
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PollResult<T> {
  value: T;
  /** True when `done` was satisfied; false when the clock ran out. */
  settled: boolean;
  /** How many times `read` ran. Useful in a test, and in a log. */
  reads: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls until `done` or the deadline, whichever comes first.
 *
 * Reads immediately before waiting at all — the thing being waited for has
 * often already happened, and a spinner held for an interval that was never
 * needed is a small avoidable insult.
 *
 * Always returns the last value read rather than throwing on timeout. A timeout
 * here is not an error: it means the answer has not arrived yet, which is a
 * different thing to say to somebody than "this failed".
 */
export async function pollUntil<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  const deadline = now() + timeoutMs;
  let reads = 0;

  for (;;) {
    const value = await options.read();
    reads += 1;

    if (options.done(value)) return { value, settled: true, reads };

    // Checked after the read, so a zero timeout still reads once. Anything
    // else would make "check now" and "wait for it" two different call shapes.
    if (now() >= deadline) return { value, settled: false, reads };

    await sleep(intervalMs);
  }
}
