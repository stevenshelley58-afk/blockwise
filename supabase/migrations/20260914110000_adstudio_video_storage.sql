-- Ad Builder Video: private storage bucket.
--
-- Bucket configuration mirrors adbuilder-customer-images: private, with a
-- declared file size ceiling and an allowed MIME list enforced by the storage
-- API itself rather than only by application code.
--
-- file_size_limit is the absolute refusal point. A source between the 500 MB
-- optimisation threshold and this ceiling is accepted, kept unchanged, and
-- given a resized derivative, so a customer's phone footage is not rejected
-- just for being large.
--
-- Deliberately NO policy on storage.objects for this bucket.
--
-- Uploads and downloads are mediated by authenticated Next.js routes holding
-- the service role, exactly like the existing customer image path. Adding a
-- storage.objects policy would let a browser client reach the object store
-- directly, which is a wider surface than this feature needs, and the bucket
-- already carries its own type and size enforcement. Object paths still begin
-- with the workspace id, so private.workspace_id_from_storage_path() resolves
-- the owning workspace if a policy is ever added here.
--
-- The bucket is private, so nothing is reachable without authorisation, and a
-- read is served as a short-lived signed link issued only after the caller's
-- workspace scope is re-checked.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adbuilder-video',
  'adbuilder-video',
  false,
  2147483648,
  array[
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The storage schema is owned by the storage API and is not exposed through
-- PostgREST. No grants are added here: the service role already reaches the
-- bucket, and the browser role must not.
