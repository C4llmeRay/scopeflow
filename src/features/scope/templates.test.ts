import { describe, expect, it } from 'vitest';

import { computeRoom } from '../../core/measure';
import { ft } from '../../core/units';
import {
  buildScope,
  constrainToPriceList,
  DEFAULT_DRYING_DAYS,
  sizeAirMovers,
  sizeDehumidifiers,
  type ScopeInput,
} from './templates';

/** The plan's worked example: 12 x 14 x 8 bedroom, door and window, 2 ft cut. */
const bedroom = computeRoom({
  lengthIn: ft(12),
  widthIn: ft(14),
  heightIn: ft(8),
  openings: [
    { kind: 'door', widthIn: 36, heightIn: 80 },
    { kind: 'window', widthIn: 48, heightIn: 36 },
  ],
  floodCutHeightIn: ft(2),
});

const scope = (over: Partial<ScopeInput> = {}): ScopeInput => ({
  quantities: bedroom,
  materials: ['Carpet', 'Carpet pad', 'Drywall', 'Insulation', 'Baseboard'],
  waterCategory: 'cat_2',
  waterClass: 'class_2',
  floodCutHeightIn: ft(2),
  ...over,
});

const codes = (input: ScopeInput) => buildScope(input).map((l) => l.code);
const qtyOf = (input: ScopeInput, code: string) =>
  buildScope(input).find((l) => l.code === code)?.qty;

describe('buildScope — the plan worked example', () => {
  it('proposes the scope that room actually needs', () => {
    expect(codes(scope())).toEqual([
      'WTR-EXT',
      'FCC-RMV',
      'FCC-CPT',
      'FCC-PAD',
      'DRY-FC2',
      'DRY-HTF',
      'PNT-W2',
      'INS-R13',
      'BAS-RR',
      'EQP-AM',
      'EQP-DEH',
    ]);
  });

  it('takes every quantity from the measurement engine', () => {
    const input = scope();
    expect(qtyOf(input, 'WTR-EXT')).toBe(bedroom.floorSf); // 168
    expect(qtyOf(input, 'FCC-CPT')).toBe(bedroom.floorSf);
    expect(qtyOf(input, 'DRY-FC2')).toBe(bedroom.floodCutSf); // 104
    expect(qtyOf(input, 'INS-R13')).toBe(bedroom.floodCutSf);
    expect(qtyOf(input, 'PNT-W2')).toBe(bedroom.netWallSf); // 384
    expect(qtyOf(input, 'BAS-RR')).toBe(bedroom.baseboardLf); // 49
  });

  it('gives every line a reason a contractor can read', () => {
    for (const line of buildScope(scope())) {
      expect(line.reason.length, line.code).toBeGreaterThan(0);
    }
  });

  it('never proposes a zero or negative quantity', () => {
    for (const line of buildScope(scope())) {
      expect(line.qty, line.code).toBeGreaterThan(0);
    }
  });
});

describe('buildScope — category changes the scope', () => {
  it('dries clean water carpet in place instead of replacing it', () => {
    const result = codes(scope({ waterCategory: 'cat_1' }));
    expect(result).toContain('FCC-CLN');
    expect(result).not.toContain('FCC-CPT');
    expect(result).not.toContain('FCC-RMV');
  });

  it('still throws away the pad in category 1, because pad never dries', () => {
    expect(codes(scope({ waterCategory: 'cat_1' }))).toContain('FCC-PAD');
  });

  it('replaces the carpet in category 2 and 3', () => {
    for (const category of ['cat_2', 'cat_3'] as const) {
      expect(codes(scope({ waterCategory: category })), category).toContain('FCC-CPT');
    }
  });

  it('adds antimicrobial treatment for category 3 only', () => {
    expect(codes(scope({ waterCategory: 'cat_3' }))).toContain('WTR-ABM');
    expect(codes(scope({ waterCategory: 'cat_2' }))).not.toContain('WTR-ABM');
    expect(codes(scope({ waterCategory: 'cat_1' }))).not.toContain('WTR-ABM');
  });
});

describe('buildScope — only what got wet', () => {
  it('proposes nothing but equipment when nothing is named', () => {
    expect(buildScope(scope({ materials: [] }))).toEqual([]);
  });

  it('skips flooring work when no flooring is wet', () => {
    const result = codes(scope({ materials: ['Drywall'] }));
    expect(result).not.toContain('FCC-CPT');
    expect(result).not.toContain('WTR-EXT');
    expect(result).toContain('DRY-HTF');
  });

  it('skips baseboard when it was not named', () => {
    expect(codes(scope({ materials: ['Carpet'] }))).not.toContain('BAS-RR');
  });

  it('adds ceiling work only when the ceiling is wet', () => {
    const result = codes(scope({ materials: ['Ceiling'] }));
    expect(result).toContain('DRY-CLG');
    expect(result).toContain('PNT-C2');
    expect(qtyOf(scope({ materials: ['Ceiling'] }), 'DRY-CLG')).toBe(bedroom.ceilingSf);
  });

  it('is not confused by casing or padding in the material name', () => {
    expect(codes(scope({ materials: ['  CARPET  '] }))).toContain('FCC-CPT');
  });
});

