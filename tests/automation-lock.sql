begin;
select set_config('test.owner',gen_random_uuid()::text,true);
select set_config('test.other',gen_random_uuid()::text,true);
select set_config('test.device1',gen_random_uuid()::text,true);
select set_config('test.device2',gen_random_uuid()::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid),(current_setting('test.other')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
do $$ begin
 if not public.claim_automation(current_setting('test.device1')::uuid) then raise exception 'FAIL first device'; end if;
 if public.claim_automation(current_setting('test.device2')::uuid) then raise exception 'FAIL duplicate runner'; end if;
 perform public.save_account_state('{"schema":1,"records":{}}',0);
 perform public.reserve_automation_action(current_setting('test.device1')::uuid,current_setting('test.request')::uuid);
 begin
  perform public.reserve_automation_action(current_setting('test.device1')::uuid,gen_random_uuid());
  raise exception 'FAIL overlapping request';
 exception when sqlstate 'PT409' then null; end;
end $$;
reset role;
update private.automation_lease set expires_at=now()-interval '1 second' where user_id=current_setting('test.owner')::uuid;
set local role authenticated;
do $$ begin
 if public.claim_automation(current_setting('test.device2')::uuid) then raise exception 'FAIL failover with uncertain purchase'; end if;
 perform public.receive_automation_action(current_setting('test.device1')::uuid,current_setting('test.request')::uuid);
 begin
  perform public.acknowledge_automation_action(current_setting('test.device1')::uuid,current_setting('test.request')::uuid);
  raise exception 'FAIL acknowledged without saved bookkeeping';
 exception when sqlstate 'PT409' then null; end;
 perform public.save_account_state('{"schema":1,"records":{"confirmedOrder":"test"}}',1);
 perform public.acknowledge_automation_action(current_setting('test.device1')::uuid,current_setting('test.request')::uuid);
 if not public.claim_automation(current_setting('test.device2')::uuid) then raise exception 'FAIL safe failover'; end if;
 begin
  perform public.reserve_automation_action(current_setting('test.device1')::uuid,gen_random_uuid());
  raise exception 'FAIL stale leader';
 exception when sqlstate 'PT409' then null; end;
 if (select count(*) from public.account_sync) <> 1 then raise exception 'FAIL own realtime signal'; end if;
 if public.get_account_access()->>'isAdmin' <> 'false' then raise exception 'FAIL admin privilege'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.other'),true);
do $$ begin
 if exists(select 1 from public.account_sync) then raise exception 'FAIL leaked realtime revision'; end if;
 if not public.claim_automation(current_setting('test.device2')::uuid) then raise exception 'FAIL separate account lease'; end if;
end $$;
rollback;
select 'PASS: one runner, blocked overlapping requests, no unsafe failover, saved bookkeeping required, stale leader blocked, private realtime signals, no admin escalation; fixtures rolled back' as result;
