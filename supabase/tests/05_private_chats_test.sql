\set ON_ERROR_STOP 1
-- Friends, private chats, invites and the public tier (0008). Runs after 01–04.
-- New users: 21, 22, 23 public; 24 founder. a and b are founders from 01.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000021', 'p1@x', '{"username":"pub1"}'),
 ('00000000-0000-0000-0000-000000000022', 'p2@x', '{"username":"pub2"}'),
 ('00000000-0000-0000-0000-000000000023', 'p3@x', '{"username":"pub3"}'),
 ('00000000-0000-0000-0000-000000000024', 'f4@x', '{"username":"found4"}');
insert into public.members (user_id, tier) values
 ('00000000-0000-0000-0000-000000000021', 'public'),
 ('00000000-0000-0000-0000-000000000022', 'public'),
 ('00000000-0000-0000-0000-000000000023', 'public'),
 ('00000000-0000-0000-0000-000000000024', 'founder');

set role authenticated;
create function pg_temp.as_user(id text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || id, false) $$;
create function pg_temp.uid(id text) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-0000000000' || id)::uuid $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.topic_ok(topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', topic, false);
  insert into realtime.messages (topic, extension) values (topic, 'presence');
  return true;
exception when insufficient_privilege then return false; end $$;

-- ---------------------------------------------------------------------------
-- Founders: all friends automatically, still see all 4 server channels
-- ---------------------------------------------------------------------------
select pg_temp.as_user('0a');
do $$ begin assert public.are_friends(pg_temp.uid('0a'), pg_temp.uid('24')), 'new founder befriended'; end $$;
do $$ begin assert public.are_friends(pg_temp.uid('0a'), pg_temp.uid('0b')), 'old founders friends'; end $$;
do $$ begin assert not public.are_friends(pg_temp.uid('0a'), pg_temp.uid('21')), 'public user befriended'; end $$;
do $$ begin assert (select count(*) from public.channels) = 4, 'founder channels'; end $$;

-- ---------------------------------------------------------------------------
-- Public tier: only #generale and #random
-- ---------------------------------------------------------------------------
select public.voice_join(3::smallint); -- a founder in Lounge
select pg_temp.as_user('21');
do $$ begin assert (select array_agg(id order by id) from public.channels) = '{1,2}', 'public channels'; end $$;
do $$ begin assert pg_temp.err($q$select public.voice_join(3::smallint)$q$) = 'forbidden', 'public in founders voice'; end $$;
do $$ begin assert not pg_temp.topic_ok('cerchio:voice:3'), 'public on founders voice topic'; end $$;
do $$ begin assert pg_temp.topic_ok('cerchio:lobby'), 'public on lobby'; end $$;
do $$ begin assert (select count(*) from public.voice_rooms) = 0, 'public sees who is in founders voice'; end $$;
do $$ begin assert pg_temp.err($q$insert into public.messages (channel_id, author_id, content) values (1, auth.uid(), 'hi')$q$) = 'ok', 'public writes in #generale'; end $$;
-- DMs and pokes need a friendship
do $$ begin assert pg_temp.err($q$select public.poke(pg_temp.uid('0a'), 'hey')$q$) = 'poke_not_friends'; end $$;
do $$ begin assert pg_temp.err($q$select public.dm_send(pg_temp.uid('0a'), 'xxxxxxxx', 'iviviviviviv', 'k')$q$) = 'dm_not_friends'; end $$;

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------
do $$ begin assert public.friend_request(pg_temp.uid('22')) = 'pending'; end $$;
do $$ begin assert public.friend_request(pg_temp.uid('22')) = 'pending', 'request twice'; end $$;
do $$ begin assert pg_temp.err($q$select public.friend_request(auth.uid())$q$) = 'friend_invalid_user', 'self'; end $$;
do $$ begin assert pg_temp.err($q$select public.friend_respond(pg_temp.uid('22'), true)$q$) = 'friend_no_request', 'accept own request'; end $$;
-- public users can ask founders too
do $$ begin assert public.friend_request(pg_temp.uid('0a')) = 'pending'; end $$;
select pg_temp.as_user('23');
do $$ begin assert (select count(*) from public.friendships) = 0, 'sees others'' friendships'; end $$;
select pg_temp.as_user('22');
do $$ begin assert (select count(*) from public.friendships where status = 'pending') = 1, 'sees the request'; end $$;
select public.friend_respond(pg_temp.uid('21'), true);
do $$ begin assert public.are_friends(pg_temp.uid('21'), pg_temp.uid('22')); end $$;
-- a declines
select pg_temp.as_user('0a');
select public.friend_respond(pg_temp.uid('21'), false);
do $$ begin assert not exists (select 1 from public.friendships where pg_temp.uid('21') in (user_lo, user_hi)), 'declined request still there'; end $$;
-- asking someone who already asked you = accepting
select pg_temp.as_user('23'); select public.friend_request(pg_temp.uid('21'));
select pg_temp.as_user('21');
do $$ begin assert public.friend_request(pg_temp.uid('23')) = 'accepted', 'mutual request'; end $$;

