-- =============================================================================
-- Opening the server (phase 3 of docs/plan-open-server.md).
--
--   - join_open(): join without the password, as a 'public' member, up to
--     max_members (100) and only while server_config.open is on. It starts OFF:
--     the admin opens sign-ups from Settings → Server when ready.
--   - The password (join_server) stays as the founders' way in.
--   - server_status(): open/closed and how many members, for the join screen.
--   - voice_rooms gets mic/deaf/cam/screen: who is in which call is no longer
--     published in the lobby presence (every member reads it), but only here,
--     where RLS shows each room only to whoever can see its channel.
--   - Public members can post files up to 10 MB (founders 50 MB).
-- =============================================================================

alter table private.server_config add column open boolean not null default false;
alter table private.server_config alter column max_members set default 100;
update private.server_config set max_members = 100;

create or replace function public.server_status()
returns table (open boolean, members int, max_members int)
language sql stable security definer
set search_path = ''
as $$
  select c.open, (select count(*) from public.members)::int, c.max_members
  from private.server_config c where c.id;
$$;

create or replace function public.join_open()
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_open boolean;
  v_max  int;
begin
  if v_uid is null then return 'not_authenticated'; end if;
  if exists (select 1 from public.members where user_id = v_uid) then return 'already_member'; end if;
  if exists (select 1 from public.bans where user_id = v_uid) then return 'banned'; end if;
  select open, max_members into v_open, v_max from private.server_config where id;
  if v_open is null then return 'not_configured'; end if;
  if not v_open then return 'closed'; end if;
  -- one join at a time, so two people can't both take the last place
  perform pg_advisory_xact_lock(hashtextextended('join_open', 0));
  if (select count(*) from public.members) >= v_max then return 'server_full'; end if;
  insert into public.members (user_id, role, tier) values (v_uid, 'member', 'public');
  return 'ok';
end;
$$;

create or replace function public.admin_set_open(p_open boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update private.server_config set open = coalesce(p_open, false) where id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Call state in the room registry
-- -----------------------------------------------------------------------------
alter table public.voice_rooms
  add column mic    boolean not null default true,
  add column deaf   boolean not null default false,
  add column cam    boolean not null default false,
  add column screen boolean not null default false;

-- Updates your own state in the room you're in (nothing if you're not in one).
create or replace function public.voice_state(p_mic boolean, p_deaf boolean, p_cam boolean, p_screen boolean)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.voice_rooms
     set mic = coalesce(p_mic, true), deaf = coalesce(p_deaf, false),
         cam = coalesce(p_cam, false), screen = coalesce(p_screen, false)
   where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Attachments: 10 MB for public members (the free tier has 1 GB of storage)
-- -----------------------------------------------------------------------------
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    public.is_member()
    and author_id = auth.uid()
    and channel_id in (select c.id from public.channels c where c.kind = 'text')
    and public.can_see_channel(channel_id)
    and (attachment_path is null
         or attachment_path like (auth.uid()::text || '/%'))
    and (attachment_size is null
         or attachment_size <= case when public.is_founder() then 52428800 else 10485760 end)
  );

revoke execute on function public.server_status() from public, anon;
revoke execute on function public.join_open() from public, anon;
revoke execute on function public.admin_set_open(boolean) from public, anon;
revoke execute on function public.voice_state(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.server_status() to authenticated;
grant execute on function public.join_open() to authenticated;
grant execute on function public.admin_set_open(boolean) to authenticated;
grant execute on function public.voice_state(boolean, boolean, boolean, boolean) to authenticated;
