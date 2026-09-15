/**
 * Calling the AI Edge Function.
 *
 * Thin on purpose. The interesting work — constraining codes, resolving
 * quantities from geometry, discarding low-confidence findings — happens in
 * resolve.ts on whatever comes back, so this layer only has to move bytes and
 * report failures in words a contractor can act on.
 */

import type { LocalDatabase } from '../../db/types';
import { getPriceItem, listPriceItems } from '../../db/price-items';
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase';
import type { AiAction, AiUsage } from './contract';
import {
  photoClassificationSchema,
  scopeSuggestionSchema,
  voiceExtractionSchema,
  NARRATIVE_SCHEMA,
} from './contract';
import {
  ALLOWED_MATERIALS,
  narrativeInstruction,
  photoInstruction,
  scopeInstruction,
  stablePrefix,
  voiceInstruction,
  type NarrativeContext,
  type PhotoContext,
  type ScopeContext,
} from './prompts';

export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailable';
  }
}

export class AiBudgetExceeded extends Error {
  constructor(
    message: string,
    readonly spentCents: number,
    readonly ceilingCents: number,
  ) {
    super(message);
    this.name = 'AiBudgetExceeded';
  }
}

interface InvokeArgs {
  action: AiAction;
  jobId: string | null;
  instruction: string;
  schema: object;
  prefix: ReturnType<typeof stablePrefix>;
  imageBase64?: string;
}

async function invoke<T>(args: InvokeArgs): Promise<{ result: T; usage: AiUsage }> {
  if (!isSupabaseConfigured()) {
    throw new AiUnavailable('AI needs a backend. Everything else works without one.');
  }

  const { data, error } = await getSupabase().functions.invoke('ai', { body: args });

  if (error) {
    // A budget refusal comes back as a 429 with a body worth reading.
    const body = (data ?? {}) as Record<string, unknown>;
    if (body.error === 'budget_exceeded') {
      throw new AiBudgetExceeded(
        String(body.message ?? 'This job has used its AI budget.'),
        Number(body.spentCents ?? 0),
        Number(body.ceilingCents ?? 0),
      );
    }
    throw new AiUnavailable(error.message || 'The AI service did not answer.');
  }

  const body = data as { result?: T; usage?: AiUsage; error?: string };
  if (body.error) throw new AiUnavailable(body.error);
  if (!body.result) throw new AiUnavailable('The AI service returned nothing usable.');

  return {
    result: body.result,
    usage: body.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costCents: 0,
    },
  };
}

/** Loaded once per call so the cacheable prefix matches the current price list. */
async function prefixFor(db: LocalDatabase, companyId: string) {
  return stablePrefix(await listPriceItems(db, companyId));
}

export async function classifyPhoto(
  db: LocalDatabase,
  companyId: string,
  jobId: string,
  imageBase64: string,
  context: PhotoContext,
) {
  return invoke<unknown>({
    action: 'classify_photo',
    jobId,
    instruction: photoInstruction(context),
    schema: photoClassificationSchema(ALLOWED_MATERIALS),
    prefix: await prefixFor(db, companyId),
    imageBase64,
  });
}

export async function suggestScope(
  db: LocalDatabase,
  companyId: string,
  jobId: string,
  context: ScopeContext,
) {
  const priceItems = await listPriceItems(db, companyId);
  if (priceItems.length === 0) {
    throw new AiUnavailable('Import or seed a price list first — there is nothing to scope with.');
  }

  return invoke<unknown>({
    action: 'suggest_scope',
    jobId,
    instruction: scopeInstruction(context),
    schema: scopeSuggestionSchema(priceItems.map((item) => item.code)),
    prefix: stablePrefix(priceItems),
  });
}

export async function extractVoice(
  db: LocalDatabase,
  companyId: string,
  jobId: string,
  transcript: string,
  roomName: string | null,
) {
  return invoke<unknown>({
    action: 'extract_voice',
    jobId,
    instruction: voiceInstruction(transcript, roomName),
    schema: voiceExtractionSchema(ALLOWED_MATERIALS),
    prefix: await prefixFor(db, companyId),
  });
}

export async function writeNarrative(
  db: LocalDatabase,
  companyId: string,
  jobId: string,
  context: NarrativeContext,
) {
  return invoke<unknown>({
    action: 'write_narrative',
    jobId,
    instruction: narrativeInstruction(context),
    schema: NARRATIVE_SCHEMA as unknown as object,
    prefix: await prefixFor(db, companyId),
  });
}

/** Re-reads a price item, so a resolved suggestion carries live pricing. */
export async function reloadPriceItem(db: LocalDatabase, id: string) {
  return getPriceItem(db, id);
}
