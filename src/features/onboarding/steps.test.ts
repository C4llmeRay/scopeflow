import { describe, expect, it } from 'vitest';

import { deriveOnboarding, describeProgress, type OnboardingFacts } from './steps';

const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  profileComplete: false,
  priceItemCount: 0,
  jobCount: 0,
  roomCount: 0,
  scopedLineCount: 0,
  estimateCount: 0,
  ...over,
});

const done = facts({
  profileComplete: true,
  priceItemCount: 24,
  jobCount: 1,
  roomCount: 3,
  scopedLineCount: 11,
  estimateCount: 1,
});

describe('deriveOnboarding', () => {
  it('starts a fresh install at the profile', () => {
    const state = deriveOnboarding(facts());
    expect(state.next?.id).toBe('profile');
    expect(state.completed).toBe(0);
    expect(state.finished).toBe(false);
  });

  it('leads with the profile, because an estimate cannot be sent without it', () => {
    expect(deriveOnboarding(facts()).steps[0].id).toBe('profile');
  });

  it('ends on pricing a room, which is the point of the app', () => {
    expect(deriveOnboarding(facts()).steps.at(-1)?.id).toBe('estimate');
  });

  it('finishes once everything is genuinely done', () => {
    const state = deriveOnboarding(done);
    expect(state.finished).toBe(true);
    expect(state.next).toBeNull();
    expect(state.completed).toBe(state.total);
  });

  it('points at what is actually missing, not at step one', () => {
    // Somebody who set up prices and started a job before filling in settings.
    const state = deriveOnboarding(facts({ priceItemCount: 20, jobCount: 1, roomCount: 2 }));
    expect(state.next?.id).toBe('profile');
    expect(state.steps.find((s) => s.id === 'prices')?.done).toBe(true);
    expect(state.steps.find((s) => s.id === 'room')?.done).toBe(true);
  });

  it('skips ahead when earlier steps are already done', () => {
    const state = deriveOnboarding(facts({ profileComplete: true, priceItemCount: 24 }));
    expect(state.next?.id).toBe('job');
    expect(state.completed).toBe(2);
  });

  it('counts a seeded price list as prices being set up', () => {
    expect(deriveOnboarding(facts({ priceItemCount: 1 })).steps[1].done).toBe(true);
  });

  it('counts scoped lines OR a frozen estimate as having priced something', () => {
    expect(deriveOnboarding(facts({ scopedLineCount: 4 })).steps.at(-1)?.done).toBe(true);
    expect(deriveOnboarding(facts({ estimateCount: 1 })).steps.at(-1)?.done).toBe(true);
  });

  it('gives every step somewhere to go and something to tap', () => {
    for (const step of deriveOnboarding(facts()).steps) {
      expect(step.route, step.id).toMatch(/^\//);
      expect(step.action.length, step.id).toBeGreaterThan(0);
      expect(step.detail.length, step.id).toBeGreaterThan(20);
    }
  });

  it('finishes itself when a contractor just gets on with it', () => {
    // Nobody tapped a single onboarding button; they used the app.
    expect(deriveOnboarding(done).finished).toBe(true);
  });
});

describe('describeProgress', () => {
  it('counts through', () => {
    expect(describeProgress(deriveOnboarding(facts()))).toBe('0 of 5');
    expect(describeProgress(deriveOnboarding(facts({ profileComplete: true })))).toBe('1 of 5');
  });

  it('says it is done rather than 5 of 5', () => {
    expect(describeProgress(deriveOnboarding(done))).toBe('All set');
  });
});
