/**
 * The estimate calculator.
 *
 * Every amount in and out is INTEGER CENTS. The four things that are easy to
 * get wrong and expensive to get wrong, per the build plan:
 *
 *   O&P         conventionally 10% overhead + 10% profit on the line subtotal,
 *               and contested by carriers on simple jobs, so it is a per-job
 *               toggle rather than a constant.
 *   Tax         applies to materials only in most jurisdictions, which is why
 *               price items carry split material and labor costs.
 *   Depreciation per line item, by age against useful life, applied to the line
 *               total before O&P and tax. Recoverable is a policy term.
 *   Deductible  comes off once per claim. Never per room.
 */

import { pctOfCents, roundCents, roundQty } from './units';

export type TaxBase = 'materials' | 'all';

export interface LineDepreciation {
  ageYears: number;
  usefulLifeYears: number;
  /** Released to the contractor on proof of completion. Default true. */
  recoverable?: boolean;
}

export interface EstimateLineInput {
  code: string;
  description: string;
  unit: string;
  /** Derived from the measurement engine. Never from a language model. */
  qty: number;
  materialUnitCents: number;
  laborUnitCents: number;
  /** Per material, not per job. Applied to quantity. Default 0. */
  wastePct?: number;
  depreciation?: LineDepreciation;
}

export interface EstimateOptions {
  /** 20 means 10% overhead + 10% profit. Default 0. */
  opPct?: number;
  /** Default 0. May be fractional (7.25). */
  taxPct?: number;
  /** Default 'materials'. */
  taxBase?: TaxBase;
  /** Default 0. */
  deductibleCents?: number;
}

export interface EstimateLine {
  code: string;
  description: string;
  unit: string;
  qty: number;
  /** qty after the material's waste factor. This is the billed quantity. */
  billedQty: number;
  wastePct: number;
  materialUnitCents: number;
  laborUnitCents: number;
  unitPriceCents: number;
  materialCents: number;
  laborCents: number;
  totalCents: number;
  depreciationCents: number;
  depreciationRecoverable: boolean;
}

export interface EstimateTotals {
  lines: EstimateLine[];
  lineSubtotalCents: number;
  materialSubtotalCents: number;
  laborSubtotalCents: number;
  opPct: number;
  opCents: number;
  taxPct: number;
  taxBase: TaxBase;
  taxableBaseCents: number;
  taxCents: number;
  /** Replacement cost value: what it costs to fix today. */
  rcvCents: number;
  depreciationCents: number;
  recoverableDepreciationCents: number;
  /** Actual cash value: RCV less depreciation. */
  acvCents: number;
  deductibleCents: number;
  /** What the carrier pays now. Never negative. */
  netClaimCents: number;
}

/** Waste is a property of the material, so it lands on quantity, not on price. */
export function applyWaste(qty: number, wastePct = 0): number {
  if (wastePct < 0) throw new RangeError(`wastePct must be >= 0, received ${wastePct}`);
  return roundQty(qty * (1 + wastePct / 100));
}

function depreciationFraction(d: LineDepreciation): number {
  const { ageYears, usefulLifeYears } = d;
  if (usefulLifeYears <= 0) {
    throw new RangeError(`usefulLifeYears must be > 0, received ${usefulLifeYears}`);
  }
  if (ageYears < 0) {
    throw new RangeError(`ageYears must be >= 0, received ${ageYears}`);
  }
  return Math.min(ageYears / usefulLifeYears, 1);
}

export function computeLine(input: EstimateLineInput): EstimateLine {
  const { materialUnitCents, laborUnitCents } = input;
  if (!Number.isInteger(materialUnitCents) || !Number.isInteger(laborUnitCents)) {
    throw new RangeError(
      `${input.code}: unit costs must be integer cents, received ` +
        `material=${materialUnitCents} labor=${laborUnitCents}`,
    );
  }
  if (input.qty < 0) throw new RangeError(`${input.code}: qty must be >= 0`);

  const wastePct = input.wastePct ?? 0;
  const billedQty = applyWaste(input.qty, wastePct);
  const unitPriceCents = materialUnitCents + laborUnitCents;

  const materialCents = roundCents(billedQty * materialUnitCents);
  const laborCents = roundCents(billedQty * laborUnitCents);
  // Derive the total from the parts so material + labor always reconciles to it.
  const totalCents = materialCents + laborCents;

  const depreciationCents = input.depreciation
    ? roundCents(totalCents * depreciationFraction(input.depreciation))
    : 0;

  return {
    code: input.code,
    description: input.description,
    unit: input.unit,
    qty: roundQty(input.qty),
    billedQty,
    wastePct,
    materialUnitCents,
    laborUnitCents,
    unitPriceCents,
    materialCents,
    laborCents,
    totalCents,
    depreciationCents,
    depreciationRecoverable: input.depreciation?.recoverable ?? true,
  };
}

export function computeEstimate(
  inputs: EstimateLineInput[],
  options: EstimateOptions = {},
): EstimateTotals {
  const opPct = options.opPct ?? 0;
  const taxPct = options.taxPct ?? 0;
  const taxBase = options.taxBase ?? 'materials';
  const deductibleCents = options.deductibleCents ?? 0;

  const lines = inputs.map(computeLine);

  const lineSubtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const materialSubtotalCents = lines.reduce((s, l) => s + l.materialCents, 0);
  const laborSubtotalCents = lines.reduce((s, l) => s + l.laborCents, 0);

  const opCents = pctOfCents(lineSubtotalCents, opPct);

  const taxableBaseCents =
    taxBase === 'materials' ? materialSubtotalCents : lineSubtotalCents + opCents;
  const taxCents = pctOfCents(taxableBaseCents, taxPct);

  const rcvCents = lineSubtotalCents + opCents + taxCents;

  const depreciationCents = lines.reduce((s, l) => s + l.depreciationCents, 0);
  const recoverableDepreciationCents = lines.reduce(
    (s, l) => s + (l.depreciationRecoverable ? l.depreciationCents : 0),
    0,
  );

  const acvCents = rcvCents - depreciationCents;
  const netClaimCents = Math.max(0, acvCents - deductibleCents);

  return {
    lines,
    lineSubtotalCents,
    materialSubtotalCents,
    laborSubtotalCents,
    opPct,
    opCents,
    taxPct,
    taxBase,
    taxableBaseCents,
    taxCents,
    rcvCents,
    depreciationCents,
    recoverableDepreciationCents,
    acvCents,
    deductibleCents,
    netClaimCents,
  };
}