describe('buildScope — flood cut versus whole wall', () => {
  it('scopes the cut area when a flood cut height is set', () => {
    const input = scope({ materials: ['Drywall'] });
    expect(qtyOf(input, 'DRY-HTF')).toBe(bedroom.floodCutSf);
  });

  it('scopes the whole wall when no flood cut was recorded', () => {
    const noCut = computeRoom({ lengthIn: ft(12), widthIn: ft(14), heightIn: ft(8) });
    const input = scope({
      quantities: noCut,
      materials: ['Drywall'],
      floodCutHeightIn: 0,
    });
    expect(qtyOf(input, 'DRY-HTF')).toBe(noCut.netWallSf);
  });

  it('always paints the whole wall, because a patch never blends', () => {
    expect(qtyOf(scope({ materials: ['Drywall'] }), 'PNT-W2')).toBe(bedroom.netWallSf);
  });
});

describe('drying equipment', () => {
  it('scales air movers with how wet the class is', () => {
    expect(sizeAirMovers(168, 'class_1')).toBe(1);
    expect(sizeAirMovers(168, 'class_2')).toBe(3);
    expect(sizeAirMovers(168, 'class_3')).toBe(5);
  });

  it('always places at least one of each in a room that has any floor', () => {
    expect(sizeAirMovers(10, 'class_1')).toBe(1);
    expect(sizeDehumidifiers(100, 'class_1')).toBe(1);
  });

  it('places none in a room with no area', () => {
    expect(sizeAirMovers(0, 'class_2')).toBe(0);
    expect(sizeDehumidifiers(0, 'class_2')).toBe(0);
  });

  it('assumes class 2 when the class was not recorded', () => {
    expect(sizeAirMovers(168, null)).toBe(sizeAirMovers(168, 'class_2'));
  });

  it('bills equipment as unit-days', () => {
    const input = scope();
    const movers = sizeAirMovers(bedroom.floorSf, 'class_2');
    expect(qtyOf(input, 'EQP-AM')).toBe(movers * DEFAULT_DRYING_DAYS);
  });

  it('follows a longer drying plan when one is given', () => {
    const input = scope({ dryingDays: 5 });
    const movers = sizeAirMovers(bedroom.floorSf, 'class_2');
    expect(qtyOf(input, 'EQP-AM')).toBe(movers * 5);
  });

  it('says how the equipment was sized', () => {
    const line = buildScope(scope()).find((l) => l.code === 'EQP-DEH');
    expect(line?.reason).toBe('1 dehumidifier for 3 days');
  });

  it('pluralises the count it reports', () => {
    const big = computeRoom({ lengthIn: ft(30), widthIn: ft(30), heightIn: ft(10) });
    const line = buildScope(scope({ quantities: big })).find((l) => l.code === 'EQP-DEH');
    expect(line?.reason).toMatch(/^\d+ dehumidifiers for 3 days$/);
  });
});

describe('constrainToPriceList', () => {
  const lines = [
    { code: 'FCC-CPT', qty: 168, reason: 'x' },
    { code: 'DRY-HTF', qty: 104, reason: 'y' },
    { code: 'WTR-ABM', qty: 168, reason: 'z' },
  ];

  it('keeps only codes the contractor actually has', () => {
    const { kept, dropped } = constrainToPriceList(lines, ['FCC-CPT', 'DRY-HTF']);
    expect(kept.map((l) => l.code)).toEqual(['FCC-CPT', 'DRY-HTF']);
    expect(dropped.map((l) => l.code)).toEqual(['WTR-ABM']);
  });

  it('matches codes case-insensitively', () => {
    const { kept } = constrainToPriceList(lines, ['fcc-cpt', 'dry-htf', 'wtr-abm']);
    expect(kept).toHaveLength(3);
  });

  it('drops everything when the price list is empty', () => {
    const { kept, dropped } = constrainToPriceList(lines, []);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(3);
  });

  it('never invents a line that was not proposed', () => {
    const { kept } = constrainToPriceList(lines, ['FCC-CPT', 'SOMETHING-ELSE']);
    expect(kept).toHaveLength(1);
  });
});
