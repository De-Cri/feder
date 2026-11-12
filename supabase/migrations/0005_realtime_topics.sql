-- =============================================================================
-- Canali realtime privati: solo quelli che l'app usa davvero.
--
-- Prima ogni membro poteva iscriversi e scrivere su QUALSIASI canale privato.
-- Ora solo:
--   cerchio:lobby         presenza online e poke
--   cerchio:voice:<id>    signaling e presenza di un canale vocale esistente
-- e solo con broadcast e presence. I canali cerchio-db e feder-dm non sono
-- privati: usano postgres_changes, protetto dall'RLS delle tabelle.
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
