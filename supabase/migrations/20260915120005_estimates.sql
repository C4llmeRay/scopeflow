-- ScopeFlow — estimates and the audit trail.
--
-- An estimate is an IMMUTABLE SNAPSHOT, not a live query. When a contractor
-- sends one, the entire priced scope is frozen into `snapshot`. If they later
-- edit their price list or a room measurement, the sent estimate must not
-- change underneath them: it is a claim document that can end up in a dispute,
-- and reproducing exactly what was sent on a given date is the whole point.
--
-- The trigger at the bottom enforces that. Versions are never deleted.

create type public.estimate_status as enum ('draft', 'sent', 'approved', 'rejected', 'superseded');

create table public.estimates (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  job_id                    uuid not null references public.jobs(id) on delete cascade,

  version                   integer not null check (version >= 1),
  status                    public.estimate_status not null default 'draft',

  -- Totals, all integer cents. Computed by src/core/estimate.ts and stored so
  -- a list screen never has to recompute a whole scope to show one number.
  line_subtotal_cents       bigint not null default 0,
  material_subtotal_cents   bigint not null default 0,
  labor_subtotal_cents      bigint not null default 0,
  op_pct                    numeric(5,2) not null default 0,
  op_cents                  bigint not null default 0,
  tax_pct                   numeric(6,3) not null default 0,
  tax_base                  public.tax_base not null default 'materials',
  tax_cents                 bigint not null default 0,
  rcv_cents                 bigint not null default 0,
  depreciation_cents        bigint not null default 0,
  recoverable_depreciation_cents bigint not null default 0,
  acv_cents                 bigint not null default 0,
  deductible_cents          bigint not null default 0,
  net_claim_cents           bigint not null default 0 check (net_claim_cents >= 0),

  -- The frozen scope: every line, every quantity, every unit cost, plus the
  -- room geometry they were derived from, as of the moment this was sent.
  snapshot                  jsonb not null default '{}'::jsonb
                              check (jsonb_typeof(snapshot) = 'object'),

  narrative                 text,
  pdf_path                  text,
  photo_report_path         text,

  sent_at                   timestamptz,
  sent_to                   text,
  approved_at               timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);

create unique index estimates_job_version_key on public.estimates (job_id, version);
create index estimates_job_idx on public.estimates (job_id, version desc);

select public.setup_company_scoped_table('estimates');

/*
 * Once an estimate leaves draft it is frozen. Status may still move forward
 * (sent -> approved, sent -> superseded) and the approval timestamps may be
 * filled in, but no figure and no snapshot may change. Editing a sent estimate
 * means creating the next version.
 */
create or replace function public.freeze_sent_estimates()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.snapshot is distinct from old.snapshot
     or new.line_subtotal_cents is distinct from old.line_subtotal_cents
     or new.op_cents is distinct from old.op_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.rcv_cents is distinct from old.rcv_cents
     or new.depreciation_cents is distinct from old.depreciation_cents
     or new.acv_cents is distinct from old.acv_cents
     or new.deductible_cents is distinct from old.deductible_cents
     or new.net_claim_cents is distinct from old.net_claim_cents
     or new.version is distinct from old.version
     or new.sent_at is distinct from old.sent_at
  then
    raise exception
      'estimate % version % has been sent and cannot be edited; create a new version instead',
      old.id, old.version;
  end if;

  return new;
end;
$$;

create trigger estimates_freeze_after_send
  before update on public.estimates
  for each row execute function public.freeze_sent_estimates();

-- Estimate versions are never deleted. Drop the delete policy the shared helper
-- created and take the grant back with it.
drop policy estimates_delete on public.estimates;
revoke delete on public.estimates from authenticated;

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,

  entity      text not null,
  entity_id   uuid,
  action      text not null,
  before      jsonb,
  after       jsonb,

  created_at  timestamptz not null default now()
);

create index activity_log_job_idx on public.activity_log (job_id, created_at desc);

alter table public.activity_log enable row level security;

create policy activity_log_select on public.activity_log
  for select using (company_id = public.current_company_id());

create policy activity_log_insert on public.activity_log
  for insert with check (company_id = public.current_company_id());

-- Append-only: no update, no delete policy, by design.
grant select, insert on public.activity_log to authenticated;
