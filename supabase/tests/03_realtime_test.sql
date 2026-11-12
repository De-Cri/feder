\set ON_ERROR_STOP 1
-- Private realtime channels (0005, 0007). Runs after 01 and 02: a and b are members, c isn't.
set role authenticated;
create function pg_temp.can(topic text, ext text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', coalesce(topic, ''), false);
  insert into realtime.messages (topic, extension) values (topic, ext);
  return true;
exception when insufficient_privilege then
  return false;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert pg_temp.can('cerchio:lobby', 'presence'), 'lobby presence';
  assert pg_temp.can('cerchio:voice:3', 'presence'), 'canale vocale 3';
  assert pg_temp.can('cerchio:voice:4', 'presence'), 'canale vocale 4';
  -- after 0007 nobody can broadcast from a client: signaling and pokes go through the server
  assert not pg_temp.can('cerchio:lobby', 'broadcast'), 'lobby broadcast (old pokes)';
  assert not pg_temp.can('cerchio:voice:3', 'broadcast'), 'voice broadcast (old signaling)';
  assert not pg_temp.can('cerchio:user:00000000-0000-0000-0000-00000000000b', 'broadcast'), 'writing to a personal channel';
  assert not pg_temp.can('cerchio:voice:1', 'broadcast'), 'canale di testo come vocale';
  assert not pg_temp.can('cerchio:voice:99', 'broadcast'), 'canale vocale inesistente';
  assert not pg_temp.can('dm:segreto', 'broadcast'), 'canale inventato';
  assert not pg_temp.can(null, 'broadcast'), 'senza topic';
  assert not pg_temp.can('cerchio:lobby', 'postgres_changes'), 'estensione non usata';
end $$;
-- reading: only the allowed channels
select set_config('realtime.topic', 'dm:segreto', false);
do $$ begin assert (select count(*) from realtime.messages) = 0, 'legge un canale inventato'; end $$;
select set_config('realtime.topic', 'cerchio:lobby', false);
do $$ begin assert (select count(*) from realtime.messages) > 0, 'non legge la lobby'; end $$;

-- c isn't a member: not even the lobby
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin assert not pg_temp.can('cerchio:lobby', 'presence'), 'non membro nella lobby'; end $$;

select 'realtime ok' as result;
