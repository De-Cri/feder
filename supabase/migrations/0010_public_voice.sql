-- =============================================================================
-- 0010: a voice channel for everyone, "Public Channel".
--   - Founders keep Lounge and Gaming; public members had no voice channel on
--     the left at all, only the ones they create themselves.
--   - At most 10 people in a public voice room (P2P mesh: everyone sends to
--     everyone). The app already stops at 8 using live presence; this is the
--     server's safety net, a bit higher because a crashed client can leave its
--     row behind until it joins again.
-- Only adds things: 0.6.x clients show the new channel like the others.
-- =============================================================================

insert into public.channels (id, name, kind, position, visibility)
values (5, 'Public Channel', 'voice', 5, 'public')
on conflict (id) do nothing;

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
  if exists (select 1 from public.channels c where c.id = p_channel and c.visibility = 'public')
     and (select count(*) from public.voice_rooms r
          where r.channel_id = p_channel and r.user_id <> auth.uid()) >= 10 then
    raise exception 'voice_full';
  end if;
  insert into public.voice_rooms (user_id, channel_id) values (auth.uid(), p_channel)
  on conflict (user_id) do update set channel_id = excluded.channel_id, joined_at = now();
end;
$$;
