/**
 * The room wizard's logic, with no React in it.
 *
 * The screen is three fields and a numpad; everything that decides what those
 * fields mean, whether they are valid, and what the derived quantities are
 * lives here so it can be tested without a simulator.
 */

import { computeRoom, type Offset, type Opening, type RoomQuantities } from '../../core/measure';
import { dimensionError, parseFeetInches } from './dimension';

export interface RoomFormValues {
  name: string;
  lengthText: string;
  widthText: string;
  heightText: string;
  /** Empty means no flood cut. */
  floodCutText: string;
  level?: string;
  offsets?: Offset[];
  openings?: Opening[];
  ceilingMultiplier?: number;
}

export type RoomFormField = 'name' | 'length' | 'width' | 'height' | 'floodCut';

export interface RoomFormState {
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  floodCutHeightIn: number;
  /** Null until every dimension is valid. Drives the live preview. */
  quantities: RoomQuantities | null;
  errors: Partial<Record<RoomFormField, string>>;
  canSave: boolean;
}

/** The default a contractor almost never has to change. */
export const DEFAULT_CEILING_HEIGHT_TEXT = '8';

/** Rooms a house actually has, so naming is a tap rather than typing. */
export const COMMON_ROOM_NAMES = [
  'Master Bedroom',
  'Bedroom 2',
  'Bedroom 3',
  'Living Room',
  'Kitchen',
  'Dining Room',
  'Hallway',
  'Master Bath',
  'Hall Bathroom',
  'Laundry',
  'Garage',
  'Basement',
] as const;

export function emptyRoomForm(): RoomFormValues {
  return {
    name: '',
    lengthText: '',
    widthText: '',
    heightText: DEFAULT_CEILING_HEIGHT_TEXT,
    floodCutText: '',
  };
}

export function deriveRoomForm(values: RoomFormValues): RoomFormState {
  const lengthIn = parseFeetInches(values.lengthText);
  const widthIn = parseFeetInches(values.widthText);
  const heightIn = parseFeetInches(values.heightText);

  const errors: Partial<Record<RoomFormField, string>> = {};

  if (!values.name.trim()) {
    errors.name = 'Give the room a name';
  }

  // Only complain about a field the contractor has actually touched. An empty
  // form should not open covered in red.
  if (values.lengthText.trim()) {
    const error = dimensionError(lengthIn, 'Length');
    if (error) errors.length = error;
  }
  if (values.widthText.trim()) {
    const error = dimensionError(widthIn, 'Width');
    if (error) errors.width = error;
  }
  if (values.heightText.trim()) {
    const error = dimensionError(heightIn, 'Height');
    if (error) errors.height = error;
  }

  let floodCutHeightIn = 0;
  if (values.floodCutText.trim()) {
    const parsed = parseFeetInches(values.floodCutText);
    if (parsed === null || parsed < 0) {
      errors.floodCut = 'Flood cut is not a measurement';
    } else if (heightIn !== null && parsed > heightIn) {
      errors.floodCut = 'Flood cut is taller than the wall';
    } else {
      floodCutHeightIn = parsed;
    }
  }

  const haveDimensions =
    lengthIn !== null &&
    widthIn !== null &&
    heightIn !== null &&
    !errors.length &&
    !errors.width &&
    !errors.height;

  let quantities: RoomQuantities | null = null;
  if (haveDimensions && !errors.floodCut) {
    try {
      quantities = computeRoom({
        lengthIn,
        widthIn,
        heightIn,
        floodCutHeightIn,
        offsets: values.offsets,
        openings: values.openings,
        ceilingMultiplier: values.ceilingMultiplier,
      });
    } catch {
      // The engine rejects geometry the field checks cannot catch, such as
      // offsets that remove the whole floor. No preview, but no crash either.
      quantities = null;
    }
  }

  return {
    lengthIn,
    widthIn,
    heightIn,
    floodCutHeightIn,
    quantities,
    errors,
    canSave: Object.keys(errors).length === 0 && quantities !== null,
  };
}
