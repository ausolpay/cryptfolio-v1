-- Schema introspection runs as authenticator, before the caller role is selected.
-- Give it a bounded recovery window; caller roles keep their existing limits.
alter role authenticator set statement_timeout = '30s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
