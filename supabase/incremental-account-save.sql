-- Only changed records travel over the network. The encrypted account and CAS
-- lock remain the same so older clients and concurrent devices stay compatible.
create or replace function private.patch_account_state(p_records jsonb, p_removed text[], p_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_state jsonb; current_version bigint; next_records jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_records is null or jsonb_typeof(p_records) <> 'object' or p_removed is null
     or p_version is null or p_version < 0 then
    raise exception 'Invalid account patch' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(p_records) where jsonb_typeof(value) <> 'string') then
    raise exception 'Records must be strings' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select private.load_account_state() into current_state;
  current_version := (current_state->>'version')::bigint;
  if current_version <> p_version then
    raise exception 'Newer changes exist on another device' using errcode='PT409';
  end if;
  next_records := (coalesce(current_state->'state'->'records', '{}'::jsonb) - p_removed) || p_records;
  return private.save_account_state(jsonb_build_object('schema',1,'records',next_records),p_version);
end $$;
create or replace function public.patch_account_state(p_records jsonb, p_removed text[], p_version bigint)
returns bigint language sql security invoker set search_path = '' as $$
  select private.patch_account_state(p_records,p_removed,p_version);
$$;
revoke all on function private.patch_account_state(jsonb,text[],bigint), public.patch_account_state(jsonb,text[],bigint) from public,anon;
grant execute on function private.patch_account_state(jsonb,text[],bigint), public.patch_account_state(jsonb,text[],bigint) to authenticated;
