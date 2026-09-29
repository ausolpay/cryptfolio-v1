-- AI history reads only small summary secrets, never the full account blob.
create or replace function private.load_ai_overview_history() returns jsonb
language plpgsql security definer set search_path='' as $$
declare records jsonb := '{}'::jsonb; item record; summary text; owner_email text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select email into owner_email from auth.users where id=auth.uid();
  for item in select id,secret_id from private.ai_overviews where user_id=auth.uid() order by created_at desc limit 30 loop
    -- Point lookup prevents the large account secret entering this read.
    select decrypted_secret into summary from vault.decrypted_secrets where id=item.secret_id;
    if summary is not null then records := records || jsonb_build_object(owner_email || '_ai_generation_' || item.id::text,summary); end if;
  end loop;
  return jsonb_build_object('state',jsonb_build_object('records',records));
end; $$;
create or replace function public.load_ai_overview_history() returns jsonb language sql security invoker set search_path='' as $$ select private.load_ai_overview_history(); $$;
revoke all on function private.load_ai_overview_history(),public.load_ai_overview_history() from public,anon;
grant execute on function private.load_ai_overview_history(),public.load_ai_overview_history() to authenticated;
notify pgrst,'reload schema';
