begin;
select set_config('cryptfolio.test_owner', gen_random_uuid()::text, true);
select set_config('cryptfolio.test_other', gen_random_uuid()::text, true);
insert into auth.users(id) values
(current_setting('cryptfolio.test_owner')::uuid),
(current_setting('cryptfolio.test_other')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('cryptfolio.test_owner'), true);
select public.save_portfolio_document('test', '{"holdings":1}'::jsonb, 0);
do $$
begin
  begin
    perform public.save_portfolio_document('test', '{"holdings":99}'::jsonb, 0);
    raise exception 'FAIL: stale creation accepted';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.save_portfolio_document('test', '{"holdings":2}'::jsonb, 1);
  begin
    perform public.save_portfolio_document('test', '{"holdings":99}'::jsonb, 1);
    raise exception 'FAIL: stale update accepted';
  exception when sqlstate 'PT409' then null;
  end;
  if (select version from public.portfolio_documents where document_key='test') <> 2 then
    raise exception 'FAIL: wrong version';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('cryptfolio.test_other'), true);
do $$
begin
  if exists(select 1 from public.portfolio_documents) then
    raise exception 'FAIL: another user can read owner data';
  end if;
  begin
    insert into public.portfolio_documents(user_id, document_key, payload)
      values(current_setting('cryptfolio.test_owner')::uuid, 'forged', '{}');
    raise exception 'FAIL: forged ownership accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_portfolio_document('test', '{}', 2);
    raise exception 'FAIL: another user can update owner data';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
set local role anon;
do $$
begin
  begin
    perform * from public.portfolio_documents;
    raise exception 'FAIL: anonymous read allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
select 'PASS: owner writes, conflict rejection, cross-user isolation, anonymous denial; fixtures rolled back' as result;
