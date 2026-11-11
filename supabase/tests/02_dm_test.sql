\set ON_ERROR_STOP 1
-- Messaggi privati (0004_dm.sql). Gira dopo 01_test.sql: a (admin) e b sono membri, c no.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000d', 'd@x', '{"username":"dora"}'),
 ('00000000-0000-0000-0000-00000000000e', 'e@x', '{"username":"elia"}'),
 ('00000000-0000-0000-0000-00000000000f', 'f@x', '{"username":"fede"}'),
 ('00000000-0000-0000-0000-000000000010', 'g@x', '{"username":"gino"}');
insert into public.members (user_id) values
 ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e'),
 ('00000000-0000-0000-0000-00000000000f'), ('00000000-0000-0000-0000-000000000010');

-- chiavi finte ma con lunghezze realistiche (base64)
create function pg_temp.k(tag text) returns text language sql as $$ select rpad(tag, 88, 'A') $$;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.set_key(tag text) returns void language sql as
  $$ select public.dm_set_key(pg_temp.k(tag), rpad('w', 208, 'W'), rpad('s', 24, 'S'), rpad('i', 16, 'I'), 600000) $$;

set role authenticated;

-- a senza chiave non può scrivere; chi non ha chiave non riceve
select pg_temp.as_user('0a');
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000b', 'x', rpad('i', 16, 'I'), pg_temp.k('B'));
    raise exception 'invio senza chiave';
  exception when raise_exception then if sqlerrm <> 'dm_no_key' then raise; end if; end;
end $$;
select pg_temp.set_key('A');
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000b', 'x', rpad('i', 16, 'I'), pg_temp.k('B'));
    raise exception 'invio a chi non ha chiave';
  exception when raise_exception then if sqlerrm <> 'dm_recipient_no_key' then raise; end if; end;
end $$;
do $$ begin assert (select count(*) from public.dm_my_key()) = 1, 'chiave propria non leggibile'; end $$;

select pg_temp.as_user('0b'); select pg_temp.set_key('B');
select pg_temp.as_user('0d'); select pg_temp.set_key('D');
select pg_temp.as_user('0e'); select pg_temp.set_key('E');
select pg_temp.as_user('0f'); select pg_temp.set_key('F');
select pg_temp.as_user('10'); select pg_temp.set_key('G');

-- la chiave privata cifrata degli altri non si legge, la pubblica sì
do $$ begin assert (select count(*) from public.dm_keys) = 6, 'chiavi pubbliche non visibili'; end $$;
do $$ begin
  begin perform wrapped_key from public.dm_keys; raise exception 'wrapped_key leggibile';
  exception when insufficient_privilege then null; end;
end $$;

-- scrittura diretta vietata
do $$ begin
  begin insert into public.dm_messages (sender, recipient, sender_pub, recipient_pub, iv, body)
    values (auth.uid(), '00000000-0000-0000-0000-00000000000a', 'x', 'y', rpad('i', 16, 'I'), 'z');
    raise exception 'insert diretto riuscito';
  exception when insufficient_privilege then null; end;
end $$;

-- a → b; chiave del destinatario cambiata nel frattempo
select pg_temp.as_user('0a');
select public.dm_send('00000000-0000-0000-0000-00000000000b', 'ciao-b', rpad('i', 16, 'I'), pg_temp.k('B'));
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000b', 'x', rpad('i', 16, 'I'), pg_temp.k('OLD'));
    raise exception 'chiave vecchia accettata';
  exception when raise_exception then if sqlerrm <> 'dm_key_changed' then raise; end if; end;
end $$;
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000a', 'x', rpad('i', 16, 'I'), pg_temp.k('A'));
    raise exception 'messaggio a se stessi';
  exception when raise_exception then if sqlerrm <> 'dm_invalid_recipient' then raise; end if; end;
end $$;
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000c', 'x', rpad('i', 16, 'I'), pg_temp.k('C'));
    raise exception 'messaggio a non membro';
  exception when raise_exception then if sqlerrm <> 'dm_invalid_recipient' then raise; end if; end;
end $$;
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000b', repeat('x', 11001), rpad('i', 16, 'I'), pg_temp.k('B'));
    raise exception 'messaggio troppo lungo accettato';
  exception when check_violation then null; end;
end $$;

-- solo i due interessati vedono il messaggio
select pg_temp.as_user('0b');
do $$ begin assert (select count(*) from public.dm_messages where body = 'ciao-b') = 1, 'b non vede'; end $$;
select pg_temp.as_user('0d');
do $$ begin assert (select count(*) from public.dm_messages) = 0, 'd vede messaggi altrui'; end $$;
-- c non membro: niente
select pg_temp.as_user('0c');
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000a', 'x', rpad('i', 16, 'I'), pg_temp.k('A'));
    raise exception 'non membro invia';
  exception when raise_exception then if sqlerrm <> 'forbidden' then raise; end if; end;
