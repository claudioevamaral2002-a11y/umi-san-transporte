-- Fase 4, Tarefa 11 (migration 20261020120260_categorias_adm.sql): api.categorias_adm, a leitura da tela "Categorias e
-- preços" do ADM. Todas as categorias (também as inativas) e o preço por categoria de uma versão do contrato; versão
-- antiga sem preço por categoria devolve `precos` nulo; só o ADM.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local');
update app.perfis set senha_pendente = false;
update app.categorias set ativa = false where codigo = 'CARGA_PESADA';

select set_config('t.contrato', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
-- Versão 1 da empresa: antiga, sem preço por categoria.
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4']) u;

select ok(has_function_privilege('authenticated', 'api.categorias_adm(uuid, integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'api.categorias_adm(uuid, integer)', 'EXECUTE'), 'privilégios: só authenticated');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.r1', api.categorias_adm()::text, true);
select set_config('t.r2', api.categorias_adm('00000000-0000-0000-0000-0000000000e1', 1)::text, true);
-- Versão 2 com preço por categoria (pela RPC nova).
select set_config('t.pub', api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.contrato')::jsonb,
  '{"PASSAGEIROS": {"km_cent": 300, "taxa_fixa_cent": 0}, "CARGA_LEVE": {"km_cent": 500, "taxa_fixa_cent": 0},
    "CARGA_PESADA": {"km_cent": 700, "taxa_fixa_cent": 20000}}'::jsonb, now() + interval '1 day')::text, true);
select set_config('t.r3', api.categorias_adm('00000000-0000-0000-0000-0000000000e1', 2)::text, true);
select set_config('t.r4', api.categorias_adm('00000000-0000-0000-0000-0000000000e1', 9)::text, true);
select set_config('t.r5', api.categorias_adm(null, 1)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.m', api.categorias_adm()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.n1', api.categorias_adm()::text, true);
reset role;

select is((select string_agg((x ->> 'codigo') || ':' || (x ->> 'ativa'), ',')
             from jsonb_array_elements(current_setting('t.r1')::jsonb -> 'categorias') x),
  'PASSAGEIROS:true,CARGA_LEVE:true,CARGA_PESADA:false,MOTORISTA:true', 'todas as categorias, na ordem, também a inativa');
select ok(current_setting('t.r1')::jsonb #>> '{categorias,0,nome}' = 'IVO Passageiros'
      and current_setting('t.r1')::jsonb #>> '{categorias,0,descricao_curta}' = 'até 4 pessoas', 'com nome e descrição');
select is(current_setting('t.r1')::jsonb -> 'precos', 'null'::jsonb, 'sem versão: precos nulo');
select is(current_setting('t.r2')::jsonb -> 'precos', 'null'::jsonb, 'versão antiga sem preço por categoria: precos nulo');
select is(current_setting('t.pub')::jsonb ->> 'versao', '2', 'publicada a versão 2 pela RPC nova');
select is(current_setting('t.r3')::jsonb -> 'precos',
  '{"PASSAGEIROS": {"km_cent": 300, "taxa_fixa_cent": 0}, "CARGA_LEVE": {"km_cent": 500, "taxa_fixa_cent": 0},
    "CARGA_PESADA": {"km_cent": 700, "taxa_fixa_cent": 20000}}'::jsonb, 'versão nova: o preço de cada categoria');
select ok(current_setting('t.r4')::jsonb = '{"ok": false, "codigo": "NAO_ENCONTRADO"}'::jsonb
      and current_setting('t.r5')::jsonb = '{"ok": false, "codigo": "NAO_ENCONTRADO"}'::jsonb,
  'versão inexistente (ou da tabela modelo vazia): NAO_ENCONTRADO');
select ok(current_setting('t.m')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb
      and current_setting('t.n1')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'motorista e N1: SEM_PERMISSAO');
select ok(exists (select 1 from app.auditoria where acao = 'CATEGORIAS_ADM' and resultado = 'NEGADO'
                     and usuario_id = '00000000-0000-0000-0000-0000000000a4'), 'negação auditada');

select * from finish();
rollback;
