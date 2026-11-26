\set ON_ERROR_STOP 1
-- Chess between friends (0012). Runs after 01–08. a and b are founders (friends); 71 is a stranger.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000071', 'c1@x', '{"username":"chess1"}');
insert into public.members (user_id, tier) values ('00000000-0000-0000-0000-000000000071', 'public');

set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;

-- only friends
select pg_temp.as_user('71');
do $$ begin assert pg_temp.err(format('select public.chess_challenge(%L)', pg_temp.uid('0a'))) = 'chess_not_friend', 'stranger'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_challenge(%L)', pg_temp.uid('71'))) = 'chess_invalid_user', 'yourself'; end $$;
do $$ begin assert pg_temp.err($q$insert into public.chess_games (white, black, challenger) values (auth.uid(), auth.uid(), auth.uid())$q$) like 'permission denied%', 'direct write'; end $$;

-- a challenges b as white; one pending challenge per pair
select pg_temp.as_user('0a');
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'), 'white')::text, false);
do $$ begin assert pg_temp.err(format('select public.chess_challenge(%L)', pg_temp.uid('0b'))) = 'chess_already_pending', 'twice'; end $$;
do $$ begin assert (select white from public.chess_games where id = current_setting('test.game')::bigint) = pg_temp.uid('0a'), 'color'; end $$;
-- the challenger can't accept their own challenge, nor move before it's accepted
do $$ begin assert pg_temp.err(format('select public.chess_respond(%s, true)', current_setting('test.game'))) = 'chess_not_found', 'self accept'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 0, %L)', current_setting('test.game'), 'e2e4')) = 'chess_not_active', 'move pending'; end $$;

-- the stranger doesn't see it nor touch it
select pg_temp.as_user('71');
do $$ begin assert (select count(*) from public.chess_games) = 0, 'stranger sees'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_respond(%s, true)', current_setting('test.game'))) = 'chess_not_found', 'stranger accepts'; end $$;

-- b accepts
select pg_temp.as_user('0b');
do $$ begin assert (select count(*) from public.chess_games) = 1, 'b sees'; end $$;
select public.chess_respond(current_setting('test.game')::bigint, true);
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 0, %L)', current_setting('test.game'), 'e7e5')) = 'chess_not_your_turn', 'black first'; end $$;

select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 0, %L)', current_setting('test.game'), 'e2e9')) = 'chess_bad_move', 'format'; end $$;
select public.chess_move(current_setting('test.game')::bigint, 0, 'e2e4');
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 1, %L)', current_setting('test.game'), 'd2d4')) = 'chess_not_your_turn', 'twice in a row'; end $$;

select pg_temp.as_user('0b');
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 0, %L)', current_setting('test.game'), 'e7e5')) = 'chess_out_of_sync', 'stale ply'; end $$;
select public.chess_move(current_setting('test.game')::bigint, 1, 'e7e5');

-- draw: offer, a move clears it; offer + counter-offer = agreed
select public.chess_draw(current_setting('test.game')::bigint, true);
select pg_temp.as_user('0a');
select public.chess_move(current_setting('test.game')::bigint, 2, 'g1f3');
do $$ begin assert (select draw_offer from public.chess_games where id = current_setting('test.game')::bigint) is null, 'move clears offer'; end $$;
select public.chess_draw(current_setting('test.game')::bigint, true);
select pg_temp.as_user('0b');
select public.chess_draw(current_setting('test.game')::bigint, true);
do $$ begin assert (select result || reason from public.chess_games where id = current_setting('test.game')::bigint) = '1/2-1/2agreed', 'agreed'; end $$;
do $$ begin assert pg_temp.err(format('select public.chess_move(%s, 3, %L)', current_setting('test.game'), 'b8c6')) = 'chess_not_active', 'after the end'; end $$;

-- new game: checkmate claimed by the mover, resign by the loser
select set_config('test.game', public.chess_challenge(pg_temp.uid('0a'), 'black')::text, false);
select pg_temp.as_user('0a');
select public.chess_respond(current_setting('test.game')::bigint, true);
select public.chess_move(current_setting('test.game')::bigint, 0, 'f2f3');
select pg_temp.as_user('0b');
select public.chess_move(current_setting('test.game')::bigint, 1, 'e7e5');
select pg_temp.as_user('0a');
select public.chess_move(current_setting('test.game')::bigint, 2, 'g2g4');
select pg_temp.as_user('0b');
select public.chess_move(current_setting('test.game')::bigint, 3, 'd8h4', 'checkmate');
do $$ begin assert (select result || reason from public.chess_games where id = current_setting('test.game')::bigint) = '0-1checkmate', 'mate'; end $$;

select set_config('test.game', public.chess_challenge(pg_temp.uid('0a'))::text, false);
select pg_temp.as_user('0a');
select public.chess_respond(current_setting('test.game')::bigint, true);
select public.chess_resign(current_setting('test.game')::bigint);
do $$ begin assert (select reason from public.chess_games where id = current_setting('test.game')::bigint) = 'aborted', 'abort before moves'; end $$;

-- decline and cancel
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'))::text, false);
select pg_temp.as_user('0b');
select public.chess_respond(current_setting('test.game')::bigint, false);
select pg_temp.as_user('0a');
select set_config('test.game', public.chess_challenge(pg_temp.uid('0b'))::text, false);
select public.chess_cancel(current_setting('test.game')::bigint);
do $$ begin assert (select string_agg(status, ',' order by id) from public.chess_games) = 'over,over,over,declined,cancelled', 'statuses'; end $$;

-- standings: a drew 1, lost 1 (the aborted game doesn't count); b won 1, drew 1; strangers aren't there
do $$ begin assert (select string_agg(format('%s:%s/%s/%s=%s', right(user_id::text, 2), won, drawn, lost, points), ' ')
  from public.chess_standings() where user_id in (pg_temp.uid('0a'), pg_temp.uid('0b'))) = '0b:1/1/0=4 0a:0/1/1=1', 'standings'; end $$;
do $$ begin assert not exists (select 1 from public.chess_standings() where user_id = pg_temp.uid('71')), 'stranger in standings'; end $$;

reset role;
delete from public.chess_games;
select 'chess ok' as result;