-- ---------------------------------------------------------------------------
-- Private voice chat
-- ---------------------------------------------------------------------------
-- only friends can be invited, and a bad invitee cancels the whole creation
do $$ begin assert pg_temp.err($q$select public.chat_create('squad', 'voice', array[pg_temp.uid('22'), pg_temp.uid('0a')])$q$) = 'chat_not_friend'; end $$;
do $$ begin assert (select count(*) from public.channels where visibility = 'private') = 0, 'half-created chat'; end $$;
do $$ begin assert pg_temp.err($q$select public.chat_create('', 'voice')$q$) = 'chat_invalid_name'; end $$;
do $$ begin assert pg_temp.err($q$select public.chat_create('x', 'video')$q$) = 'chat_invalid_kind'; end $$;
select set_config('test.voice', public.chat_create('squad', 'voice', array[pg_temp.uid('22')])::text, false);
do $$ begin assert current_setting('test.voice')::int >= 100, 'chat ids start at 100'; end $$;
do $$ begin assert (select count(*) from public.channels) = 3, 'owner sees the new chat'; end $$;

-- the invitee sees the invite with the chat's name, not the chat itself
select pg_temp.as_user('22');
do $$ begin assert (select channel_name from public.my_invites()) = 'squad'; end $$;
do $$ begin assert (select count(*) from public.channels) = 2, 'chat visible before accepting'; end $$;
do $$ begin assert pg_temp.err(format('select public.voice_join(%s::smallint)', current_setting('test.voice'))) = 'forbidden', 'voice before accepting'; end $$;
-- others don't see it at all
select pg_temp.as_user('23');
do $$ begin assert (select count(*) from public.my_invites()) = 0; end $$;
select pg_temp.as_user('0a');
do $$ begin assert (select count(*) from public.channels) = 4, 'founder sees a private chat'; end $$;
do $$ begin assert not pg_temp.topic_ok('cerchio:voice:' || current_setting('test.voice')), 'outsider on chat topic'; end $$;

select pg_temp.as_user('22');
select public.invite_respond((select id from public.my_invites()), true);
do $$ begin assert (select count(*) from public.channels) = 3, 'chat after accepting'; end $$;
do $$ begin assert pg_temp.topic_ok('cerchio:voice:' || current_setting('test.voice')), 'member on chat topic'; end $$;
select public.voice_join(current_setting('test.voice')::smallint);
do $$ begin assert (select count(*) from public.channel_members where channel_id = current_setting('test.voice')::smallint) = 2; end $$;
-- only the owner manages the chat
do $$ begin assert pg_temp.err(format('select public.chat_invite(%s::smallint, pg_temp.uid(%L))', current_setting('test.voice'), '21')) = 'chat_not_owner'; end $$;
do $$ begin assert pg_temp.err(format('select public.chat_rename(%s::smallint, %L)', current_setting('test.voice'), 'mine')) = 'chat_not_owner'; end $$;
do $$ begin assert pg_temp.err(format('select public.chat_delete(%s::smallint)', current_setting('test.voice'))) = 'chat_not_owner'; end $$;

-- owner removes 22: chat and voice room gone for them
select pg_temp.as_user('21');
select public.chat_rename(current_setting('test.voice')::smallint, 'squad 2');
select public.chat_remove(current_setting('test.voice')::smallint, pg_temp.uid('22'));
select pg_temp.as_user('22');
do $$ begin assert (select count(*) from public.channels) = 2, 'removed member still sees the chat'; end $$;
reset role;
do $$ begin assert not exists (select 1 from public.voice_rooms where user_id = '00000000-0000-0000-0000-000000000022'), 'removed member still in the room'; end $$;
set role authenticated;

-- ---------------------------------------------------------------------------
-- Private text chat: messages and attachments only for members
-- ---------------------------------------------------------------------------
select pg_temp.as_user('21');
select set_config('test.text', public.chat_create('testo', 'text', array[pg_temp.uid('23')])::text, false);
select pg_temp.as_user('23');
select public.invite_respond((select id from public.my_invites()), true);
insert into storage.objects (bucket_id, name) values ('attachments', '00000000-0000-0000-0000-000000000023/f.png');
insert into public.messages (channel_id, author_id, content, attachment_path)
values (current_setting('test.text')::smallint, auth.uid(), 'segreto', '00000000-0000-0000-0000-000000000023/f.png');
select pg_temp.as_user('21');
do $$ begin assert (select count(*) from public.messages where content = 'segreto') = 1, 'member reads'; end $$;
do $$ begin assert (select count(*) from storage.objects where name like '%23/f.png') = 1, 'member reads the file'; end $$;
select pg_temp.as_user('22');
do $$ begin assert (select count(*) from public.messages where content = 'segreto') = 0, 'outsider reads'; end $$;
do $$ begin assert (select count(*) from storage.objects where name like '%23/f.png') = 0, 'outsider reads the file'; end $$;
do $$ begin assert pg_temp.err(format('insert into public.messages (channel_id, author_id, content) values (%s, auth.uid(), %L)', current_setting('test.text'), 'x')) like '%row-level security%', 'outsider writes'; end $$;
select pg_temp.as_user('0a');
do $$ begin assert (select count(*) from public.messages where content = 'segreto') = 0, 'founder reads a private chat'; end $$;

