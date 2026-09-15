-- ScopeFlow — photos and damage records.
--
-- Photos are evidence. EXIF, GPS and the original capture timestamp are
-- preserved on the original object in storage, which is never re-encoded; the
-- compressed derivative is a separate object. When a claim is contested
-- eighteen months later, a photo with intact metadata is the contractor's
-- defence and a re-compressed copy with stripped EXIF is worth much less.

create type public.upload_state as enum ('pending', 'uploading', 'uploaded', 'failed');
create type public.water_category as enum ('cat_1', 'cat_2', 'cat_3');
create type public.water_class as enum ('class_1', 'class_2', 'class_3', 'class_4');
create type public.damage_source as enum ('manual', 'ai_photo', 'ai_voice');

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------

create table public.photos (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  job_id         uuid not null references public.jobs(id) on delete cascade,
  -- Null while the photo is still unassigned in the capture queue.
  room_id        uuid references public.rooms(id) on delete set null,

  -- Original bytes, EXIF intact. Uploaded on Wi-Fi.
  storage_path   text,
  -- Compressed derivative. Uploaded immediately, used everywhere in the UI.
  thumb_path     text,

  taken_at       timestamptz,
  gps_lat        numeric(9,6),
  gps_lng        numeric(9,6),
  width_px       integer,
  height_px      integer,
  byte_size      bigint,

  caption        text,
  -- Claude's classification output. Advisory: never drives a dollar amount.
  --   { "material": "drywall", "severity": "moderate", "confidence": 0.82, ... }
  ai_labels      jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(ai_labels) = 'object'),

  upload_state   public.upload_state not null default 'pending',
  upload_error   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index photos_job_idx on public.photos (job_id, taken_at)
  where deleted_at is null;
create index photos_room_idx on public.photos (room_id)
  where deleted_at is null;
create index photos_pending_upload_idx on public.photos (company_id, upload_state)
  where deleted_at is null and upload_state <> 'uploaded';

select public.setup_company_scoped_table('photos');

-- ---------------------------------------------------------------------------
-- damages
-- ---------------------------------------------------------------------------

create table public.damages (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  room_id             uuid not null references public.rooms(id) on delete cascade,
  -- The photo this was classified from, when it came from one.
  photo_id            uuid references public.photos(id) on delete set null,

  -- 'drywall', 'carpet', 'carpet_pad', 'subfloor', 'insulation', 'baseboard',
  -- 'ceiling', 'cabinet', 'trim'. Text rather than an enum: the taxonomy will
  -- churn through beta and a migration per new material is friction you do not
  -- need in week one.
  material            text not null,

  water_category      public.water_category,
  water_class         public.water_class,

  -- Share of the material in this room that is affected.
  affected_pct        numeric(5,2) check (affected_pct >= 0 and affected_pct <= 100),
  -- How far up the wall the water reached. Drives the flood cut height.
  affected_height_in  integer check (affected_height_in >= 0),
  -- Moisture meter reading, percent.
  moisture_pct        numeric(5,2) check (moisture_pct >= 0),

  notes               text,
  source              public.damage_source not null default 'manual',
  -- Model confidence when source is not manual. Null for manual entry.
  ai_confidence       numeric(4,3) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index damages_room_idx on public.damages (room_id)
  where deleted_at is null;

select public.setup_company_scoped_table('damages');

-- ---------------------------------------------------------------------------
-- voice_notes
-- ---------------------------------------------------------------------------

create table public.voice_notes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  room_id       uuid references public.rooms(id) on delete set null,

  storage_path  text,
  duration_ms   integer check (duration_ms is null or duration_ms >= 0),
  transcript    text,
  transcribed_at timestamptz,

  upload_state  public.upload_state not null default 'pending',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index voice_notes_job_idx on public.voice_notes (job_id, created_at)
  where deleted_at is null;

select public.setup_company_scoped_table('voice_notes');
