-- User preferences synced between the desktop app and the browser.
create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_prefs_size check (pg_column_size(data) <= 16384)
);

alter table public.user_prefs enable row level security;

create policy "user_prefs: leggi le mie"
  on public.user_prefs for select to authenticated
  using (user_id = auth.uid());

create policy "user_prefs: crea le mie"
  on public.user_prefs for insert to authenticated
  with check (user_id = auth.uid());

create policy "user_prefs: modifica le mie"
  on public.user_prefs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());