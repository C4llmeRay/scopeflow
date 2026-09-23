/**
 * Damage records plus room geometry, in — a starting scope, out.
 *
 * This is the deterministic half of what the plan calls auto-scoping. No model
 * is involved: the contractor said what got wet and how far up, the measurement
 * engine says how much of it there is, and these rules say which line items
 * follow. Category and class come from IICRC S500, which is why water was
 * chosen as the MVP peril — the mapping from condition to scope is close to
 * mechanical.
 *
 * Two rules hold everywhere, and both come straight from the build plan:
 *
 *   * Quantities come from geometry, never from a rule that invents a number.
 *     Every line below takes its quantity from a RoomQuantities field.
 *   * A line is only proposed, never committed. The caller drops any code the
 *     contractor does not have in their own price list, and every surviving
 *     line still needs a human tap.
 */

import type { RoomQuantities } from '../../core/measure';
import type { WaterCategory, WaterClass } from '../../db/damages';

export interface ScopeInput {
  quantities: RoomQuantities;
  /** Materials named on the damage sheet, as stored. */
  materials: string[];
  waterCategory: WaterCategory | null;
  waterClass: WaterClass | null;
  /** From the room, after the damage sheet's suggestion was applied. */
  floodCutHeightIn: number;
  /** How long the equipment is expected to run. Three days is the usual start. */
  dryingDays?: number;
}

export interface ScopeLine {
  code: string;
  qty: number;
  /** Shown next to the line, so a contractor can see why it was proposed. */
  reason: string;
}

export const DEFAULT_DRYING_DAYS = 3;

/**
 * Initial air mover placement, as square feet of affected floor per unit.
 *
 * These follow the shape of S500's initial-placement guidance — wetter classes
 * get more airflow — but they are a starting point a contractor edits, not a
 * drying plan. The real count depends on materials, containment and what the
 * moisture readings do on day two.
 */
const SF_PER_AIR_MOVER: Record<WaterClass, number> = {
  class_1: 300,
  class_2: 60,
  class_3: 40,
  class_4: 40,
};

/** Cubic feet one LGR dehumidifier is sized to hold, by class. */
const CF_PER_DEHUMIDIFIER: Record<WaterClass, number> = {
  class_1: 3_000,
  class_2: 2_000,
  class_3: 1_500,
  class_4: 1_500,
};

const normalize = (material: string): string => material.trim().toLowerCase();

const FLOORING_MATERIALS = new Set(['carpet', 'carpet pad', 'laminate', 'vinyl plank']);

export function sizeAirMovers(floorSf: number, waterClass: WaterClass | null): number {
  if (floorSf <= 0) return 0;
  const per = SF_PER_AIR_MOVER[waterClass ?? 'class_2'];
  return Math.max(1, Math.ceil(floorSf / per));
}

export function sizeDehumidifiers(volumeCf: number, waterClass: WaterClass | null): number {
  if (volumeCf <= 0) return 0;
  const per = CF_PER_DEHUMIDIFIER[waterClass ?? 'class_2'];
  return Math.max(1, Math.ceil(volumeCf / per));
}

/**
 * Category 1 is clean water, so carpet is usually dried in place. Category 2
 * and 3 are contaminated: the pad always goes, and the carpet goes with it in
 * Category 3.
 */
function carpetIsSalvageable(category: WaterCategory | null): boolean {
  return category === 'cat_1';
}

