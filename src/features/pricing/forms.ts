/**
 * Form logic for editing a price item and for editing a line item, with no
 * React in it.
 *
 * Both screens show a live total as the contractor types, and both are the
 * places where a typo turns into a wrong estimate. Keeping the parsing and the
 * arithmetic here means the whole of it is tested without a simulator.
 */

import { computeLine } from '../../core/estimate';
import { formatUsd, roundQty } from '../../core/units';
import { parseMoneyCents } from './import';

/* -------------------------------------------------------------------------- */
/* Shared parsing                                                             */
/* -------------------------------------------------------------------------- */

/** A line item quantity. Never negative — a negative quantity is a credit. */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return roundQty(value);
}

/** A percentage between 0 and 100. */
export function parsePercentInRange(input: string): number | null {
  const cleaned = input.replace(/[%\s,]/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value > 100) return null;
  return value;
}

/** Whole years of useful life. */
export function parseYears(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}

/** Cents back into something a money field can show and re-parse. */
export const centsToInput = (cents: number): string => (cents / 100).toFixed(2);

/* -------------------------------------------------------------------------- */
/* Price item editor                                                          */
/* -------------------------------------------------------------------------- */

export type PriceField =
  | 'code'
  | 'description'
  | 'unit'
  | 'materialCost'
  | 'laborCost'
  | 'wastePct'
  | 'usefulLife';

export interface PriceFormValues {
  code: string;
  description: string;
  unit: string;
  category: string;
  materialText: string;
  laborText: string;
  wastePctText: string;
  usefulLifeText: string;
}

export interface PriceFormState {
  materialCostCents: number;
  laborCostCents: number;
  unitPriceCents: number;
  wastePct: number;
  usefulLifeYears: number | null;
  /** Normalised code, which is what uniqueness is checked against. */
  normalizedCode: string;
  errors: Partial<Record<PriceField, string>>;
  canSave: boolean;
  /** True when the whole price sits in labor, so tax will read as zero. */
  unsplit: boolean;
}

export function emptyPriceForm(): PriceFormValues {
  return {
    code: '',
    description: '',
    unit: 'SF',
    category: '',
    materialText: '0.00',
    laborText: '0.00',
    wastePctText: '0',
    usefulLifeText: '',
  };
}

export function derivePriceForm(values: PriceFormValues): PriceFormState {
  const errors: Partial<Record<PriceField, string>> = {};

  const normalizedCode = values.code.trim().toUpperCase();
  if (!normalizedCode) {
    errors.code = 'A code is required';
  } else if (/\s/.test(normalizedCode)) {
    errors.code = 'Codes cannot contain spaces';
  }

  if (!values.description.trim()) errors.description = 'A description is required';
  if (!values.unit.trim()) errors.unit = 'A unit is required';

  let materialCostCents = 0;
  if (values.materialText.trim()) {
    const parsed = parseMoneyCents(values.materialText);
    if (parsed === null) errors.materialCost = 'Not an amount';
    else if (parsed < 0) errors.materialCost = 'Cannot be negative';
    else materialCostCents = parsed;
  }

  let laborCostCents = 0;
  if (values.laborText.trim()) {
    const parsed = parseMoneyCents(values.laborText);
    if (parsed === null) errors.laborCost = 'Not an amount';
    else if (parsed < 0) errors.laborCost = 'Cannot be negative';
    else laborCostCents = parsed;
  }

  let wastePct = 0;
  if (values.wastePctText.trim()) {
    const parsed = parsePercentInRange(values.wastePctText);
    if (parsed === null) errors.wastePct = 'Must be 0 to 100';
    else wastePct = parsed;
  }

  let usefulLifeYears: number | null = null;
  if (values.usefulLifeText.trim()) {
    const parsed = parseYears(values.usefulLifeText);
    if (parsed === null) errors.usefulLife = 'Whole years, more than zero';
    else usefulLifeYears = parsed;
  }

  return {
    materialCostCents,
    laborCostCents,
    unitPriceCents: materialCostCents + laborCostCents,
    wastePct,
    usefulLifeYears,
    normalizedCode,
    errors,
    canSave: Object.keys(errors).length === 0,
    unsplit: materialCostCents === 0 && laborCostCents > 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Line item editor                                                           */
/* -------------------------------------------------------------------------- */

export type LineField = 'qty' | 'wastePct' | 'materialCost' | 'laborCost';

export interface LineFormValues {
  qtyText: string;
  wastePctText: string;
  materialText: string;
  laborText: string;
}

export interface LineFormState {
  qty: number;
  /** Quantity after the waste factor — what actually gets billed. */
  billedQty: number;
  wastePct: number;
  materialUnitCents: number;
  laborUnitCents: number;
  unitPriceCents: number;
  /** Live line total, so the number moves as the contractor types. */
  totalCents: number;
  errors: Partial<Record<LineField, string>>;
  canSave: boolean;
}

export function lineFormFrom(item: {
  qty: number;
  wastePct: number;
  materialUnitCents: number;
  laborUnitCents: number;
}): LineFormValues {
  return {
    qtyText: String(item.qty),
    wastePctText: String(item.wastePct),
    materialText: centsToInput(item.materialUnitCents),
    laborText: centsToInput(item.laborUnitCents),
  };
}

export function deriveLineForm(values: LineFormValues): LineFormState {
  const errors: Partial<Record<LineField, string>> = {};

  let qty = 0;
  const parsedQty = parseQuantity(values.qtyText);
  if (values.qtyText.trim() === '') errors.qty = 'A quantity is required';
  else if (parsedQty === null) errors.qty = 'Not a quantity';
  else qty = parsedQty;

  let wastePct = 0;
  if (values.wastePctText.trim()) {
    const parsed = parsePercentInRange(values.wastePctText);
    if (parsed === null) errors.wastePct = 'Must be 0 to 100';
    else wastePct = parsed;
  }

  let materialUnitCents = 0;
  if (values.materialText.trim()) {
    const parsed = parseMoneyCents(values.materialText);
    if (parsed === null) errors.materialCost = 'Not an amount';
    else if (parsed < 0) errors.materialCost = 'Cannot be negative';
    else materialUnitCents = parsed;
  }

  let laborUnitCents = 0;
  if (values.laborText.trim()) {
    const parsed = parseMoneyCents(values.laborText);
    if (parsed === null) errors.laborCost = 'Not an amount';
    else if (parsed < 0) errors.laborCost = 'Cannot be negative';
    else laborUnitCents = parsed;
  }

  const canSave = Object.keys(errors).length === 0;

  // Priced through the same calculator the estimate uses, so the preview here
  // and the total at the bottom can never disagree.
  const priced = canSave
    ? computeLine({
        code: 'preview',
        description: 'preview',
        unit: '',
        qty,
        materialUnitCents,
        laborUnitCents,
        wastePct,
      })
    : null;

  return {
    qty,
    billedQty: priced?.billedQty ?? qty,
    wastePct,
    materialUnitCents,
    laborUnitCents,
    unitPriceCents: materialUnitCents + laborUnitCents,
    totalCents: priced?.totalCents ?? 0,
    errors,
    canSave,
  };
}

/** "184.8 SF × $4.10 = $757.68", for the line under the fields. */
export function describeLine(state: LineFormState, unit: string): string {
  if (!state.canSave) return '';
  const qty = state.wastePct > 0 ? `${state.billedQty} ${unit} incl. waste` : `${state.qty} ${unit}`;
  return `${qty} × ${formatUsd(state.unitPriceCents)} = ${formatUsd(state.totalCents)}`;
}
