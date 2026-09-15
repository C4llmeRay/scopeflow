import { describe, expect, it } from 'vitest';

import {
  assertPositiveInt,
  centsToDollars,
  cuInToCf,
  dollarsToCents,
  formatUsd,
  ft,
  inchesToFeet,
  pctOfCents,
  roundCents,
  roundQty,
  sqInToSf,
} from './units';

describe('ft', () => {
  it('converts whole feet to inches', () => {
    expect(ft(12)).toBe(144);
    expect(ft(8)).toBe(96);
  });

  it('adds the inches remainder', () => {
    expect(ft(12, 6)).toBe(150);
    expect(ft(0, 36)).toBe(36);
  });

  it('always returns a whole number', () => {
    expect(Number.isInteger(ft(11.5))).toBe(true);
    expect(ft(11.5)).toBe(138);
  });
});

describe('conversions', () => {
  it('converts inches to feet', () => {
    expect(inchesToFeet(144)).toBe(12);
    expect(inchesToFeet(150)).toBe(12.5);
  });

  it('converts square inches to square feet', () => {
    expect(sqInToSf(144)).toBe(1);
    expect(sqInToSf(24_192)).toBe(168); // the plan's 12 x 14 bedroom
  });

  it('converts cubic inches to cubic feet', () => {
    expect(cuInToCf(1728)).toBe(1);
    expect(cuInToCf(2_322_432)).toBe(1344); // 12 x 14 x 8
  });
});

describe('rounding', () => {
  it('rounds a quantity to two decimals', () => {
    expect(roundQty(152.375)).toBe(152.38);
    expect(roundQty(168)).toBe(168);
    expect(roundQty(1 / 3)).toBe(0.33);
  });

  it('rounds fractional cents to whole cents', () => {
    expect(roundCents(52_875.4)).toBe(52_875);
    expect(roundCents(7_165.2)).toBe(7_165);
    expect(roundCents(0.5)).toBe(1);
  });

  it('takes a percentage of a cent amount', () => {
    expect(pctOfCents(264_377, 20)).toBe(52_875);
    expect(pctOfCents(102_360, 7)).toBe(7_165);
    expect(pctOfCents(10_000, 7.25)).toBe(725);
    expect(pctOfCents(12_345, 0)).toBe(0);
  });
});

describe('money', () => {
  it('round-trips dollars and cents', () => {
    expect(dollarsToCents(26.43)).toBe(2643);
    expect(centsToDollars(2643)).toBe(26.43);
  });

  it('survives the classic float cases', () => {
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(1.005)).toBe(101);
  });

  it('formats with a thousands separator and two decimals', () => {
    expect(formatUsd(264_377)).toBe('$2,643.77');
    expect(formatUsd(196_865)).toBe('$1,968.65');
    expect(formatUsd(500)).toBe('$5.00');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats negatives with the sign outside the dollar mark', () => {
    expect(formatUsd(-27_552)).toBe('-$275.52');
  });
});

describe('assertPositiveInt', () => {
  it('accepts whole positive inches', () => {
    expect(() => assertPositiveInt('x', 144)).not.toThrow();
  });

  it('rejects fractions, zero, negatives and non-numbers', () => {
    expect(() => assertPositiveInt('x', 144.5)).toThrow(/integer inches/i);
    expect(() => assertPositiveInt('x', 0)).toThrow();
    expect(() => assertPositiveInt('x', -1)).toThrow();
    expect(() => assertPositiveInt('x', Number.NaN)).toThrow();
    expect(() => assertPositiveInt('x', Number.POSITIVE_INFINITY)).toThrow();
  });

  it('names the offending field so the error is actionable', () => {
    expect(() => assertPositiveInt('lengthIn', 0)).toThrow(/lengthIn/);
  });
});
