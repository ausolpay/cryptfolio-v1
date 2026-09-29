-- Keep AI reservations/results out of the frequently updated whole-account blob.
-- Summary contents retain the existing Vault encryption boundary.
create table if not exists private.ai_overviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, secret_id uuid not null, scope text not null,
  status text not null check (status in ('pending','complete','error')),
  created_at timestamptz not null, summary_day text,
  primary key (user_id,id)
);
alter table private.ai_overviews enable row level security;
revoke all on private.ai_overviews from public,anon,authenticated;

create or replace function private.load_ai_overview_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare account jsonb; records jsonb; owner_email text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select email into owner_email from auth.users where id=auth.uid();
  account := private.load_account_state();
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into records
    from jsonb_each(coalesce(account->'state'->'records','{}'::jsonb))
    where key=owner_email || '_aiSettings' or starts_with(key,owner_email || '_ai_daily_')
       or starts_with(key,owner_email || '_ai_generation_');
  select records || coalesce(jsonb_object_agg(owner_email || '_ai_generation_' || g.id::text,v.decrypted_secret),'{}'::jsonb)
    into records from (select * from private.ai_overviews where user_id=auth.uid() order by created_at desc limit 30) g
    join vault.decrypted_secrets v on v.id=g.secret_id;
  return jsonb_build_object('state',jsonb_build_object('records',records));
end; $$;

create or replace function private.reserve_ai_overview(p_generation jsonb,p_day text,p_daily boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.ai_overviews; secret uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_generation->>'status'<>'pending' or p_generation->>'scope' is null or octet_length(p_generation::text)>1000000
     or p_day !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid overview' using errcode='22023'; end if;
  -- Different lock from account autosave: market updates cannot starve AI.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
  if p_daily then
    select * into prior from private.ai_overviews where user_id=auth.uid() and scope='portfolio' and summary_day=p_day order by created_at desc limit 1;
    if found then
      return jsonb_build_object('generation',(select decrypted_secret::jsonb from vault.decrypted_secrets where id=prior.secret_id),'dailyStatus',prior.status,'reused',true);
    end if;
  end if;
  if exists(select 1 from private.ai_overviews where user_id=auth.uid() and status='pending' and created_at>now()-interval '120 seconds') then
    raise exception 'An overview is already generating. Check your saved summary shortly.' using errcode='PT429';
  end if;
  secret := vault.create_secret(p_generation::text);
  insert into private.ai_overviews(user_id,id,secret_id,scope,status,created_at,summary_day)
    values(auth.uid(),(p_generation->>'id')::uuid,secret,p_generation->>'scope','pending',now(),case when p_generation->>'scope'='portfolio' then p_day end);
  return null;
end; $$;

create or replace function private.finish_ai_overview(p_generation jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing private.ai_overviews;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_generation->>'status' not in ('complete','error') or octet_length(p_generation::text)>1000000 then
    raise exception 'Invalid overview' using errcode='22023'; end if;
  select * into existing from private.ai_overviews where user_id=auth.uid() and id=(p_generation->>'id')::uuid for update;
  if not found then raise exception 'Overview not found' using errcode='42501'; end if;
  if existing.status='complete' then return; end if;
  perform vault.update_secret(existing.secret_id,p_generation::text);
  update private.ai_overviews set status=p_generation->>'status' where user_id=auth.uid() and id=existing.id;
end; $$;

create or replace function public.load_ai_overview_state() returns jsonb language sql security invoker set search_path='' as $$ select private.load_ai_overview_state(); $$;
create or replace function public.reserve_ai_overview(p_generation jsonb,p_day text,p_daily boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_ai_overview(p_generation,p_day,p_daily); $$;
create or replace function public.finish_ai_overview(p_generation jsonb) returns void language sql security invoker set search_path='' as $$ select private.finish_ai_overview(p_generation); $$;
revoke all on function private.load_ai_overview_state(),public.load_ai_overview_state(),private.reserve_ai_overview(jsonb,text,boolean),public.reserve_ai_overview(jsonb,text,boolean),private.finish_ai_overview(jsonb),public.finish_ai_overview(jsonb) from public,anon;
grant execute on function private.load_ai_overview_state(),public.load_ai_overview_state(),private.reserve_ai_overview(jsonb,text,boolean),public.reserve_ai_overview(jsonb,text,boolean),private.finish_ai_overview(jsonb),public.finish_ai_overview(jsonb) to authenticated;
notify pgrst,'reload schema';
