begin;
select set_config('cryptfolio.test_owner', gen_random_uuid()::text, true);
select set_config('cryptfolio.test_other', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('cryptfolio.test_owner')::uuid),(current_setting('cryptfolio.test_other')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('cryptfolio.test_owner'),true);
do $$
begin
  if public.save_account_state('{"schema":1,"records":{"apiSecret":"test-only-secret","holding":"12"}}',0) <> 1 then
    raise exception 'FAIL: initial save';
  end if;
  if public.load_account_state()->'state'->'records'->>'apiSecret' <> 'test-only-secret' then
    raise exception 'FAIL: encrypted data did not round-trip';
  end if;
  begin
    perform public.save_account_state('{}',0);
    raise exception 'FAIL: stale update accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform * from vault.decrypted_secrets;
    raise exception 'FAIL: direct vault access';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('cryptfolio.test_other'),true);
do $$ begin
  if public.load_account_state()->>'version' <> '0' then raise exception 'FAIL: cross-user read'; end if;
  begin
    perform public.save_account_state('{}',1);
    raise exception 'FAIL: cross-user version update';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from private.account_state a join vault.secrets s on s.id=a.secret_id
    where a.user_id=current_setting('cryptfolio.test_owner')::uuid and s.secret like '%test-only-secret%')
    then raise exception 'FAIL: plaintext at rest'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.load_account_state();
    raise exception 'FAIL: anonymous read';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
select 'PASS: encrypted round-trip, no plaintext at rest, no direct vault access, no cross-user access, stale version rejection, anonymous denial; all fixtures rolled back' as result;
