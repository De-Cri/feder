-- =============================================================================
-- Friends, private chats and invites (phase 1 of docs/plan-open-server.md).
--
--   - members.tier: 'founder' (whoever is in the server today, and whoever joins
--     with the password while it exists) or 'public' (open sign-ups, phase 3).
--   - channels.visibility:
--       public    everyone (#generale, #random)
--       founders  founders only (Lounge, Gaming)
--       private   only the people in channel_members (chats created by users)
--     can_see_channel() is the one place that decides, used by every policy below.
--   - friendships: founders are all friends with each other automatically.
--     Everyone else sends requests. DMs, pokes and chat invites need a friendship.
--   - Writes only through the functions at the bottom, with limits on the server.
--
-- Only adds things for current clients: 0.5.x keeps working (all current
-- members become founders, so they still see all 4 channels).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tiers
-- -----------------------------------------------------------------------------
alter table public.members
  add column tier text not null default 'founder' check (tier in ('founder', 'public'));

create or replace function public.is_founder()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.tier = 'founder');
$$;

-- -----------------------------------------------------------------------------
-- Channels: visibility, owner, ids for user-created chats
-- -----------------------------------------------------------------------------
create sequence public.channels_id_seq as smallint start 100 owned by public.channels.id;
alter table public.channels
  alter column id set default nextval('public.channels_id_seq'),
  alter column position set default 0,
  add column visibility text not null default 'private'
    check (visibility in ('public', 'founders', 'private')),
  add column owner_id   uuid references public.profiles (id) on delete set null,
  add column created_at timestamptz not null default now(),
  add constraint channels_name_check check (char_length(btrim(name)) between 1 and 32);

update public.channels set visibility = case when kind = 'text' then 'public' else 'founders' end
where id <= 4;

-- Deleting a chat takes its messages and voice registry with it.
alter table public.messages drop constraint messages_channel_id_fkey,
  add constraint messages_channel_id_fkey foreign key (channel_id)
    references public.channels (id) on delete cascade;
alter table public.voice_rooms drop constraint voice_rooms_channel_id_fkey,
  add constraint voice_rooms_channel_id_fkey foreign key (channel_id)
    references public.channels (id) on delete cascade;
create index messages_attachment_path_idx on public.messages (attachment_path)
  where attachment_path is not null;

create table public.channel_members (
  channel_id smallint not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.members (user_id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id);

create table public.channel_invites (
  id         bigint generated always as identity primary key,
  channel_id smallint not null references public.channels (id) on delete cascade,
  inviter    uuid not null references public.members (user_id) on delete cascade,
  invitee    uuid not null references public.members (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (channel_id, invitee)
);
create index channel_invites_invitee_idx on public.channel_invites (invitee);

-- -----------------------------------------------------------------------------
-- Friends and blocks (on profiles, so a kick doesn't wipe them)
-- -----------------------------------------------------------------------------
create table public.friendships (
  user_lo      uuid not null references public.profiles (id) on delete cascade,
  user_hi      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_lo, user_hi),
  check (user_lo < user_hi),
  check (requested_by in (user_lo, user_hi))
);
create index friendships_hi_idx on public.friendships (user_hi);

create table public.blocks (
  blocker    uuid not null references public.profiles (id) on delete cascade,
  blocked    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Anti-spam log for friend requests and invites.
create table private.social_log (
  sender  uuid not null,
  kind    text not null,
  sent_at timestamptz not null default now()
);
create index social_log_idx on private.social_log (sender, kind, sent_at desc);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_lo = least(p_a, p_b) and f.user_hi = greatest(p_a, p_b) and f.status = 'accepted'
  );
$$;

create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a)
  );
$$;

-- The single rule for who sees a channel (and so its messages, files, voice room).
create or replace function public.can_see_channel(p_channel smallint)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_member() and exists (
    select 1 from public.channels c
    where c.id = p_channel
      and (c.visibility = 'public'
           or (c.visibility = 'founders' and public.is_founder())
           or (c.visibility = 'private' and exists (
                 select 1 from public.channel_members cm
                 where cm.channel_id = c.id and cm.user_id = auth.uid())))
  );
$$;

