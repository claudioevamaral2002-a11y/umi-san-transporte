-- Fase 3A (migration 20261015120300_uso_mapas.sql): cada chamada ao Google passa antes por api.registrar_uso_mapas
-- (limite por usuário e teto diário por empresa, ajustável pelo ADM em app.configuracao).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n2b@teste.local', 'Solicitante B',   'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2b@teste.local');
update app.perfis set senha_pendente = false;
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a5', 'a6', 'a8']) u;

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is((select mapas_teto_diario_empresa from api.ler_configuracao()), 2000, 'teto padrão: 2.000 por dia');
select is(api.definir_teto_mapas(3) ->> 'ok', 'true', 'ADM ajusta o teto');
select is(api.definir_teto_mapas(0) ->> 'codigo', 'CAMPOS_INVALIDOS', 'teto 0 recusado');
select is(api.definir_teto_mapas(1000001) ->> 'codigo', 'CAMPOS_INVALIDOS', 'teto acima de 1.000.000 recusado');

select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.definir_teto_mapas(9999) ->> 'codigo', 'SEM_PERMISSAO', 'cliente não ajusta o teto');
select is(api.registrar_uso_mapas('SUGERIR') ->> 'ok', 'true', '1ª chamada');
select is(api.registrar_uso_mapas('ROTA') ->> 'ok', 'true', '2ª');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.registrar_uso_mapas('DETALHAR') ->> 'ok', 'true', '3ª (N3 da mesma empresa soma no mesmo teto)');
select is(api.registrar_uso_mapas('SUGERIR') ->> 'codigo', 'TETO_DIARIO', 'acima do teto da empresa');
select is(api.registrar_uso_mapas('OUTRO') ->> 'codigo', 'CAMPOS_INVALIDOS', 'tipo desconhecido');

select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.registrar_uso_mapas('SUGERIR') ->> 'ok', 'true', 'outra empresa tem o próprio teto');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_uso_mapas('ROTA') ->> 'ok', 'true', 'a equipe conta no teto da IVO');

-- Limite por usuário: 20 rotas por minuto (a equipe ainda tem 2 de 3 no teto; sobe o teto antes).
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select api.definir_teto_mapas(1000);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select api.registrar_uso_mapas('ROTA') from generate_series(1, 19);
select is(api.registrar_uso_mapas('ROTA') ->> 'codigo', 'LIMITE_EXCEDIDO', 'a 21ª rota no minuto é recusada');

reset role;
select ok((select count(*) from app.auditoria where acao = 'USO_MAPAS' and resultado = 'NEGADO') >= 2, 'recusas auditadas');

select * from finish();
rollback;
