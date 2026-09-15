/**
 * The starter water-damage price list.
 *
 * THESE ARE NOT AUTHORITATIVE REGIONAL PRICES. They are a plausible starting
 * point so a brand-new account is not an empty screen, and every one of them is
 * meant to be edited or replaced by the contractor's own import. The app labels
 * them as seed rows for exactly that reason.
 *
 * Costs are split into material and labor because sales tax applies to
 * materials only in most jurisdictions. Demolition, extraction and equipment
 * rental carry no material cost, which is why several rows show zero.
 *
 * Codes match what src/features/scope/templates.ts proposes, so a seeded
 * account can auto-scope a room without any import at all.
 */

export interface SeedPriceItem {
  code: string;
  description: string;
  unit: string;
  category: string;
  materialCostCents: number;
  laborCostCents: number;
  wastePct: number;
  usefulLifeYears: number | null;
}

export const SEED_PRICE_LIST: readonly SeedPriceItem[] = [
  // ---- Mitigation -------------------------------------------------------
  { code: 'WTR-EXT', description: 'Water extraction, carpeted floor', unit: 'SF', category: 'Mitigation', materialCostCents: 0, laborCostCents: 62, wastePct: 0, usefulLifeYears: null },
  { code: 'WTR-EXT-H', description: 'Water extraction, hard surface floor', unit: 'SF', category: 'Mitigation', materialCostCents: 0, laborCostCents: 48, wastePct: 0, usefulLifeYears: null },
  { code: 'WTR-ABM', description: 'Antimicrobial treatment', unit: 'SF', category: 'Mitigation', materialCostCents: 14, laborCostCents: 26, wastePct: 0, usefulLifeYears: null },
  { code: 'WTR-CNT', description: 'Containment barrier, 6 mil poly', unit: 'SF', category: 'Mitigation', materialCostCents: 22, laborCostCents: 96, wastePct: 10, usefulLifeYears: null },

  // ---- Equipment --------------------------------------------------------
  { code: 'EQP-AM', description: 'Air mover, per day', unit: 'DA', category: 'Equipment', materialCostCents: 0, laborCostCents: 2_650, wastePct: 0, usefulLifeYears: null },
  { code: 'EQP-DEH', description: 'Dehumidifier (LGR), per day', unit: 'DA', category: 'Equipment', materialCostCents: 0, laborCostCents: 8_800, wastePct: 0, usefulLifeYears: null },
  { code: 'EQP-AFD', description: 'Air scrubber, per day', unit: 'DA', category: 'Equipment', materialCostCents: 0, laborCostCents: 7_400, wastePct: 0, usefulLifeYears: null },
  { code: 'EQP-MON', description: 'Daily monitoring visit', unit: 'EA', category: 'Equipment', materialCostCents: 0, laborCostCents: 7_500, wastePct: 0, usefulLifeYears: null },

  // ---- Flooring ---------------------------------------------------------
  { code: 'FCC-RMV', description: 'Remove carpet', unit: 'SF', category: 'Flooring', materialCostCents: 0, laborCostCents: 32, wastePct: 0, usefulLifeYears: null },
  { code: 'FCC-PAD', description: 'Remove and dispose carpet pad', unit: 'SF', category: 'Flooring', materialCostCents: 0, laborCostCents: 28, wastePct: 0, usefulLifeYears: null },
  { code: 'FCC-CPT', description: 'Carpet with pad, replace', unit: 'SF', category: 'Flooring', materialCostCents: 320, laborCostCents: 90, wastePct: 10, usefulLifeYears: 10 },
  { code: 'FCC-CLN', description: 'Clean and dry carpet in place', unit: 'SF', category: 'Flooring', materialCostCents: 8, laborCostCents: 44, wastePct: 0, usefulLifeYears: null },
  { code: 'FCC-LAM', description: 'Laminate flooring, remove and replace', unit: 'SF', category: 'Flooring', materialCostCents: 285, laborCostCents: 175, wastePct: 10, usefulLifeYears: 15 },
  { code: 'FCC-LVP', description: 'Luxury vinyl plank, remove and replace', unit: 'SF', category: 'Flooring', materialCostCents: 340, laborCostCents: 190, wastePct: 10, usefulLifeYears: 20 },
  { code: 'SUB-RR', description: 'Subfloor, remove and replace', unit: 'SF', category: 'Flooring', materialCostCents: 165, laborCostCents: 220, wastePct: 10, usefulLifeYears: 50 },

  // ---- Drywall ----------------------------------------------------------
  { code: 'DRY-FC2', description: 'Drywall flood cut and remove, 2 ft', unit: 'SF', category: 'Drywall', materialCostCents: 0, laborCostCents: 186, wastePct: 0, usefulLifeYears: null },
  { code: 'DRY-HTF', description: 'Drywall hang, tape, float and texture', unit: 'SF', category: 'Drywall', materialCostCents: 130, laborCostCents: 144, wastePct: 10, usefulLifeYears: 50 },
  { code: 'DRY-CLG', description: 'Ceiling drywall, remove and replace', unit: 'SF', category: 'Drywall', materialCostCents: 142, laborCostCents: 198, wastePct: 10, usefulLifeYears: 50 },
  { code: 'INS-R13', description: 'R-13 batt insulation, remove and replace', unit: 'SF', category: 'Insulation', materialCostCents: 95, laborCostCents: 47, wastePct: 5, usefulLifeYears: 30 },

  // ---- Paint ------------------------------------------------------------
  { code: 'PNT-W2', description: 'Paint walls, two coats', unit: 'SF', category: 'Paint', materialCostCents: 35, laborCostCents: 57, wastePct: 0, usefulLifeYears: 10 },
  { code: 'PNT-C2', description: 'Paint ceiling, two coats', unit: 'SF', category: 'Paint', materialCostCents: 33, laborCostCents: 62, wastePct: 0, usefulLifeYears: 10 },
  { code: 'PNT-SEAL', description: 'Seal stained surface before paint', unit: 'SF', category: 'Paint', materialCostCents: 18, laborCostCents: 34, wastePct: 0, usefulLifeYears: null },

  // ---- Trim and doors ---------------------------------------------------
  { code: 'BAS-RR', description: 'Baseboard, remove and replace', unit: 'LF', category: 'Trim', materialCostCents: 240, laborCostCents: 145, wastePct: 8, usefulLifeYears: 25 },
  { code: 'QTR-RR', description: 'Quarter round, remove and replace', unit: 'LF', category: 'Trim', materialCostCents: 110, laborCostCents: 95, wastePct: 8, usefulLifeYears: 25 },
  { code: 'DOR-INT', description: 'Interior door with casing, replace', unit: 'EA', category: 'Trim', materialCostCents: 18_500, laborCostCents: 9_500, wastePct: 0, usefulLifeYears: 30 },

  // ---- Contents and cleanup --------------------------------------------
  { code: 'CON-MOV', description: 'Move and reset contents, per room', unit: 'EA', category: 'Contents', materialCostCents: 0, laborCostCents: 6_800, wastePct: 0, usefulLifeYears: null },
  { code: 'CLN-FIN', description: 'Final cleaning, per room', unit: 'EA', category: 'Contents', materialCostCents: 0, laborCostCents: 4_200, wastePct: 0, usefulLifeYears: null },
  { code: 'DBR-HAU', description: 'Haul debris, per load', unit: 'EA', category: 'Contents', materialCostCents: 0, laborCostCents: 14_500, wastePct: 0, usefulLifeYears: null },
];
