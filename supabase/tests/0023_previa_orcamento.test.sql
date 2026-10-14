-- Fase 3A (migration 20261015120200_previa_orcamento.sql): prévia do orçamento pela tabela do contrato vigente,
-- só para cliente N1 e N2; mesma conta do orçamento do motorista; nunca grava orçamento; recusas auditadas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e3', 'Empresa C');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n2c@teste.local', 'Solicitante C',   'CLIENTE', '00000000-0000-0000-0000-0000000000e3', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2c@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u = 'a2' then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a2', 'a4', 'a5', 'a6', 'a9']) u;
select set_config('t.e', '{"km": 38.2, "usa_reboque": true, "levar": true, "trazer": false, "modalidade": "VEICULO_PROPRIO"}', true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r', api.previa_orcamento(current_setting('t.e')::jsonb)::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'N2 vê a prévia');
select set_config('t.sem', api.previa_orcamento(current_setting('t.e')::jsonb || '{"usa_reboque": false}')::text, true);
select ok((current_setting('t.sem')::jsonb ->> 'total_cent')::int < (current_setting('t.r')::jsonb ->> 'total_cent')::int,
  'sem reboque sai mais barato');
select is(api.previa_orcamento(current_setting('t.e')::jsonb || '{"espera_horas": 2}') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'só km, reboque, levar/trazer e modalidade');
select is(api.previa_orcamento(current_setting('t.e')::jsonb || '{"km": 9000}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'km acima de 5000');
select is(api.previa_orcamento(current_setting('t.e')::jsonb || '{"km": 38.25}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'km com 2 casas');
select is(api.previa_orcamento(current_setting('t.e')::jsonb || '{"levar": false}') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'sem levar nem trazer');

select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'total_cent', current_setting('t.r')::jsonb ->> 'total_cent',
  'N1 vê a mesma prévia');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não vê');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'codigo', 'SEM_PERMISSAO', 'a equipe não usa a prévia do cliente');
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'codigo', 'SEM_CONTRATO', 'empresa sem contrato');

reset role;
select is((current_setting('t.r')::jsonb ->> 'total_cent')::bigint,
  (interno.calcular_linhas((select c from interno.contrato_vigente('00000000-0000-0000-0000-0000000000e1') c), true, false,
   'VEICULO_PROPRIO', '{"km": 38.2, "usa_reboque": true}') ->> 'total_cent')::bigint,
  'prévia = conta do orçamento do motorista');
select is((select count(*)::int from app.orcamentos), 0, 'a prévia nunca grava orçamento');
select ok((select count(*) from app.auditoria where acao = 'PREVIA_ORCAMENTO' and resultado = 'NEGADO') >= 3,
  'recusas auditadas');

select * from finish();
rollback;
