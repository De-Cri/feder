-- =============================================================================
-- Chess clock: time control chosen with the challenge (e.g. 3+2 = 3 minutes, +2 s per move).
--
--   - time_base (seconds) null = no clock. time_inc = seconds added after each move.
--   - white_ms / black_ms: time left at the last move; last_move_at: when the clock
--     of the side to move started. The server keeps time (the clients only show it).
--   - The clock starts after both first moves (like lichess): before that it doesn't run.
--   - Moving with no time left, or chess_timeout when the side to move has run out,
--     ends the game: the other side wins on time.
-- =============================================================================

alter table public.chess_games
  add column time_base    int check (time_base is null or time_base between 30 and 7200),
  add column time_inc     int not null default 0 check (time_inc between 0 and 60),
  add column white_ms     int,
  add column black_ms     int,
  add column last_move_at timestamptz;

alter table public.chess_games drop constraint chess_games_reason_check;
alter table public.chess_games add constraint chess_games_reason_check
  check (reason in ('checkmate', 'resign', 'stalemate', 'agreed', 'insufficient',
                    'repetition', 'fifty', 'aborted', 'timeout'));

-- The server's clock, to show the remaining time right on PCs whose clock is off.
create or replace function public.server_now()
returns timestamptz
language sql stable
as $$ select clock_timestamp(); $$;

-- Milliseconds the side to move has used since its clock started (0 before both first moves).
create or replace function private.chess_elapsed(p_row public.chess_games)
returns int
language sql volatile
set search_path = ''
as $$
  select case
    when p_row.time_base is null or cardinality(p_row.moves) < 2 or p_row.last_move_at is null then 0
    else floor(extract(epoch from clock_timestamp() - p_row.last_move_at) * 1000)::int
  end;
$$;

drop function public.chess_challenge(uuid, text);
create or replace function public.chess_challenge(p_user uuid, p_color text default 'random',
                                                  p_base int default null, p_inc int default 0)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_white boolean;
  v_id bigint;
begin
  if v_me is null or not public.is_member() then raise exception 'forbidden'; end if;
  if p_user is null or p_user = v_me or not exists (select 1 from public.members where user_id = p_user) then
    raise exception 'chess_invalid_user';
  end if;
  if not public.are_friends(v_me, p_user) or public.is_blocked(v_me, p_user) then
    raise exception 'chess_not_friend';
  end if;
  if p_color not in ('white', 'black', 'random') then raise exception 'chess_invalid_color'; end if;
  if (p_base is not null and p_base not between 30 and 7200) or coalesce(p_inc, -1) not between 0 and 60 then
    raise exception 'chess_invalid_time';
  end if;

  -- old challenges nobody answered
  update public.chess_games set status = 'cancelled', updated_at = now()
  where status = 'pending' and created_at < now() - interval '1 day';

  if exists (select 1 from public.chess_games
             where status = 'pending' and least(white, black) = least(v_me, p_user)
               and greatest(white, black) = greatest(v_me, p_user)) then
    raise exception 'chess_already_pending';
  end if;
  if (select count(*) from public.chess_games
      where status = 'active' and v_me in (white, black)) >= 10 then
    raise exception 'chess_too_many';
  end if;
  if not private.rate_ok('chess', interval '1 hour', 30) then raise exception 'chess_rate_limited'; end if;

  v_white := case p_color when 'white' then true when 'black' then false else random() < 0.5 end;
  insert into public.chess_games (white, black, challenger, time_base, time_inc)
  values (case when v_white then v_me else p_user end,
          case when v_white then p_user else v_me end, v_me,
          p_base, case when p_base is null then 0 else p_inc end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.chess_respond(p_game bigint, p_accept boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
begin
  if v_row.status <> 'pending' or v_row.challenger = auth.uid() then raise exception 'chess_not_found'; end if;
  if v_row.created_at < now() - interval '1 day' then raise exception 'chess_not_found'; end if;
  update public.chess_games
  set status = case when p_accept then 'active' else 'declined' end,
      white_ms = v_row.time_base * 1000,
      black_ms = v_row.time_base * 1000,
      last_move_at = clock_timestamp(),
      updated_at = now()
  where id = p_game;
end;
$$;

create or replace function public.chess_move(p_game bigint, p_ply int, p_move text, p_end text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
  v_n int := cardinality(v_row.moves);
  v_me_white boolean := v_row.white = auth.uid();
  v_left int;
begin
  if v_row.status <> 'active' then raise exception 'chess_not_active'; end if;
  if p_ply is distinct from v_n then raise exception 'chess_out_of_sync'; end if;
  if (v_n % 2 = 0) <> v_me_white then raise exception 'chess_not_your_turn'; end if;
  if p_move is null or p_move !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'chess_bad_move'; end if;
  if p_end is not null and p_end not in ('checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty') then
    raise exception 'chess_bad_end';
  end if;
  if v_n >= 1000 then raise exception 'chess_too_long'; end if;

  if v_row.time_base is not null then
    v_left := case when v_me_white then v_row.white_ms else v_row.black_ms end - private.chess_elapsed(v_row);
    if v_left <= 0 then
      -- too late: the move doesn't count, the game is lost on time
      update public.chess_games
      set status = 'over', reason = 'timeout', draw_offer = null, updated_at = now(),
          result = case when v_me_white then '0-1' else '1-0' end,
          white_ms = case when v_me_white then 0 else white_ms end,
          black_ms = case when v_me_white then black_ms else 0 end
      where id = p_game;
      return;
    end if;
    if v_n >= 2 then v_left := v_left + v_row.time_inc * 1000; end if;
  end if;

  update public.chess_games
  set moves = moves || p_move,
      draw_offer = null,
      status = case when p_end is null then 'active' else 'over' end,
      result = case
        when p_end is null then null
        when p_end = 'checkmate' then case when v_me_white then '1-0' else '0-1' end
        else '1/2-1/2' end,
      reason = p_end,
      white_ms = case when v_me_white and v_left is not null then v_left else white_ms end,
      black_ms = case when not v_me_white and v_left is not null then v_left else black_ms end,
      last_move_at = clock_timestamp(),
      updated_at = now()
  where id = p_game;
end;
$$;

-- Either player: the side to move has run out of time → it loses.
create or replace function public.chess_timeout(p_game bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
  v_white_moves boolean := cardinality(v_row.moves) % 2 = 0;
begin
  if v_row.status <> 'active' or v_row.time_base is null then raise exception 'chess_not_active'; end if;
  if (case when v_white_moves then v_row.white_ms else v_row.black_ms end) - private.chess_elapsed(v_row) > 0 then
    raise exception 'chess_not_timeout';
  end if;
  update public.chess_games
  set status = 'over', reason = 'timeout', draw_offer = null, updated_at = now(),
      result = case when v_white_moves then '0-1' else '1-0' end,
      white_ms = case when v_white_moves then 0 else white_ms end,
      black_ms = case when v_white_moves then black_ms else 0 end
  where id = p_game;
end;
$$;

revoke execute on function private.chess_elapsed(public.chess_games) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.chess_challenge(uuid, text, int, int)', 'public.chess_timeout(bigint)', 'public.server_now()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
