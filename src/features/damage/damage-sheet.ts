/**
 * The damage sheet's logic, with no React in it.
 *
 * Category and Class describe the water, not the material, so they are set once
 * for the room and stamped onto every damage record saved from this sheet. That
 * is both how IICRC S500 reads and how a contractor thinks: one loss, one
 * category, then a walk around the room naming what got wet.
 */

import { suggestFloodCutHeightIn } from '../../core/floodcut';
import type { WaterCategory, WaterClass } from '../../db/damages';
import { parseFeetInches } from '../rooms/dimension';

export interface DamageDraft {
  /** The record id when editing, a fresh id when adding. */
  id: string;
  material: string;
  /** How far up the wall the water reached, in the trade's notation. */
  affectedHeightText: string;
  /** Moisture meter reading, percent. */
  moistureText: string;
  notes: string;
}

export interface DamageSheetValues {
  waterCategory: WaterCategory | null;
  waterClass: WaterClass | null;
  drafts: DamageDraft[];
}

export interface DamageSheetState {
  /** Per draft id, per field. */
  errors: Record<string, Partial<Record<'affectedHeight' | 'moisture', string>>>;
  /** Parsed height per draft id, null when blank or unreadable. */
  heights: Record<string, number | null>;
  /** Parsed moisture per draft id. */
  moisture: Record<string, number | null>;
  /** The deepest reading on the sheet — what the flood cut has to clear. */
  deepestWaterLineIn: number | null;
  suggestedFloodCutIn: number;
  canSave: boolean;
}

export function emptyDamageSheet(): DamageSheetValues {
  return { waterCategory: null, waterClass: null, drafts: [] };
}

export function newDraft(id: string, material: string): DamageDraft {
  return { id, material, affectedHeightText: '', moistureText: '', notes: '' };
}

/**
 * Reads a moisture meter percentage. Accepts a bare number or one with a
 * percent sign, because both are what gets typed.
 */
export function parsePercent(input: string): number | null {
  const s = input.trim().replace(/%$/, '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

export function deriveDamageSheet(
  values: DamageSheetValues,
  wallHeightIn: number,
): DamageSheetState {
  const errors: DamageSheetState['errors'] = {};
  const heights: Record<string, number | null> = {};
  const moisture: Record<string, number | null> = {};

  for (const draft of values.drafts) {
    const fieldErrors: Partial<Record<'affectedHeight' | 'moisture', string>> = {};

    let height: number | null = null;
    if (draft.affectedHeightText.trim()) {
      height = parseFeetInches(draft.affectedHeightText);
      if (height === null) {
        fieldErrors.affectedHeight = 'Not a measurement';
      } else if (height > wallHeightIn && wallHeightIn > 0) {
        fieldErrors.affectedHeight = 'Higher than the wall';
        height = null;
      }
    }
    heights[draft.id] = height;

    let percent: number | null = null;
    if (draft.moistureText.trim()) {
      percent = parsePercent(draft.moistureText);
      if (percent === null) {
        fieldErrors.moisture = 'Not a reading';
      } else if (percent > 100) {
        fieldErrors.moisture = 'Over 100%';
        percent = null;
      }
    }
    moisture[draft.id] = percent;

    if (Object.keys(fieldErrors).length > 0) errors[draft.id] = fieldErrors;
  }

  const recorded = Object.values(heights).filter((h): h is number => h !== null && h > 0);
  const deepestWaterLineIn = recorded.length > 0 ? Math.max(...recorded) : null;

  return {
    errors,
    heights,
    moisture,
    deepestWaterLineIn,
    suggestedFloodCutIn: suggestFloodCutHeightIn(deepestWaterLineIn, wallHeightIn),
    canSave: values.drafts.length > 0 && Object.keys(errors).length === 0,
  };
}
