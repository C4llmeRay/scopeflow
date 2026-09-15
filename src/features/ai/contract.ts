/**
 * What the model is allowed to say.
 *
 * The plan's four rules are enforced here rather than trusted:
 *
 *   1. Codes are constrained to the contractor's own price list. The schema
 *      carries the allowed codes as an enum, and resolve.ts drops anything that
 *      slips through anyway.
 *   2. Nothing arrives accepted. Everything the model produces lands as a
 *      suggestion and needs a human tap.
 *   3. QUANTITIES COME FROM GEOMETRY. This is the important one, and it is
 *      structural: the model cannot return a number at all. It returns a
 *      `measure` — the NAME of a derived quantity — and the measurement engine
 *      supplies the value. A hallucinated 4,000 SF of carpet is not something
 *      this schema can express.
 *   4. The stable prefix is cacheable; see prompts.ts.
 */

import type { RoomQuantities } from '../../core/measure';

/* -------------------------------------------------------------------------- */
/* Quantity basis                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The only quantities a suggested line may use. Each name maps to a field the
 * measurement engine derived from what the contractor actually measured.
 *
 * `each` is the escape hatch for a per-item line (a door, a cabinet), and it
 * resolves to 1 — a count the contractor then edits, not a guess.
 */
export const QUANTITY_BASES = [
  'floorSf',
  'ceilingSf',
  'perimeterLf',
  'grossWallSf',
  'netWallSf',
  'baseboardLf',
  'floodCutSf',
  'volumeCf',
  'each',
] as const;

export type QuantityBasis = (typeof QUANTITY_BASES)[number];

/** Human wording for the review UI, so a suggestion explains its own quantity. */
export const QUANTITY_BASIS_LABELS: Record<QuantityBasis, string> = {
  floorSf: 'floor area',
  ceilingSf: 'ceiling area',
  perimeterLf: 'perimeter',
  grossWallSf: 'wall area before openings',
  netWallSf: 'wall area after openings',
  baseboardLf: 'baseboard run',
  floodCutSf: 'flood cut area',
  volumeCf: 'room volume',
  each: 'a count',
};

export function resolveQuantity(basis: QuantityBasis, quantities: RoomQuantities): number {
  if (basis === 'each') return 1;
  return quantities[basis];
}

/* -------------------------------------------------------------------------- */
/* Photo classification                                                       */
/* -------------------------------------------------------------------------- */

export const WATER_CATEGORIES = ['cat_1', 'cat_2', 'cat_3'] as const;
export const WATER_CLASSES = ['class_1', 'class_2', 'class_3', 'class_4'] as const;

export interface ClassifiedDamage {
  /** Must be one of the materials offered in the prompt. */
  material: string;
  /** How far up the wall water reached, in INCHES, or null if not visible. */
  affectedHeightIn: number | null;
  /** 0-1. The UI shows anything under 0.6 differently. */
  confidence: number;
  /** One short sentence a contractor can check against the photo. */
  observation: string;
}

export interface PhotoClassification {
  damages: ClassifiedDamage[];
  waterCategory: (typeof WATER_CATEGORIES)[number] | null;
  waterClass: (typeof WATER_CLASSES)[number] | null;
  /** A caption for the photo report. */
  caption: string;
  /** True when the photo shows no damage at all — a hallway, a shot of the sky. */
  noDamageVisible: boolean;
}

export function photoClassificationSchema(materials: readonly string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['damages', 'waterCategory', 'waterClass', 'caption', 'noDamageVisible'],
    properties: {
      damages: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['material', 'affectedHeightIn', 'confidence', 'observation'],
          properties: {
            material: { type: 'string', enum: [...materials] },
            affectedHeightIn: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 120,
              description: 'Inches above the floor that water reached, or null if not visible.',
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            observation: { type: 'string', maxLength: 200 },
          },
        },
      },
      waterCategory: { type: ['string', 'null'], enum: [...WATER_CATEGORIES, null] },
      waterClass: { type: ['string', 'null'], enum: [...WATER_CLASSES, null] },
      caption: { type: 'string', maxLength: 160 },
      noDamageVisible: { type: 'boolean' },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Scope suggestion                                                           */
/* -------------------------------------------------------------------------- */

export interface SuggestedLine {
  /** Must be a code from the contractor's own price list. */
  code: string;
  /** The NAME of a derived quantity, never a number. */
  measure: QuantityBasis;
  confidence: number;
  /** Why this line belongs, in one sentence. */
  reason: string;
}

export interface ScopeSuggestion {
  lines: SuggestedLine[];
  /** Anything the model thinks is needed but could not find a code for. */
  unpriced: string[];
}

export function scopeSuggestionSchema(codes: readonly string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['lines', 'unpriced'],
    properties: {
      lines: {
        type: 'array',
        maxItems: 25,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'measure', 'confidence', 'reason'],
          properties: {
            code: { type: 'string', enum: [...codes] },
            measure: {
              type: 'string',
              enum: [...QUANTITY_BASES],
              description:
                'Which derived room quantity this line is measured against. ' +
                'Never a number — the measurement engine supplies the value.',
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', maxLength: 200 },
          },
        },
      },
      unpriced: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 120 },
        description: 'Work that is needed but has no matching code in the price list.',
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Voice transcript                                                           */
/* -------------------------------------------------------------------------- */

export interface VoiceExtraction {
  damages: ClassifiedDamage[];
  waterCategory: (typeof WATER_CATEGORIES)[number] | null;
  waterClass: (typeof WATER_CLASSES)[number] | null;
  /** Anything said that is not damage — a reminder, a note about access. */
  notes: string[];
}

export function voiceExtractionSchema(materials: readonly string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['damages', 'waterCategory', 'waterClass', 'notes'],
    properties: {
      damages: (photoClassificationSchema(materials) as { properties: Record<string, object> })
        .properties.damages,
      waterCategory: { type: ['string', 'null'], enum: [...WATER_CATEGORIES, null] },
      waterClass: { type: ['string', 'null'], enum: [...WATER_CLASSES, null] },
      notes: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 200 } },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Narrative                                                                  */
/* -------------------------------------------------------------------------- */

export interface NarrativeResult {
  narrative: string;
}

export const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative'],
  properties: {
    narrative: {
      type: 'string',
      maxLength: 1200,
      description: 'Plain-language summary of the loss and the scope, for an adjuster.',
    },
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

export type AiAction = 'classify_photo' | 'suggest_scope' | 'extract_voice' | 'write_narrative';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costCents: number;
}

export interface AiResponse<T> {
  result: T;
  usage: AiUsage;
}
