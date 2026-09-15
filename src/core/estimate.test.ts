import { describe, expect, it } from 'vitest';

import {
  applyWaste,
  computeEstimate,
  computeLine,
  type EstimateLineInput,
} from './estimate';
import {
  BEDROOM_OPTIONS,
  BEDROOM_SCOPE,
  BEDROOM_TOTALS_EXPECTED,
} from './fixtures/bedroom-cat2';

const line = (over: Partial<EstimateLineInput> = {}): EstimateLineInput => ({
  code: 'TEST-1',
  description: 'Test line',
  unit: 'SF',
  qty: 100,
  materialUnitCents: 100,
  laborUnitCents: 100,
  ...over,
});

describe("computeEstimate — the plan's worked example", () => {
  const totals = computeEstimate(BEDROOM_SCOPE, BEDROOM_OPTIONS);

  it('reproduces every figure in the plan estimate table', () => {
    expect({
      lineSubtotalCents: totals.lineSubtotalCents,
      materialSubtotalCents: totals.materialSubtotalCents,
      laborSubtotalCents: totals.laborSubtotalCents,
      opCents: totals.opCents,
      taxCents: totals.taxCents,
      rcvCents: totals.rcvCents,
      depreciationCents: totals.depreciationCents,
      recoverableDepreciationCents: totals.recoverableDepreciationCents,
      acvCents: totals.acvCents,
      netClaimCents: totals.netClaimCents,
    }).toEqual(BEDROOM_TOTALS_EXPECTED);
  });

  it('splits the subtotal exactly into materials and labor', () => {
    expect(totals.materialSubtotalCents + totals.laborSubtotalCents).toBe(
      totals.lineSubtotalCents,
    );
  });

  it('taxes materials only, not the full subtotal', () => {
    expect(totals.taxableBaseCents).toBe(totals.materialSubtotalCents);
    expect(totals.taxableBaseCents).toBeLessThan(totals.lineSubtotalCents);
  });

  it('depreciates only the carpet', () => {
    const depreciated = totals.lines.filter((l) => l.depreciationCents > 0);
    expect(depreciated.map((l) => l.code)).toEqual(['FCC-CPT']);
  });
});

describe('computeLine', () => {
  it('reconciles material + labor to the line total', () => {
    const l = computeLine(line({ qty: 168, materialUnitCents: 320, laborUnitCents: 90 }));
    expect(l.materialCents).toBe(53_760);
    expect(l.laborCents).toBe(15_120);
    expect(l.totalCents).toBe(68_880);
    expect(l.materialCents + l.laborCents).toBe(l.totalCents);
  });

  it('sums material and labor into a unit price', () => {
    const l = computeLine(line({ materialUnitCents: 320, laborUnitCents: 90 }));
    expect(l.unitPriceCents).toBe(410);
  });

  it('applies waste to quantity, not to price', () => {
    const l = computeLine(line({ qty: 100, wastePct: 10 }));
    expect(l.qty).toBe(100);
    expect(l.billedQty).toBe(110);
    expect(l.unitPriceCents).toBe(200);
    expect(l.totalCents).toBe(22_000);
  });

  it('carries zero depreciation when none is configured', () => {
    expect(computeLine(line()).depreciationCents).toBe(0);
  });

  it('depreciates by age against useful life', () => {
    const l = computeLine(
      line({ qty: 100, depreciation: { ageYears: 4, usefulLifeYears: 10 } }),
    );
    expect(l.totalCents).toBe(20_000);
    expect(l.depreciationCents).toBe(8_000); // 40%
  });

  it('caps depreciation at 100% for something past its useful life', () => {
    const l = computeLine(
      line({ qty: 100, depreciation: { ageYears: 30, usefulLifeYears: 10 } }),
    );
    expect(l.depreciationCents).toBe(l.totalCents);
  });

  it('defaults depreciation to recoverable', () => {
    const l = computeLine(line({ depreciation: { ageYears: 1, usefulLifeYears: 10 } }));
    expect(l.depreciationRecoverable).toBe(true);
  });

  it('rejects unit costs that are not integer cents', () => {
    expect(() => computeLine(line({ materialUnitCents: 3.2 }))).toThrow(/integer cents/i);
  });

  it('rejects a negative quantity', () => {
    expect(() => computeLine(line({ qty: -1 }))).toThrow(/qty/);
  });

  it('rejects a negative waste factor', () => {
    expect(() => computeLine(line({ wastePct: -5 }))).toThrow(/wastePct/);
  });

  it('rejects a zero useful life', () => {
    expect(() =>
      computeLine(line({ depreciation: { ageYears: 1, usefulLifeYears: 0 } })),
    ).toThrow(/usefulLifeYears/);
  });
});

