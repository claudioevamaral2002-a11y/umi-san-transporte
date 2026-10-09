-- Links curtos: código só como hash, uso único, expiração, limite por IP/dia, privilégios e auditoria.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into app.convites (email, nome, papel, empresa_id) values ('cli@teste.local', 'Cliente Teste', 'MOTORISTA', null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli@teste.local');

create temp table t_codigos (nome text primary key, codigo text);
insert into t_codigos values
  ('a', api.sistema_criar_link_curto('hash-falso-convite-aaaaaaaaaa', 'invite', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo_link');

select matches((select codigo from t_codigos where nome = 'a'), '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$', 'código: 10 símbolos do alfabeto sem ambiguidade');
select is((select count(*)::int from interno.links_acesso where codigo_hash = interno.hash_texto((select codigo from t_codigos where nome = 'a'))), 1,
  'guardado pelo SHA-256 do código');
select is_empty($$ select 1 from interno.links_acesso l join t_codigos c on l.codigo_hash = c.codigo or l.token_hash = c.codigo $$,
  'o código em claro não é guardado');
select is((select expira_em - criado_em from interno.links_acesso limit 1), interval '24 hours', 'expira em 24 h');

-- entrada inválida
select is(api.sistema_criar_link_curto('curto', 'invite', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo', 'CAMPOS_INVALIDOS', 'token_hash inválido: recusado');
select is(api.sistema_criar_link_curto('hash-falso-xxxxxxxxxx', 'magiclink', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo', 'CAMPOS_INVALIDOS', 'tipo fora da lista: recusado');
select is(api.sistema_criar_link_curto('hash-falso-xxxxxxxxxx', 'recovery', gen_random_uuid()) ->> 'codigo', 'CAMPOS_INVALIDOS', 'usuário inexistente: recusado');

-- resgate: uso único (hífen, minúsculas e espaços aceitos)
select is(api.sistema_resgatar_link(
  lower(substr((select codigo from t_codigos where nome = 'a'), 1, 4) || '-' || substr((select codigo from t_codigos where nome = 'a'), 5)), '198.51.100.1'),
  '{"ok": true, "tipo": "invite", "token_hash": "hash-falso-convite-aaaaaaaaaa"}'::jsonb,
  'primeiro resgate devolve token_hash e tipo');
select isnt((select usado_em from interno.links_acesso where codigo_hash = interno.hash_texto((select codigo from t_codigos where nome = 'a'))), null, 'marcado como usado');
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'a'), '198.51.100.1') ->> 'codigo', 'EXPIRADO', 'segundo resgate: EXPIRADO');
select is(api.sistema_resgatar_link('ZZZZZZZZZZ', '198.51.100.1') ->> 'codigo', 'NAO_ENCONTRADO', 'código inexistente: NAO_ENCONTRADO');
select is(api.sistema_resgatar_link('0O1IL0O1IL', '198.51.100.1') ->> 'codigo', 'NAO_ENCONTRADO', 'símbolos fora do alfabeto: NAO_ENCONTRADO');
select is(api.sistema_resgatar_link(null, '198.51.100.1') ->> 'codigo', 'NAO_ENCONTRADO', 'nulo: NAO_ENCONTRADO');

-- expiração
insert into t_codigos values
  ('b', api.sistema_criar_link_curto('hash-falso-bbbbbbbbbbbb', 'recovery', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo_link');
update interno.links_acesso set expira_em = now() - interval '1 second'
where codigo_hash = interno.hash_texto((select codigo from t_codigos where nome = 'b'));
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'b'), '198.51.100.1') ->> 'codigo', 'EXPIRADO', 'expirado: EXPIRADO');

-- um link novo da mesma pessoa anula o anterior ainda não usado
insert into t_codigos values
  ('c', api.sistema_criar_link_curto('hash-falso-cccccccccccc', 'recovery', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo_link');
insert into t_codigos values
  ('d', api.sistema_criar_link_curto('hash-falso-dddddddddddd', 'recovery', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo_link');
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'c'), '198.51.100.1') ->> 'codigo', 'EXPIRADO', 'link anterior anulado pelo novo');
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'd'), '198.51.100.1') ->> 'tipo', 'recovery', 'link novo vale');

-- limite por IP/dia: 30 tentativas; a 31ª é recusada mesmo com código válido; outro IP segue livre
insert into t_codigos values
  ('e', api.sistema_criar_link_curto('hash-falso-eeeeeeeeeeee', 'invite', '00000000-0000-0000-0000-0000000000b1') ->> 'codigo_link');
select is((select count(*)::int from (select api.sistema_resgatar_link('ZZZZZZZZZZ', '203.0.113.7') ->> 'codigo' as c from generate_series(1, 30)) x where c = 'NAO_ENCONTRADO'), 30, '30 tentativas erradas do mesmo IP');
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'e'), '203.0.113.7') ->> 'codigo', 'LIMITE_EXCEDIDO', '31ª tentativa do IP: LIMITE_EXCEDIDO');
select is((select usado_em from interno.links_acesso where codigo_hash = interno.hash_texto((select codigo from t_codigos where nome = 'e'))), null, 'recusa por limite não gasta o link');
select is(api.sistema_resgatar_link((select codigo from t_codigos where nome = 'e'), '203.0.113.8') ->> 'ok', 'true', 'outro IP: resgata');
select is_empty($$ select 1 from interno.limites_ip where ip_hash like '%203.0.113%' $$, 'o IP é guardado só como hash');

-- auditoria (origem sistema; recusa por limite auditada uma vez só)
select is((select count(*)::int from app.auditoria where acao = 'RESGATAR_LINK' and codigo = 'LIMITE_EXCEDIDO'), 1, 'limite auditado uma vez');
select ok((select bool_and(detalhe ->> 'origem' = 'sistema') from app.auditoria where acao in ('RESGATAR_LINK', 'CRIAR_LINK_CURTO')),
  'auditoria com origem = sistema');

-- privilégios
select ok(not has_function_privilege('anon', 'api.sistema_resgatar_link(text, text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'api.sistema_resgatar_link(text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.sistema_criar_link_curto(text, text, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'api.sistema_criar_link_curto(text, text, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'api.sistema_resgatar_link(text, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'api.sistema_criar_link_curto(text, text, uuid)', 'EXECUTE'),
  'RPCs de link: só service_role executa');
select ok(not has_table_privilege('anon', 'interno.links_acesso', 'SELECT')
          and not has_table_privilege('authenticated', 'interno.links_acesso', 'SELECT')
          and not has_table_privilege('authenticated', 'interno.limites_ip', 'SELECT'),
  'tabelas de link: sem acesso para anon/authenticated');

select * from finish();
rollback;
