/**
 * The demo stand-in for the AI Edge Function.
 *
 * Runs only when no backend is configured — a sales demo on a laptop, or a
 * phone that has never been pointed at Supabase. It answers in exactly the
 * shape the real model is held to (contract.ts), so everything downstream —
 * resolve.ts, the suggestion badges, the accept tap — runs unchanged. That is
 * the point of it: the guarantees are shown working, not described.
 *
 * It is rules, not a model, and the UI says so wherever its output appears.
 * Presenting this as Claude would be a lie to the person watching the demo.
 */

import type { NarrativeContext, ScopeContext } from './prompts';
import type { QuantityBasis, ScopeSuggestion } from './contract';

/** Shown next to anything this module produced. */
export const DEMO_AI_LABEL = 'Demo AI — rules running on this device, not Claude';

interface Rule {
  code: string;
  measure: QuantityBasis;
  confidence: number;
  reason: string;
  applies: (context: ScopeContext, materials: Set<string>) => boolean;
}

const contaminated = (context: ScopeContext) =>
  context.waterCategory === 'cat_2' || context.waterCategory === 'cat_3';

/**
 * What a template commonly misses. Each rule names a measure, never a number:
 * the quantity is looked up from the room's geometry by resolve.ts, exactly as
 * it would be for the real model.
 */
const RULES: readonly Rule[] = [
  {
    code: 'EQP-AFD',
    measure: 'each',
    confidence: 0.86,
    reason: 'Contaminated water and open wall cavities — an air scrubber keeps spores out of the rest of the house. Set the days to the drying plan.',
    applies: (context) => contaminated(context) && context.floodCutHeightIn > 0,
  },
  {
    code: 'EQP-MON',
    measure: 'each',
    confidence: 0.9,
    reason: 'Daily moisture readings are what prove the drying goal was met. One visit per drying day.',
    applies: (_context, materials) => materials.size > 0,
  },
  {
    code: 'WTR-ABM',
    measure: 'floorSf',
    confidence: 0.8,
    reason: 'Category 2 water — antimicrobial on exposed framing and subfloor before closing up.',
    applies: (context) => context.waterCategory === 'cat_2',
  },
  {
    code: 'PNT-SEAL',
    measure: 'floodCutSf',
    confidence: 0.66,
    reason: 'Seal stained framing below the flood cut before new drywall goes on.',
    applies: (context) => context.floodCutHeightIn > 0,
  },
  {
    code: 'FCC-LVP',
    measure: 'floorSf',
    confidence: 0.69,
    reason: 'Vinyl plank over a wet subfloor has to come up for the subfloor to dry, and rarely goes back down.',
    applies: (_context, materials) => materials.has('vinyl plank'),
  },
  {
    code: 'QTR-RR',
    measure: 'baseboardLf',
    confidence: 0.58,
    reason: 'Quarter round usually comes off with the flooring and rarely survives.',
    applies: (_context, materials) => materials.has('baseboard') && hasFlooring(materials),
  },
  {
    code: 'CON-MOV',
    measure: 'each',
    confidence: 0.82,
    reason: 'The room has to be emptied before flooring comes up.',
    applies: (_context, materials) => hasFlooring(materials),
  },
  {
    code: 'DBR-HAU',
    measure: 'each',
    confidence: 0.77,
    reason: 'Wet drywall, pad and carpet have to leave the site.',
    applies: (_context, materials) => materials.has('drywall') || hasFlooring(materials),
  },
  {
    code: 'CLN-FIN',
    measure: 'floorSf',
    confidence: 0.71,
    reason: 'Final clean before the homeowner moves back in.',
    applies: (_context, materials) => materials.size > 0,
  },
];

function hasFlooring(materials: Set<string>): boolean {
  return ['carpet', 'carpet pad', 'laminate', 'vinyl plank', 'hardwood'].some((m) =>
    materials.has(m),
  );
}

/** A real model answers with a handful of additions, not a second scope. */
const MAX_SUGGESTIONS = 5;

export function demoScopeSuggestion(
  context: ScopeContext,
  availableCodes: readonly string[],
): ScopeSuggestion {
  const materials = new Set(context.materials.map((m) => m.trim().toLowerCase()));
  const already = new Set(context.alreadyScoped.map((c) => c.toUpperCase()));
  const available = new Set(availableCodes.map((c) => c.toUpperCase()));

  const lines = RULES.filter(
    (rule) =>
      !already.has(rule.code) && available.has(rule.code) && rule.applies(context, materials),
  )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ code, measure, confidence, reason }) => ({ code, measure, confidence, reason }));

  const unpriced =
    contaminated(context) && context.floodCutHeightIn > 0
      ? ['Post-remediation verification testing']
      : [];

  return { lines, unpriced };
}

const PERIL_WORDS: Record<string, string> = {
  water: 'water',
  fire: 'fire',
  smoke: 'smoke',
  wind: 'wind',
  hail: 'hail',
  mold: 'mold',
  other: 'the reported peril',
};

export function demoNarrative(context: NarrativeContext): { narrative: string } {
  const affected = context.rooms.filter((room) => room.materials.length > 0);
  const where = context.propertyAddress ? ` at ${context.propertyAddress}` : '';
  const when = context.dateOfLoss ? ` on ${context.dateOfLoss}` : '';
  const peril = PERIL_WORDS[context.peril] ?? context.peril;

  const opening =
    `The property${where} sustained ${peril} damage${when}. ` +
    `${affected.length} of ${context.rooms.length} inspected ${
      context.rooms.length === 1 ? 'room was' : 'rooms were'
    } affected.`;

  const rooms = affected
    .map((room) => `${room.name}: ${room.materials.map((m) => m.toLowerCase()).join(', ')}.`)
    .join(' ');

  const closing =
    'Quantities in this estimate are taken from room measurements recorded on site. ' +
    'Wet materials are removed and replaced where drying in place is not appropriate, and ' +
    'drying equipment is sized to the affected area and volume. Concealed damage found during ' +
    'demolition will be submitted as a supplement.';

  return { narrative: [opening, rooms, closing].filter(Boolean).join('\n\n') };
}
