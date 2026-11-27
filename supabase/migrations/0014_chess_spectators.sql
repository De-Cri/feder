-- =============================================================================
-- Chess spectators: friends of a player can watch the game live.
--
--   - Who: a member who is a friend of at least one of the two players and isn't
--     blocked by (and doesn't block) either of them.
--   - What: ongoing games only. A finished game stays readable for 10 minutes, so
--     that whoever is watching gets the final move and the result (realtime checks
--     RLS on the new row) and then it disappears for them.
--   - Read only: every write goes through the chess_* functions, which still accept
--     only the two players (private.chess_mine).
-- =============================================================================

create or replace function public.chess_can_watch(p_white uuid, p_black uuid, p_status text, p_updated timestamptz)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and auth.uid() not in (p_white, p_black)
     and (p_status = 'active' or (p_status = 'over' and p_updated > now() - interval '10 minutes'))
     and (public.are_friends(auth.uid(), p_white) or public.are_friends(auth.uid(), p_black))
     and not public.is_blocked(auth.uid(), p_white)
     and not public.is_blocked(auth.uid(), p_black);
$$;
-- used by the policy below; harmless as an RPC (it only tells you what you can already see)
revoke execute on function public.chess_can_watch(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.chess_can_watch(uuid, uuid, text, timestamptz) to authenticated;

drop policy chess_games_select on public.chess_games;
create policy chess_games_select on public.chess_games for select to authenticated
  using (public.is_member() and (auth.uid() in (white, black)
                                 or public.chess_can_watch(white, black, status, updated_at)));

create index chess_games_active_idx on public.chess_games (updated_at desc) where status = 'active';
