\set ON_ERROR_STOP 1
-- Canali realtime privati (0005_realtime_topics.sql). Gira dopo 01 e 02: a e b sono membri, c no.
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
  assert pg_temp.can('cerchio:lobby', 'broadcast'), 'lobby broadcast (poke)';
  assert pg_temp.can('cerchio:voice:3', 'broadcast'), 'canale vocale 3';
  assert pg_temp.can('cerchio:voice:4', 'presence'), 'canale vocale 4';
  assert not pg_temp.can('cerchio:voice:1', 'broadcast'), 'canale di testo come vocale';
  assert not pg_temp.can('cerchio:voice:99', 'broadcast'), 'canale vocale inesistente';
  assert not pg_temp.can('dm:segreto', 'broadcast'), 'canale inventato';
  assert not pg_temp.can(null, 'broadcast'), 'senza topic';
  assert not pg_temp.can('cerchio:lobby', 'postgres_changes'), 'estensione non usata';
end $$;
-- lettura: solo i canali permessi
select set_config('realtime.topic', 'dm:segreto', false);
do $$ begin assert (select count(*) from realtime.messages) = 0, 'legge un canale inventato'; end $$;
select set_config('realtime.topic', 'cerchio:lobby', false);
do $$ begin assert (select count(*) from realtime.messages) > 0, 'non legge la lobby'; end $$;

-- c non è membro: nemmeno la lobby
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin assert not pg_temp.can('cerchio:lobby', 'presence'), 'non membro nella lobby'; end $$;

select 'realtime ok' as result;
