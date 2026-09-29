create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table private.account_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_id uuid not null references vault.secrets(id),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table private.account_state enable row level security;
revoke all on private.account_state from public, anon, authenticated;
revoke all on vault.decrypted_secrets, vault.secrets from anon, authenticated;

create function private.load_account_state() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select jsonb_build_object('version', a.version, 'state', v.decrypted_secret::jsonb)
    into result from private.account_state a join vault.decrypted_secrets v on v.id=a.secret_id
    where a.user_id=auth.uid();
  return coalesce(result, '{"version":0,"state":null}'::jsonb);
end;
$$;

create function private.save_account_state(p_state jsonb, p_version bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare existing private.account_state; new_id uuid; result bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text)>10485760
    or p_version is null or p_version<0 then
    raise exception 'Invalid account state' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into existing from private.account_state where user_id=auth.uid() for update;
  if coalesce(existing.version,0) <> p_version then
    raise exception 'Newer changes exist on another device' using errcode='PT409';
  end if;
  if existing.user_id is null then
    new_id := vault.create_secret(p_state::text, 'cryptfolio-account-' || auth.uid()::text);
    insert into private.account_state(user_id,secret_id) values(auth.uid(),new_id);
    return 1;
  end if;
  perform vault.update_secret(existing.secret_id, p_state::text);
  update private.account_state set version=version+1,updated_at=now()
    where user_id=auth.uid() returning version into result;
  return result;
end;
$$;

create function public.load_account_state() returns jsonb
language sql security invoker set search_path=''
as $$ select private.load_account_state(); $$;
create function public.save_account_state(p_state jsonb, p_version bigint) returns bigint
language sql security invoker set search_path=''
as $$ select private.save_account_state(p_state,p_version); $$;
revoke all on function private.load_account_state(), private.save_account_state(jsonb,bigint),
 public.load_account_state(), public.save_account_state(jsonb,bigint) from public,anon;
grant execute on function private.load_account_state(), private.save_account_state(jsonb,bigint),
 public.load_account_state(), public.save_account_state(jsonb,bigint) to authenticated;

