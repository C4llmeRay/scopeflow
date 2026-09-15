-- ScopeFlow — AI usage metering.
--
-- Two jobs. It is the audit trail for what the model was asked and what it
-- answered, and it is the meter the per-job spend ceiling reads.
--
-- The ceiling exists because of the failure mode the plan names: not the cost
-- per estimate, which is trivial against a contractor's time, but a retry loop
-- on one bad photo quietly burning the API budget overnight.

create type public.ai_action as enum (
  'classify_photo',
  'suggest_scope',
  'extract_voice',
  'write_narrative'
);

create table public.ai_usage (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  job_id                uuid references public.jobs(id) on delete cascade,
  action                public.ai_action not null,
  model                 text not null,

  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_read_tokens     integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cost_cents            integer not null default 0,

  -- Null on success. Set when the call failed, so a run of failures is visible
  -- rather than showing up only as spend.
  error                 text,
  duration_ms           integer,

  created_at            timestamptz not null default now()
);

create index ai_usage_job_idx on public.ai_usage (job_id, created_at desc);
create index ai_usage_company_idx on public.ai_usage (company_id, created_at desc);

alter table public.ai_usage enable row level security;

-- A contractor may read their own spend. Rows are written by the Edge Function
-- with the service role, so there is no insert policy for a normal user: the
-- meter must not be writable by the thing being metered.
create policy ai_usage_select on public.ai_usage
  for select using (company_id = public.current_company_id());

grant select on public.ai_usage to authenticated;

-- What a job has spent so far. SECURITY DEFINER so the Edge Function can call
-- it cheaply, and scoped so it can only ever report on the caller's own job.
create or replace function public.ai_spend_cents(p_job_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(cost_cents), 0)::integer
    from public.ai_usage
   where job_id = p_job_id;
$$;

grant execute on function public.ai_spend_cents(uuid) to authenticated, service_role;

-- Per-job AI budget, so a contractor can raise it on a big loss.
alter table public.companies
  add column if not exists ai_job_ceiling_cents integer not null default 500;
