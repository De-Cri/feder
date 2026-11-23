\set ON_ERROR_STOP 1
-- Open sign-ups, the 100 cap, call state in voice_rooms, attachment limits (0009). Runs after 01–05.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000060', 'n1@x', '{"username":"new1"}'),
 ('00000000-0000-0000-0000-000000000061', 'n2@x', '{"username":"new2"}'),
 ('00000000-0000-0000-0000-000000000062', 'n3@x', '{"username":"new3"}');
insert into public.bans (user_id) values ('00000000-0000-0000-0000-000000000062');
-- 05 already added a dozen public members this hour: no hourly limit until it's tested below
update private.server_config set joins_per_hour = 1000;

set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;

-- closed by default: nobody gets in without the password
select pg_temp.as_user('60');
do $$ begin assert (select open from public.server_status()) = false, 'open by default'; end $$;
do $$ begin assert (select max_members from public.server_status()) = 100; end $$;
do $$ begin assert public.join_open() = 'closed'; end $$;
do $$ begin assert pg_temp.err($q$select public.admin_set_open(true)$q$) = 'forbidden', 'non-admin opens'; end $$;

-- the admin opens: you join as a public member, without the password
select pg_temp.as_user('0a');
select public.admin_set_open(true);
select pg_temp.as_user('60');
do $$ begin assert public.join_open() = 'ok'; end $$;
do $$ begin assert public.join_open() = 'already_member'; end $$;
do $$ begin assert (select tier from public.members where user_id = auth.uid()) = 'public', 'tier'; end $$;
do $$ begin assert (select array_agg(id order by id) from public.channels) = '{1,2,5}', 'public sees founders channels'; end $$;
select pg_temp.as_user('62');
do $$ begin assert public.join_open() = 'banned'; end $$;

-- the cap
reset role;
update private.server_config set max_members = (select count(*) from public.members);
set role authenticated;
select pg_temp.as_user('61');
do $$ begin assert public.join_open() = 'server_full'; end $$;
reset role;
update private.server_config set max_members = 100;
set role authenticated;

-- joins per hour: with the limit at this hour's public joins, the next one waits
reset role;
update private.server_config
   set joins_per_hour = (select count(*) from public.members where tier = 'public' and joined_at > now() - interval '1 hour');
set role authenticated;
select pg_temp.as_user('61');
do $$ begin assert public.join_open() = 'busy', 'joins per hour'; end $$;
reset role;
update private.server_config set joins_per_hour = 10;
set role authenticated;

-- closing again
select pg_temp.as_user('0a');
select public.admin_set_open(false);
select pg_temp.as_user('61');
do $$ begin assert public.join_open() = 'closed'; end $$;

-- call state: written only through voice_state, visible only to who sees the room
select pg_temp.as_user('0b');
select public.voice_join(3::smallint);
select public.voice_state(false, false, true, true);
do $$ begin assert pg_temp.err($q$update public.voice_rooms set cam = false$q$) like 'permission denied%', 'direct write'; end $$;
select pg_temp.as_user('0a');
do $$ begin assert (select cam and screen and not mic from public.voice_rooms where user_id = pg_temp.uid('0b')), 'founder sees the state'; end $$;
select pg_temp.as_user('60');
do $$ begin assert (select count(*) from public.voice_rooms) = 0, 'public sees founders calls'; end $$;

-- attachments: 10 MB for public members, 50 MB for founders
do $$ begin assert pg_temp.err($q$insert into public.messages (channel_id, author_id, content, attachment_path, attachment_size)
  values (1, auth.uid(), '', auth.uid() || '/big.zip', 20000000)$q$) like '%row-level security%', 'public 20 MB'; end $$;
do $$ begin assert pg_temp.err($q$insert into public.messages (channel_id, author_id, content, attachment_path, attachment_size)
  values (1, auth.uid(), '', auth.uid() || '/ok.zip', 9000000)$q$) = 'ok', 'public 9 MB'; end $$;
select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err($q$insert into public.messages (channel_id, author_id, content, attachment_path, attachment_size)
  values (1, auth.uid(), '', auth.uid() || '/big.zip', 40000000)$q$) = 'ok', 'founder 40 MB'; end $$;

select 'open server ok' as result;
