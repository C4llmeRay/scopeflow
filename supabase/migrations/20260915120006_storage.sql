-- ScopeFlow — media storage.
--
-- Photo originals, their derivatives, and voice note audio. Private: a claim
-- photo shows the inside of somebody's house, and a public bucket would make
-- every one of them reachable by anyone who guesses a path.
--
-- Object keys are `<company_id>/<job_id>/<file>`, so the first path segment is
-- the tenant. The policies below key on exactly that, which makes storage
-- access follow the same rule as every table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-media',
  'job-media',
  false,
  -- 50 MB. A full-resolution phone photo is a few MB; this leaves room for
  -- longer voice notes without letting a bug upload something absurd.
  52428800,
  array['image/jpeg', 'image/png', 'image/heic', 'audio/m4a', 'audio/mpeg']
)
on conflict (id) do nothing;

create policy job_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-media'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

create policy job_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-media'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Uploads are retried, and a retry re-uploads the same key, so update has to be
-- allowed or an interrupted upload could never be resumed.
create policy job_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'job-media'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  )
  with check (
    bucket_id = 'job-media'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- No delete policy by design. Photos are evidence: a deleted photo is
-- soft-deleted in the photos table, and the bytes stay put.
