-- =============================================================================
-- Cerchio — schema iniziale
-- Un solo server, 4 canali fissi (2 testo, 2 voce/video), un admin.
-- Tutto l'accesso passa da RLS: chi non ha inserito la password del server
-- (cioè non è in public.members) non vede e non scrive niente.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tabelle
-- -----------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique
              check (username ~ '^[a-z0-9_.]{3,20}$'),
  avatar_path text,
  created_at  timestamptz not null default now()
);

create table public.members (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now()
);

create table public.bans (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  reason    text,
  banned_at timestamptz not null default now()
);

create table public.channels (
  id       smallint primary key,
  name     text not null,
  kind     text not null check (kind in ('text', 'voice')),
  position smallint not null
);

insert into public.channels (id, name, kind, position) values
  (1, 'generale',  'text',  1),
  (2, 'random',    'text',  2),
  (3, 'Lounge',    'voice', 3),
  (4, 'Gaming',    'voice', 4);

create table public.messages (
  id              bigint generated always as identity primary key,
  channel_id      smallint not null references public.channels (id),
  author_id       uuid references public.profiles (id) on delete set null,
  content         text not null default '' check (char_length(content) <= 4000),
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  created_at      timestamptz not null default now(),
  check (content <> '' or attachment_path is not null)
);
create index messages_channel_id_idx on public.messages (channel_id, id desc);

-- Mute imposto dall'admin nei canali vocali (lato client: il muto non trasmette
-- e tutti gli altri ignorano comunque il suo audio).
create table public.voice_mutes (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  muted_at   timestamptz not null default now()
);

-- Configurazione privata (non esposta via API).
create table private.server_config (
  id            boolean primary key default true check (id),
  password_hash text not null,
  max_members   int not null default 12
);

create table private.join_attempts (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
create index join_attempts_idx on private.join_attempts (user_id, attempted_at desc);

-- -----------------------------------------------------------------------------
-- Helper
-- -----------------------------------------------------------------------------

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- Crea il profilo alla registrazione (username dai metadata).
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
  if v_username !~ '^[a-z0-9_.]{3,20}$' then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 15) || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;
  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Ingresso nel server con password
-- Ritorna uno stato invece di sollevare eccezioni, così il tentativo resta
-- registrato (rate limit: 5 tentativi ogni 15 minuti).
-- -----------------------------------------------------------------------------

