/**
 * The measurement engine.
 *
 * A contractor enters three numbers. This derives every quantity any water
 * damage line item could need. It is pure: no React, no database, no I/O — so
 * it can be tested hard, which it needs to be, because this is the one module
 * where a bug silently produces the wrong dollar amount.
 */

import {
  assertNonNegativeInt,
  assertPositiveInt,
  cuInToCf,
  inchesToFeet,
  roundQty,
  sqInToSf,
} from './units';

export type OpeningKind = 'door' | 'window' | 'archway' | 'missing_wall';

export interface Opening {
  kind: OpeningKind;
  widthIn: number;
  heightIn: number;
  /** Number of identical openings. Default 1. */
  count?: number;
  /** Does this reduce boardable/paintable wall area? Default true for all kinds. */
  deductsWall?: boolean;
  /**
   * Does baseboard stop at this opening? Default true for doors, archways and
   * missing walls; false for windows, because baseboard runs underneath a window.
   */
  deductsBase?: boolean;
}

export type OffsetOp = 'add' | 'subtract';

/**
 * Where the offset sits on the wall it attaches to. This changes the perimeter,
 * not the area, so it only matters for `subtract`.
 */
export type OffsetPlacement = 'corner' | 'mid_wall';

/**
 * A rectangle added to or removed from the base rectangle — the MVP's answer to
 * L-shaped rooms. Covers closets, bump-outs, chimney chases and stair
 * bulkheads without asking a contractor to draw a polygon on a phone.
 */
export interface Offset {
  name?: string;
  op: OffsetOp;
  /** Perpendicular to the wall this offset attaches to. */
  depthIn: number;
  /** Along the wall this offset attaches to. */
  widthIn: number;
  /** Default 'corner' — by far the common case for a subtracted offset. */
  placement?: OffsetPlacement;
}

export interface RoomInput {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  openings?: Opening[];
  offsets?: Offset[];
  /** Height of the drywall flood cut, e.g. ft(2). 0 or omitted means none. */
  floodCutHeightIn?: number;
  /** >1 for a vaulted or cathedral ceiling. Default 1 (flat). */
  ceilingMultiplier?: number;
  /**
   * Whether the flood cut run stops at door openings. Default false: the full
   * perimeter is cut, which is how most estimators quantify it and what the
   * seed price list assumes. Set true for contractors who scope it net.
   */
  floodCutDeductsOpenings?: boolean;
}

export interface RoomQuantities {
  /** Floor area, including offsets. */
  floorSf: number;
  /** Floor area times the ceiling multiplier. */
  ceilingSf: number;
  /** Wall run at the floor, including offsets. */
  perimeterLf: number;
  /** perimeter x height, before openings. */
  grossWallSf: number;
  /** Total area removed by openings that deduct wall. */
  openingWallDeductionSf: number;
  /** grossWall - openings. What gets painted. */
  netWallSf: number;
  /** Perimeter less the width of openings that break the baseboard run. */
  baseboardLf: number;
  /** Wall area removed by a flood cut. 0 when no cut height is given. */
  floodCutSf: number;
  /** Used for dehumidifier sizing and air mover counts. */
  volumeCf: number;
}

const BASE_DEDUCT_BY_KIND: Record<OpeningKind, boolean> = {
  door: true,
  archway: true,
  missing_wall: true,
  window: false,
};

function openingDeductsWall(o: Opening): boolean {
  return o.deductsWall ?? true;
}

function openingDeductsBase(o: Opening): boolean {
  return o.deductsBase ?? BASE_DEDUCT_BY_KIND[o.kind];
}

/**
 * Perimeter effect of an offset.
 *
 * A bump-out trades `width` of existing wall for `width` of new wall and adds
 * the two `depth` returns, so the perimeter grows by 2 x depth regardless of
 * where along the wall it sits.
 *
 * A notch taken out of a CORNER leaves the perimeter unchanged: the two removed
 * wall runs reappear as the two faces of the new inside corner. A bite out of
 * the MIDDLE of a wall still adds the two returns.
 */
