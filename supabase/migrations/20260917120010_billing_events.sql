-- ScopeFlow — making the Stripe webhook safe to be wrong twice.
--
-- Stripe delivers at least once, not exactly once, and it does not promise
-- order. Both of those are ordinary, not exceptional: a timeout on our side
-- means a redelivery, and a subscription updated twice in the same second can
-- arrive backwards. A webhook handler that assumes otherwise produces a
-- contractor who cancelled last week and is somehow subscribed again, or one
-- whose payment succeeded and who is still locked out.
--
-- Two defences, and they solve different halves of the problem:
--
--   * stripe_events makes a REPLAY harmless — the same event id is processed
--     once and afterwards recognised.
--   * companies.last_billing_event_at makes a REORDER harmless — an event
--     older than the one already applied is dropped rather than applied on top.
--
-- The first alone is not enough: two different events arriving out of order are
-- not replays, and both are new.

create table if not exists public.stripe_events (
  -- Stripe's own event id, e.g. evt_1P... The primary key IS the idempotency:
  -- a second delivery collides and the handler knows to stop.
  id            text primary key,
  type          text        not null,
  -- The company it resolved to, when it resolved to one. Null for an event
  -- about a customer we have never seen, which is worth keeping a record of.
  company_id    uuid references public.companies(id) on delete set null,
  -- Stripe's timestamp for the event, not ours. Ordering is judged by this.
  event_created_at timestamptz not null,
  received_at   timestamptz not null default now(),
  -- What the handler decided. 'applied', 'stale', or 'ignored'.
  outcome       text        not null
);

create index if not exists stripe_events_company_idx
  on public.stripe_events (company_id, event_created_at desc);

-- RLS on with no policy at all is not an oversight — it is the point. This
-- table is the webhook's alone, and the webhook runs with the service role,
-- which bypasses RLS. Every ordinary client sees an empty table. Billing event
-- history is not a contractor's business and definitely not a competitor's.
alter table public.stripe_events enable row level security;

-- And belt as well as braces: Supabase grants `authenticated` broad table
-- privileges by default, so RLS with no policy is the only thing standing
-- between a client and this table. Revoking the grant outright means a mistake
-- in a future migration — one stray permissive policy — cannot open it.
--
-- It also makes the local Docker harness and a real project behave identically,
-- which matters more than it sounds: a security test that passes only because
-- the test database happens to lack a grant is not evidence of anything.
revoke all on public.stripe_events from anon, authenticated;

-- The high-water mark for out-of-order delivery.
alter table public.companies
  add column if not exists last_billing_event_at timestamptz,
  -- Stripe keeps a cancelled-but-still-running subscription in 'active' and
  -- flags it here. Without this column the app would tell somebody who
  -- cancelled this morning that everything was fine.
  add column if not exists cancel_at_period_end boolean not null default false;

-- The read-only-billing trigger has to learn about the new columns, or a client
-- could set cancel_at_period_end itself. Recreating the function is enough; the
-- trigger points at it by name.
create or replace function public.reject_client_billing_writes()
returns trigger
language plpgsql
as $$
begin
  if new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end
     or new.last_billing_event_at is distinct from old.last_billing_event_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  then
    raise exception 'billing state is set by Stripe, not by the app';
  end if;
  return new;
end;
$$;

-- Looking a company up by its Stripe customer is the webhook's hot path: every
-- event arrives carrying a customer id and nothing else we key on.
create unique index if not exists companies_stripe_customer_idx
  on public.companies (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists companies_stripe_subscription_idx
  on public.companies (stripe_subscription_id)
  where stripe_subscription_id is not null;
