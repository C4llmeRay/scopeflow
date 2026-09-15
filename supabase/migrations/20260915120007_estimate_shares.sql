-- ScopeFlow — shareable estimate links.
--
-- An adjuster will not create an account to read an estimate, and a homeowner
-- certainly will not. So a sent estimate can be published as a standalone HTML
-- page at an unguessable URL.
--
-- The security model is a capability URL, stated plainly because it is a real
-- tradeoff: anyone holding the link can read that estimate. What protects it is
-- 122 bits of entropy in the path, which is not guessable, and the fact that
-- deleting the object revokes the link immediately. What it is NOT protected
-- against is the contractor forwarding the link to the wrong person — the same
-- risk as emailing the PDF, which is the alternative.
--
-- Nothing here is a claim document of record. The authoritative estimate is the
-- frozen row in public.estimates; this bucket holds a rendering of it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estimate-shares',
  'estimate-shares',
  -- Public read. That is the entire point: no login for the recipient.
  true,
  10485760,
  array['text/html']
)
on conflict (id) do nothing;

-- The owning contractor must be able to SEE their own published shares, to list
-- them and to revoke one. Public read by the recipient is served by the storage
-- API for a public bucket and does not go through this policy at all — this one
-- is what lets the owner manage what they published.
--
-- It is also load-bearing for the delete below: Postgres requires a SELECT
-- policy to permit a row before an UPDATE or DELETE can find it, so without
-- this, revoking a link silently matches nothing.
create policy estimate_shares_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'estimate-shares'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Writing is still restricted to the owning company, keyed on the first path
-- segment exactly as job-media is.
create policy estimate_shares_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'estimate-shares'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

create policy estimate_shares_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'estimate-shares'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  )
  with check (
    bucket_id = 'estimate-shares'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Delete IS allowed here, unlike job-media: revoking a shared link is a thing a
-- contractor must be able to do, and the underlying estimate row is untouched.
create policy estimate_shares_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'estimate-shares'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Where the published copy lives, so the link can be shown again and revoked.
alter table public.estimates add column if not exists share_path text;
