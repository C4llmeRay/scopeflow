-- Schema smoke test.
--
-- Proves the claims the schema makes that are expensive to get wrong:
--   1. RLS isolates one company's data from another's.
--   2. RLS refuses a write that tries to plant a row in another company.
--   3. A sent estimate cannot be edited.
--   4. An AI line item cannot be inserted pre-accepted.
--   5. Storage follows the same tenant rule, and the bucket is private.
--
-- Run by scripts/verify-schema.sh. Any failed assertion aborts with an error.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- A second company, to have something that must stay invisible.
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000',
        '99999999-9999-9999-9999-999999999999',
        'authenticated', 'authenticated', 'rival@other.test', now(), now());

insert into public.companies (id, name)
values ('88888888-8888-8888-8888-888888888888', 'Rival Restoration Co');

insert into public.profiles (id, company_id, email, role)
values ('99999999-9999-9999-9999-999999999999',
        '88888888-8888-8888-8888-888888888888', 'rival@other.test', 'owner');

insert into public.jobs (id, company_id, claim_no, peril)
values ('77777777-7777-7777-7777-777777777777',
        '88888888-8888-8888-8888-888888888888', 'RIVAL-0001', 'water');

-- ---------------------------------------------------------------------------
-- 1 + 2. Tenant isolation, as the seeded contractor.
-- ---------------------------------------------------------------------------

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  do $$
  declare
    v_jobs      integer;
    v_rooms     integer;
    v_companies integer;
    v_prices    integer;
  begin
    select count(*) into v_jobs from public.jobs;
    select count(*) into v_rooms from public.rooms;
    select count(*) into v_companies from public.companies;
    select count(*) into v_prices from public.price_items;

    if v_jobs <> 1 then
      raise exception 'RLS leak: expected 1 visible job, saw %', v_jobs;
    end if;
    if v_rooms <> 3 then
      raise exception 'expected 3 visible rooms, saw %', v_rooms;
    end if;
    if v_companies <> 1 then
      raise exception 'RLS leak: expected 1 visible company, saw %', v_companies;
    end if;
    if v_prices <> 11 then
      raise exception 'expected 11 seeded price items, saw %', v_prices;
    end if;

    raise notice 'PASS  tenant isolation on select';
  end
  $$;

  -- A write aimed at another company must be refused.
  do $$
  begin
    begin
      insert into public.jobs (company_id, claim_no, peril)
      values ('88888888-8888-8888-8888-888888888888', 'STOLEN-0001', 'water');
      raise exception 'RLS HOLE: inserted a job into another company';
    exception
      when insufficient_privilege then
        raise notice 'PASS  cross-tenant insert refused';
    end;
  end
  $$;

  -- The rival's job must not be updatable either.
  do $$
  declare v_rows integer;
  begin
    update public.jobs set claim_no = 'HIJACKED'
      where id = '77777777-7777-7777-7777-777777777777';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'RLS HOLE: updated % rows in another company', v_rows;
    end if;
    raise notice 'PASS  cross-tenant update matched no rows';
  end
  $$;
commit;

-- ---------------------------------------------------------------------------
-- 3. A sent estimate is frozen.
-- ---------------------------------------------------------------------------

insert into public.estimates (
  id, company_id, job_id, version, status,
  line_subtotal_cents, rcv_cents, acv_cents, net_claim_cents, snapshot
) values (
  '55555555-5555-5555-5555-555555555555',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  1, 'draft', 264377, 324417, 296865, 196865, '{"rooms":[]}'::jsonb
);

-- Still a draft: editing is fine.
update public.estimates
  set line_subtotal_cents = 264377, snapshot = '{"rooms":["master"]}'::jsonb
  where id = '55555555-5555-5555-5555-555555555555';

-- Send it.
update public.estimates
  set status = 'sent', sent_at = now(), sent_to = 'rndiaye@lonestarmutual.test'
  where id = '55555555-5555-5555-5555-555555555555';

do $$
begin
  begin
    update public.estimates
      set rcv_cents = 999999
      where id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FROZEN ESTIMATE HOLE: edited a sent estimate';
  exception
    when raise_exception then
      if sqlerrm like '%FROZEN ESTIMATE HOLE%' then raise; end if;
      raise notice 'PASS  sent estimate refused an edit';
  end;
end
$$;

-- Moving it forward to approved is still allowed.
update public.estimates
  set status = 'approved', approved_at = now()
  where id = '55555555-5555-5555-5555-555555555555';

do $$
declare v_status public.estimate_status;
begin
  select status into v_status from public.estimates
    where id = '55555555-5555-5555-5555-555555555555';
  if v_status <> 'approved' then
    raise exception 'expected approved, got %', v_status;
  end if;
  raise notice 'PASS  sent estimate still accepts a status advance';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. AI line items land as suggestions.
-- ---------------------------------------------------------------------------