describe('computeEstimate — totals', () => {
  it('returns zeroes for an empty scope', () => {
    const t = computeEstimate([], BEDROOM_OPTIONS);
    expect(t.lineSubtotalCents).toBe(0);
    expect(t.rcvCents).toBe(0);
    expect(t.netClaimCents).toBe(0);
  });

  it('omits O&P when the job has it toggled off', () => {
    const t = computeEstimate([line()], { opPct: 0, taxPct: 0 });
    expect(t.opCents).toBe(0);
    expect(t.rcvCents).toBe(t.lineSubtotalCents);
  });

  it('applies O&P to the line subtotal', () => {
    const t = computeEstimate([line({ qty: 100 })], { opPct: 20 });
    expect(t.lineSubtotalCents).toBe(20_000);
    expect(t.opCents).toBe(4_000);
  });

  it('taxes the subtotal plus O&P when taxBase is "all"', () => {
    const t = computeEstimate([line({ qty: 100 })], {
      opPct: 20,
      taxPct: 10,
      taxBase: 'all',
    });
    expect(t.taxableBaseCents).toBe(24_000);
    expect(t.taxCents).toBe(2_400);
  });

  it('handles a fractional tax rate', () => {
    const t = computeEstimate([line({ qty: 100, materialUnitCents: 100, laborUnitCents: 0 })], {
      taxPct: 7.25,
    });
    expect(t.materialSubtotalCents).toBe(10_000);
    expect(t.taxCents).toBe(725);
  });

  it('subtracts the deductible once, not per line', () => {
    const t = computeEstimate([line(), line(), line()], { deductibleCents: 100_000 });
    expect(t.lineSubtotalCents).toBe(60_000);
    expect(t.acvCents).toBe(60_000);
    expect(t.netClaimCents).toBe(0); // deductible exceeds the loss
  });

  it('never returns a negative net claim', () => {
    const t = computeEstimate([line({ qty: 1 })], { deductibleCents: 500_000 });
    expect(t.netClaimCents).toBe(0);
  });

  it('separates recoverable from non-recoverable depreciation', () => {
    const t = computeEstimate([
      line({
        code: 'A',
        qty: 100,
        depreciation: { ageYears: 5, usefulLifeYears: 10, recoverable: true },
      }),
      line({
        code: 'B',
        qty: 100,
        depreciation: { ageYears: 5, usefulLifeYears: 10, recoverable: false },
      }),
    ]);
    expect(t.depreciationCents).toBe(20_000);
    expect(t.recoverableDepreciationCents).toBe(10_000);
  });

  it('keeps ACV equal to RCV when nothing depreciates', () => {
    const t = computeEstimate([line()], { opPct: 20, taxPct: 7 });
    expect(t.depreciationCents).toBe(0);
    expect(t.acvCents).toBe(t.rcvCents);
  });
});

describe('applyWaste', () => {
  it('is a no-op at zero', () => {
    expect(applyWaste(168)).toBe(168);
    expect(applyWaste(168, 0)).toBe(168);
  });

  it('adds the factor and rounds to quantity precision', () => {
    expect(applyWaste(168, 10)).toBe(184.8);
    expect(applyWaste(100, 7.5)).toBe(107.5);
    expect(applyWaste(33, 10)).toBe(36.3);
  });
});
