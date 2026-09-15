/**
 * Building the requests.
 *
 * Every prompt here is split into a STABLE PREFIX and a volatile tail, and the
 * prefix is marked cacheable. The system instructions and the contractor's
 * price list are byte-identical across every call in a job — a twelve-room
 * house is a dozen calls sharing the same few thousand tokens of price list —
 * so caching it is the difference between paying for it once and paying for it
 * twelve times.
 *
 * The tail is whatever is specific to this photo, room or transcript, and it
 * goes last so it cannot invalidate the prefix.
 */

import type { RoomQuantities } from '../../core/measure';
import { COMMON_MATERIALS } from '../../db/damages';
import type { PriceItemRecord } from '../../db/price-items';
import { QUANTITY_BASIS_LABELS, QUANTITY_BASES } from './contract';

export const AI_MODEL = 'claude-opus-5';

/** Materials a finding may name. Shared by the schema and the prompt. */
export const ALLOWED_MATERIALS: readonly string[] = COMMON_MATERIALS;

/* -------------------------------------------------------------------------- */
/* The stable prefix                                                          */
/* -------------------------------------------------------------------------- */

const ROLE = `You are assisting a water-damage restoration contractor who is inspecting a property.

You work to IICRC S500. Category describes how clean the water is: cat_1 clean from a supply line, cat_2 grey from an appliance or a washing machine, cat_3 grossly contaminated from sewage or ground water. Class describes how much of the room absorbed it: class_1 the least, class_4 deeply bound materials like plaster and hardwood.

How you are used matters:

- Everything you return is a SUGGESTION. A human reviews each one and taps to accept it. You are not filling in a form on their behalf, you are pointing at things worth their attention.
- You never state a quantity. The contractor measured the room and the app derived the areas; you name WHICH derived quantity a line is measured against and the app supplies the number.
- You only ever name line item codes that appear in the price list below. If work is needed and no code covers it, say so in the unpriced list rather than inventing a code.
- Confidence is a real number you are held to. Say 0.9 when the photograph plainly shows it, 0.4 when you are reading tea leaves. Findings below 0.25 are discarded, so a guess costs nothing but is also worth nothing.
- Be specific and short. A contractor reads these standing in a wet basement.`;

function materialsBlock(): string {
  return `MATERIALS you may name, exactly as spelled:\n${ALLOWED_MATERIALS.join(', ')}`;
}

function measuresBlock(): string {
  const rows = QUANTITY_BASES.map((basis) => `  ${basis} — ${QUANTITY_BASIS_LABELS[basis]}`);
  return `QUANTITY BASES. Pick the one a line is genuinely measured against:\n${rows.join('\n')}`;
}

/** The contractor's own list, which is the only vocabulary of codes allowed. */
export function priceListBlock(priceItems: readonly PriceItemRecord[]): string {
  if (priceItems.length === 0) return 'PRICE LIST: empty. You cannot suggest any line items.';

  const rows = priceItems.map(
    (item) => `  ${item.code} | ${item.description} | per ${item.unit}`,
  );
  return `PRICE LIST — the only codes you may use:\n${rows.join('\n')}`;
}

export interface CacheableBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * The prefix every call in a job shares. Marked cacheable at the end, so the
 * whole of it — role, materials, measures, price list — is one cache entry.
 */
export function stablePrefix(priceItems: readonly PriceItemRecord[]): CacheableBlock[] {
  return [
    { type: 'text', text: ROLE },
    { type: 'text', text: materialsBlock() },
    { type: 'text', text: measuresBlock() },
    // Last block carries the marker, so everything above it is cached too.
    { type: 'text', text: priceListBlock(priceItems), cache_control: { type: 'ephemeral' } },
  ];
}

/* -------------------------------------------------------------------------- */
/* The volatile tails                                                         */
/* -------------------------------------------------------------------------- */

export interface PhotoContext {
  roomName: string | null;
  /** What the contractor has already recorded, so the model adds rather than repeats. */
  knownMaterials: readonly string[];
}

