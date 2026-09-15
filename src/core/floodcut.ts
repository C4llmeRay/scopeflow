/**
 * Choosing a flood cut height from the measured water line.
 *
 * Two things decide it in the field. The cut has to clear the visible water
 * line with margin, because water wicks higher than it stains. And it should
 * land on a standard height — 2 ft, 4 ft, or the full wall — so the drywall
 * comes off the sheet without a custom rip and the seam falls where a taper
 * expects it.
 *
 * Pure, so the app can suggest a height the moment a moisture reading is
 * entered, and so the suggestion is testable without a phone.
 */

/** Heights a sheet of drywall cuts to cleanly. */
export const STANDARD_CUT_HEIGHTS_IN = [24, 48, 96] as const;

/**
 * How far above the visible line the cut must reach. Water wicks up through
 * paper facing and insulation past where it stains, so cutting level with the
 * line leaves wet material in the wall.
 */
export const MIN_CLEARANCE_IN = 6;

/**
 * Returns the flood cut height in inches, or 0 when no cut is called for.
 *
 * A water line taller than every standard height means the whole wall comes
 * out, so the wall height itself is returned.
 */
export function suggestFloodCutHeightIn(
  waterLineIn: number | null,
  wallHeightIn: number,
): number {
  if (waterLineIn === null || waterLineIn <= 0) return 0;
  if (wallHeightIn <= 0) return 0;

  const target = waterLineIn + MIN_CLEARANCE_IN;

  // The water already reaches the ceiling: take the whole wall.
  if (target >= wallHeightIn) return wallHeightIn;

  const standard = STANDARD_CUT_HEIGHTS_IN.find(
    (height) => height >= target && height <= wallHeightIn,
  );

  // No standard height clears the line inside this wall — a low basement
  // ceiling with a high line, for instance — so the whole wall comes out.
  return standard ?? wallHeightIn;
}

/** How the suggestion reads in the UI, next to the number. */
export function explainFloodCut(waterLineIn: number | null, suggestedIn: number): string {
  if (waterLineIn === null || waterLineIn <= 0) {
    return 'No water line recorded, so no flood cut is suggested.';
  }
  if (suggestedIn === 0) return 'No flood cut is suggested.';

  const feet = suggestedIn / 12;
  const label = Number.isInteger(feet) ? `${feet} ft` : `${suggestedIn} in`;
  return `${label} cut clears the ${waterLineIn} in water line by ${suggestedIn - waterLineIn} in.`;
}
