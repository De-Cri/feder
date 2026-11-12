-- =============================================================================
-- Cut-over to server-relayed signaling and pokes (apply together with the release
-- that uses 0006): the lobby and voice channels keep only presence.
-- Client broadcasts are no longer possible anywhere, so signaling and pokes can
-- only go through voice_signal / poke, with the sender set by the server.
-- 0.4.7 clients can't make calls or send pokes anymore until they update.
-- =============================================================================

drop policy if exists realtime_members_select on realtime.messages;
drop policy if exists realtime_members_insert on realtime.messages;

create policy realtime_members_select on realtime.messages for select to authenticated
  using (
    public.is_member()
    and (
      (extension = 'presence' and public.realtime_topic_allowed(realtime.topic()))
      or (extension = 'broadcast' and realtime.topic() = 'cerchio:user:' || auth.uid()::text)
    )
  );
create policy realtime_members_insert on realtime.messages for insert to authenticated
  with check (
    public.is_member()
    and extension = 'presence'
    and public.realtime_topic_allowed(realtime.topic())
  );
