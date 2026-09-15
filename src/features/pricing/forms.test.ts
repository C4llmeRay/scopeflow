import { describe, expect, it } from 'vitest';

import {
  centsToInput,
  derivePriceForm,
  deriveLineForm,
  describeLine,
  emptyPriceForm,
  lineFormFrom,
  parsePercentInRange,
  parseQuantity,
  parseYears,
  type LineFormValues,
  type PriceFormValues,
} from './forms';

describe('parseQuantity', () => {
  it('reads decimals and thousands separators', () => {
    expect(parseQuantity('168')).toBe(168);
    expect(parseQuantity('168.5')).toBe(168.5);
    expect(parseQuantity('1,234')).toBe(1234);
  });

  it('rounds to the precision a line item carries', () => {
    expect(parseQuantity('168.567')).toBe(168.57);
  });

  it('refuses a negative quantity, which would be a credit', () => {
    expect(parseQuantity('-5')).toBeNull();
  });

  it('returns null for blanks and text', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('   ')).toBeNull();
    expect(parseQuantity('lots')).toBeNull();
    expect(parseQuantity('1.2.3')).toBeNull();
  });
});

describe('parsePercentInRange', () => {
  it('accepts 0 through 100, with or without the sign', () => {
    expect(parsePercentInRange('0')).toBe(0);
    expect(parsePercentInRange('10%')).toBe(10);
    expect(parsePercentInRange('7.5')).toBe(7.5);
    expect(parsePercentInRange('100')).toBe(100);
  });

  it('rejects out of range and nonsense', () => {
    expect(parsePercentInRange('101')).toBeNull();
    expect(parsePercentInRange('-1')).toBeNull();
    expect(parsePercentInRange('lots')).toBeNull();
  });
});

describe('parseYears', () => {
  it('takes whole positive years only', () => {
    expect(parseYears('10')).toBe(10);
    expect(parseYears('0')).toBeNull();
    expect(parseYears('10.5')).toBeNull();
    expect(parseYears('-4')).toBeNull();
  });
});

describe('centsToInput', () => {
  it('round-trips through a money field', () => {
    expect(centsToInput(320)).toBe('3.20');
    expect(centsToInput(8_800)).toBe('88.00');
    expect(centsToInput(0)).toBe('0.00');
  });
});

const priceForm = (over: Partial<PriceFormValues> = {}): PriceFormValues => ({
  ...emptyPriceForm(),
  code: 'FCC-CPT',
  description: 'Carpet with pad, replace',
  unit: 'SF',
  materialText: '3.20',
  laborText: '0.90',
  ...over,
});

describe('derivePriceForm', () => {
  it('reads a complete item and sums the unit price', () => {
    const state = derivePriceForm(priceForm({ wastePctText: '10', usefulLifeText: '10' }));
    expect(state).toMatchObject({
      materialCostCents: 320,
      laborCostCents: 90,
      unitPriceCents: 410,
      wastePct: 10,
      usefulLifeYears: 10,
      normalizedCode: 'FCC-CPT',
      canSave: true,
      unsplit: false,
    });
  });

  it('uppercases the code, which is what uniqueness is checked against', () => {
    expect(derivePriceForm(priceForm({ code: ' fcc-cpt ' })).normalizedCode).toBe('FCC-CPT');
  });

  it('will not save without a code, description or unit', () => {
    expect(derivePriceForm(priceForm({ code: '' })).errors.code).toBeDefined();
    expect(derivePriceForm(priceForm({ description: '  ' })).errors.description).toBeDefined();
    expect(derivePriceForm(priceForm({ unit: '' })).errors.unit).toBeDefined();
  });

  it('rejects a code with spaces in it', () => {
    expect(derivePriceForm(priceForm({ code: 'FCC CPT' })).errors.code).toMatch(/spaces/);
  });

  it('rejects an unreadable or negative amount', () => {
    expect(derivePriceForm(priceForm({ materialText: 'lots' })).errors.materialCost).toBeDefined();
    expect(derivePriceForm(priceForm({ laborText: '(5.00)' })).errors.laborCost).toMatch(/negative/);
  });

  it('treats blank money fields as zero rather than an error', () => {
    const state = derivePriceForm(priceForm({ materialText: '', laborText: '' }));
    expect(state.canSave).toBe(true);
    expect(state.unitPriceCents).toBe(0);
  });

  it('flags an item whose whole price sits in labor', () => {
    const state = derivePriceForm(priceForm({ materialText: '0', laborText: '0.62' }));
    expect(state.unsplit).toBe(true);
  });

  it('does not flag a genuinely free item as unsplit', () => {
    expect(derivePriceForm(priceForm({ materialText: '0', laborText: '0' })).unsplit).toBe(false);
  });

  it('rejects a waste factor outside 0 to 100', () => {
    expect(derivePriceForm(priceForm({ wastePctText: '250' })).errors.wastePct).toBeDefined();
  });

  it('leaves useful life empty for something that is not depreciated', () => {
    expect(derivePriceForm(priceForm({ usefulLifeText: '' })).usefulLifeYears).toBeNull();
  });

  it('opens a new item ready to type into rather than covered in red', () => {
    const state = derivePriceForm(emptyPriceForm());
    expect(state.errors.materialCost).toBeUndefined();
    expect(state.errors.wastePct).toBeUndefined();
    expect(state.errors.code).toBeDefined();
    expect(state.canSave).toBe(false);
  });
});

