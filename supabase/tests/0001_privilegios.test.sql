-- Guarda permanente das regras 1.1 e Adendo A4 da especificação.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_schema('api');
select has_schema('app');
select has_schema('interno');

select ok(
  not has_schema_privilege('anon', 'api', 'USAGE')
  and not has_schema_privilege('anon', 'app', 'USAGE')
  and not has_schema_privilege('anon', 'interno', 'USAGE'),
  'anon sem USAGE em api, app e interno'
);

select ok(
  not has_schema_privilege('authenticated', 'interno', 'USAGE'),
  'authenticated sem USAGE em interno'
);

select is_empty($$
  select c.relname || ':' || r.papel || ':' || p.priv
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(papel)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where n.nspname = 'app' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege(r.papel, c.oid, p.priv)
$$, 'app: nenhuma escrita direta para anon/authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'interno'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
$$, 'interno: nenhuma função executável por anon/authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not (p.proname like 'pode\_%' and p.prosecdef)))
$$, 'app: só funções pode_* SECURITY DEFINER executáveis por authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'EXECUTE')
$$, 'api: nenhuma função executável por anon');

select is_empty($$
  select n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'app', 'interno') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
$$, 'toda função SECURITY DEFINER tem search_path fixo');

select is_empty($$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false)
$$, 'toda view de api é security_invoker (Adendo A4)');

select is_empty($$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'toda tabela de app tem RLS habilitado');

select * from finish();
rollback;