create or replace function private.rate_ok(p_kind text, p_window interval, p_max int)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('social:' || auth.uid()::text, 0));
  if (select count(*) from private.social_log
      where sender = auth.uid() and kind = p_kind and sent_at > clock_timestamp() - p_window) >= p_max then
    return false;
  end if;
  insert into private.social_log (sender, kind, sent_at) values (auth.uid(), p_kind, clock_timestamp());
  delete from private.social_log where sent_at < now() - interval '1 day';
  return true;
end;
$$;

-- Founders are all friends: whoever becomes a founder is friends with every other founder.
create or replace function private.befriend_founders()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.tier = 'founder' and (tg_op = 'INSERT' or old.tier is distinct from 'founder') then
    insert into public.friendships (user_lo, user_hi, status, requested_by)
    select least(new.user_id, m.user_id), greatest(new.user_id, m.user_id), 'accepted', new.user_id
    from public.members m
    where m.tier = 'founder' and m.user_id <> new.user_id
    on conflict (user_lo, user_hi) do update set status = 'accepted';
  end if;
  return new;
end;
$$;

create trigger members_befriend_founders
  after insert or update of tier on public.members
  for each row execute function private.befriend_founders();

-- Today's members: all founders, all friends.
insert into public.friendships (user_lo, user_hi, status, requested_by)
select a.user_id, b.user_id, 'accepted', a.user_id
from public.members a join public.members b on a.user_id < b.user_id
on conflict (user_lo, user_hi) do update set status = 'accepted';

-- When someone leaves a chat (or is kicked from the server): the oldest member
-- becomes owner; with nobody left, the chat is deleted.
create or replace function private.chat_member_gone()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  delete from public.voice_rooms where user_id = old.user_id and channel_id = old.channel_id;
  if old.role <> 'owner' or not exists (select 1 from public.channels where id = old.channel_id) then
    return old;
  end if;
  select user_id into v_next from public.channel_members
  where channel_id = old.channel_id order by joined_at, user_id limit 1;
  if v_next is null then
    delete from public.channels where id = old.channel_id;
  else
    update public.channel_members set role = 'owner' where channel_id = old.channel_id and user_id = v_next;
    update public.channels set owner_id = v_next where id = old.channel_id;
  end if;
  return old;
end;
$$;

create trigger channel_members_gone
  after delete on public.channel_members
  for each row execute function private.chat_member_gone();

-- -----------------------------------------------------------------------------
-- Limits
-- -----------------------------------------------------------------------------
-- chats owned per user: 10. People per chat (members + pending invites):
-- voice 8 (P2P mesh: everyone sends to everyone), text 25.
create or replace function private.chat_capacity(p_channel smallint)
returns int
language sql stable security definer
set search_path = ''
as $$
  select case c.kind when 'voice' then 8 else 25 end
       - (select count(*) from public.channel_members where channel_id = c.id)::int
       - (select count(*) from public.channel_invites where channel_id = c.id)::int
  from public.channels c where c.id = p_channel;
$$;

