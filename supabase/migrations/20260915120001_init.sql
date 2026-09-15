-- ScopeFlow — foundations.
--
-- Conventions enforced across every migration:
--   * Linear dimensions are INTEGER INCHES, in columns suffixed _in.
--   * Money is BIGINT CENTS, in columns suffixed _cents.
--   * Every tenant table carries company_id, created_at, updated_at, deleted_at.
--   * Soft delete only. A contractor who removes a room mid-inspection needs undo.
--   * RLS is on for every tenant table, keyed on company_id.
--
-- Note: the build plan calls this table `users`; it is named `profiles` here to
-- avoid confusion with Supabase's own auth.users, which it extends.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('owner', 'estimator', 'tech');
create type public.tax_base as enum ('materials', 'all');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The caller's company. SECURITY DEFINER so it reads profiles without RLS,
-- which is what stops the profiles policy from recursing into itself.
--
-- plpgsql rather than sql on purpose: there is a definition cycle here —
-- companies' policies need this function, this function reads profiles, and
-- profiles has a foreign key to companies. A plpgsql body is not name-resolved
-- until it runs, which lets the three be created in that order.
create or replace function public.current_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  return v_company_id;
end;
$$;

/*
 * Migration-time helper. Applies the standard tenant setup to a table:
 * updated_at trigger, RLS on, the four company-scoped policies, and the grants
 * the authenticated role needs. Keeping this in one place is deliberate — forty
 * hand-written policy statements is forty chances to typo a table name in the
 * one part of the schema where a typo is a data leak.
 */
create or replace function public.setup_company_scoped_table(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger %I before update on public.%I
       for each row execute function public.set_updated_at()',
    p_table || '_set_updated_at', p_table);

  execute format('alter table public.%I enable row level security', p_table);

  execute format(
    'create policy %I on public.%I for select
       using (company_id = public.current_company_id())',
    p_table || '_select', p_table);

  execute format(
    'create policy %I on public.%I for insert
       with check (company_id = public.current_company_id())',
    p_table || '_insert', p_table);

  execute format(
    'create policy %I on public.%I for update
       using (company_id = public.current_company_id())
       with check (company_id = public.current_company_id())',
    p_table || '_update', p_table);

  execute format(
    'create policy %I on public.%I for delete
       using (company_id = public.current_company_id())',
    p_table || '_delete', p_table);

  execute format(
    'grant select, insert, update, delete on public.%I to authenticated', p_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) > 0),
  license_no        text,
  logo_url          text,
  phone             text,
  email             text,
  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  postal_code       text,

  -- Defaults copied onto each new job, where they can be overridden.
  default_op_pct    numeric(5,2) not null default 20
                      check (default_op_pct >= 0 and default_op_pct <= 100),
  default_tax_pct   numeric(6,3) not null default 0
                      check (default_tax_pct >= 0 and default_tax_pct <= 100),
  default_tax_base  public.tax_base not null default 'materials',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

alter table public.companies enable row level security;

create policy companies_select on public.companies
  for select using (id = public.current_company_id());

create policy companies_update on public.companies
  for update using (id = public.current_company_id())
  with check (id = public.current_company_id());

-- No insert policy by design: companies are created through bootstrap_company()
-- below, because a user has no company_id until the moment they get one.

grant select, update on public.companies to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete restrict,
  email       text not null,
  full_name   text,
  phone       text,
  role        public.app_role not null default 'owner',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index profiles_company_id_idx on public.profiles (company_id)
  where deleted_at is null;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select using (company_id = public.current_company_id());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

/*
 * Creates the company and the caller's profile in one transaction. This exists
 * because of a chicken-and-egg problem: RLS keys on company_id, and a brand new
 * user does not have one yet. Doing it through a SECURITY DEFINER function
 * avoids having to open up an insert policy on companies to every signed-in user.
 */
create or replace function public.bootstrap_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_company_id uuid;
  v_email      text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'user already belongs to a company';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.companies (name)
  values (p_name)
  returning id into v_company_id;

  insert into public.profiles (id, company_id, email, role)
  values (v_uid, v_company_id, coalesce(v_email, ''), 'owner');

  return v_company_id;
end;
$$;

grant execute on function public.current_company_id() to authenticated;
grant execute on function public.bootstrap_company(text) to authenticated;
