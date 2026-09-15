import { describe, expect, it } from 'vitest';

import {
  explainFloodCut,
  MIN_CLEARANCE_IN,
  STANDARD_CUT_HEIGHTS_IN,
  suggestFloodCutHeightIn,
} from '../../core/floodcut';
import { ft } from '../../core/units';
import {
  deriveDamageSheet,
  emptyDamageSheet,
  newDraft,
  parsePercent,
  type DamageSheetValues,
} from './damage-sheet';

describe('suggestFloodCutHeightIn', () => {
  const wall = ft(8);

  it('suggests nothing when there is no water line', () => {
    expect(suggestFloodCutHeightIn(null, wall)).toBe(0);
    expect(suggestFloodCutHeightIn(0, wall)).toBe(0);
  });

  it('suggests a 2 ft cut for a typical low water line', () => {
    // The plan's worked example: water at 14 in gets a 2 ft cut.
    expect(suggestFloodCutHeightIn(14, wall)).toBe(24);
    expect(suggestFloodCutHeightIn(4, wall)).toBe(24);
    expect(suggestFloodCutHeightIn(18, wall)).toBe(24);
  });

  it('steps up to 4 ft once 2 ft no longer clears the line', () => {
    expect(suggestFloodCutHeightIn(19, wall)).toBe(48);
    expect(suggestFloodCutHeightIn(30, wall)).toBe(48);
    expect(suggestFloodCutHeightIn(42, wall)).toBe(48);
  });

  it('takes the whole wall when no standard height clears the line', () => {
    expect(suggestFloodCutHeightIn(43, wall)).toBe(96);
    expect(suggestFloodCutHeightIn(90, wall)).toBe(96);
  });

  it('never suggests a cut taller than the wall', () => {
    for (const line of [10, 40, 80, 200]) {
      expect(suggestFloodCutHeightIn(line, wall)).toBeLessThanOrEqual(wall);
    }
  });

  it('handles a low basement ceiling where no standard height fits', () => {
    const lowWall = ft(7);
    expect(suggestFloodCutHeightIn(60, lowWall)).toBe(lowWall);
  });

  it('always clears the line by at least the minimum clearance, or takes the wall', () => {
    for (let line = 1; line < 96; line++) {
      const cut = suggestFloodCutHeightIn(line, wall);
      const clears = cut - line >= MIN_CLEARANCE_IN;
      expect(clears || cut === wall, `line ${line} gave cut ${cut}`).toBe(true);
    }
  });

  it('only ever suggests a standard height or the full wall', () => {
    for (let line = 1; line < 96; line++) {
      const cut = suggestFloodCutHeightIn(line, wall);
      const isStandard = (STANDARD_CUT_HEIGHTS_IN as readonly number[]).includes(cut);
      expect(isStandard || cut === wall).toBe(true);
    }
  });

  it('refuses to suggest against a nonsense wall', () => {
    expect(suggestFloodCutHeightIn(14, 0)).toBe(0);
  });
});

describe('explainFloodCut', () => {
  it('says why in feet when the cut is a whole number of them', () => {
    expect(explainFloodCut(14, 24)).toBe('2 ft cut clears the 14 in water line by 10 in.');
  });

  it('explains the absence of a suggestion', () => {
    expect(explainFloodCut(null, 0)).toMatch(/No water line recorded/);
    expect(explainFloodCut(0, 0)).toMatch(/No water line recorded/);
  });
});

describe('parsePercent', () => {
  it('reads a bare number and one with a sign', () => {
    expect(parsePercent('31')).toBe(31);
    expect(parsePercent('31.5')).toBe(31.5);
    expect(parsePercent('31.5%')).toBe(31.5);
    expect(parsePercent('  42 % ')).toBe(42);
  });

  it('returns null for nothing and for text', () => {
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('   ')).toBeNull();
    expect(parsePercent('wet')).toBeNull();
    expect(parsePercent('-5')).toBeNull();
  });
});

const sheet = (over: Partial<DamageSheetValues> = {}): DamageSheetValues => ({
  ...emptyDamageSheet(),
  waterCategory: 'cat_2',
  waterClass: 'class_2',
  drafts: [newDraft('d1', 'Drywall')],
  ...over,
});

describe('deriveDamageSheet', () => {
  const wall = ft(8);

  it('will not save an empty sheet', () => {
    expect(deriveDamageSheet(emptyDamageSheet(), wall).canSave).toBe(false);
  });

  it('saves a material with nothing measured, because naming it is the point', () => {
    const state = deriveDamageSheet(sheet(), wall);
    expect(state.canSave).toBe(true);
    expect(state.deepestWaterLineIn).toBeNull();
    expect(state.suggestedFloodCutIn).toBe(0);
  });

  it('parses a water line in the trade notation', () => {
    const state = deriveDamageSheet(
      sheet({ drafts: [{ ...newDraft('d1', 'Drywall'), affectedHeightText: '14"' }] }),
      wall,
    );
    expect(state.heights.d1).toBe(14);
    expect(state.deepestWaterLineIn).toBe(14);
    expect(state.suggestedFloodCutIn).toBe(24);
  });

  it('takes the deepest line across every material', () => {
    const state = deriveDamageSheet(
      sheet({
        drafts: [
          { ...newDraft('d1', 'Drywall'), affectedHeightText: '14"' },
          { ...newDraft('d2', 'Insulation'), affectedHeightText: '22"' },
          { ...newDraft('d3', 'Carpet'), affectedHeightText: '' },
        ],
      }),
      wall,
    );
    expect(state.deepestWaterLineIn).toBe(22);
    expect(state.suggestedFloodCutIn).toBe(48);
  });

  it('rejects a water line taller than the wall', () => {
    const state = deriveDamageSheet(
      sheet({ drafts: [{ ...newDraft('d1', 'Drywall'), affectedHeightText: '12' }] }),
      wall,
    );
    expect(state.errors.d1?.affectedHeight).toMatch(/Higher than the wall/);
    expect(state.canSave).toBe(false);
  });

  it('rejects an unreadable measurement', () => {
    const state = deriveDamageSheet(
      sheet({ drafts: [{ ...newDraft('d1', 'Drywall'), affectedHeightText: 'knee high' }] }),
      wall,
    );
    expect(state.errors.d1?.affectedHeight).toMatch(/Not a measurement/);
    expect(state.canSave).toBe(false);
  });

  it('reads a moisture percentage', () => {
    const state = deriveDamageSheet(
      sheet({ drafts: [{ ...newDraft('d1', 'Drywall'), moistureText: '31.5%' }] }),
      wall,
    );
    expect(state.moisture.d1).toBe(31.5);
    expect(state.canSave).toBe(true);
  });

  it('rejects an impossible moisture reading', () => {
    const state = deriveDamageSheet(
      sheet({ drafts: [{ ...newDraft('d1', 'Drywall'), moistureText: '250' }] }),
      wall,
    );
    expect(state.errors.d1?.moisture).toMatch(/Over 100/);
    expect(state.canSave).toBe(false);
  });

  it('flags only the draft that is wrong', () => {
    const state = deriveDamageSheet(
      sheet({
        drafts: [
          { ...newDraft('d1', 'Drywall'), affectedHeightText: '14"' },
          { ...newDraft('d2', 'Carpet'), moistureText: 'soaked' },
        ],
      }),
      wall,
    );
    expect(state.errors.d1).toBeUndefined();
    expect(state.errors.d2?.moisture).toBeDefined();
    // The good reading still counts toward the suggestion.
    expect(state.deepestWaterLineIn).toBe(14);
  });
});
