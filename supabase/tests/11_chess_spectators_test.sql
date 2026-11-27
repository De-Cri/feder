\set ON_ERROR_STOP 1
-- Chess spectators (0014). Runs after 09 and 10. a and b are founders (friends).
-- 72: friend of a only. 73: stranger. 74: friend of a, but blocked by b.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000072', 'w1@x', '{"username":"watch1"}'),
 ('00000000-0000-0000-0000-000000000073', 'w2@x', '{"username":"watch2"}'),
 ('00000000-0000-0000-0000-000000000074', 'w3@x', '{"username":"watch3"}');
insert into public.members (user_id, tier) values
 ('00000000-0000-0000-0000-000000000072', 'public'),
 ('00000000-0000-0000-0000-000000000073', 'public'),
 ('00000000-0000-0000-0000-000000000074', 'public');
insert into public.friendships (user_lo, user_hi, status, requested_by) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000072', 'accepted', '00000000-0000-0000-0000-00000000000a'),
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000074', 'accepted', '00000000-0000-0000-0000-00000000000a');
insert into public.blocks (blocker, blocked) values
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000074');

set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.sees() returns bigint language sql as
  $$ select count(*) from public.chess_games where id = current_setting('test.game')::bigint $$;

-- a challenges b: a pending challenge is only for the two players
select pg_temp.as_user('0a');
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'), 'white')::text, false);
select pg_temp.as_user('72');
do $$ begin assert pg_temp.sees() = 0, 'spectator sees a challenge'; end $$;

-- accepted: the friend of a watches, the stranger and the blocked friend don't
select pg_temp.as_user('0b');
select public.chess_respond(current_setting('test.game')::bigint, true);
select pg_temp.as_user('72');
do $$ begin assert pg_temp.sees() = 1, 'friend can''t watch'; end $$;
select pg_temp.as_user('73');
do $$ begin assert pg_temp.sees() = 0, 'stranger watches'; end $$;
select pg_temp.as_user('74');
do $$ begin assert pg_temp.sees() = 0, 'blocked friend watches'; end $$;

-- watching is read only
select pg_temp.as_user('72');
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 0, %L)', current_setting('test.game'), 'e2e4')) = 'chess_not_found', 'spectator moves'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_resign(%s)', current_setting('test.game'))) = 'chess_not_found', 'spectator resigns'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_draw(%s, true)', current_setting('test.game'))) = 'chess_not_found', 'spectator offers a draw'; end $$;
do $$ begin assert pg_temp.err(format('update public.chess_games set moves = %L where id = %s', '{e2e4}', current_setting('test.game'))) like 'permission denied%', 'direct write'; end $$;

-- the game ends: still visible for a while (the final move reaches spectators), then gone
select pg_temp.as_user('0a');
select public.chess_resign(current_setting('test.game')::bigint);
select pg_temp.as_user('72');
do $$ begin assert pg_temp.sees() = 1, 'result not visible'; end $$;
reset role;
update public.chess_games set updated_at = now() - interval '11 minutes' where id = current_setting('test.game')::bigint;
set role authenticated;
select pg_temp.as_user('72');
do $$ begin assert pg_temp.sees() = 0, 'old game still visible'; end $$;
-- the players keep it
select pg_temp.as_user('0b');
do $$ begin assert pg_temp.sees() = 1, 'player lost the game'; end $$;

reset role;
delete from public.chess_games;
select 'chess spectators ok' as result;