insert into public.line_items (
  id, company_id, job_id, room_id, code, description, unit, qty,
  material_unit_cents, labor_unit_cents, origin, status
) values (
  '66666666-6666-6666-6666-666666666666',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444401',
  'FCC-CPT', 'Carpet with pad, replace', 'SF', 168,
  320, 90, 'ai', 'accepted'   -- a client bug trying to pre-accept
);

do $$
declare v_status public.line_item_status;
begin
  select status into v_status from public.line_items
    where id = '66666666-6666-6666-6666-666666666666';
  if v_status <> 'suggested' then
    raise exception 'AI line item was accepted without a human tap: %', v_status;
  end if;
  raise notice 'PASS  AI line item forced to suggested on insert';
end
$$;

-- Accepting it afterwards is the human tap, and must work.
update public.line_items set status = 'accepted'
  where id = '66666666-6666-6666-6666-666666666666';

do $$
declare v_status public.line_item_status;
begin
  select status into v_status from public.line_items
    where id = '66666666-6666-6666-6666-666666666666';
  if v_status <> 'accepted' then
    raise exception 'could not accept a suggestion: %', v_status;
  end if;
  raise notice 'PASS  a human can accept a suggestion';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Every tenant table actually has RLS enabled.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ')
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'tables without RLS: %', v_missing;
  end if;
  raise notice 'PASS  every public table has RLS enabled';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Storage follows the same tenant rule as the tables.
-- ---------------------------------------------------------------------------

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  -- A key inside the contractor's own company folder is allowed.
  insert into storage.objects (bucket_id, name)
  values ('job-media', '22222222-2222-2222-2222-222222222222/job/photo-a.jpg');

  do $$
  begin
    begin
      -- The same shape, but under the rival's company id.
      insert into storage.objects (bucket_id, name)
      values ('job-media', '88888888-8888-8888-8888-888888888888/job/stolen.jpg');
      raise exception 'STORAGE HOLE: wrote into another company folder';
    exception
      when insufficient_privilege then
        raise notice 'PASS  storage refused a cross-tenant write';
    end;
  end
  $$;

  do $$
  declare v_visible integer;
  begin
    select count(*) into v_visible from storage.objects;
    if v_visible <> 1 then
      raise exception 'STORAGE HOLE: expected 1 visible object, saw %', v_visible;
    end if;
    raise notice 'PASS  storage isolates one company from another';
  end
  $$;
commit;

do $$
declare v_public boolean;
begin
  select public into v_public from storage.buckets where id = 'job-media';
  if v_public is not false then
    raise exception 'job-media bucket must not be public';
  end if;
  raise notice 'PASS  job-media bucket is private';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. A shared estimate link is readable without a login, writable only by its
--    owner, and revocable.
-- ---------------------------------------------------------------------------

do $$
declare v_public boolean;
begin
  select public into v_public from storage.buckets where id = 'estimate-shares';
  if v_public is not true then
    raise exception 'estimate-shares must be public — the recipient has no account';
  end if;
  raise notice 'PASS  estimate-shares is publicly readable by design';
end
$$;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  insert into storage.objects (bucket_id, name)
  values ('estimate-shares', '22222222-2222-2222-2222-222222222222/token-abc.html');

  do $$
  begin
    begin
      insert into storage.objects (bucket_id, name)
      values ('estimate-shares', '88888888-8888-8888-8888-888888888888/token-xyz.html');
      raise exception 'SHARE HOLE: published into another company folder';
    exception
      when insufficient_privilege then
        raise notice 'PASS  cannot publish a share under another company';
    end;
  end
  $$;

  -- Revoking a link must work, unlike job-media where evidence is never deleted.
  do $$
  declare v_rows integer;
  begin
    delete from storage.objects
      where bucket_id = 'estimate-shares'
        and name = '22222222-2222-2222-2222-222222222222/token-abc.html';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'expected to revoke 1 share, revoked %', v_rows;
    end if;
    raise notice 'PASS  a shared link can be revoked';
  end
  $$;
commit;

-- ---------------------------------------------------------------------------
-- 8. The AI meter is readable by its owner and writable by nobody.
-- ---------------------------------------------------------------------------

insert into public.ai_usage (company_id, job_id, action, model, cost_cents)
values ('22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333', 'classify_photo', 'claude-opus-5', 37);

insert into public.ai_usage (company_id, job_id, action, model, cost_cents)
values ('88888888-8888-8888-8888-888888888888', null, 'suggest_scope', 'claude-opus-5', 999);

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  do $$
  declare v_rows integer; v_spend integer;
  begin
    select count(*) into v_rows from public.ai_usage;
    if v_rows <> 1 then
      raise exception 'AI meter leak: expected 1 visible row, saw %', v_rows;
    end if;

    select public.ai_spend_cents('33333333-3333-3333-3333-333333333333') into v_spend;
    if v_spend <> 37 then
      raise exception 'expected 37 cents of spend, got %', v_spend;
    end if;
    raise notice 'PASS  AI spend is visible to its owner only';
  end
  $$;

  -- The thing being metered must not be able to write the meter.
  do $$
  begin
    begin
      insert into public.ai_usage (company_id, action, model, cost_cents)
      values ('22222222-2222-2222-2222-222222222222', 'suggest_scope', 'claude-opus-5', 0);
      raise exception 'METER HOLE: a normal user wrote the AI meter';
    exception
      when insufficient_privilege then
        raise notice 'PASS  the AI meter is not writable by a normal user';
    end;
  end
  $$;
