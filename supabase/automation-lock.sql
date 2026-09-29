create table private.automation_lease (
 user_id uuid primary key references auth.users(id) on delete cascade,
 device_id uuid not null, expires_at timestamptz not null
);
create table private.automation_actions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null, state_version bigint not null,
 status text not null default 'pending' check(status in ('pending','received','acknowledged')),
 created_at timestamptz not null default now()
);
alter table private.automation_lease enable row level security;
alter table private.automation_actions enable row level security;
revoke all on private.automation_lease,private.automation_actions from public,anon,authenticated;

create function public.claim_automation(p_device uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_lease private.automation_lease;
begin
 if auth.uid() is null or p_device is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 select * into current_lease from private.automation_lease where user_id=auth.uid();
 if current_lease.device_id=p_device then
  update private.automation_lease set expires_at=now()+interval '30 seconds' where user_id=auth.uid();
  return true;
 end if;
 if current_lease.expires_at>now() or exists(
  select 1 from private.automation_actions where user_id=auth.uid() and status<>'acknowledged'
 ) then return false; end if;
 insert into private.automation_lease values(auth.uid(),p_device,now()+interval '30 seconds')
 on conflict(user_id) do update set device_id=p_device,expires_at=excluded.expires_at;
 return true;
end; $$;

create function public.reserve_automation_action(p_device uuid,p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if not exists(select 1 from private.automation_lease where user_id=auth.uid() and device_id=p_device and expires_at>now()) then
  raise exception 'Another device controls automation, or the lease expired' using errcode='PT409';
 end if;
 if exists(select 1 from private.automation_actions where user_id=auth.uid() and status<>'acknowledged') then
  raise exception 'An earlier order needs reconciliation before another request can be sent' using errcode='PT409';
 end if;
 insert into private.automation_actions(id,user_id,device_id,state_version)
 values(p_request,auth.uid(),p_device,coalesce((select version from private.account_state where user_id=auth.uid()),0));
end; $$;

create function public.receive_automation_action(p_device uuid,p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.automation_actions set status='received'
 where id=p_request and user_id=auth.uid() and device_id=p_device and status='pending';
end; $$;

create function public.acknowledge_automation_action(p_device uuid,p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.automation_actions a set status='acknowledged'
 where a.id=p_request and a.user_id=auth.uid() and a.device_id=p_device and a.status='received'
 and exists(select 1 from private.account_state s where s.user_id=auth.uid() and s.version>a.state_version);
 if not found then raise exception 'Save the confirmed order result before continuing' using errcode='PT409'; end if;
end; $$;
revoke all on function public.claim_automation(uuid),public.reserve_automation_action(uuid,uuid),
 public.receive_automation_action(uuid,uuid),public.acknowledge_automation_action(uuid,uuid) from public,anon;
grant execute on function public.claim_automation(uuid),public.reserve_automation_action(uuid,uuid),
 public.receive_automation_action(uuid,uuid),public.acknowledge_automation_action(uuid,uuid) to authenticated;
