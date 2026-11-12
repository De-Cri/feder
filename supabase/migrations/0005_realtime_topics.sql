-- =============================================================================
-- Private realtime channels: only the ones the app really uses.
--
-- Before, every member could join and write to ANY private channel.
-- Now only:
--   cerchio:lobby         online presence and pokes
--   cerchio:voice:<id>    signaling and presence of an existing voice channel
-- and only with broadcast and presence. The cerchio-db and feder-dm channels aren't
-- private: they use postgres_changes, protected by the tables' RLS.
-- =============================================================================

create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_topic = 'cerchio:lobby'
      or exists (
        select 1 from public.channels c
        where c.kind = 'voice' and p_topic = 'cerchio:voice:' || c.id::text
      );
$$;
revoke execute on function public.realtime_topic_allowed(text) from public, anon;
grant execute on function public.realtime_topic_allowed(text) to authenticated;

drop policy if exists realtime_members_select on realtime.messages;
drop policy if exists realtime_members_insert on realtime.messages;

create policy realtime_members_select on realtime.messages for select to authenticated
  using (
    public.is_member()
    and extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed(realtime.topic())
  );
create policy realtime_members_insert on realtime.messages for insert to authenticated
  with check (
    public.is_member()
    and extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed(realtime.topic())
  );
