-- Vault remains the encryption boundary. The inner PGP envelope is used only
-- for its lossless ZIP compression; its public literal is not a security key.
-- Keeping this behind existing RPCs also preserves compatibility with open tabs.
create or replace function private.pack_account_state(value text) returns text
language sql volatile strict set search_path='' as $$
 select 'CFZ1:' || encode(extensions.pgp_sym_encrypt(value, 'cryptfolio-compression-v1',
   'compress-algo=1,compress-level=6,s2k-mode=0'), 'base64');
$$;
create or replace function private.unpack_account_state(value text) returns text
language sql immutable strict set search_path='' as $$
 select case when left(value,5)='CFZ1:' then extensions.pgp_sym_decrypt(
   decode(substring(value from 6),'base64'), 'cryptfolio-compression-v1') else value end;
$$;
revoke all on function private.pack_account_state(text), private.unpack_account_state(text) from public,anon,authenticated;

create or replace function private.load_account_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select jsonb_build_object('version', a.version, 'state', private.unpack_account_state(v.decrypted_secret)::jsonb)
 into result from private.account_state a join vault.decrypted_secrets v on v.id=a.secret_id where a.user_id=auth.uid();
 return coalesce(result, '{"version":0,"state":null}'::jsonb);
end; $$;

create or replace function private.save_account_state(p_state jsonb, p_version bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare existing private.account_state; new_id uuid; result bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>10485760
 or p_version is null or p_version<0 then raise exception 'Invalid account state' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into existing from private.account_state where user_id=auth.uid() for update;
 if coalesce(existing.version,0)<>p_version then raise exception 'Newer changes exist on another device' using errcode='PT409'; end if;
 if existing.user_id is null then
  new_id := vault.create_secret(private.pack_account_state(p_state::text), 'cryptfolio-account-' || auth.uid()::text);
  insert into private.account_state(user_id,secret_id) values(auth.uid(),new_id);
  return 1;
 end if;
 perform vault.update_secret(existing.secret_id,private.pack_account_state(p_state::text));
 update private.account_state set version=version+1,updated_at=now() where user_id=auth.uid() returning version into result;
 return result;
end; $$;