export function photoInstruction(context: PhotoContext): string {
  const lines = [
    'Look at this photograph from the inspection and report what damage it shows.',
    context.roomName ? `It was taken in: ${context.roomName}.` : 'It is not tagged to a room yet.',
  ];

  if (context.knownMaterials.length > 0) {
    lines.push(
      `The contractor has already recorded these as wet: ${context.knownMaterials.join(', ')}. ` +
        'Confirm them if the photograph supports it, and add anything they have missed.',
    );
  }

  lines.push(
    'If a water line is visible, estimate its height above the floor in inches against something ' +
      'of known size in the frame — a baseboard is about 4 inches, an outlet box sits about 12 to ' +
      '16 inches up, a door is 80 inches. If nothing gives you a reference, return null rather ' +
      'than a guess.',
    'If the photograph shows no damage at all, say so and return no findings.',
    'Write a caption for the photo report: what it shows, in one line, no preamble.',
  );

  return lines.join('\n\n');
}

export interface ScopeContext {
  roomName: string;
  quantities: RoomQuantities;
  materials: readonly string[];
  waterCategory: string | null;
  waterClass: string | null;
  floodCutHeightIn: number;
  /** Codes the deterministic template already produced, so the model adds to them. */
  alreadyScoped: readonly string[];
}

export function scopeInstruction(context: ScopeContext): string {
  const q = context.quantities;
  const measured = [
    `floor ${q.floorSf} SF`,
    `ceiling ${q.ceilingSf} SF`,
    `perimeter ${q.perimeterLf} LF`,
    `walls ${q.netWallSf} SF after openings`,
    `baseboard ${q.baseboardLf} LF`,
    q.floodCutSf > 0 ? `flood cut ${q.floodCutSf} SF` : null,
    `volume ${q.volumeCf} CF`,
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [
    `Room: ${context.roomName}.`,
    `Measured: ${measured}.`,
    `Water: ${context.waterCategory ?? 'category not recorded'}, ${context.waterClass ?? 'class not recorded'}.`,
    `Wet materials the contractor recorded: ${
      context.materials.length > 0 ? context.materials.join(', ') : 'none recorded'
    }.`,
  ];

  if (context.alreadyScoped.length > 0) {
    lines.push(
      `The standard template already scoped these codes: ${context.alreadyScoped.join(', ')}. ` +
        'Do not repeat them. Suggest only what the template missed.',
    );
  }

  lines.push(
    'Suggest additional line items this room needs. For each, give the code, which quantity ' +
      'basis it is measured against, your confidence, and one sentence of reasoning a contractor ' +
      'can check. If nothing is missing, return an empty list — that is a good answer.',
  );

  return lines.join('\n\n');
}

export function voiceInstruction(transcript: string, roomName: string | null): string {
  return [
    'This is a voice note the contractor recorded while walking the property.',
    roomName ? `It is tagged to: ${roomName}.` : 'It is not tagged to a room.',
    'Pull out the damage they described: which materials, how far up the water went, and the ' +
      'category and class if they said them. Heights spoken as feet should be converted to inches.',
    'Anything said that is not damage — an access note, a reminder, something about the ' +
      'homeowner — goes in notes rather than being dropped.',
    `TRANSCRIPT:\n${transcript}`,
  ].join('\n\n');
}

export interface NarrativeContext {
  propertyAddress: string | null;
  peril: string;
  dateOfLoss: string | null;
  rooms: { name: string; materials: string[] }[];
  totalCents: number;
}

export function narrativeInstruction(context: NarrativeContext): string {
  const rooms = context.rooms
    .map((room) => `  ${room.name}: ${room.materials.join(', ') || 'no materials recorded'}`)
    .join('\n');

  return [
    'Write the summary of loss that goes at the foot of this estimate. An adjuster reads it ' +
      'before they read the scope.',
    `Property: ${context.propertyAddress ?? 'not recorded'}. Peril: ${context.peril}. ` +
      `Date of loss: ${context.dateOfLoss ?? 'not recorded'}.`,
    `Rooms and what got wet:\n${rooms}`,
    'Two or three short paragraphs. Say what happened, what it affected, and why the major ' +
      'line items follow from it. Plain language, no adjectives that argue — the scope argues ' +
      'for itself. Do not invent a cause the contractor did not record; if the cause is not in ' +
      'the data, describe the damage without speculating about it.',
  ].join('\n\n');
}