-- -----------------------------------------------------------------------------
-- Friends: functions
-- -----------------------------------------------------------------------------
-- Sends a request, or accepts theirs if they already asked you. Returns the new status.
create or replace function public.friend_request(p_user uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.friendships;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_user is null or p_user = v_me
     or not exists (select 1 from public.members where user_id = p_user) then
    raise exception 'friend_invalid_user';
  end if;
  if public.is_blocked(v_me, p_user) then raise exception 'friend_blocked'; end if;

  select * into v_row from public.friendships
  where user_lo = least(v_me, p_user) and user_hi = greatest(v_me, p_user);
  if v_row.status = 'accepted' then return 'accepted'; end if;
  if v_row.status = 'pending' then
    if v_row.requested_by = v_me then return 'pending'; end if;
    update public.friendships set status = 'accepted'
    where user_lo = v_row.user_lo and user_hi = v_row.user_hi;
    return 'accepted';
  end if;

  if not private.rate_ok('friend', interval '1 hour', 20) then raise exception 'friend_rate_limited'; end if;
  insert into public.friendships (user_lo, user_hi, status, requested_by)
  values (least(v_me, p_user), greatest(v_me, p_user), 'pending', v_me);
  return 'pending';
end;
$$;

create or replace function public.friend_respond(p_user uuid, p_accept boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.friendships
                 where user_lo = least(v_me, p_user) and user_hi = greatest(v_me, p_user)
                   and status = 'pending' and requested_by = p_user) then
    raise exception 'friend_no_request';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted'
    where user_lo = least(v_me, p_user) and user_hi = greatest(v_me, p_user);
  else
    delete from public.friendships where user_lo = least(v_me, p_user) and user_hi = greatest(v_me, p_user);
  end if;
end;
$$;

-- Removes a friend, or cancels a request in either direction.
-- Pending chat invites between the two go away too.
create or replace function public.friend_remove(p_user uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  delete from public.friendships where user_lo = least(v_me, p_user) and user_hi = greatest(v_me, p_user);
  delete from public.channel_invites
  where (inviter = v_me and invitee = p_user) or (inviter = p_user and invitee = v_me);
end;
$$;

create or replace function public.user_block(p_user uuid, p_on boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_user is null or p_user = v_me then raise exception 'friend_invalid_user'; end if;
  if p_on then
    insert into public.blocks (blocker, blocked) values (v_me, p_user) on conflict do nothing;
    perform public.friend_remove(p_user);
  else
    delete from public.blocks where blocker = v_me and blocked = p_user;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Private chats: functions
-- -----------------------------------------------------------------------------
create or replace function private.chat_owner_check(p_channel smallint)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.channel_members
                 where channel_id = p_channel and user_id = auth.uid() and role = 'owner') then
    raise exception 'chat_not_owner';
  end if;
end;
$$;

create or replace function public.chat_invite(p_channel smallint, p_user uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform private.chat_owner_check(p_channel);
  if p_user is null or p_user = v_me or not public.are_friends(v_me, p_user) then
    raise exception 'chat_not_friend';
  end if;
  if exists (select 1 from public.channel_members where channel_id = p_channel and user_id = p_user) then
    raise exception 'chat_already_member';
  end if;
  if exists (select 1 from public.channel_invites where channel_id = p_channel and invitee = p_user) then
    return; -- already invited
  end if;
  if private.chat_capacity(p_channel) <= 0 then raise exception 'chat_full'; end if;
  if not private.rate_ok('invite', interval '1 hour', 40) then raise exception 'chat_rate_limited'; end if;
  insert into public.channel_invites (channel_id, inviter, invitee) values (p_channel, v_me, p_user);
end;
$$;

create or replace function public.chat_create(p_name text, p_kind text, p_invitees uuid[] default '{}')
returns smallint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_id smallint;
  v_user uuid;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_kind not in ('text', 'voice') then raise exception 'chat_invalid_kind'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 32 then raise exception 'chat_invalid_name'; end if;
  if (select count(*) from public.channels where owner_id = v_me and visibility = 'private') >= 10 then
    raise exception 'chat_too_many';
  end if;
  if not private.rate_ok('chat', interval '1 hour', 10) then raise exception 'chat_rate_limited'; end if;

  insert into public.channels (name, kind, visibility, owner_id)
  values (btrim(p_name), p_kind, 'private', v_me) returning id into v_id;
  insert into public.channel_members (channel_id, user_id, role) values (v_id, v_me, 'owner');
  foreach v_user in array coalesce(p_invitees, '{}') loop
    perform public.chat_invite(v_id, v_user);
  end loop;
  return v_id;
end;
$$;

create or replace function public.invite_respond(p_invite bigint, p_accept boolean)
returns smallint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_inv public.channel_invites;
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  delete from public.channel_invites where id = p_invite and invitee = auth.uid() returning * into v_inv;
  if v_inv.id is null then raise exception 'invite_not_found'; end if;
  if p_accept then
    -- the invite was already counted in the capacity: deleting it freed its place
    insert into public.channel_members (channel_id, user_id) values (v_inv.channel_id, auth.uid())
    on conflict do nothing;
  end if;
  return v_inv.channel_id;
end;
$$;

-- The owner withdraws an invite.
create or replace function public.invite_cancel(p_invite bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_channel smallint;
begin
  select channel_id into v_channel from public.channel_invites where id = p_invite;
  if v_channel is null then raise exception 'invite_not_found'; end if;
  perform private.chat_owner_check(v_channel);
  delete from public.channel_invites where id = p_invite;
end;
$$;

create or replace function public.chat_leave(p_channel smallint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = auth.uid();
end;
$$;

create or replace function public.chat_remove(p_channel smallint, p_user uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.chat_owner_check(p_channel);
  if p_user = auth.uid() then raise exception 'chat_remove_self'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = p_user;
end;
$$;

create or replace function public.chat_rename(p_channel smallint, p_name text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.chat_owner_check(p_channel);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 32 then raise exception 'chat_invalid_name'; end if;
  update public.channels set name = btrim(p_name) where id = p_channel;
end;
$$;

-- Deletes the chat with its messages. Uploaded files stay in storage
-- (Supabase doesn't allow deleting them from SQL): the app removes the owner's own.
create or replace function public.chat_delete(p_channel smallint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.chat_owner_check(p_channel);
  delete from public.channels where id = p_channel and visibility = 'private';
end;
$$;

-- -----------------------------------------------------------------------------
-- Existing functions that now depend on visibility or friendship
-- -----------------------------------------------------------------------------
create or replace function public.voice_join(p_channel smallint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.channels c where c.id = p_channel and c.kind = 'voice') then
    raise exception 'not_a_voice_channel';
  end if;
  if not public.can_see_channel(p_channel) then raise exception 'forbidden'; end if;
  insert into public.voice_rooms (user_id, channel_id) values (auth.uid(), p_channel)
  on conflict (user_id) do update set channel_id = excluded.channel_id, joined_at = now();
end;
$$;

create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_topic = 'cerchio:lobby'
      or exists (
        select 1 from public.channels c
        where c.kind = 'voice' and p_topic = 'cerchio:voice:' || c.id::text
          and public.can_see_channel(c.id)
      );
$$;

-- DMs and pokes: friends only (founders are all friends, so nothing changes for them).
-- Same body as 0004/0006, plus the friendship check.
create or replace function public.dm_send(p_to uuid, p_body text, p_iv text, p_recipient_pub text)
returns public.dm_messages
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_spub text;
  v_rpub text;
  v_row  public.dm_messages;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_to is null or p_to = v_me then raise exception 'dm_invalid_recipient'; end if;
  if not exists (select 1 from public.members where user_id = p_to) then
    raise exception 'dm_invalid_recipient';
  end if;
  if not public.are_friends(v_me, p_to) then raise exception 'dm_not_friends'; end if;

  select public_key into v_spub from public.dm_keys where user_id = v_me;
  if v_spub is null then raise exception 'dm_no_key'; end if;
  select public_key into v_rpub from public.dm_keys where user_id = p_to;
  if v_rpub is null then raise exception 'dm_recipient_no_key'; end if;
  if v_rpub is distinct from p_recipient_pub then raise exception 'dm_key_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended('dm:' || v_me::text, 0));

  if (select count(*) from public.dm_messages
      where sender = v_me and created_at > clock_timestamp() - interval '5 seconds') >= 5
  or (select count(*) from public.dm_messages
      where sender = v_me and created_at > clock_timestamp() - interval '1 minute') >= 60 then
    raise exception 'dm_rate_limited';
  end if;
  if (select count(distinct recipient) from public.dm_messages
      where sender = v_me and recipient <> p_to
        and created_at > clock_timestamp() - interval '2 minutes') >= 3 then
    raise exception 'dm_too_many_people';
  end if;

  insert into public.dm_messages (sender, recipient, sender_pub, recipient_pub, iv, body, created_at)
  values (v_me, p_to, v_spub, v_rpub, p_iv, p_body, clock_timestamp())
  returning * into v_row;

  perform private.dm_purge();
  return v_row;
end;
$$;

create or replace function public.poke(p_to uuid, p_text text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_to = v_me or not exists (select 1 from public.members where user_id = p_to) then
    raise exception 'poke_invalid_recipient';
  end if;
  if not public.are_friends(v_me, p_to) then raise exception 'poke_not_friends'; end if;
  if char_length(coalesce(p_text, '')) > 120 then raise exception 'poke_too_long'; end if;

  perform pg_advisory_xact_lock(hashtextextended('poke:' || v_me::text, 0));
  if exists (select 1 from private.poke_log
             where sender = v_me and recipient = p_to and sent_at > clock_timestamp() - interval '3 seconds')
  or (select count(*) from private.poke_log
      where sender = v_me and sent_at > clock_timestamp() - interval '1 minute') >= 10 then
    raise exception 'poke_rate_limited';
  end if;
  insert into private.poke_log (sender, recipient, sent_at) values (v_me, p_to, clock_timestamp());
  delete from private.poke_log where sent_at < now() - interval '1 hour';

  perform realtime.send(
    jsonb_build_object('from', v_me, 'text', coalesce(p_text, '')),
    'poke', 'cerchio:user:' || p_to::text, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
drop policy channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (public.can_see_channel(id));

drop policy messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.can_see_channel(channel_id));
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    public.is_member()
    and author_id = auth.uid()
    and channel_id in (select c.id from public.channels c where c.kind = 'text')
    and public.can_see_channel(channel_id)
    and (attachment_path is null
         or attachment_path like (auth.uid()::text || '/%'))
  );

drop policy voice_rooms_select on public.voice_rooms;
create policy voice_rooms_select on public.voice_rooms for select to authenticated
  using (public.can_see_channel(channel_id));

alter table public.channel_members enable row level security;
alter table public.channel_invites enable row level security;
alter table public.friendships     enable row level security;
alter table public.blocks          enable row level security;

create policy channel_members_select on public.channel_members for select to authenticated
  using (public.can_see_channel(channel_id));
-- invites: whoever sent or received them, and the chat's owner
create policy channel_invites_select on public.channel_invites for select to authenticated
  using (
    public.is_member() and (
      auth.uid() in (inviter, invitee)
      or exists (select 1 from public.channel_members cm
                 where cm.channel_id = channel_invites.channel_id
                   and cm.user_id = auth.uid() and cm.role = 'owner'))
  );
create policy friendships_select on public.friendships for select to authenticated
  using (public.is_member() and auth.uid() in (user_lo, user_hi));
create policy blocks_select on public.blocks for select to authenticated
  using (blocker = auth.uid());

revoke all on public.channel_members, public.channel_invites, public.friendships, public.blocks
  from anon, authenticated;
grant select on public.channel_members, public.channel_invites, public.friendships, public.blocks
  to authenticated;

-- An invitee must see the chat's name before accepting: only through this function.
create or replace function public.my_invites()
returns table (id bigint, channel_id smallint, channel_name text, kind text,
               inviter uuid, invitee uuid, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.channel_id, c.name, c.kind, i.inviter, i.invitee, i.created_at
  from public.channel_invites i join public.channels c on c.id = i.channel_id
  where public.is_member() and auth.uid() in (i.inviter, i.invitee)
  order by i.created_at desc;
$$;

-- Attachments: readable only by whoever can see the message's channel.
-- Avatars live in the same bucket and stay visible to every member; your own files always.
drop policy attachments_select on storage.objects;
create policy attachments_select on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_member()
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.avatar_path = name)
      or exists (select 1 from public.messages m
                 where m.attachment_path = name and public.can_see_channel(m.channel_id))
    )
  );

-- -----------------------------------------------------------------------------
-- Permissions on the functions
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.is_founder()', 'public.are_friends(uuid, uuid)', 'public.is_blocked(uuid, uuid)',
    'public.can_see_channel(smallint)', 'public.friend_request(uuid)',
    'public.friend_respond(uuid, boolean)', 'public.friend_remove(uuid)',
    'public.user_block(uuid, boolean)', 'public.chat_invite(smallint, uuid)',
    'public.chat_create(text, text, uuid[])', 'public.invite_respond(bigint, boolean)',
    'public.invite_cancel(bigint)', 'public.chat_leave(smallint)',
    'public.chat_remove(smallint, uuid)', 'public.chat_rename(smallint, text)',
    'public.chat_delete(smallint)', 'public.my_invites()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Realtime: changes reach only who can see them (postgres_changes respects RLS)
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.channels, public.channel_members, public.channel_invites, public.friendships;
