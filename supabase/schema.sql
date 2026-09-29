-- Non-secret account data; provider secrets must use separate encrypted server storage.
create table public.portfolio_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check (length(document_key) between 1 and 160),
  payload jsonb not null,
  version bigint not null default 1 check (version > 0),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, document_key),
  check (octet_length(payload::text) <= 1048576)
);
alter table public.portfolio_documents enable row level security;
revoke all on public.portfolio_documents from anon;
grant select, insert, update on public.portfolio_documents to authenticated;
create policy documents_select_own on public.portfolio_documents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy documents_insert_own on public.portfolio_documents
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy documents_update_own on public.portfolio_documents
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.save_portfolio_document(
  p_key text, p_payload jsonb, p_expected_version bigint, p_deleted boolean default false
) returns public.portfolio_documents
language plpgsql security invoker set search_path = ''
as $$
declare result public.portfolio_documents;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid version' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.portfolio_documents(user_id, document_key, payload, deleted)
    values (auth.uid(), p_key, p_payload, p_deleted)
    on conflict do nothing returning * into result;
  else
    update public.portfolio_documents
    set payload = p_payload, version = version + 1, deleted = p_deleted, updated_at = now()
    where user_id = auth.uid() and document_key = p_key and version = p_expected_version
    returning * into result;
  end if;
  if result.user_id is null then
    raise exception 'Document changed on another device; reload before saving'
      using errcode = 'PT409';
  end if;
  return result;
end;
$$;
revoke all on function public.save_portfolio_document(text,jsonb,bigint,boolean) from public, anon;
grant execute on function public.save_portfolio_document(text,jsonb,bigint,boolean) to authenticated;

