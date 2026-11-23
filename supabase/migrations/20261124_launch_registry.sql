create table if not exists public.hmonhook_launches (
  mint text primary key check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signature text not null unique check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  creator text not null check (creator ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  name text not null check (char_length(name) between 1 and 32),
  symbol text not null check (char_length(symbol) between 1 and 13),
  metadata_uri text not null check (char_length(metadata_uri) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists hmonhook_launches_created_at_idx on public.hmonhook_launches (created_at desc);
create index if not exists hmonhook_launches_name_lower_idx on public.hmonhook_launches (lower(name));
alter table public.hmonhook_launches enable row level security;
revoke all on public.hmonhook_launches from anon, authenticated;

-- Only the Edge Function's service role can insert after verifying the Pump transaction.
-- Public reads are served by the Edge Function, with a bounded response size.
