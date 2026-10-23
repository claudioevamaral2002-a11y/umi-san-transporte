-- Fase 4.1, Tarefa 5 (migration 20261022120200_categorias_veiculo.sql): api.categorias_veiculo, os nomes das categorias
-- para o cadastro de veículo. Motorista e ADM leem (também as inativas e a de veículo do cliente, com as marcações);
-- cliente não; nenhum preço sai; o nome renomeado aparece.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a4', 'a8']) u;

update app.categorias set nome = 'IVO Passageiros VIP' where codigo = 'PASSAGEIROS';

select ok(has_function_privilege('authenticated', 'api.categorias_veiculo()', 'EXECUTE')
      and not has_function_privilege('anon', 'api.categorias_veiculo()', 'EXECUTE'),
  'categorias_veiculo: só authenticated');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.mot', api.categorias_veiculo()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm', api.categorias_veiculo()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.n1', api.categorias_veiculo()::text, true);
reset role;

select is((select string_agg(x ->> 'codigo' || ':' || (x ->> 'ativa') || ':' || (x ->> 'veiculo_cliente'), '|' order by i)
             from jsonb_array_elements(current_setting('t.mot')::jsonb -> 'categorias') with ordinality t(x, i)),
  'PASSAGEIROS:true:false|CARGA_LEVE:true:false|CARGA_PESADA:false:false|MOTORISTA:true:true',
  'motorista: todas as categorias, na ordem, com ativa e veiculo_cliente');
select is((select x ->> 'nome' from jsonb_array_elements(current_setting('t.mot')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'PASSAGEIROS'),
  'IVO Passageiros VIP', 'o nome atual (renomeado) vem do banco');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(current_setting('t.mot')::jsonb -> 'categorias') x,
             jsonb_object_keys(x) k),
  array['ativa', 'codigo', 'nome', 'ordem', 'veiculo_cliente'], 'só nome e marcações, nenhum preço');
select is(current_setting('t.adm')::jsonb -> 'categorias', current_setting('t.mot')::jsonb -> 'categorias',
  'o ADM lê a mesma lista');
select is(current_setting('t.n1')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'cliente: SEM_PERMISSAO');
select is((select count(*)::int from app.auditoria a where a.acao = 'CATEGORIAS_VEICULO' and a.resultado = 'NEGADO'), 1,
  'a negação é auditada');

select * from finish();
rollback;
