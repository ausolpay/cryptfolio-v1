-- Admin assignments are provisioned privately, never embedded in public app code.
create table if not exists private.admin_accounts (
 email text primary key check(email=lower(email))
);
alter table private.admin_accounts enable row level security;
revoke all on private.admin_accounts from public,anon,authenticated;
create or replace function public.get_account_access() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('isAdmin', exists(
   select 1 from auth.users u join private.admin_accounts a on a.email=lower(u.email)
   where u.id=auth.uid() and u.email_confirmed_at is not null),
   'tier', case when exists(
   select 1 from auth.users u join private.admin_accounts a on a.email=lower(u.email)
   where u.id=auth.uid() and u.email_confirmed_at is not null)
   then 'elite' else 'free' end);
$$;
revoke all on function public.get_account_access() from public,anon;
grant execute on function public.get_account_access() to authenticated;
