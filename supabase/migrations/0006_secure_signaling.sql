-- =============================================================================
-- Server-relayed signaling and pokes (fixes #23 and the poke part of #24).
--
-- Before: call signaling and pokes were client broadcasts on shared channels,
-- so every member received everyone's messages and could forge the sender.
-- Now:
--   - voice_rooms: who is in which voice channel, written only by voice_join /
--     voice_leave with auth.uid(); clients use it to validate room presence.
--   - voice_signal: relays signaling between two people in the same room, to
--     the recipient's personal channel only, with the sender set by the server.
--   - poke: same personal channel, sender set by the server, rate-limited.
--   - cerchio:user:<id>: personal realtime channel, readable only by its owner,
--     written only by these functions (realtime.send).
-- This migration only adds things: 0.4.7 clients keep working until
-- 0007_signaling_cutover.sql closes the old broadcast paths.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Voice room registry
-- -----------------------------------------------------------------------------
create table public.voice_rooms (
  user_id    uuid primary key references public.members (user_id) on delete cascade,
  channel_id smallint not null references public.channels (id),
  joined_at  timestamptz not null default now()
);

alter table public.voice_rooms enable row level security;
create policy voice_rooms_select on public.voice_rooms for select to authenticated
  using (public.is_member());
revoke all on public.voice_rooms from anon, authenticated;
grant select on public.voice_rooms to authenticated;
alter publication supabase_realtime add table public.voice_rooms;

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
  insert into public.voice_rooms (user_id, channel_id) values (auth.uid(), p_channel)
  on conflict (user_id) do update set channel_id = excluded.channel_id, joined_at = now();
end;
$$;

create or replace function public.voice_leave()
returns void
language sql volatile security definer
set search_path = ''
as $$
  delete from public.voice_rooms where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Signaling relay: an array of signals (offers, answers, ICE candidates…) in order.
-- -----------------------------------------------------------------------------
create or replace function public.voice_signal(p_to uuid, p_signals jsonb)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_mine smallint;
  v_peer smallint;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_signals) is distinct from 'array'
     or jsonb_array_length(p_signals) not between 1 and 200 then
    raise exception 'signal_invalid';
  end if;
  if pg_column_size(p_signals) > 65536 then raise exception 'signal_too_large'; end if;
  select channel_id into v_mine from public.voice_rooms where user_id = v_me;
  select channel_id into v_peer from public.voice_rooms where user_id = p_to;
  if v_mine is null or v_peer is null or v_mine <> v_peer or p_to = v_me then
    raise exception 'not_in_same_room';
  end if;
  perform realtime.send(
    jsonb_build_object('from', v_me, 'signals', p_signals),
    'signal', 'cerchio:user:' || p_to::text, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pokes: at most 1 every 3 s to the same person and 10 a minute per sender.
-- -----------------------------------------------------------------------------
create table private.poke_log (
  sender    uuid not null,
  recipient uuid not null,
  sent_at   timestamptz not null default now()
);
create index poke_log_idx on private.poke_log (sender, sent_at desc);

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

revoke execute on function public.voice_join(smallint) from public, anon;
revoke execute on function public.voice_leave() from public, anon;
revoke execute on function public.voice_signal(uuid, jsonb) from public, anon;
revoke execute on function public.poke(uuid, text) from public, anon;
grant execute on function public.voice_join(smallint) to authenticated;
grant execute on function public.voice_leave() to authenticated;
grant execute on function public.voice_signal(uuid, jsonb) to authenticated;
grant execute on function public.poke(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: everyone can also read their own personal channel (broadcast only).
-- Nobody can write to it from a client: only the functions above, via realtime.send.
-- -----------------------------------------------------------------------------
drop policy if exists realtime_members_select on realtime.messages;
create policy realtime_members_select on realtime.messages for select to authenticated
  using (
    public.is_member()
    and (
      (extension in ('broadcast', 'presence') and public.realtime_topic_allowed(realtime.topic()))
      or (extension = 'broadcast' and realtime.topic() = 'cerchio:user:' || auth.uid()::text)
    )
  );
