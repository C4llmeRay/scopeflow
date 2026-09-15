/**
 * Getting a contractor from install to a finished estimate.
 *
 * Derived from what is actually in the database, not from a stored wizard
 * position. That matters more than it sounds: a linear wizard with its own
 * cursor gets out of sync the first time somebody backs out halfway, force
 * quits, or does a step from a different screen. Reading the real state means
 * onboarding is resumable, cannot lie, and quietly finishes itself the moment
 * a contractor does the work their own way.
 *
 * The order is the order of the plan's own thesis — profile, prices, one real
 * room, one real estimate — because the last step is the moment they see what
 * the thing is for.
 */

export type OnboardingStepId = 'profile' | 'prices' | 'job' | 'room' | 'estimate';

export interface OnboardingFacts {
  /** Name plus a way to reach them. Without it an estimate cannot be sent. */
  profileComplete: boolean;
  priceItemCount: number;
  jobCount: number;
  roomCount: number;
  /** Line items across every job. */
  scopedLineCount: number;
  estimateCount: number;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  /** What this step is for, in the contractor's terms. */
  detail: string;
  /** The label on the button that starts it. */
  action: string;
  route: string;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  /** The first unfinished step, or null once everything is done. */
  next: OnboardingStep | null;
  completed: number;
  total: number;
  finished: boolean;
}

export function deriveOnboarding(facts: OnboardingFacts): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      id: 'profile',
      title: 'Your business details',
      detail:
        'Your name and a way to reach you go on every estimate. An adjuster who ' +
        'cannot reply to a document does not act on it.',
      action: 'Fill them in',
      route: '/settings',
      done: facts.profileComplete,
    },
    {
      id: 'prices',
      title: 'Your prices',
      detail:
        'Import your own spreadsheet — those are the numbers you trust. Or start ' +
        'from a generic water-damage list and edit it as you go.',
      action: 'Set up prices',
      route: '/prices',
      done: facts.priceItemCount > 0,
    },
    {
      id: 'job',
      title: 'Your first job',
      detail: 'A claim, a property, a loss. Start one the next time you pull up to a house.',
      action: 'Start a job',
      route: '/',
      done: facts.jobCount > 0,
    },
    {
      id: 'room',
      title: 'Measure a room',
      detail:
        'Three numbers and you are done — the areas, the perimeter, the baseboard ' +
        'run and the flood cut all come out of them.',
      action: 'Measure one',
      route: '/',
      done: facts.roomCount > 0,
    },
    {
      id: 'estimate',
      title: 'Price it',
      detail:
        'Say what got wet, scope it, and watch the number appear. This is the part ' +
        'that used to take you the evening.',
      action: 'Build an estimate',
      route: '/',
      done: facts.scopedLineCount > 0 || facts.estimateCount > 0,
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  return {
    steps,
    // The first unfinished step, so a contractor who did things out of order is
    // pointed at what is actually missing rather than at step one.
    next: steps.find((step) => !step.done) ?? null,
    completed,
    total: steps.length,
    finished: completed === steps.length,
  };
}

/** "2 of 5" for the progress line. */
export const describeProgress = (state: OnboardingState): string =>
  state.finished ? 'All set' : `${state.completed} of ${state.total}`;
