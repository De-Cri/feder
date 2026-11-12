-- "Contributor" badge for people who contributed code on GitHub.
-- Only the admin can grant or remove it (admin_set_contributor).
alter table public.members add column if not exists contributor boolean not null default false;

create or replace function public.admin_set_contributor(p_user uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.members set contributor = p_on where user_id = p_user;
end;
$$;

revoke execute on function public.admin_set_contributor(uuid, boolean) from public, anon;
grant execute on function public.admin_set_contributor(uuid, boolean) to authenticated;
