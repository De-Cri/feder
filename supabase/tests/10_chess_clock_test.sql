\set ON_ERROR_STOP 1
-- Chess clock (0013). Runs after 09. a and b are founders (friends).
set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;
-- moves the clock of game g back by n seconds (as if that much time had passed)
create function pg_temp.wait(n int) returns void language sql as $$
  update public.chess_games set last_move_at = last_move_at - make_interval(secs => n)
  where id = current_setting('test.game')::bigint $$;
create function pg_temp.g() returns public.chess_games language sql as
  $$ select * from public.chess_games where id = current_setting('test.game')::bigint $$;

select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err(format('select public.chess_challenge(%L, %L, 10)', pg_temp.uid('0b'), 'white')) = 'chess_invalid_time', 'too short'; end $$;
-- 3+2, a white
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'), 'white', 180, 2)::text, false);
select pg_temp.as_user('0b');
select public.chess_respond(current_setting('test.game')::bigint, true);
do $$ begin assert (pg_temp.g()).white_ms = 180000 and (pg_temp.g()).black_ms = 180000, 'start'; end $$;

-- first moves are free, even if slow
reset role; select pg_temp.wait(500); set role authenticated;
select pg_temp.as_user('0a');
select public.chess_move(current_setting('test.game')::bigint, 0, 'e2e4');
select pg_temp.as_user('0b');
select public.chess_move(current_setting('test.game')::bigint, 1, 'e7e5');
do $$ begin assert (pg_temp.g()).white_ms = 180000 and (pg_temp.g()).black_ms = 180000, 'no clock yet'; end $$;

-- a thinks 10 s: 180 - 10 + 2 = 172 s
reset role; select pg_temp.wait(10); set role authenticated;
select pg_temp.as_user('0a');
select public.chess_move(current_setting('test.game')::bigint, 2, 'g1f3');
do $$ begin assert (pg_temp.g()).white_ms between 171900 and 172000, 'increment ' || (pg_temp.g()).white_ms; end $$;

-- b still has time: no timeout claim
do $$ begin assert pg_temp.err(format('select public.chess_timeout(%s)', current_setting('test.game'))) = 'chess_not_timeout', 'early claim'; end $$;
-- b runs out: a claims, a wins on time
reset role; select pg_temp.wait(181); set role authenticated;
select public.chess_timeout(current_setting('test.game')::bigint);
do $$ begin assert (pg_temp.g()).result || (pg_temp.g()).reason = '1-0timeout' and (pg_temp.g()).black_ms = 0, 'flag'; end $$;

-- moving too late loses too (the move isn't played)
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'), 'black', 60, 0)::text, false);
select pg_temp.as_user('0b');
select public.chess_respond(current_setting('test.game')::bigint, true);
select public.chess_move(current_setting('test.game')::bigint, 0, 'd2d4');
select pg_temp.as_user('0a');
select public.chess_move(current_setting('test.game')::bigint, 1, 'd7d5');
reset role; select pg_temp.wait(61); set role authenticated;
select pg_temp.as_user('0b');
select public.chess_move(current_setting('test.game')::bigint, 2, 'c2c4');
do $$ begin assert (pg_temp.g()).result || (pg_temp.g()).reason = '0-1timeout' and cardinality((pg_temp.g()).moves) = 2, 'late move'; end $$;

-- no clock: as before
select set_config('test.game', public.chess_challenge(pg_temp.uid('0a'))::text, false);
do $$ begin assert (pg_temp.g()).time_base is null, 'untimed'; end $$;
select public.chess_cancel(current_setting('test.game')::bigint);

reset role;
delete from public.chess_games;
select 'chess clock ok' as result;
