-- Only revision numbers enter Realtime. Encrypted account contents stay in Vault.
create table public.account_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null
);
alter table public.account_sync enable row level security;
revoke all on public.account_sync from anon, authenticated;
grant select on public.account_sync to authenticated;
create policy "Read own sync revision" on public.account_sync for select to authenticated
  using (user_id=(select auth.uid()));
create function private.publish_account_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.account_sync(user_id,version) values(new.user_id,new.version)
  on conflict(user_id) do update set version=excluded.version;
  return new;
end; $$;
revoke all on function private.publish_account_revision() from public,anon,authenticated;
create trigger publish_account_revision after insert or update on private.account_state
for each row execute function private.publish_account_revision();
insert into public.account_sync select user_id,version from private.account_state;
alter publication supabase_realtime add table public.account_sync;
