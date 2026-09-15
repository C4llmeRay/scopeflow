-- ScopeFlow — price list and line items.
--
-- Material and labor are stored SEPARATELY on every price item, because sales
-- tax applies to materials only in most jurisdictions. Collapsing them into one
-- unit price makes the tax line impossible to compute correctly later.
--
-- Waste is a property of the material, not of the job: carpet wastes
-- differently than tile than drywall. It lives on the price item and is applied
-- to quantity, with the pre-waste number kept visible in the UI.

create type public.line_item_origin as enum ('manual', 'template', 'ai');
create type public.line_item_status as enum ('suggested', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- price_items
-- ---------------------------------------------------------------------------

create table public.price_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,

  code                text not null check (length(trim(code)) > 0),
  description         text not null,
  -- SF, LF, SY, EA, DA, HR, CF.
  unit                text not null,
  category            text,

  material_cost_cents bigint not null default 0 check (material_cost_cents >= 0),
  labor_cost_cents    bigint not null default 0 check (labor_cost_cents >= 0),
  waste_pct           numeric(5,2) not null default 0
                        check (waste_pct >= 0 and waste_pct <= 100),

  -- Typical useful life, used to propose depreciation on the line.
  useful_life_years   integer check (useful_life_years is null or useful_life_years > 0),

  -- True for rows that came from the shipped starter list rather than the
  -- contractor's own import. Shown differently in the UI, because the seed list
  -- is a starting point to be edited and never authoritative regional pricing.
  is_seed             boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- One row per code per company. Partial, so a soft-deleted code can be re-added.
create unique index price_items_company_code_key
  on public.price_items (company_id, upper(code))
  where deleted_at is null;

create index price_items_company_category_idx
  on public.price_items (company_id, category)
  where deleted_at is null;

select public.setup_company_scoped_table('price_items');

-- ---------------------------------------------------------------------------
-- line_items
-- ---------------------------------------------------------------------------

create table public.line_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  job_id              uuid not null references public.jobs(id) on delete cascade,
  room_id             uuid references public.rooms(id) on delete cascade,

  -- Kept for traceability. The code, description, unit and costs below are
  -- COPIED at the time the line is created, so editing the price list later
  -- never silently rewrites an existing scope.
  price_item_id       uuid references public.price_items(id) on delete set null,

  code                text not null,
  description         text not null,
  unit                text not null,

  -- Derived by src/core/measure.ts. Never produced by a language model.
  qty                 numeric(12,2) not null check (qty >= 0),
  waste_pct           numeric(5,2) not null default 0 check (waste_pct >= 0),
  material_unit_cents bigint not null default 0 check (material_unit_cents >= 0),
  labor_unit_cents    bigint not null default 0 check (labor_unit_cents >= 0),

  -- Depreciation inputs, per line.
  age_years           numeric(5,2) check (age_years is null or age_years >= 0),
  useful_life_years   integer check (useful_life_years is null or useful_life_years > 0),
  depreciation_recoverable boolean not null default true,

  origin              public.line_item_origin not null default 'manual',
  -- Everything AI-generated lands as 'suggested' and needs a human tap before
  -- it can reach an estimate total. Manual and template lines start accepted.
  status              public.line_item_status not null default 'accepted',
  ai_confidence       numeric(4,3)
                        check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),

  note                text,
  sort_order          integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- An AI line must start life as a suggestion. This is the database half of
-- "the model proposes, the human disposes" — the rule that keeps a hallucinated
-- line item out of a dollar total even if a client bug tries to insert one
-- pre-accepted. Accepting it afterwards, through an UPDATE, is exactly the
-- human tap the rule is asking for, so the trigger only fires on INSERT.
create or replace function public.force_ai_line_items_to_suggested()
returns trigger
language plpgsql
as $$
begin
  if new.origin = 'ai' then
    new.status := 'suggested';
  end if;
  return new;
end;
$$;

create trigger line_items_ai_starts_suggested
  before insert on public.line_items
  for each row execute function public.force_ai_line_items_to_suggested();

create index line_items_job_idx on public.line_items (job_id, sort_order)
  where deleted_at is null;
create index line_items_room_idx on public.line_items (room_id)
  where deleted_at is null;
create index line_items_review_queue_idx on public.line_items (job_id)
  where deleted_at is null and status = 'suggested';

select public.setup_company_scoped_table('line_items');
