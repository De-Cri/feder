-- =============================================================================
-- Chess between friends.
--
--   - chess_games: one row per game. Only the two players can read it.
--   - Moves are UCI strings (e2e4, e7e8q) in order. The client checks that a move
--     is legal (both players run the same rules); the server checks that it is the
--     caller's turn, that the ply count matches (no double moves, no races) and
--     that the move is well formed.
--   - Writes only through the functions below. Realtime: postgres_changes (RLS).
--   - A challenge is answered with chess_respond; it expires after a day.
-- =============================================================================

create table public.chess_games (
  id          bigint generated always as identity primary key,
  white       uuid not null references public.profiles (id) on delete cascade,
  black       uuid not null references public.profiles (id) on delete cascade,
  challenger  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'active', 'over', 'declined', 'cancelled')),
  moves       text[] not null default '{}',
  result      text check (result in ('1-0', '0-1', '1/2-1/2')),
  reason      text check (reason in ('checkmate', 'resign', 'stalemate', 'agreed',
                                     'insufficient', 'repetition', 'fifty', 'aborted')),
  draw_offer  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (white <> black),
  check (challenger in (white, black)),
  check (cardinality(moves) <= 1000)
);
create index chess_games_white_idx on public.chess_games (white, updated_at desc);
create index chess_games_black_idx on public.chess_games (black, updated_at desc);

alter table public.chess_games enable row level security;
create policy chess_games_select on public.chess_games for select to authenticated
  using (public.is_member() and auth.uid() in (white, black));
revoke all on public.chess_games from anon, authenticated;
grant select on public.chess_games to authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The caller's game, locked; raises if it doesn't exist or isn't theirs.
create or replace function private.chess_mine(p_game bigint)
returns public.chess_games
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games;
begin
  if auth.uid() is null or not public.is_member() then raise exception 'forbidden'; end if;
  select * into v_row from public.chess_games where id = p_game for update;
  if v_row.id is null or auth.uid() not in (v_row.white, v_row.black) then
    raise exception 'chess_not_found';
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
-- Challenges a friend. p_color: the challenger's color ('white', 'black', 'random').
create or replace function public.chess_challenge(p_user uuid, p_color text default 'random')
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
  insert into public.chess_games (white, black, challenger)
  values (case when v_white then v_me else p_user end,
          case when v_white then p_user else v_me end, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- The challenged player accepts or declines.
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
  set status = case when p_accept then 'active' else 'declined' end, updated_at = now()
  where id = p_game;
end;
$$;

-- The challenger withdraws a challenge nobody answered yet.
create or replace function public.chess_cancel(p_game bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
begin
  if v_row.status <> 'pending' or v_row.challenger <> auth.uid() then raise exception 'chess_not_found'; end if;
  update public.chess_games set status = 'cancelled', updated_at = now() where id = p_game;
end;
$$;

-- Plays a move. p_ply = how many moves the caller has seen (must match the server).
-- p_end: the move ends the game ('checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty').
create or replace function public.chess_move(p_game bigint, p_ply int, p_move text, p_end text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
  v_n int := cardinality(v_row.moves);
  v_me_white boolean := v_row.white = auth.uid();
begin
  if v_row.status <> 'active' then raise exception 'chess_not_active'; end if;
  if p_ply is distinct from v_n then raise exception 'chess_out_of_sync'; end if;
  if (v_n % 2 = 0) <> v_me_white then raise exception 'chess_not_your_turn'; end if;
  if p_move is null or p_move !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'chess_bad_move'; end if;
  if p_end is not null and p_end not in ('checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty') then
    raise exception 'chess_bad_end';
  end if;
  if v_n >= 1000 then raise exception 'chess_too_long'; end if;

  update public.chess_games
  set moves = moves || p_move,
      draw_offer = null,
      status = case when p_end is null then 'active' else 'over' end,
      result = case
        when p_end is null then null
        when p_end = 'checkmate' then case when v_me_white then '1-0' else '0-1' end
        else '1/2-1/2' end,
      reason = p_end,
      updated_at = now()
  where id = p_game;
end;
$$;

-- Resigns (or aborts, if nobody has moved on the board yet: ply < 2).
create or replace function public.chess_resign(p_game bigint)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
begin
  if v_row.status <> 'active' then raise exception 'chess_not_active'; end if;
  if cardinality(v_row.moves) < 2 then
    update public.chess_games set status = 'over', reason = 'aborted', draw_offer = null, updated_at = now()
    where id = p_game;
  else
    update public.chess_games
    set status = 'over', reason = 'resign', draw_offer = null, updated_at = now(),
        result = case when v_row.white = auth.uid() then '0-1' else '1-0' end
    where id = p_game;
  end if;
end;
$$;

-- Offers a draw (p_on = true), or withdraws/declines the pending offer (false).
-- Offering when the opponent already offered = draw agreed.
create or replace function public.chess_draw(p_game bigint, p_on boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row public.chess_games := private.chess_mine(p_game);
begin
  if v_row.status <> 'active' then raise exception 'chess_not_active'; end if;
  if not p_on then
    update public.chess_games set draw_offer = null, updated_at = now() where id = p_game;
  elsif v_row.draw_offer is not null and v_row.draw_offer <> auth.uid() then
    update public.chess_games
    set status = 'over', result = '1/2-1/2', reason = 'agreed', draw_offer = null, updated_at = now()
    where id = p_game;
  else
    update public.chess_games set draw_offer = auth.uid(), updated_at = now() where id = p_game;
  end if;
end;
$$;

-- Standings of you and your friends, football style: win 3, draw 1, loss 0.
-- Counts every finished game of each person (aborted games have no result and don't count).
-- Only the totals: nobody sees the games of others.
create or replace function public.chess_standings()
returns table (user_id uuid, won int, drawn int, lost int, points int)
language sql stable security definer
set search_path = ''
as $$
  with people as (
    select auth.uid() as id where public.is_member()
    union
    select case when f.user_lo = auth.uid() then f.user_hi else f.user_lo end
    from public.friendships f
    where public.is_member() and f.status = 'accepted' and auth.uid() in (f.user_lo, f.user_hi)
  ), res as (
    select g.white as id, case g.result when '1-0' then 'w' when '0-1' then 'l' else 'd' end as r
    from public.chess_games g where g.status = 'over' and g.result is not null
    union all
    select g.black, case g.result when '0-1' then 'w' when '1-0' then 'l' else 'd' end
    from public.chess_games g where g.status = 'over' and g.result is not null
  )
  select p.id,
         (count(*) filter (where r.r = 'w'))::int,
         (count(*) filter (where r.r = 'd'))::int,
         (count(*) filter (where r.r = 'l'))::int,
         (3 * count(*) filter (where r.r = 'w') + count(*) filter (where r.r = 'd'))::int
  from people p left join res r on r.id = p.id
  group by p.id
  order by 5 desc, 2 desc;
$$;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
revoke execute on function private.chess_mine(bigint) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.chess_challenge(uuid, text)', 'public.chess_respond(bigint, boolean)',
    'public.chess_cancel(bigint)', 'public.chess_move(bigint, int, text, text)',
    'public.chess_resign(bigint)', 'public.chess_draw(bigint, boolean)', 'public.chess_standings()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

alter publication supabase_realtime add table public.chess_games;
