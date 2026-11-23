insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hmonhook-metadata', 'hmonhook-metadata', true, 2000000,
  array['image/png', 'image/jpeg', 'image/webp', 'application/json'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The Edge Function uploads with the service role. Do not add an anonymous
-- INSERT policy on storage.objects for this bucket.
