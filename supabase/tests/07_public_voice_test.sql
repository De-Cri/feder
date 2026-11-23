\set ON_ERROR_STOP 1
-- "Public Channel": a voice channel everyone sees, at most 10 people on the server (0010). Runs after 01–06.
set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.topic_ok(topic text) returns boolean language sql as
  $$ select public.realtime_topic_allowed(topic) $$;

-- a public member sees it and can join, founders too
select pg_temp.as_user('60');
do $$ begin assert (select name from public.channels where id = 5) = 'Public Channel'; end $$;
do $$ begin assert pg_temp.topic_ok('cerchio:voice:5'), 'public on the topic'; end $$;
select public.voice_join(5::smallint);
select pg_temp.as_user('0a');
select public.voice_join(5::smallint);
do $$ begin assert (select count(*) from public.voice_rooms where channel_id = 5) = 2, 'founder sees who is inside'; end $$;

-- full at 10 (yourself not counted, so rejoining doesn't lock you out)
reset role;
delete from public.voice_rooms;
insert into public.voice_rooms (user_id, channel_id)
select user_id, 5 from public.members where user_id not in (pg_temp.uid('60'), pg_temp.uid('0b')) limit 10;
set role authenticated;
select pg_temp.as_user('60');
do $$ begin assert pg_temp.err($q$select public.voice_join(5::smallint)$q$) = 'voice_full', 'eleventh person'; end $$;
-- the founders' rooms have no such limit
select pg_temp.as_user('0b');
do $$ begin assert pg_temp.err($q$select public.voice_join(3::smallint)$q$) = 'ok', 'founders room'; end $$;
-- 0a + 9 others inside: 0a can join again, a newcomer can't
reset role;
delete from public.voice_rooms where channel_id = 5 and user_id <> pg_temp.uid('0a');
insert into public.voice_rooms (user_id, channel_id)
select user_id, 5 from public.members where user_id not in (pg_temp.uid('60'), pg_temp.uid('0a'), pg_temp.uid('0b')) limit 9
on conflict (user_id) do update set channel_id = 5;
set role authenticated;
select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err($q$select public.voice_join(5::smallint)$q$) = 'ok', 'tenth rejoins'; end $$;
select pg_temp.as_user('60');
do $$ begin assert pg_temp.err($q$select public.voice_join(5::smallint)$q$) = 'voice_full', 'still full'; end $$;
reset role;
delete from public.voice_rooms;

select 'public voice ok' as result;