-- owner leaves: ownership passes on; last one leaves: chat and messages deleted
select pg_temp.as_user('21');
select public.chat_leave(current_setting('test.text')::smallint);
select pg_temp.as_user('23');
do $$ begin assert (select role from public.channel_members where channel_id = current_setting('test.text')::smallint) = 'owner', 'ownership'; end $$;
select public.chat_leave(current_setting('test.text')::smallint);
reset role;
do $$ begin assert not exists (select 1 from public.channels where id = current_setting('test.text')::smallint), 'empty chat not deleted'; end $$;
do $$ begin assert not exists (select 1 from public.messages where content = 'segreto'), 'messages of a deleted chat'; end $$;
set role authenticated;

-- ---------------------------------------------------------------------------
-- Invites: decline, cancel, unfriend
-- ---------------------------------------------------------------------------
select pg_temp.as_user('21');
select public.chat_invite(current_setting('test.voice')::smallint, pg_temp.uid('23'));
select pg_temp.as_user('23');
select public.invite_respond((select id from public.my_invites()), false);
do $$ begin assert (select count(*) from public.channels where id = current_setting('test.voice')::smallint) = 0, 'declined but joined'; end $$;
select pg_temp.as_user('21');
select public.chat_invite(current_setting('test.voice')::smallint, pg_temp.uid('23'));
select public.invite_cancel((select id from public.my_invites()));
do $$ begin assert (select count(*) from public.my_invites()) = 0, 'cancelled invite'; end $$;
select public.chat_invite(current_setting('test.voice')::smallint, pg_temp.uid('23'));
select public.friend_remove(pg_temp.uid('23'));
do $$ begin assert (select count(*) from public.my_invites()) = 0, 'unfriending keeps invites'; end $$;
do $$ begin assert pg_temp.err(format('select public.chat_invite(%s::smallint, pg_temp.uid(%L))', current_setting('test.voice'), '23')) = 'chat_not_friend'; end $$;

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
select pg_temp.as_user('22');
select public.user_block(pg_temp.uid('21'), true);
do $$ begin assert not public.are_friends(pg_temp.uid('21'), pg_temp.uid('22')), 'block keeps the friendship'; end $$;
select pg_temp.as_user('21');
do $$ begin assert pg_temp.err($q$select public.friend_request(pg_temp.uid('22'))$q$) = 'friend_blocked'; end $$;
do $$ begin assert (select count(*) from public.blocks) = 0, 'sees who blocked them'; end $$;
select pg_temp.as_user('22');
select public.user_block(pg_temp.uid('21'), false);
select pg_temp.as_user('21');
do $$ begin assert public.friend_request(pg_temp.uid('22')) = 'pending', 'after unblock'; end $$;

-- ---------------------------------------------------------------------------
-- Capacity: a voice chat holds 8 people, members + pending invites
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000000' || to_hex(i))::uuid, i || '@x', jsonb_build_object('username', 'cap' || i)
from generate_series(48, 56) i;
insert into public.members (user_id, tier)
select ('00000000-0000-0000-0000-0000000000' || to_hex(i))::uuid, 'public' from generate_series(48, 56) i;
insert into public.friendships (user_lo, user_hi, status, requested_by)
select least(pg_temp.uid('21'), u), greatest(pg_temp.uid('21'), u), 'accepted', pg_temp.uid('21')
from (select ('00000000-0000-0000-0000-0000000000' || to_hex(i))::uuid u from generate_series(48, 56) i) t;
set role authenticated;
select pg_temp.as_user('21');
do $$ declare i int; begin
  for i in 48..54 loop perform public.chat_invite(current_setting('test.voice')::smallint, pg_temp.uid(to_hex(i))); end loop;
  assert pg_temp.err(format('select public.chat_invite(%s::smallint, pg_temp.uid(%L))', current_setting('test.voice'), to_hex(55))) = 'chat_full', '9th person';
end $$;

-- ---------------------------------------------------------------------------
-- Kicked owner: the chat goes to the next member
-- ---------------------------------------------------------------------------
select pg_temp.as_user('30');
select public.invite_respond((select id from public.my_invites()), true);
select pg_temp.as_user('0a');
select public.admin_kick(pg_temp.uid('21'));
reset role;
do $$ begin assert (select owner_id from public.channels where id = current_setting('test.voice')::smallint) = '00000000-0000-0000-0000-000000000030', 'owner after kick'; end $$;
do $$ begin assert exists (select 1 from public.friendships where pg_temp.uid('21') in (user_lo, user_hi)), 'kick wiped friendships'; end $$;

select 'private chats ok' as result;
