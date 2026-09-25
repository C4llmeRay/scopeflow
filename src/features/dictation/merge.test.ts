import { describe, expect, it } from 'vitest';

import {
  applyResult,
  EMPTY_DICTATION,
  formatElapsed,
  joinSpoken,
  levelFromRms,
  levelFromVolume,
  pushLevel,
  spokenSoFar,
} from './merge';

describe('joinSpoken', () => {
  it('fills an empty field, starting with a capital', () => {
    expect(joinSpoken('', 'water line at fourteen inches')).toBe('Water line at fourteen inches');
  });

  it('adds to what was typed, as a new sentence after a full stop', () => {
    expect(joinSpoken('Wet drywall.', 'baseboard detached')).toBe('Wet drywall. Baseboard detached');
  });

  it('continues a sentence that was left open', () => {
    expect(joinSpoken('Water line visible at approx.', '14 inches')).toBe(
      'Water line visible at approx. 14 inches',
    );
    expect(joinSpoken('Moisture reading of', '38 percent')).toBe('Moisture reading of 38 percent');
  });

  it('leaves the field alone when nothing was heard', () => {
    expect(joinSpoken('Wet drywall.', '   ')).toBe('Wet drywall.');
  });
});

describe('recognition results', () => {
  it('shows the segment being spoken without committing it', () => {
    const state = applyResult(EMPTY_DICTATION, 'water line', false);
    expect(state).toEqual({ committed: '', current: 'water line' });
    expect(spokenSoFar(state)).toBe('water line');
  });

  it('commits segments in order, as the browser and Android send them', () => {
    let state = applyResult(EMPTY_DICTATION, 'water line', false);
    state = applyResult(state, 'water line at 14 inches', true);
    state = applyResult(state, 'drywall', false);
    expect(spokenSoFar(state)).toBe('water line at 14 inches drywall');
    state = applyResult(state, 'drywall is swollen', true);
    expect(state).toEqual({ committed: 'water line at 14 inches drywall is swollen', current: '' });
  });

  it('handles one growing segment, as iOS sends it', () => {
    let state = applyResult(EMPTY_DICTATION, 'water', false);
    state = applyResult(state, 'water line at 14', false);
    expect(spokenSoFar(state)).toBe('water line at 14');
    state = applyResult(state, 'water line at 14 inches', true);
    expect(spokenSoFar(state)).toBe('water line at 14 inches');
  });
});

describe('the meter', () => {
  it('reads native volume, with silence at the bottom', () => {
    expect(levelFromVolume(-2)).toBe(0);
    expect(levelFromVolume(4)).toBe(0.5);
    expect(levelFromVolume(10)).toBe(1);
    expect(levelFromVolume(Number.NaN)).toBe(0);
  });

  it('lifts quiet browser speech and caps loud sound', () => {
    expect(levelFromRms(0.001)).toBe(0);
    expect(levelFromRms(0.075)).toBeCloseTo(0.5);
    expect(levelFromRms(0.9)).toBe(1);
  });

  it('keeps a rolling history of fixed length', () => {
    let history: number[] = [];
    for (const level of [0.1, 0.2, 0.3, 1.4]) history = pushLevel(history, level, 3);
    expect(history).toEqual([0.2, 0.3, 1]);
  });

  it('shows elapsed time as minutes and seconds', () => {
    expect(formatElapsed(7_400)).toBe('0:07');
    expect(formatElapsed(75_000)).toBe('1:15');
  });
});
