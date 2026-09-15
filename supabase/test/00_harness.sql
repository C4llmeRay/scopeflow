-- Stubs the parts of a Supabase database that the platform normally provides,
-- so the migrations can be executed against a plain Postgres container.
--
-- This is a verification harness only. It is never applied to a real project —
-- on Supabase, all of this already exists.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                text,
  role               text,
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  is_super_admin     boolean
);

create table if not exists auth.identities (
  id              uuid primary key,
  user_id         uuid references auth.users(id) on delete cascade,
  provider_id     text,
  identity_data   jsonb,
  provider        text,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz
);

-- PostgREST exposes the JWT subject through this GUC; auth.uid() reads it.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Storage, stubbed just enough for the storage migration to run.
-- ---------------------------------------------------------------------------

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Splits an object key into its path segments, as Supabase does.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
-- Supabase grants all four to authenticated and lets RLS do the gating, so the
-- stub matches: a policy, not a missing grant, is what must refuse a write.
grant select, insert, update, delete on storage.objects to authenticated;