function perimeterDeltaIn(off: Offset): number {
  const placement = off.placement ?? 'corner';
  if (off.op === 'subtract' && placement === 'corner') return 0;
  return 2 * off.depthIn;
}

export function computeRoom(input: RoomInput): RoomQuantities {
  const { lengthIn, widthIn, heightIn } = input;
  assertPositiveInt('lengthIn', lengthIn);
  assertPositiveInt('widthIn', widthIn);
  assertPositiveInt('heightIn', heightIn);

  const openings = input.openings ?? [];
  const offsets = input.offsets ?? [];
  const ceilingMultiplier = input.ceilingMultiplier ?? 1;
  const floodCutHeightIn = input.floodCutHeightIn ?? 0;
  assertNonNegativeInt('floodCutHeightIn', floodCutHeightIn);

  if (!Number.isFinite(ceilingMultiplier) || ceilingMultiplier <= 0) {
    throw new RangeError(`ceilingMultiplier must be > 0, received ${ceilingMultiplier}`);
  }

  let floorSqIn = lengthIn * widthIn;
  let perimeterIn = 2 * (lengthIn + widthIn);

  for (const off of offsets) {
    assertPositiveInt('offset.depthIn', off.depthIn);
    assertPositiveInt('offset.widthIn', off.widthIn);
    const area = off.depthIn * off.widthIn;
    floorSqIn += off.op === 'add' ? area : -area;
    perimeterIn += perimeterDeltaIn(off);
  }

  if (floorSqIn <= 0) {
    throw new RangeError('Offsets removed the entire floor area of the room.');
  }

  const grossWallSqIn = perimeterIn * heightIn;

  let openingWallSqIn = 0;
  let openingBaseIn = 0;
  for (const o of openings) {
    assertPositiveInt('opening.widthIn', o.widthIn);
    assertPositiveInt('opening.heightIn', o.heightIn);
    const count = o.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`opening.count must be a whole number >= 1, received ${count}`);
    }
    if (openingDeductsWall(o)) openingWallSqIn += o.widthIn * o.heightIn * count;
    if (openingDeductsBase(o)) openingBaseIn += o.widthIn * count;
  }

  const baseboardIn = Math.max(0, perimeterIn - openingBaseIn);
  const netWallSqIn = Math.max(0, grossWallSqIn - openingWallSqIn);

  const floodCutRunIn = input.floodCutDeductsOpenings ? baseboardIn : perimeterIn;
  const floodCutSqIn = floodCutHeightIn > 0 ? floodCutRunIn * floodCutHeightIn : 0;

  return {
    floorSf: roundQty(sqInToSf(floorSqIn)),
    ceilingSf: roundQty(sqInToSf(floorSqIn) * ceilingMultiplier),
    perimeterLf: roundQty(inchesToFeet(perimeterIn)),
    grossWallSf: roundQty(sqInToSf(grossWallSqIn)),
    openingWallDeductionSf: roundQty(sqInToSf(openingWallSqIn)),
    netWallSf: roundQty(sqInToSf(netWallSqIn)),
    baseboardLf: roundQty(inchesToFeet(baseboardIn)),
    floodCutSf: roundQty(sqInToSf(floodCutSqIn)),
    volumeCf: roundQty(cuInToCf(floorSqIn * heightIn)),
  };
}

/** Standard opening sizes, so the UI can offer one tap instead of two fields. */
export const COMMON_OPENINGS = {
  interiorDoor: { kind: 'door', widthIn: 32, heightIn: 80 },
  standardDoor: { kind: 'door', widthIn: 36, heightIn: 80 },
  doubleDoor: { kind: 'door', widthIn: 72, heightIn: 80 },
  slidingDoor: { kind: 'door', widthIn: 72, heightIn: 80 },
  standardWindow: { kind: 'window', widthIn: 48, heightIn: 36 },
  largeWindow: { kind: 'window', widthIn: 72, heightIn: 48 },
} as const satisfies Record<string, Opening>;
