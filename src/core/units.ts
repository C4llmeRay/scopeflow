/**
 * ScopeFlow unit primitives.
 *
 * Two hard rules, both of which exist because breaking them produces an
 * estimate that is quietly wrong by a dollar — which is how a contractor stops
 * trusting the whole tool:
 *
 *   1. Linear dimensions are INTEGER INCHES. Never feet as a float.
 *      12.5833 ft is not a measurement, it is a rounding error with a decimal
 *      point in it.
 *   2. Money is INTEGER CENTS. Never dollars as a float.
 *
 * Decimals appear in exactly one place: derived quantities (SF / LF / CF),
 * because a line item quantity genuinely is a decimal.
 */

export const IN_PER_FT = 12;
export const SQIN_PER_SF = 144;
export const CUIN_PER_CF = 1728;

/** Decimal places carried on a derived quantity. */
export const QTY_DP = 2;

/** `ft(12)` -> 144, `ft(12, 6)` -> 150. */
export function ft(feet: number, inches = 0): number {
  return Math.round(feet * IN_PER_FT + inches);
}

export function inchesToFeet(inches: number): number {
  return inches / IN_PER_FT;
}

export function sqInToSf(sqIn: number): number {
  return sqIn / SQIN_PER_SF;
}

export function cuInToCf(cuIn: number): number {
  return cuIn / CUIN_PER_CF;
}

/**
 * Kill the ~1e-13 relative noise that binary floats leave behind, so a value
 * that should be exactly 100.5 rounds like 100.5 rather than like
 * 100.49999999999999. Twelve significant digits is far more than any money or
 * quantity figure in an estimate needs, and far fewer than it takes to preserve
 * the error.
 */
function snap(n: number): number {
  return Number.isFinite(n) ? Number(n.toPrecision(12)) : n;
}

/** Round half away from zero — how a person rounds, unlike Math.round on negatives. */
function roundHalf(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Round a derived quantity to the precision a line item carries. */
export function roundQty(n: number): number {
  const f = 10 ** QTY_DP;
  return roundHalf(snap(n * f)) / f;
}

/** Round a fractional cent amount to whole cents. */
export function roundCents(n: number): number {
  return roundHalf(snap(n));
}

/** `pctOfCents(264377, 20)` -> 52875. Percentages may be fractional (7.25). */
export function pctOfCents(cents: number, pct: number): number {
  return roundCents((cents * pct) / 100);
}

export function dollarsToCents(dollars: number): number {
  return roundCents(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${frac}`;
}

export function assertPositiveInt(field: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `${field} must be a positive whole number of inches, received ${value}. ` +
        `Dimensions are stored as integer inches — convert before calling.`,
    );
  }
}

export function assertNonNegativeInt(field: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${field} must be a whole number of inches >= 0, received ${value}.`,
    );
  }
}
