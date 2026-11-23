-- =============================================================================
-- 0011: the admin makes someone a founder, or takes it away (admin_set_founder).
--   - Founder: sees Lounge and Gaming, 50 MB attachments, and becomes friends
--     with every other founder (trigger members_befriend_founders, 0008).
--   - Back to public: friendships stay; if they were in a founders' voice
--     channel, they're taken out of it.
--   - The admin always stays a founder.
-- =============================================================================

create or replace function public.admin_set_founder(p_user uuid, p_on boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.members where user_id = p_user) then raise exception 'not_a_member'; end if;
  if not coalesce(p_on, false)
     and exists (select 1 from public.members where user_id = p_user and role = 'admin') then
    raise exception 'admin_is_founder';
  end if;
  update public.members set tier = case when p_on then 'founder' else 'public' end
  where user_id = p_user;
  if not p_on then
    delete from public.voice_rooms r
    using public.channels c
    where r.user_id = p_user and c.id = r.channel_id and c.visibility = 'founders';
  end if;
end;
$$;

revoke execute on function public.admin_set_founder(uuid, boolean) from public, anon;
grant execute on function public.admin_set_founder(uuid, boolean) to authenticated;
