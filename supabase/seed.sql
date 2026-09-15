-- ScopeFlow — local development seed.
--
-- LOCAL ONLY. This writes directly into auth.users, which is fine against a
-- local `supabase start` stack and must never run against a hosted project.
--
-- Sign in as:  dev@scopeflow.test  /  password123
--
-- The Water Street job is the plan's worked example: its master bedroom is the
-- exact 12' x 14' x 8' room that src/core/fixtures/bedroom-cat2.ts asserts
-- against, so the seed data and the test suite tell the same story.

-- ---------------------------------------------------------------------------
-- Auth user
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'dev@scopeflow.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dev Contractor"}'::jsonb,
  false
) on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"dev@scopeflow.test","email_verified":true}'::jsonb,
  'email',
  now(), now(), now()
) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Company and profile
-- ---------------------------------------------------------------------------

insert into public.companies (
  id, name, license_no, phone, email,
  address_line1, city, state, postal_code,
  default_op_pct, default_tax_pct, default_tax_base
) values (
  '22222222-2222-2222-2222-222222222222',
  'Harbor Restoration LLC',
  'TX-RC-118244',
  '(512) 555-0142',
  'office@harborrestoration.test',
  '4400 Shoal Creek Blvd', 'Austin', 'TX', '78756',
  20, 8.25, 'materials'
) on conflict (id) do nothing;

insert into public.profiles (id, company_id, email, full_name, phone, role)
values (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'dev@scopeflow.test',
  'Dev Contractor',
  '(512) 555-0199',
  'owner'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Job
-- ---------------------------------------------------------------------------

insert into public.jobs (
  id, company_id,
  claim_no, policy_no, carrier, adjuster_name, adjuster_email,
  date_of_loss, peril, loss_description, status,
  property_address1, property_city, property_state, property_postal, year_built,
  homeowner_name, homeowner_phone, homeowner_email,
  deductible_cents, op_pct, tax_pct, tax_base
) values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'CLM-2026-884120', 'HO3-9917446', 'Lone Star Mutual',
  'Rachel Ndiaye', 'rndiaye@lonestarmutual.test',
  date '2026-09-11', 'water',
  'Supply line failure at the upstairs hall bathroom lavatory. Water migrated '
    || 'through the hall into the master bedroom and down the interior wall '
    || 'cavity. Discovered approximately 14 hours after onset.',
  'inspecting',
  '1812 Water Street', 'Austin', 'TX', '78702', 1996,
  'Marcus Oyelaran', '(512) 555-0177', 'm.oyelaran@example.test',
  100000, 20, 8.25, 'materials'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------

-- 12' x 14' x 8' — the plan's worked example, to the inch.
insert into public.rooms (
  id, company_id, job_id, name, level,
  length_in, width_in, height_in,
  ceiling_type, flooring_type, flood_cut_height_in, sort_order, notes
) values (
  '44444444-4444-4444-4444-444444444401',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  'Master Bedroom', 'Second floor',
  144, 168, 96,
  'flat', 'Carpet over pad', 24, 1,
  'Cat 2, Class 2. Water line visible at roughly 14 inches on the north and '
    || 'west walls. Carpet and pad saturated wall to wall.'
) on conflict (id) do nothing;

-- 8' x 10' x 8' with a 2' x 3' corner notch for the stair bulkhead.
insert into public.rooms (
  id, company_id, job_id, name, level,
  length_in, width_in, height_in,
  ceiling_type, flooring_type, offsets, flood_cut_height_in, sort_order, notes
) values (
  '44444444-4444-4444-4444-444444444402',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  'Upstairs Hallway', 'Second floor',
  96, 120, 96,
  'flat', 'Carpet over pad',
  '[{"name":"Stair bulkhead","op":"subtract","depthIn":24,"widthIn":36,"placement":"corner"}]'::jsonb,
  24, 2,
  'Path of migration between the bathroom and the master bedroom.'
) on conflict (id) do nothing;

-- 5' x 8' x 8' vaulted, tile floor, no flood cut needed.
insert into public.rooms (
  id, company_id, job_id, name, level,
  length_in, width_in, height_in,
  ceiling_type, ceiling_multiplier, flooring_type, flood_cut_height_in, sort_order, notes
) values (
  '44444444-4444-4444-4444-444444444403',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  'Hall Bathroom', 'Second floor',
  60, 96, 96,
  'vaulted', 1.15, 'Ceramic tile', 0, 3,
  'Source room. Tile floor intact; damage is confined to the vanity cabinet '
    || 'and the wall cavity behind it.'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Openings
-- ---------------------------------------------------------------------------

insert into public.openings (company_id, room_id, kind, width_in, height_in, count)
values
  -- Master Bedroom: one standard door, one standard window — the fixture.
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444401', 'door',   36, 80, 1),
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444401', 'window', 48, 36, 1),
  -- Hallway: three interior doors and the open stair run.
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444402', 'door',   32, 80, 3),
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444402', 'missing_wall', 42, 96, 1),
  -- Bathroom: one door, one small window.
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444403', 'door',   30, 80, 1),
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444403', 'window', 24, 24, 1);

-- ---------------------------------------------------------------------------
-- Price list — a slice of the starter water-damage list.
-- Starting points to be edited, never authoritative regional pricing.
-- ---------------------------------------------------------------------------

insert into public.price_items (
  company_id, code, description, unit, category,
  material_cost_cents, labor_cost_cents, waste_pct, useful_life_years, is_seed
) values
  ('22222222-2222-2222-2222-222222222222', 'WTR-EXT', 'Water extraction, carpeted floor',        'SF', 'Mitigation',    0,  62,  0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'FCC-RMV', 'Remove carpet',                           'SF', 'Flooring',      0,  32,  0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'FCC-PAD', 'Remove and dispose carpet pad',           'SF', 'Flooring',      0,  28,  0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'DRY-FC2', 'Drywall flood cut and remove, 2 ft',      'SF', 'Drywall',       0, 186,  0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'INS-R13', 'R-13 batt insulation, remove and replace','SF', 'Insulation',   95,  47,  5,   30, true),
  ('22222222-2222-2222-2222-222222222222', 'EQP-DEH', 'Dehumidifier, per day',                   'DA', 'Equipment',     0, 8800, 0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'EQP-AM',  'Air mover, per day',                      'DA', 'Equipment',     0, 2650, 0, null, true),
  ('22222222-2222-2222-2222-222222222222', 'DRY-HTF', 'Drywall hang, tape, float and texture',   'SF', 'Drywall',     130, 144, 10,   50, true),
  ('22222222-2222-2222-2222-222222222222', 'PNT-W2',  'Paint walls, two coats',                  'SF', 'Paint',        35,  57,  0,   10, true),
  ('22222222-2222-2222-2222-222222222222', 'FCC-CPT', 'Carpet with pad, replace',                'SF', 'Flooring',    320,  90, 10,   10, true),
  ('22222222-2222-2222-2222-222222222222', 'BAS-RR',  'Baseboard, remove and replace',           'LF', 'Trim',        240, 145,  8,   25, true)
on conflict do nothing;
