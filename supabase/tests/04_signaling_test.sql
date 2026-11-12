\set ON_ERROR_STOP 1
-- Server-relayed signaling and pokes (0006, 0007). Runs after 01–03:
-- a (admin), b, d, e, f, g are members; c isn't.
set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;
-- broadcasts the user can read on their personal channel
create function pg_temp.inbox(ev text) returns bigint language sql as $$
  select count(*) from realtime.messages where payload->>'event' = ev $$;

-- not in a room: no signaling
select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err($q$select public.voice_signal('00000000-0000-0000-0000-00000000000b', '[{"x":1}]')$q$) = 'not_in_same_room'; end $$;
do $$ begin assert pg_temp.err($q$select public.voice_join(1::smallint)$q$) = 'not_a_voice_channel', 'join a text channel'; end $$;

-- a and b in channel 3, d in channel 4
select public.voice_join(3::smallint);
select pg_temp.as_user('0b'); select public.voice_join(3::smallint);
select pg_temp.as_user('0d'); select public.voice_join(4::smallint);
do $$ begin assert (select count(*) from public.voice_rooms) = 3, 'members see the registry'; end $$;
do $$ begin assert pg_temp.err($q$insert into public.voice_rooms (user_id, channel_id) values (auth.uid(), 3)$q$) like 'permission denied%', 'direct write'; end $$;

-- a → b in the same room: delivered to b's personal channel only, with the real sender
select pg_temp.as_user('0a');
select public.voice_signal('00000000-0000-0000-0000-00000000000b', '[{"description":{"type":"offer"}},{"candidate":null}]');
do $$ begin assert pg_temp.err($q$select public.voice_signal('00000000-0000-0000-0000-00000000000d', '[{"x":1}]')$q$) = 'not_in_same_room', 'different room'; end $$;
do $$ begin assert pg_temp.err($q$select public.voice_signal('00000000-0000-0000-0000-00000000000b', '{"x":1}')$q$) = 'signal_invalid', 'not an array'; end $$;
do $$ begin assert pg_temp.err($q$select public.voice_signal('00000000-0000-0000-0000-00000000000b', '[]')$q$) = 'signal_invalid', 'empty'; end $$;
do $$ begin assert pg_temp.err(format($q$select public.voice_signal('00000000-0000-0000-0000-00000000000b', '[%s]')$q$, '"' || repeat('x', 70000) || '"')) = 'signal_too_large', 'too large'; end $$;

select pg_temp.as_user('0b');
select set_config('realtime.topic', 'cerchio:user:00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert pg_temp.inbox('signal') = 1, 'b reads its signal'; end $$;
do $$ begin assert (select payload->>'from' from realtime.messages where payload->>'event' = 'signal') = '00000000-0000-0000-0000-00000000000a', 'sender set by the server'; end $$;
-- d can't read b's personal channel
select pg_temp.as_user('0d');
do $$ begin assert pg_temp.inbox('signal') = 0, 'd reads b''s signals'; end $$;
select set_config('realtime.topic', 'cerchio:voice:3', false);
do $$ begin assert pg_temp.inbox('signal') = 0, 'signals visible on the voice channel'; end $$;

-- leaving the room stops the relay
select pg_temp.as_user('0b'); select public.voice_leave();
select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err($q$select public.voice_signal('00000000-0000-0000-0000-00000000000b', '[{"x":1}]')$q$) = 'not_in_same_room', 'b left'; end $$;

-- pokes: server sender, personal channel, rate limits
select public.poke('00000000-0000-0000-0000-00000000000b', 'ciao');
do $$ begin assert pg_temp.err($q$select public.poke('00000000-0000-0000-0000-00000000000b', 'again')$q$) = 'poke_rate_limited', '3 s per recipient'; end $$;
do $$ begin assert pg_temp.err($q$select public.poke('00000000-0000-0000-0000-00000000000a', 'me')$q$) = 'poke_invalid_recipient', 'self'; end $$;
do $$ begin assert pg_temp.err($q$select public.poke('00000000-0000-0000-0000-00000000000c', 'x')$q$) = 'poke_invalid_recipient', 'non member'; end $$;
do $$ begin assert pg_temp.err(format($q$select public.poke('00000000-0000-0000-0000-00000000000d', '%s')$q$, repeat('x', 121))) = 'poke_too_long'; end $$;
select pg_temp.as_user('0b');
select set_config('realtime.topic', 'cerchio:user:00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert pg_temp.inbox('poke') = 1, 'b got the poke'; end $$;
do $$ begin assert (select payload->>'from' from realtime.messages where payload->>'event' = 'poke') = '00000000-0000-0000-0000-00000000000a', 'poke sender set by the server'; end $$;

-- 10 pokes a minute per sender
select pg_temp.as_user('0e');
do $$ declare r text; i int; begin
  for i in 1..10 loop
    r := pg_temp.err(format($q$select public.poke('%s', 'p')$q$, (array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-000000000010'])[1 + (i - 1) % 5]));
    if i <= 5 then assert r = 'ok', 'poke ' || i || ': ' || r; end if;
  end loop;
  assert pg_temp.err($q$select public.poke('00000000-0000-0000-0000-000000000010', 'p')$q$) = 'poke_rate_limited', '10 a minute';
end $$;

-- non member: nothing works
select pg_temp.as_user('0c');
do $$ begin assert pg_temp.err($q$select public.voice_join(3::smallint)$q$) = 'forbidden'; end $$;
do $$ begin assert pg_temp.err($q$select public.poke('00000000-0000-0000-0000-00000000000a', 'x')$q$) = 'forbidden'; end $$;

-- a kicked member leaves the registry
reset role;
delete from public.members where user_id = '00000000-0000-0000-0000-00000000000d';
do $$ begin assert not exists (select 1 from public.voice_rooms where user_id = '00000000-0000-0000-0000-00000000000d'), 'kicked member still in a room'; end $$;

select 'signaling ok' as result;