end $$;

-- anti-broadcast: d scrive a 3 persone, la quarta nello stesso intervallo no
select pg_temp.as_user('0d');
select public.dm_send('00000000-0000-0000-0000-00000000000a', 'd1', rpad('i', 16, 'I'), pg_temp.k('A'));
select public.dm_send('00000000-0000-0000-0000-00000000000b', 'd2', rpad('i', 16, 'I'), pg_temp.k('B'));
select public.dm_send('00000000-0000-0000-0000-00000000000e', 'd3', rpad('i', 16, 'I'), pg_temp.k('E'));
do $$ begin
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000f', 'd4', rpad('i', 16, 'I'), pg_temp.k('F'));
    raise exception 'quarta persona accettata';
  exception when raise_exception then if sqlerrm <> 'dm_too_many_people' then raise; end if; end;
end $$;
-- ma può continuare a scrivere a chi ha già scritto
select public.dm_send('00000000-0000-0000-0000-00000000000a', 'd5', rpad('i', 16, 'I'), pg_temp.k('A'));

-- raffica: massimo 5 messaggi in 5 secondi
select pg_temp.as_user('0e');
do $$ declare i int; begin
  for i in 1..5 loop
    perform public.dm_send('00000000-0000-0000-0000-00000000000f', 'r' || i, rpad('i', 16, 'I'), pg_temp.k('F'));
  end loop;
  begin perform public.dm_send('00000000-0000-0000-0000-00000000000f', 'r6', rpad('i', 16, 'I'), pg_temp.k('F'));
    raise exception 'raffica accettata';
  exception when raise_exception then if sqlerrm <> 'dm_rate_limited' then raise; end if; end;
end $$;

-- elenco chat di b: a e d
select pg_temp.as_user('0b');
do $$ begin assert (select count(*) from public.dm_conversations()) = 2, 'conversazioni di b'; end $$;

-- stelline e scadenza a 30 giorni
select pg_temp.as_user('10');
select public.dm_send('00000000-0000-0000-0000-00000000000a', 'vecchio-con-stella', rpad('i', 16, 'I'), pg_temp.k('A'));
select public.dm_send('00000000-0000-0000-0000-00000000000a', 'vecchio-senza', rpad('i', 16, 'I'), pg_temp.k('A'));
select pg_temp.as_user('0a');
select public.dm_star((select id from public.dm_messages where body = 'vecchio-con-stella'), true);
-- la stellina di a non è visibile a g
select pg_temp.as_user('10');
do $$ begin assert (select count(*) from public.dm_stars) = 0, 'stelline altrui visibili'; end $$;

reset role;
update public.dm_messages set created_at = now() - interval '31 days' where body like 'vecchio-%';
set role authenticated;

select pg_temp.as_user('0a');
do $$ begin assert (select count(*) from public.dm_messages where body = 'vecchio-con-stella') = 1, 'a perde il messaggio stellato'; end $$;
do $$ begin assert (select count(*) from public.dm_messages where body = 'vecchio-senza') = 0, 'scaduto ancora visibile'; end $$;
select pg_temp.as_user('10');
do $$ begin assert (select count(*) from public.dm_messages where body like 'vecchio-%') = 0, 'g vede messaggi scaduti'; end $$;
do $$ begin
  begin perform public.dm_star((select id from public.dm_messages where body = 'vecchio-senza'), true);
    raise exception 'stellina su scaduto';
  exception when raise_exception then if sqlerrm <> 'dm_not_found' then raise; end if; end;
end $$;

-- il prossimo invio cancella dal server lo scaduto senza stelline
select public.dm_send('00000000-0000-0000-0000-00000000000a', 'nuovo', rpad('i', 16, 'I'), pg_temp.k('A'));
reset role;
do $$ begin assert (select count(*) from public.dm_messages where body = 'vecchio-senza') = 0, 'scaduto non cancellato'; end $$;
do $$ begin assert (select count(*) from public.dm_messages where body = 'vecchio-con-stella') = 1, 'stellato cancellato'; end $$;

-- tolta l'ultima stellina, sparisce davvero
set role authenticated;
select pg_temp.as_user('0a');
select public.dm_star((select id from public.dm_messages where body = 'vecchio-con-stella'), false);
reset role;
do $$ begin assert (select count(*) from public.dm_messages where body = 'vecchio-con-stella') = 0, 'stellina tolta ma messaggio rimasto'; end $$;

select 'dm ok' as result;
