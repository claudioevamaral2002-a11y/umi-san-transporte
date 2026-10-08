-- api.sistema_papel_por_email: só ADM ativo; só service_role executa; auditado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into app.convites (email, nome, papel, empresa_id) values
  ('adm@teste.local', 'Admin Teste', 'ADM', null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local');

select is(api.sistema_papel_por_email('  ADM@teste.local ') ->> 'usuario_id', '00000000-0000-0000-0000-0000000000a1', 'ADM ativo: devolve o id (e-mail normalizado)');
select is(api.sistema_papel_por_email('mot@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'motorista: negado');
select is(api.sistema_papel_por_email('ninguem@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'e-mail inexistente: negado');
select is(api.sistema_papel_por_email(null) ->> 'codigo', 'NAO_PERMITIDO', 'nulo: negado');
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a1';
select is(api.sistema_papel_por_email('adm@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'ADM inativo: negado');
select is((select count(*)::int from app.auditoria where acao = 'LOCALIZAR_ADM' and detalhe ->> 'origem' = 'sistema'), 5, 'auditado com origem = sistema');

select ok(not has_function_privilege('authenticated', 'api.sistema_papel_por_email(text)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.sistema_papel_por_email(text)', 'EXECUTE'), 'anon/authenticated sem EXECUTE');
select ok(has_function_privilege('service_role', 'api.sistema_papel_por_email(text)', 'EXECUTE'), 'service_role executa');

select * from finish();
rollback;
