-- Only the three account-scoped summary operations receive this bounded window.
alter function public.reserve_ai_overview(jsonb,text,boolean) set statement_timeout = '20s';
alter function public.finish_ai_overview(jsonb) set statement_timeout = '20s';
alter function public.load_ai_overview_history() set statement_timeout = '20s';
notify pgrst, 'reload schema';
