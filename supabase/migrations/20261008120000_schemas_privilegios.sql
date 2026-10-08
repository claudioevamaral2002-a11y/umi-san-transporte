-- Schemas da especificação 1.1:
--   api     único exposto pelo PostgREST: RPCs e views por perfil
--   app     tabelas de negócio, não exposto
--   interno funções de sistema (cron, reconciliação, outbox), sem acesso de usuário
create schema api;
create schema app;
create schema interno;

revoke all on schema api, app, interno from public, anon, authenticated;

grant usage on schema api to authenticated, service_role;
-- USAGE em app só para as funções app.pode_* usadas em políticas e para SELECT sob RLS
-- pelas views security_invoker; escrita direta nunca (testado em 0001_privilegios).
grant usage on schema app to authenticated;

-- Objetos futuros nascem fechados; cada um recebe GRANT explícito na sua migration.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema api, app, interno revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema api, app, interno revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema api, app, interno revoke all on sequences from anon, authenticated;

-- Evidência do item 10 de segurança (sem Authorization → recusado) e keep-alive (fase 5).
create function api.ping()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select 'pong'::text $$;

revoke execute on function api.ping() from public, anon;
grant execute on function api.ping() to authenticated;