export function buildScope(input: ScopeInput): ScopeLine[] {
  const { quantities: q, waterCategory, waterClass, floodCutHeightIn } = input;
  const materials = new Set(input.materials.map(normalize));
  const days = input.dryingDays ?? DEFAULT_DRYING_DAYS;
  const lines: ScopeLine[] = [];

  const add = (code: string, qty: number, reason: string) => {
    if (qty > 0) lines.push({ code, qty, reason });
  };

  const wetFlooring = [...materials].some((m) => FLOORING_MATERIALS.has(m));

  // ---- Mitigation -------------------------------------------------------
  if (wetFlooring) {
    // Extraction is priced by what the water is sitting in: a carpet wand pulls
    // water out of fibre, a hard surface is squeegeed.
    const soft = materials.has('carpet') || materials.has('carpet pad');
    if (soft) add('WTR-EXT', q.floorSf, 'Standing water on the floor');
    else add('WTR-EXT-H', q.floorSf, 'Standing water on a hard floor');
  }

  // ---- Flooring ---------------------------------------------------------
  if (materials.has('carpet')) {
    if (carpetIsSalvageable(waterCategory)) {
      add('FCC-CLN', q.floorSf, 'Category 1 water — carpet dried and cleaned in place');
    } else {
      add('FCC-RMV', q.floorSf, 'Carpet removed');
      add('FCC-CPT', q.floorSf, 'Carpet replaced');
    }
  }
  if (materials.has('carpet pad')) {
    // Pad is never salvageable once wet, in any category.
    add('FCC-PAD', q.floorSf, 'Pad removed and disposed');
  }

  // ---- Drywall ----------------------------------------------------------
  if (materials.has('drywall')) {
    if (floodCutHeightIn > 0 && q.floodCutSf > 0) {
      add('DRY-FC2', q.floodCutSf, `Flood cut to the recorded water line`);
      add('DRY-HTF', q.floodCutSf, 'Drywall replaced at the flood cut');
    } else {
      add('DRY-HTF', q.netWallSf, 'Wet drywall replaced');
    }
    // Paint covers the whole wall: a patched section never blends.
    add('PNT-W2', q.netWallSf, 'Walls repainted after drywall work');
  }

  if (materials.has('insulation')) {
    const qty = floodCutHeightIn > 0 && q.floodCutSf > 0 ? q.floodCutSf : q.netWallSf;
    add('INS-R13', qty, 'Wet insulation in the wall cavity');
  }

  if (materials.has('ceiling')) {
    add('DRY-CLG', q.ceilingSf, 'Water came from above');
    add('PNT-C2', q.ceilingSf, 'Ceiling repainted');
  }

  // ---- Trim -------------------------------------------------------------
  if (materials.has('baseboard')) {
    add('BAS-RR', q.baseboardLf, 'Baseboard removed and replaced');
  }

  // ---- Structure --------------------------------------------------------
  if (materials.has('subfloor')) {
    add('SUB-RR', q.floorSf, 'Subfloor affected');
  }

  // ---- Drying equipment -------------------------------------------------
  const airMovers = sizeAirMovers(q.floorSf, waterClass);
  const dehumidifiers = sizeDehumidifiers(q.volumeCf, waterClass);

  if (materials.size > 0) {
    add(
      'EQP-AM',
      airMovers * days,
      `${airMovers} air movers for ${days} days`,
    );
    add(
      'EQP-DEH',
      dehumidifiers * days,
      `${dehumidifiers} dehumidifier${dehumidifiers === 1 ? '' : 's'} for ${days} days`,
    );
  }

  // Category 3 is grossly contaminated: everything it touched gets treated.
  if (waterCategory === 'cat_3' && q.floorSf > 0) {
    add('WTR-ABM', q.floorSf, 'Category 3 water — antimicrobial treatment');
  }

  return lines;
}

/**
 * Drops any proposed line whose code the contractor does not actually have.
 *
 * This is the same constraint the AI layer will run under in Phase 4, applied
 * here first: a scope may only contain codes that exist in this contractor's
 * own price list, because a line item nobody can price is worse than no line
 * at all.
 */
export function constrainToPriceList(
  lines: readonly ScopeLine[],
  availableCodes: Iterable<string>,
): { kept: ScopeLine[]; dropped: ScopeLine[] } {
  const available = new Set([...availableCodes].map((code) => code.toUpperCase()));
  const kept: ScopeLine[] = [];
  const dropped: ScopeLine[] = [];

  for (const line of lines) {
    if (available.has(line.code.toUpperCase())) kept.push(line);
    else dropped.push(line);
  }

  return { kept, dropped };
}
