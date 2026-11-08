\set ON_ERROR_STOP 1
-- setup: admin + 2 utenti
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'a@x', '{"username":"Samu"}'),
 ('00000000-0000-0000-0000-00000000000b', 'b@x', '{"username":"bob"}'),
 ('00000000-0000-0000-0000-00000000000c', 'c@x', '{"username":"!!bad"}');
select private.configure_server('segreta123', '00000000-0000-0000-0000-00000000000a');
select username from public.profiles order by username;

set role authenticated;
-- bob non membro: non vede nulla
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert (select count(*) from public.channels) = 0, 'non membro vede canali'; end $$;
do $$ begin assert (select count(*) from public.profiles) = 1, 'non membro vede profili altrui'; end $$;
do $$ begin assert public.join_server('sbagliata') = 'wrong_password'; end $$;
do $$ begin
  begin insert into public.messages (channel_id, author_id, content) values (1, auth.uid(), 'hack');
    raise exception 'insert non membro riuscito';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform 1 from private.server_config; raise exception 'private leggibile';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert public.join_server('segreta123') = 'ok'; end $$;
do $$ begin assert public.join_server('segreta123') = 'already_member'; end $$;
do $$ begin assert (select count(*) from public.channels) = 4; end $$;
insert into public.messages (channel_id, author_id, content) values (1, auth.uid(), 'ciao');
do $$ begin
  begin insert into public.messages (channel_id, author_id, content) values (3, auth.uid(), 'in vocale');
    raise exception 'msg in canale voce';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform public.admin_kick('00000000-0000-0000-0000-00000000000a'); raise exception 'bob kick admin';
  exception when raise_exception then if sqlerrm <> 'forbidden' then raise; end if; end;
end $$;
-- realtime: membro può leggere/scrivere
insert into realtime.messages (topic, extension) values ('lobby', 'presence');

-- c: rate limit
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ declare i int; begin
  for i in 1..5 loop assert public.join_server('x') = 'wrong_password'; end loop;
  assert public.join_server('segreta123') = 'too_many_attempts';
end $$;
do $$ begin
  begin insert into realtime.messages (topic, extension) values ('lobby', 'broadcast'); raise exception 'realtime non membro';
  exception when insufficient_privilege then null; end;
end $$;

-- admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin assert public.is_admin(); end $$;
delete from public.messages where content = 'ciao';
do $$ begin assert (select count(*) from public.messages) = 0, 'admin non cancella'; end $$;
select public.admin_set_voice_mute('00000000-0000-0000-0000-00000000000b', true);
do $$ begin assert (select count(*) from public.voice_mutes) = 1; end $$;
select public.admin_ban('00000000-0000-0000-0000-00000000000b', 'test');
select public.admin_set_password('nuovapass');

-- bob bannato
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert public.join_server('nuovapass') = 'banned'; end $$;
do $$ begin assert (select count(*) from public.messages) = 0 and (select count(*) from public.channels) = 0; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.admin_unban('00000000-0000-0000-0000-00000000000b');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin assert public.join_server('segreta123') = 'wrong_password'; assert public.join_server('nuovapass') = 'ok'; end $$;
-- storage
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('attachments', '00000000-0000-0000-0000-00000000000a/x.png'); raise exception 'upload in cartella altrui';
  exception when insufficient_privilege then null; end;
end $$;
insert into storage.objects (bucket_id, name) values ('attachments', '00000000-0000-0000-0000-00000000000b/x.png');
reset role;
select 'ALL TESTS PASSED' as result;
