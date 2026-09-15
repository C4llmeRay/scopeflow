/**
 * The worked example from the build plan, section 6.
 *
 * A 12' x 14' x 8' bedroom, Category 2 water, Class 2, supply line failure.
 * One standard door and one standard window. Two-foot flood cut.
 *
 * This fixture is the contract between the plan document and the code. If a
 * number here changes, the plan changes with it.
 */

import type { EstimateLineInput, EstimateOptions } from '../estimate';
import type { RoomInput } from '../measure';
import { ft } from '../units';

export const BEDROOM: RoomInput = {
  lengthIn: ft(12),
  widthIn: ft(14),
  heightIn: ft(8),
  openings: [
    { kind: 'door', widthIn: 36, heightIn: 80 },
    { kind: 'window', widthIn: 48, heightIn: 36 },
  ],
  floodCutHeightIn: ft(2),
};

/** floor 168 SF, perimeter 52 LF, net wall 384 SF, baseboard 49 LF, cut 104 SF. */
export const BEDROOM_EXPECTED = {
  floorSf: 168,
  ceilingSf: 168,
  perimeterLf: 52,
  grossWallSf: 416,
  openingWallDeductionSf: 32,
  netWallSf: 384,
  baseboardLf: 49,
  floodCutSf: 104,
  volumeCf: 1344,
} as const;

/**
 * The scope. Material and labor are split because sales tax applies to
 * materials only in most jurisdictions.
 */
export const BEDROOM_SCOPE: EstimateLineInput[] = [
  { code: 'WTR-EXT', description: 'Water extraction, carpeted floor', unit: 'SF', qty: 168, materialUnitCents: 0, laborUnitCents: 62 },
  { code: 'FCC-RMV', description: 'Remove carpet', unit: 'SF', qty: 168, materialUnitCents: 0, laborUnitCents: 32 },
  { code: 'FCC-PAD', description: 'Remove and dispose carpet pad', unit: 'SF', qty: 168, materialUnitCents: 0, laborUnitCents: 28 },
  { code: 'DRY-FC2', description: "Drywall flood cut and remove, 2'", unit: 'SF', qty: 104, materialUnitCents: 0, laborUnitCents: 186 },
  { code: 'INS-R13', description: 'R-13 batt insulation, remove and replace', unit: 'SF', qty: 104, materialUnitCents: 95, laborUnitCents: 47 },
  { code: 'EQP-DEH', description: 'Dehumidifier, per day', unit: 'DA', qty: 3, materialUnitCents: 0, laborUnitCents: 8800 },
  { code: 'EQP-AM', description: 'Air mover, per day (4 units, 3 days)', unit: 'DA', qty: 12, materialUnitCents: 0, laborUnitCents: 2650 },
  { code: 'DRY-HTF', description: 'Drywall hang, tape, float and texture', unit: 'SF', qty: 104, materialUnitCents: 130, laborUnitCents: 144 },
  { code: 'PNT-W2', description: 'Paint walls, two coats', unit: 'SF', qty: 384, materialUnitCents: 35, laborUnitCents: 57 },
  {
    code: 'FCC-CPT',
    description: 'Carpet with pad, replace',
    unit: 'SF',
    qty: 168,
    materialUnitCents: 320,
    laborUnitCents: 90,
    depreciation: { ageYears: 4, usefulLifeYears: 10, recoverable: true },
  },
  { code: 'BAS-RR', description: 'Baseboard, remove and replace', unit: 'LF', qty: 49, materialUnitCents: 240, laborUnitCents: 145 },
];

export const BEDROOM_OPTIONS: EstimateOptions = {
  opPct: 20,
  taxPct: 7,
  taxBase: 'materials',
  deductibleCents: 100_000,
};

/** Every figure the plan's estimate table prints, in cents. */
export const BEDROOM_TOTALS_EXPECTED = {
  lineSubtotalCents: 264_377,
  materialSubtotalCents: 102_360,
  laborSubtotalCents: 162_017,
  opCents: 52_875,
  taxCents: 7_165,
  rcvCents: 324_417,
  depreciationCents: 27_552,
  recoverableDepreciationCents: 27_552,
  acvCents: 296_865,
  netClaimCents: 196_865,
} as const;
