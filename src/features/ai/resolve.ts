/**
 * Turning model output into records the app will store.
 *
 * Written on the assumption that the schema was ignored. Structured outputs
 * make a malformed response unlikely, not impossible, and the cost of a bad
 * line item reaching a total is a contractor who stops trusting every other
 * line. So everything is re-checked here: codes against the price list,
 * measures against the known bases, confidence into 0-1, heights into a
 * plausible range.
 *
 * Nothing in here can produce a quantity out of thin air — the only numbers it
 * emits come from RoomQuantities.
 */

import type { RoomQuantities } from '../../core/measure';
import type { PriceItemRecord } from '../../db/price-items';
import {
  QUANTITY_BASES,
  resolveQuantity,
  WATER_CATEGORIES,
  WATER_CLASSES,
  type ClassifiedDamage,
  type QuantityBasis,
  type VoiceExtraction,
} from './contract';

/** Below this, a suggestion is shown but flagged as a guess. */
export const LOW_CONFIDENCE = 0.6;

/** Below this, a suggestion is not worth showing at all. */
export const DISCARD_CONFIDENCE = 0.25;

const clamp01 = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
};

function cleanHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  // A water line above ten feet is not a reading, it is a mistake.
  if (rounded <= 0 || rounded > 120) return null;
  return rounded;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export interface CleanDamage extends ClassifiedDamage {
  lowConfidence: boolean;
}

/**
 * Keeps only damages naming a material the contractor's own taxonomy has, and
 * only those the model was confident enough about to be worth a human's time.
 */
export function cleanDamages(
  raw: unknown,
  allowedMaterials: readonly string[],
): CleanDamage[] {
  if (!Array.isArray(raw)) return [];

  const allowed = new Map(allowedMaterials.map((m) => [m.toLowerCase(), m]));
  const seen = new Set<string>();
  const out: CleanDamage[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const material = allowed.get(String(item.material ?? '').trim().toLowerCase());
    if (!material) continue;

    // One record per material; the model sometimes lists a material twice from
    // two angles of the same wall.
    if (seen.has(material)) continue;
    seen.add(material);

    const confidence = clamp01(item.confidence);
    if (confidence < DISCARD_CONFIDENCE) continue;

    out.push({
      material,
      affectedHeightIn: cleanHeight(item.affectedHeightIn),
      confidence,
      observation: cleanText(item.observation, 200),
      lowConfidence: confidence < LOW_CONFIDENCE,
    });
  }

  return out;
}

export interface CleanPhotoClassification {
  damages: CleanDamage[];
  waterCategory: (typeof WATER_CATEGORIES)[number] | null;
  waterClass: (typeof WATER_CLASSES)[number] | null;
  caption: string;
  noDamageVisible: boolean;
}

export function cleanPhotoClassification(
  raw: unknown,
  allowedMaterials: readonly string[],
): CleanPhotoClassification {
  const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const damages = cleanDamages(item.damages, allowedMaterials);

  return {
    damages,
    waterCategory: cleanEnum(item.waterCategory, WATER_CATEGORIES),
    waterClass: cleanEnum(item.waterClass, WATER_CLASSES),
    caption: cleanText(item.caption, 160),
    // A photo the model found nothing in, or one where everything was discarded
    // for low confidence, is a photo with no usable finding.
    noDamageVisible: item.noDamageVisible === true || damages.length === 0,
  };
}

export function cleanVoiceExtraction(
  raw: unknown,
  allowedMaterials: readonly string[],
): VoiceExtraction & { damages: CleanDamage[] } {
  const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const notes = Array.isArray(item.notes)
    ? item.notes.map((n) => cleanText(n, 200)).filter(Boolean).slice(0, 8)
    : [];

  return {
    damages: cleanDamages(item.damages, allowedMaterials),
    waterCategory: cleanEnum(item.waterCategory, WATER_CATEGORIES),
    waterClass: cleanEnum(item.waterClass, WATER_CLASSES),
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Scope suggestions                                                          */
/* -------------------------------------------------------------------------- */

export interface ResolvedLine {
  code: string;
  description: string;
  unit: string;
  /** Straight from the measurement engine. The model never saw this number. */
  qty: number;
  measure: QuantityBasis;
  wastePct: number;
  materialUnitCents: number;
  laborUnitCents: number;
  usefulLifeYears: number | null;
  priceItemId: string;
  confidence: number;
  lowConfidence: boolean;
  reason: string;
}

export interface ResolvedScope {
  lines: ResolvedLine[];
  /** Codes the model returned that the contractor does not actually have. */
  rejectedCodes: string[];
  /** Work the model flagged as needed with no code for it. */
  unpriced: string[];
  /** Lines dropped because the derived quantity was zero. */
  zeroQuantity: string[];
}

/**
 * Resolves a scope suggestion against the price list and the room's geometry.
 *
 * Every rejection path is reported rather than swallowed, so the UI can tell a
 * contractor "three suggestions needed prices you do not have" instead of
 * quietly returning a short list.
 */
export function resolveScopeSuggestion(
  raw: unknown,
  priceItems: readonly PriceItemRecord[],
  quantities: RoomQuantities,
): ResolvedScope {
  const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const byCode = new Map(priceItems.map((p) => [p.code.toUpperCase(), p]));

  const lines: ResolvedLine[] = [];
  const rejectedCodes: string[] = [];
  const zeroQuantity: string[] = [];
  const seen = new Set<string>();

  const rawLines = Array.isArray(item.lines) ? item.lines : [];

  for (const entry of rawLines) {
    if (typeof entry !== 'object' || entry === null) continue;
    const line = entry as Record<string, unknown>;

    const code = String(line.code ?? '').trim();
    if (!code) continue;

    const priceItem = byCode.get(code.toUpperCase());
    if (!priceItem) {
      rejectedCodes.push(code);
      continue;
    }

    if (seen.has(priceItem.code.toUpperCase())) continue;
    seen.add(priceItem.code.toUpperCase());

    const confidence = clamp01(line.confidence);
    if (confidence < DISCARD_CONFIDENCE) continue;

    const measure = (QUANTITY_BASES as readonly string[]).includes(String(line.measure))
      ? (line.measure as QuantityBasis)
      : null;
    if (!measure) {
      rejectedCodes.push(code);
      continue;
    }

    const qty = resolveQuantity(measure, quantities);
    if (!Number.isFinite(qty) || qty <= 0) {
      // A line measured against something this room does not have — a flood cut
      // area in a room with no flood cut.
      zeroQuantity.push(priceItem.code);
      continue;
    }

    lines.push({
      code: priceItem.code,
      description: priceItem.description,
      unit: priceItem.unit,
      qty,
      measure,
      wastePct: priceItem.wastePct,
      materialUnitCents: priceItem.materialCostCents,
      laborUnitCents: priceItem.laborCostCents,
      usefulLifeYears: priceItem.usefulLifeYears,
      priceItemId: priceItem.id,
      confidence,
      lowConfidence: confidence < LOW_CONFIDENCE,
      reason: cleanText(line.reason, 200),
    });
  }

  const unpriced = Array.isArray(item.unpriced)
    ? item.unpriced.map((u) => cleanText(u, 120)).filter(Boolean).slice(0, 10)
    : [];

  return { lines, rejectedCodes: [...new Set(rejectedCodes)], unpriced, zeroQuantity };
}

/** Trims a narrative to something an adjuster will actually read. */
export function cleanNarrative(raw: unknown): string {
  const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return cleanText(item.narrative, 1200);
}
