-- ScopeFlow — subscription state.
--
-- One plan, a fourteen-day trial, and a rule the app enforces everywhere: the
-- trial gates SENDING, never working. A contractor whose card failed can still
-- measure, photograph, scope and price, and can still read everything they have
-- ever recorded. What lapses is sending a new estimate.
--
-- Holding somebody's claim data hostage to a card on file earns a chargeback
-- and a review that costs ten customers. Asking for money at the moment they
-- are looking at a finished twelve-thousand-dollar estimate does not.

create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired'
);

alter table public.companies
  add column if not exists subscription_status public.subscription_status
    not null default 'trialing',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz,
  -- Set by the Stripe webhook. Never written by the app.
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

-- A company starts its trial the moment it is created.
alter table public.companies
  alter column trial_ends_at set default (now() + interval '14 days');

-- Billing state is read by the contractor and written only by the webhook,
-- which runs with the service role. The existing companies_update policy would
-- otherwise let a client set its own subscription to active.
create or replace function public.reject_client_billing_writes()
returns trigger
language plpgsql
as $$
begin
  if new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  then
    raise exception 'billing state is set by Stripe, not by the app';
  end if;
  return new;
end;
$$;

-- Only fires for a normal signed-in user; the service role bypasses it.
create trigger companies_billing_is_read_only
  before update on public.companies
  for each row
  when (current_setting('role', true) = 'authenticated')
  execute function public.reject_client_billing_writes();
