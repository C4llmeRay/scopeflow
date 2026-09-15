/**
 * Reading and writing dimensions the way the trade writes them.
 *
 * A contractor types 12'6", 12 6, 12-6 and 12.5 interchangeably, sometimes with
 * a glove on. All four mean 150 inches. Anything this parser rejects, the
 * contractor has to retype standing in a wet basement, so it is forgiving on
 * input and strict on output.
 */

const MAX_REASONABLE_IN = 1_200; // 100 feet. Past this it is a typo, not a room.

const number = String.raw`\d+(?:\.\d+)?`;
const FEET_UNIT = String.raw`(?:'|ft|foot|feet)`;
const INCH_UNIT = String.raw`(?:"|''|in|inch|inches)`;

const INCHES_ONLY = new RegExp(`^(${number})\\s*${INCH_UNIT}$`);
const FEET_THEN_INCHES = new RegExp(`^(${number})\\s*${FEET_UNIT}\\s*(${number})\\s*${INCH_UNIT}?$`);
const TWO_NUMBERS = new RegExp(`^(${number})\\s*[-\\s]\\s*(${number})\\s*${INCH_UNIT}?$`);
const FEET_ONLY = new RegExp(`^(${number})\\s*${FEET_UNIT}?$`);

/**
 * Returns whole inches, or null if the text is not a dimension.
 *
 * A bare number is FEET, because that is how the trade speaks: "twelve by
 * fourteen" is never twelve inches. Inches alone need an explicit mark.
 */
export function parseFeetInches(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;

  let m = INCHES_ONLY.exec(s);
  if (m) return toWholeInches(Number(m[1]));

  m = FEET_THEN_INCHES.exec(s) ?? TWO_NUMBERS.exec(s);
  if (m) return toWholeInches(Number(m[1]) * 12 + Number(m[2]));

  m = FEET_ONLY.exec(s);
  if (m) return toWholeInches(Number(m[1]) * 12);

  return null;
}

function toWholeInches(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** 150 -> `12' 6"`, 144 -> `12'`, 6 -> `6"`. */
export function formatFeetInches(inches: number): string {
  if (!Number.isFinite(inches)) return '';
  const sign = inches < 0 ? '-' : '';
  const total = Math.abs(Math.round(inches));
  const feet = Math.floor(total / 12);
  const rest = total % 12;

  if (feet === 0) return `${sign}${rest}"`;
  if (rest === 0) return `${sign}${feet}'`;
  return `${sign}${feet}' ${rest}"`;
}

/** Why a dimension is unusable, or null when it is fine. */
export function dimensionError(inches: number | null, label: string): string | null {
  if (inches === null) return `${label} is not a measurement`;
  if (inches <= 0) return `${label} must be more than zero`;
  if (inches > MAX_REASONABLE_IN) return `${label} looks like a typo — over 100 feet`;
  return null;
}

export { MAX_REASONABLE_IN };
