-- Account encryption can exceed the default authenticated-role 8s budget.
-- Keep the override scoped to existing account RPCs. No data rewrite,
-- encryption changes, permission changes, or concurrency changes.
alter function public.load_account_state() set statement_timeout = '30s';
alter function public.patch_account_state(jsonb,text[],bigint) set statement_timeout = '30s';
alter function public.save_account_state(jsonb,bigint) set statement_timeout = '30s';
notify pgrst, 'reload schema';
