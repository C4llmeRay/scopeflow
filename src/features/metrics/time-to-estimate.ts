/**
 * Time to estimate — the one number that says whether this app is worth using.
 *
 * The pitch is that a job which takes hours with a tape measure, a camera roll
 * and a spreadsheet takes minutes here. That claim is either true for a given
 * contractor or it is not, and they should be able to see which. So: from
 * creating the job to freezing the first estimate, measured on their own jobs.
 *
 * Three decisions worth stating, because each one is a way this number could
 * quietly lie:
 *
 *   * MEDIAN, NOT MEAN. One job started on a Friday and finished on Monday is
 *     enough to move a mean by hours. The median describes the ordinary job,
 *     which is the one the contractor is deciding about.
 *   * FIRST ESTIMATE, NOT LATEST. Later versions are supplements and
 *     negotiation, sometimes weeks later. The claim is about getting to a
 *     number, and that happens once.
 *   * ONLY JOBS THAT REACHED AN ESTIMATE. An abandoned job has no duration,
 *     and counting it as "slow" would punish the app for a cancelled claim.
 *
 * Everything here is pure so it can be tested; the repository query that feeds
 * it lives in the screen.
 */

export interface JobTiming {
  jobId: string;
  /** When the job was created on the phone. Epoch ms. */
  startedAt: number;
  /**
   * When the first estimate version was frozen. Epoch ms, or null for a job
   * that never got that far.
   */
  firstEstimateAt: number | null;
}

export interface TimeToEstimate {
  /** Median milliseconds from job created to first estimate frozen. */
  medianMs: number | null;
  /** How many jobs the median is built from. */
  sample: number;
  /** Jobs that exist but have never reached an estimate. */
  unfinished: number;
  /** One line, in a contractor's terms. */
  label: string;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * A duration a person would say out loud.
 *
 * Deliberately coarse. "1h 47m" implies a precision this measurement does not
 * have — the clock includes lunch, the drive back, and the twenty minutes
 * spent arguing with a homeowner about a rug.
 */
export function humanDuration(ms: number): string {
  if (ms < MINUTE) return 'under a minute';

  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;

  const hours = ms / HOUR;
  if (hours < 10) {
    // One decimal below ten hours, because the difference between 1.5 and 2.5
    // hours is the whole story and "2 h" would hide it.
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
  }

  const days = Math.round(ms / (24 * HOUR));
  if (days < 1) return `${Math.round(hours)} hours`;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The middle value; the mean of the middle two when the count is even. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * How few jobs is too few to draw a line through.
 *
 * Below this the number is noise dressed as evidence, and showing it would
 * invite a contractor to conclude something from two jobs. The screen says
 * "not enough yet" instead, which is both true and more useful.
 */
export const MIN_SAMPLE = 3;

export function timeToEstimate(timings: readonly JobTiming[]): TimeToEstimate {
  const durations: number[] = [];
  let unfinished = 0;

  for (const timing of timings) {
    if (timing.firstEstimateAt === null) {
      unfinished += 1;
      continue;
    }

    const elapsed = timing.firstEstimateAt - timing.startedAt;
    // A negative or zero duration means clock skew or a backdated import, not
    // an instantaneous estimate. Dropping it is honest; keeping it would drag
    // the median toward a number nobody achieved.
    if (elapsed > 0) durations.push(elapsed);
  }

  const medianMs = median(durations);

  if (medianMs === null || durations.length < MIN_SAMPLE) {
    return {
      medianMs: null,
      sample: durations.length,
      unfinished,
      label:
        durations.length === 0
          ? 'No estimates yet'
          : `${durations.length} of ${MIN_SAMPLE} jobs — not enough to judge yet`,
    };
  }

  return {
    medianMs,
    sample: durations.length,
    unfinished,
    label: `${humanDuration(medianMs)} from walking in to a priced estimate`,
  };
}