create or replace function public.join_server(p_password text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_hash     text;
  v_max      int;
  v_attempts int;
begin
  if v_uid is null then
    return 'not_authenticated';
  end if;
  if exists (select 1 from public.members where user_id = v_uid) then
    return 'already_member';
  end if;
  if exists (select 1 from public.bans where user_id = v_uid) then
    return 'banned';
  end if;

  select count(*) into v_attempts
  from private.join_attempts
  where user_id = v_uid and attempted_at > now() - interval '15 minutes';
  if v_attempts >= 5 then
    return 'too_many_attempts';
  end if;
  insert into private.join_attempts (user_id) values (v_uid);

  select password_hash, max_members into v_hash, v_max
  from private.server_config where id;
  if v_hash is null then
    return 'not_configured';
  end if;
  if extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    return 'wrong_password';
  end if;
  if (select count(*) from public.members) >= v_max then
    return 'server_full';
  end if;

  insert into public.members (user_id, role) values (v_uid, 'member');
  delete from private.join_attempts where user_id = v_uid;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- Funzioni admin
-- -----------------------------------------------------------------------------

create or replace function public.admin_kick(p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_kick_self'; end if;
  delete from public.members where user_id = p_user;
  delete from public.voice_mutes where user_id = p_user;
end;
$$;

create or replace function public.admin_ban(p_user uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_ban_self'; end if;
  insert into public.bans (user_id, reason) values (p_user, p_reason)
    on conflict (user_id) do update set reason = excluded.reason, banned_at = now();
  delete from public.members where user_id = p_user;
  delete from public.voice_mutes where user_id = p_user;
end;
$$;

create or replace function public.admin_unban(p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.bans where user_id = p_user;
end;
$$;

create or replace function public.admin_set_password(p_password text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  update private.server_config
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10))
   where id;
end;
$$;

create or replace function public.admin_set_voice_mute(p_user uuid, p_muted boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_muted then
    insert into public.voice_mutes (user_id) values (p_user) on conflict do nothing;
  else
    delete from public.voice_mutes where user_id = p_user;
  end if;
end;
$$;

-- Usata solo dallo script di setup (con service_role / SQL editor).
create or replace function private.configure_server(p_password text, p_admin uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into private.server_config (id, password_hash)
  values (true, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set password_hash = excluded.password_hash;

  if p_admin is not null then
    insert into public.members (user_id, role) values (p_admin, 'admin')
    on conflict (user_id) do update set role = 'admin';
  end if;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.join_server(text) from public, anon;
revoke execute on function public.admin_kick(uuid) from public, anon;
revoke execute on function public.admin_ban(uuid, text) from public, anon;
revoke execute on function public.admin_unban(uuid) from public, anon;
revoke execute on function public.admin_set_password(text) from public, anon;
revoke execute on function public.admin_set_voice_mute(uuid, boolean) from public, anon;
grant execute on function public.join_server(text) to authenticated;
grant execute on function public.admin_kick(uuid) to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;
grant execute on function public.admin_set_password(text) to authenticated;
grant execute on function public.admin_set_voice_mute(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.members     enable row level security;
alter table public.bans        enable row level security;
alter table public.channels    enable row level security;
alter table public.messages    enable row level security;
alter table public.voice_mutes enable row level security;

-- profiles: il proprio sempre; tutti gli altri solo se sei membro.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- members: i membri vedono la lista; il proprio stato sempre (per sapere se sei dentro).
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member());

-- bans: solo admin; il diretto interessato vede il proprio ban.
create policy bans_select on public.bans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy channels_select on public.channels for select to authenticated
  using (public.is_member());

create policy messages_select on public.messages for select to authenticated
  using (public.is_member());
create policy messages_insert on public.messages for insert to authenticated
  with check (
    public.is_member()
    and author_id = auth.uid()
    and channel_id in (select c.id from public.channels c where c.kind = 'text')
    and (attachment_path is null
         or attachment_path like (auth.uid()::text || '/%'))
  );
create policy messages_delete on public.messages for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy voice_mutes_select on public.voice_mutes for select to authenticated
  using (public.is_member());

-- Supabase dà di default tutti i privilegi ad anon/authenticated: si riparte da zero.
revoke all on public.profiles, public.members, public.bans, public.channels,
              public.messages, public.voice_mutes from authenticated;
grant select on public.profiles, public.members, public.bans, public.channels,
                public.messages, public.voice_mutes to authenticated;
grant update (username, avatar_path) on public.profiles to authenticated;
grant insert (channel_id, author_id, content, attachment_path, attachment_name,
              attachment_mime, attachment_size) on public.messages to authenticated;
grant delete on public.messages to authenticated;
grant usage on sequence public.messages_id_seq to authenticated;
revoke all on public.profiles, public.members, public.bans, public.channels,
              public.messages, public.voice_mutes from anon;

-- -----------------------------------------------------------------------------
-- Storage: bucket privato per allegati e avatar (max 50 MB a file, limite free)
-- Path: <user_id>/<uuid>-<nome file>
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do nothing;

create policy attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member());
create policy attachments_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy attachments_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- -----------------------------------------------------------------------------
-- Realtime
-- postgres_changes per messaggi/membri/mute; canali privati (broadcast +
-- presence) per presenza online e signaling WebRTC, solo per i membri.
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.messages, public.members, public.voice_mutes, public.profiles;

create policy realtime_members_select on realtime.messages for select to authenticated
  using (public.is_member());
create policy realtime_members_insert on realtime.messages for insert to authenticated
  with check (public.is_member());