const lineForm = (over: Partial<LineFormValues> = {}): LineFormValues => ({
  qtyText: '168',
  wastePctText: '0',
  materialText: '3.20',
  laborText: '0.90',
  ...over,
});

describe('deriveLineForm', () => {
  it('prices the line live as the contractor types', () => {
    const state = deriveLineForm(lineForm());
    expect(state).toMatchObject({
      qty: 168,
      billedQty: 168,
      unitPriceCents: 410,
      totalCents: 68_880,
      canSave: true,
    });
  });

  it('applies waste to quantity, not to price', () => {
    const state = deriveLineForm(lineForm({ qtyText: '100', wastePctText: '10' }));
    expect(state.qty).toBe(100);
    expect(state.billedQty).toBe(110);
    expect(state.unitPriceCents).toBe(410);
    expect(state.totalCents).toBe(45_100);
  });

  it('agrees with the calculator the estimate uses', () => {
    // 168 SF at 3.20 material + 0.90 labor is the plan's carpet line.
    expect(deriveLineForm(lineForm()).totalCents).toBe(68_880);
  });

  it('requires a quantity', () => {
    const state = deriveLineForm(lineForm({ qtyText: '' }));
    expect(state.errors.qty).toMatch(/required/);
    expect(state.canSave).toBe(false);
  });

  it('rejects an unreadable quantity', () => {
    expect(deriveLineForm(lineForm({ qtyText: 'some' })).errors.qty).toMatch(/Not a quantity/);
  });

  it('allows a zero quantity, for a line kept but not billed', () => {
    const state = deriveLineForm(lineForm({ qtyText: '0' }));
    expect(state.canSave).toBe(true);
    expect(state.totalCents).toBe(0);
  });

  it('shows no total while a field is wrong', () => {
    expect(deriveLineForm(lineForm({ materialText: 'zzz' })).totalCents).toBe(0);
  });

  it('round-trips a stored line back into the form', () => {
    const values = lineFormFrom({
      qty: 104,
      wastePct: 10,
      materialUnitCents: 130,
      laborUnitCents: 144,
    });
    expect(values).toEqual({
      qtyText: '104',
      wastePctText: '10',
      materialText: '1.30',
      laborText: '1.44',
    });

    const state = deriveLineForm(values);
    expect(state.qty).toBe(104);
    expect(state.unitPriceCents).toBe(274);
  });
});

describe('describeLine', () => {
  it('reads as the arithmetic a contractor would check', () => {
    expect(describeLine(deriveLineForm(lineForm()), 'SF')).toBe('168 SF × $4.10 = $688.80');
  });

  it('says when the quantity shown includes waste', () => {
    const state = deriveLineForm(lineForm({ qtyText: '100', wastePctText: '10' }));
    expect(describeLine(state, 'SF')).toBe('110 SF incl. waste × $4.10 = $451.00');
  });

  it('says nothing while the form is wrong', () => {
    expect(describeLine(deriveLineForm(lineForm({ qtyText: '' })), 'SF')).toBe('');
  });
});
