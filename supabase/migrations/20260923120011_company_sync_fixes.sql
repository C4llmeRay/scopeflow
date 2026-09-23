-- ScopeFlow — the company row as the app actually writes it.
--
-- Two mismatches between the app and the schema, both of which stopped a
-- company's details from ever reaching the server.

-- 1. A company may exist before it has a name.
--
-- bootstrap_company runs at the first sign-in, before the contractor has typed
-- anything, and the app creates it with an empty name on purpose: an empty name
-- is how the app knows to ask for business details, and the app refuses to send
-- an estimate until they are filled in. The non-empty check made that first
-- sign-in fail for every new user. The name stays NOT NULL.
alter table public.companies drop constraint if exists companies_name_check;

-- 2. The terms printed at the foot of every estimate.
--
-- Edited in the app's settings and synced with the rest of the profile, but the
-- column never existed here, so every company update was refused.
alter table public.companies add column if not exists estimate_terms text;
