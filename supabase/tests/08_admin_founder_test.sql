\set ON_ERROR_STOP 1
-- The admin makes someone a founder or takes it away (0011). Runs after 01–07. 0a is the admin, 23 is public.
set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;

-- only the admin
select pg_temp.as_user('0b');
do $$ begin assert pg_temp.err($q$select public.admin_set_founder(pg_temp.uid('23'), true)$q$) = 'forbidden', 'non-admin promotes'; end $$;
select pg_temp.as_user('23');
do $$ begin assert pg_temp.err($q$select public.admin_set_founder(pg_temp.uid('23'), true)$q$) = 'forbidden', 'promotes self'; end $$;
do $$ begin assert pg_temp.err($q$update public.members set tier = 'founder' where user_id = auth.uid()$q$) like 'permission denied%', 'direct write'; end $$;
do $$ begin assert not public.are_friends(pg_temp.uid('23'), pg_temp.uid('0b')), 'friends before'; end $$;

-- promoted: founders' channels, friends with every founder
select pg_temp.as_user('0a');
select public.admin_set_founder(pg_temp.uid('23'), true);
select pg_temp.as_user('23');
do $$ begin assert (select tier from public.members where user_id = auth.uid()) = 'founder'; end $$;
do $$ begin assert exists (select 1 from public.channels where id = 3), 'founder sees Lounge'; end $$;
do $$ begin assert public.are_friends(pg_temp.uid('23'), pg_temp.uid('0b')), 'befriended'; end $$;
select public.voice_join(3::smallint);

-- back to public: out of Lounge, friendships stay
select pg_temp.as_user('0a');
select public.admin_set_founder(pg_temp.uid('23'), false);
select pg_temp.as_user('23');
do $$ begin assert (select tier from public.members where user_id = auth.uid()) = 'public'; end $$;
do $$ begin assert not exists (select 1 from public.channels where id = 3), 'public sees Lounge'; end $$;
do $$ begin assert not exists (select 1 from public.voice_rooms where user_id = auth.uid()), 'still in Lounge'; end $$;
do $$ begin assert public.are_friends(pg_temp.uid('23'), pg_temp.uid('0b')), 'friendship removed'; end $$;

-- the admin stays a founder; strangers aren't members
select pg_temp.as_user('0a');
do $$ begin assert pg_temp.err($q$select public.admin_set_founder(pg_temp.uid('0a'), false)$q$) = 'admin_is_founder'; end $$;
do $$ begin assert pg_temp.err($q$select public.admin_set_founder('00000000-0000-0000-0000-000000000099', true)$q$) = 'not_a_member'; end $$;

select 'admin founder ok' as result;
