-- ScopeFlow — jobs, rooms and openings.
--
-- rooms holds only what a contractor types: three dimensions plus offsets.
-- Every derived quantity (floor SF, perimeter LF, net wall SF, baseboard LF,
-- flood cut SF, volume CF) comes from src/core/measure.ts and is deliberately
-- NOT stored here. One source of truth for geometry, and it is the one with
-- tests around it.

create type public.peril as enum ('water', 'fire', 'smoke', 'wind', 'hail', 'mold', 'other');
create type public.job_status as enum ('inspecting', 'estimating', 'sent', 'approved', 'closed', 'lost');
create type public.ceiling_type as enum ('flat', 'vaulted', 'tray', 'cathedral');
create type public.opening_kind as enum ('door', 'window', 'archway', 'missing_wall');

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------

create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,

  -- Claim identity
  claim_no           text,
  policy_no          text,
  carrier            text,
  adjuster_name      text,
  adjuster_email     text,
  adjuster_phone     text,
  date_of_loss       date,
  peril              public.peril not null default 'water',
  loss_description   text,

  status             public.job_status not null default 'inspecting',

  -- Property
  property_address1  text,
  property_address2  text,
  property_city      text,
  property_state     text,
  property_postal    text,
  year_built         integer check (year_built is null or (year_built between 1600 and 2200)),

  -- Homeowner
  homeowner_name     text,
  homeowner_phone    text,
  homeowner_email    text,

  -- Money terms, copied from company defaults at creation then editable per job.
  deductible_cents   bigint not null default 0 check (deductible_cents >= 0),
  op_pct             numeric(5,2) not null default 20 check (op_pct >= 0 and op_pct <= 100),
  tax_pct            numeric(6,3) not null default 0 check (tax_pct >= 0 and tax_pct <= 100),
  tax_base           public.tax_base not null default 'materials',

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index jobs_company_status_idx on public.jobs (company_id, status)
  where deleted_at is null;
create index jobs_company_updated_idx on public.jobs (company_id, updated_at desc)
  where deleted_at is null;

select public.setup_company_scoped_table('jobs');

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------

create table public.rooms (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  job_id              uuid not null references public.jobs(id) on delete cascade,

  name                text not null check (length(trim(name)) > 0),
  level               text,

  length_in           integer not null check (length_in > 0),
  width_in            integer not null check (width_in > 0),
  height_in           integer not null check (height_in > 0),

  ceiling_type        public.ceiling_type not null default 'flat',
  -- >1 for vaulted and cathedral ceilings; multiplies the derived ceiling area.
  ceiling_multiplier  numeric(4,2) not null default 1 check (ceiling_multiplier > 0),
  flooring_type       text,

  -- Rectangles added to or removed from the base rectangle — the MVP's answer
  -- to L-shaped rooms. Shape:
  --   [{ "name": "Closet", "op": "add", "depthIn": 24, "widthIn": 60,
  --      "placement": "corner" }]
  offsets             jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(offsets) = 'array'),

  -- Height of the drywall flood cut, 0 for none.
  flood_cut_height_in integer not null default 0 check (flood_cut_height_in >= 0),

  sort_order          integer not null default 0,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index rooms_job_idx on public.rooms (job_id, sort_order)
  where deleted_at is null;

select public.setup_company_scoped_table('rooms');

-- ---------------------------------------------------------------------------
-- openings
-- ---------------------------------------------------------------------------

create table public.openings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,

  kind          public.opening_kind not null,
  width_in      integer not null check (width_in > 0),
  height_in     integer not null check (height_in > 0),
  count         integer not null default 1 check (count >= 1),

  -- Null means "use the default for this kind" in src/core/measure.ts:
  -- everything deducts wall area; everything except a window breaks the
  -- baseboard run, because baseboard runs underneath a window.
  deducts_wall  boolean,
  deducts_base  boolean,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index openings_room_idx on public.openings (room_id)
  where deleted_at is null;

select public.setup_company_scoped_table('openings');
