-- Exact, case-insensitive name lookup across verified registered launches.
-- This is called by the Edge Function with its service-role key; browsers
-- never receive direct table or RPC access.
create or replace function public.hmonhook_launches_by_name(lookup_name text)
returns table (
  mint text,
  signature text,
  creator text,
  name text,
  symbol text,
  metadata_uri text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.mint, l.signature, l.creator, l.name, l.symbol, l.metadata_uri, l.created_at
  from public.hmonhook_launches as l
  where lower(l.name) = lower(lookup_name)
  order by l.created_at desc
  limit 100;
$$;

revoke all on function public.hmonhook_launches_by_name(text) from public, anon, authenticated;
grant execute on function public.hmonhook_launches_by_name(text) to service_role;
