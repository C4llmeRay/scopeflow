/**
 * The AI Edge Function.
 *
 * Everything the model does goes through here, for four reasons the plan names:
 *
 *   1. The API key never ships in an app bundle. A key in a mobile binary is a
 *      key on the internet.
 *   2. The per-job spend ceiling is enforced BEFORE the call, not discovered on
 *      the invoice. The failure mode that hurts is a retry loop on one bad
 *      photo running overnight.
 *   3. Token usage is logged per call against the job, so cost per estimate is
 *      a number rather than a feeling.
 *   4. The caller is authenticated and scoped: a request may only ever spend
 *      against a job its own company owns.
 *
 * Deno. Deployed with `supabase functions deploy ai`.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-opus-5';
const DEFAULT_CEILING_CENTS = 500;

/** Claude Opus 5, cents per million tokens. Mirrors src/features/ai/cost.ts. */
const PRICING = {
  input: 500,
  output: 2_500,
  cacheRead: 50,
  cacheWrite: 625,
};

type Action = 'classify_photo' | 'suggest_scope' | 'extract_voice' | 'write_narrative';

interface RequestBody {
  action: Action;
  jobId: string | null;
  /** Cacheable prefix blocks, built on the client from the contractor's price list. */
  prefix: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
  /** The volatile instruction for this call. */
  instruction: string;
  /** Base64 JPEG, for classify_photo only. */
  imageBase64?: string;
  /** JSON Schema the answer must satisfy. */
  schema: Record<string, unknown>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function costCents(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): number {
  const millionths =
    (usage.input_tokens ?? 0) * PRICING.input +
    (usage.output_tokens ?? 0) * PRICING.output +
    (usage.cache_read_input_tokens ?? 0) * PRICING.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * PRICING.cacheWrite;
  const cents = millionths / 1_000_000;
  return cents > 0 ? Math.max(1, Math.ceil(cents)) : 0;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const started = Date.now();

  // ---- Who is asking -------------------------------------------------------
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not authenticated' }, 401);

  // A client scoped to the CALLER, so RLS decides what they can see. This is
  // what stops one company spending against another company's job.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'not authenticated' }, 401);

  const { data: profile } = await caller
    .from('profiles')
    .select('company_id')
    .eq('id', auth.user.id)
    .single();

  if (!profile?.company_id) return json({ error: 'no company for this user' }, 403);
  const companyId = profile.company_id as string;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'malformed request' }, 400);
  }

  if (!body.action || !body.instruction || !body.schema || !Array.isArray(body.prefix)) {
    return json({ error: 'missing action, instruction, prefix or schema' }, 400);
  }

  // ---- The job must be one this company owns -------------------------------
  if (body.jobId) {
    const { data: job } = await caller.from('jobs').select('id').eq('id', body.jobId).single();
    if (!job) return json({ error: 'that job is not yours' }, 403);
  }

  // ---- The ceiling, checked before spending anything ------------------------
  const { data: company } = await caller
    .from('companies')
    .select('ai_job_ceiling_cents')
    .eq('id', companyId)
    .single();

  const ceiling = (company?.ai_job_ceiling_cents as number | undefined) ?? DEFAULT_CEILING_CENTS;

  if (body.jobId) {
    const { data: spent } = await caller.rpc('ai_spend_cents', { p_job_id: body.jobId });
    const spentCents = (spent as number | null) ?? 0;
    if (spentCents >= ceiling) {
      return json(
        {
          error: 'budget_exceeded',
          message:
            `This job has used $${(spentCents / 100).toFixed(2)} of its ` +
            `$${(ceiling / 100).toFixed(2)} AI budget.`,
          spentCents,
          ceilingCents: ceiling,
        },
        429,
      );
    }
  }

  // Writing the meter uses the service role: the thing being metered must not
  // be able to edit its own meter.
  const meter = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const record = async (
    usage: Record<string, number> | null,
    error: string | null,
  ): Promise<number> => {
    const cents = usage ? costCents(usage) : 0;
    await meter.from('ai_usage').insert({
      company_id: companyId,
      job_id: body.jobId,
      action: body.action,
      model: MODEL,
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
      cost_cents: cents,
      error,
      duration_ms: Date.now() - started,
    });
    return cents;
  };

  // ---- The call ------------------------------------------------------------
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const content: unknown[] = [];
  if (body.imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: body.imageBase64 },
    });
  }
  content.push({ type: 'text', text: body.instruction });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4_000,
      // The cacheable prefix goes in system, where it is byte-identical across
      // every call in a job. The photo and the instruction go in messages.
      system: body.prefix as never,
      messages: [{ role: 'user', content: content as never }],
      output_config: { format: { type: 'json_schema', schema: body.schema } as never },
    });

    if (response.stop_reason === 'refusal') {
      const cents = await record(response.usage as never, 'refusal');
      return json({ error: 'refused', costCents: cents }, 422);
    }

    const text = response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('');

    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      const cents = await record(response.usage as never, 'unparseable json');
      return json({ error: 'the model did not return usable JSON', costCents: cents }, 502);
    }

    const usage = response.usage as unknown as Record<string, number>;
    const cents = await record(usage, null);

    return json({
      result,
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        costCents: cents,
      },
    });
  } catch (error) {
    await record(null, (error as Error).message.slice(0, 500));
    return json({ error: (error as Error).message }, 502);
  }
});
