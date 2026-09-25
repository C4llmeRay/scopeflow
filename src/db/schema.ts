/**
 * The on-device schema.
 *
 * Mirrors the server tables closely enough that an outbox payload is a near
 * copy of a local row, but not slavishly: timestamps are epoch milliseconds
 * here (integers sort and compare cheaply) and ISO strings on the wire.
 *
 * Plain SQL rather than generated migrations on purpose. Drizzle's migrator for
 * expo-sqlite needs a Metro transformer for .sql assets, which is real setup
 * friction for a schema that is going to churn every day for the next month.
 * When the schema settles, swap this for generated migrations.
 */

export const APP_SCHEMA = `
pragma journal_mode = WAL;
pragma foreign_keys = ON;

create table if not exists companies (
  id                text primary key,
  -- Equals id. Present only because every tenant table carries it; the server's
  -- companies table has no such column, so it never goes on the wire.
  company_id        text not null,
  name              text not null,
  license_no        text,
  logo_url          text,
  phone             text,
  email             text,
  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  postal_code       text,
  default_op_pct    real not null default 20,
  default_tax_pct   real not null default 0,
  default_tax_base  text not null default 'materials',
  -- Printed at the foot of every estimate.
  estimate_terms    text,
  -- Per-job AI budget, in cents. Stops a retry loop burning the API bill.
  ai_job_ceiling_cents integer not null default 500,
  -- Set by the Stripe webhook and synced down. Never written by the app.
  subscription_status  text not null default 'trialing',
  trial_ends_at        integer,
  current_period_end   integer,
  -- Stripe's word for "this is the last period". Kept so the app can say
  -- "cancels on the 4th" instead of treating a still-live subscription as gone.
  cancel_at_period_end integer not null default 0,
  created_at        integer not null,
  updated_at        integer not null,
  deleted_at        integer
);

create table if not exists jobs (
  id                text primary key,
  company_id        text not null,
  claim_no          text,
  policy_no         text,
  carrier           text,
  adjuster_name     text,
  adjuster_email    text,
  date_of_loss      text,
  peril             text not null default 'water',
  status            text not null default 'inspecting',
  property_address1 text,
  property_city     text,
  property_state    text,
  property_postal   text,
  year_built        integer,
  homeowner_name    text,
  homeowner_phone   text,
  homeowner_email   text,
  deductible_cents  integer not null default 0,
  op_pct            real    not null default 20,
  tax_pct           real    not null default 0,
  tax_base          text    not null default 'materials',
  created_at        integer not null,
  updated_at        integer not null,
  deleted_at        integer
);

create table if not exists rooms (
  id                  text primary key,
  company_id          text not null,
  job_id              text not null references jobs(id) on delete cascade,
  name                text not null,
  level               text,
  length_in           integer not null,
  width_in            integer not null,
  height_in           integer not null,
  ceiling_type        text not null default 'flat',
  ceiling_multiplier  real not null default 1,
  flooring_type       text,
  offsets             text not null default '[]',
  flood_cut_height_in integer not null default 0,
  sort_order          integer not null default 0,
  notes               text,
  created_at          integer not null,
  updated_at          integer not null,
  deleted_at          integer
);

create index if not exists rooms_job_idx on rooms (job_id, sort_order);

create table if not exists openings (
  id           text primary key,
  company_id   text not null,
  room_id      text not null references rooms(id) on delete cascade,
  kind         text not null,
  width_in     integer not null,
  height_in    integer not null,
  count        integer not null default 1,
  deducts_wall integer,
  deducts_base integer,
  created_at   integer not null,
  updated_at   integer not null,
  deleted_at   integer
);

create index if not exists openings_room_idx on openings (room_id);

create table if not exists photos (
  id            text primary key,
  company_id    text not null,
  job_id        text not null references jobs(id) on delete cascade,
  room_id       text references rooms(id) on delete set null,
  local_uri       text,
  local_thumb_uri text,
  storage_path    text,
  thumb_path      text,
  taken_at        integer,
  gps_lat         real,
  gps_lng         real,
  -- The photo's name in Xactimate, e.g. "Kitchen - Water line".
  title           text,
  -- Its description in Xactimate.
  caption         text,
  ai_labels       text not null default '{}',
  -- State of the compressed derivative, which is what the UI shows.
  upload_state    text not null default 'pending',
  -- State of the untouched original, which waits for an unmetered connection.
  original_state  text not null default 'pending',
  created_at      integer not null,
  updated_at      integer not null,
  deleted_at      integer
);

create index if not exists photos_job_idx on photos (job_id, taken_at);
create index if not exists photos_room_idx on photos (room_id);

create table if not exists damages (
  id                 text primary key,
  company_id         text not null,
  room_id            text not null references rooms(id) on delete cascade,
  photo_id           text references photos(id) on delete set null,
  material           text not null,
  water_category     text,
  water_class        text,
  affected_pct       real,
  affected_height_in integer,
  moisture_pct       real,
  notes              text,
  source             text not null default 'manual',
  ai_confidence      real,
  created_at         integer not null,
  updated_at         integer not null,
  deleted_at         integer
);

create index if not exists damages_room_idx on damages (room_id);


create table if not exists price_items (
  id                  text primary key,
  company_id          text not null,
  code                text not null,
  description         text not null,
  unit                text not null,
  category            text,
  material_cost_cents integer not null default 0,
  labor_cost_cents    integer not null default 0,
  waste_pct           real    not null default 0,
  useful_life_years   integer,
  is_seed             integer not null default 0,
  created_at          integer not null,
  updated_at          integer not null,
  deleted_at          integer
);

-- One row per code per company, so a re-import updates rather than duplicates.
create unique index if not exists price_items_code_idx
  on price_items (company_id, upper(code)) where deleted_at is null;
create index if not exists price_items_category_idx
  on price_items (company_id, category) where deleted_at is null;

create table if not exists line_items (
  id                  text primary key,
  company_id          text not null,
  job_id              text not null references jobs(id) on delete cascade,
  room_id             text references rooms(id) on delete cascade,
  price_item_id       text,
  code                text not null,
  description         text not null,
  unit                text not null,
  qty                 real    not null default 0,
  waste_pct           real    not null default 0,
  material_unit_cents integer not null default 0,
  labor_unit_cents    integer not null default 0,
  age_years           real,
  useful_life_years   integer,
  depreciation_recoverable integer not null default 1,
  origin              text not null default 'manual',
  status              text not null default 'accepted',
  ai_confidence       real,
  note                text,
  sort_order          integer not null default 0,
  created_at          integer not null,
  updated_at          integer not null,
  deleted_at          integer
);

create index if not exists line_items_job_idx on line_items (job_id, sort_order);
create index if not exists line_items_room_idx on line_items (room_id);

create table if not exists estimates (
  id                      text primary key,
  company_id              text not null,
  job_id                  text not null references jobs(id) on delete cascade,
  version                 integer not null,
  status                  text not null default 'draft',
  line_subtotal_cents     integer not null default 0,
  material_subtotal_cents integer not null default 0,
  labor_subtotal_cents    integer not null default 0,
  op_pct                  real    not null default 0,
  op_cents                integer not null default 0,
  tax_pct                 real    not null default 0,
  tax_base                text    not null default 'materials',
  tax_cents               integer not null default 0,
  rcv_cents               integer not null default 0,
  depreciation_cents      integer not null default 0,
  recoverable_depreciation_cents integer not null default 0,
  acv_cents               integer not null default 0,
  deductible_cents        integer not null default 0,
  net_claim_cents         integer not null default 0,
  snapshot                text    not null default '{}',
  narrative               text,
  pdf_path                text,
  -- Where the public HTML rendering lives, when one has been published.
  share_path              text,
  sent_at                 integer,
  sent_to                 text,
  created_at              integer not null,
  updated_at              integer not null,
  deleted_at              integer
);

create unique index if not exists estimates_version_idx on estimates (job_id, version);

create table if not exists voice_notes (
  id           text primary key,
  company_id   text not null,
  job_id       text not null references jobs(id) on delete cascade,
  room_id      text references rooms(id) on delete set null,
  local_uri    text,
  storage_path text,
  duration_ms  integer,
  transcript   text,
  upload_state text not null default 'pending',
  created_at   integer not null,
  updated_at   integer not null,
  deleted_at   integer
);
`;