commit;

-- ---------------------------------------------------------------------------
-- 9. Billing state is Stripe's to set, not the app's.
-- ---------------------------------------------------------------------------

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  do $$
  begin
    begin
      update public.companies
         set subscription_status = 'active'
       where id = '22222222-2222-2222-2222-222222222222';
      raise exception 'BILLING HOLE: a client granted itself a subscription';
    exception
      when raise_exception then
        if sqlerrm like '%BILLING HOLE%' then raise; end if;
        raise notice 'PASS  a client cannot grant itself a subscription';
    end;
  end
  $$;

  -- Ordinary edits to the same row must still work.
  do $$
  begin
    update public.companies
       set phone = '(512) 555-0199'
     where id = '22222222-2222-2222-2222-222222222222';
    raise notice 'PASS  ordinary company edits still work';
  end
  $$;
commit;

-- The webhook, running as the service role, may set it.
update public.companies
   set subscription_status = 'active', current_period_end = now() + interval '30 days'
 where id = '22222222-2222-2222-2222-222222222222';

do $$
declare v_status public.subscription_status;
begin
  select subscription_status into v_status from public.companies
   where id = '22222222-2222-2222-2222-222222222222';
  if v_status <> 'active' then
    raise exception 'the webhook could not set billing state, got %', v_status;
  end if;
  raise notice 'PASS  the webhook can set billing state';
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 6: the webhook's own table, and the columns it owns.
-- ---------------------------------------------------------------------------

-- A client must not be able to see, invent or replay billing events. The table
-- has RLS on and no policy at all, which denies everything for an ordinary
-- user; the service role bypasses it. That asymmetry is the whole design, so it
-- is worth asserting rather than assuming.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  do $$
  declare v_count integer;
  begin
    -- Two ways to be safe here and both are acceptable: the grant is revoked
    -- (permission denied) or RLS has no policy to admit anything (zero rows).
    -- What is NOT acceptable is a row coming back.
    select count(*) into v_count from public.stripe_events;
    if v_count <> 0 then
      raise exception 'BILLING HOLE: a client can read % billing events', v_count;
    end if;
    raise notice 'PASS  billing events are invisible to a client (empty)';
  exception
    when insufficient_privilege then
      raise notice 'PASS  billing events are invisible to a client (no grant)';
  end
  $$;

  do $$
  begin
    begin
      insert into public.stripe_events (id, type, event_created_at, outcome)
      values ('evt_forged', 'customer.subscription.updated', now(), 'applied');
      raise exception 'BILLING HOLE: a client forged a billing event';
    exception
      when insufficient_privilege or raise_exception then
        if sqlerrm like '%BILLING HOLE%' then raise; end if;
        raise notice 'PASS  a client cannot forge a billing event';
    end;
  end
  $$;

  -- cancel_at_period_end is Stripe's, like every other billing column. It was
  -- added after the original trigger was written, which is exactly the kind of
  -- column that gets left out of the guard.
  do $$
  begin
    begin
      update public.companies
         set cancel_at_period_end = true
       where id = '22222222-2222-2222-2222-222222222222';
      raise exception 'BILLING HOLE: a client set its own cancel_at_period_end';
    exception
      when raise_exception then
        if sqlerrm like '%BILLING HOLE%' then raise; end if;
        raise notice 'PASS  a client cannot set cancel_at_period_end';
    end;
  end
  $$;
commit;

-- The webhook, as the service role, writes all of it.
insert into public.stripe_events (id, type, company_id, event_created_at, outcome)
values ('evt_real', 'customer.subscription.updated',
        '22222222-2222-2222-2222-222222222222', now(), 'applied');

do $$
begin
  begin
    insert into public.stripe_events (id, type, event_created_at, outcome)
    values ('evt_real', 'customer.subscription.updated', now(), 'applied');
    raise exception 'REPLAY HOLE: the same event was accepted twice';
  exception
    when unique_violation then
      raise notice 'PASS  a replayed event id is refused';
  end;
end
$$;

update public.companies
   set cancel_at_period_end = true,
       last_billing_event_at = now()
 where id = '22222222-2222-2222-2222-222222222222';

do $$
declare v_cancel boolean;
begin
  select cancel_at_period_end into v_cancel from public.companies
   where id = '22222222-2222-2222-2222-222222222222';
  if not v_cancel then
    raise exception 'the webhook could not set cancel_at_period_end';
  end if;
  raise notice 'PASS  the webhook can set cancel_at_period_end';
end
$$;
