-- Fase 4, ajustes da revisão final (migration 20261020120400_ajustes_revisao_final.sql, Ruling R18).
-- Cobre: (1) orçar pedido com categoria sem veiculo_id (Orçar do app atual e do ADM) usa o veículo ativo que atende a
-- categoria; sem nenhum, VEICULO_INVALIDO; veiculo_id explícito inválido continua recusado; (2) publicar_contrato depois
-- de publicar_contrato_categorias mantém o preço por categoria na versão nova (e o modelo sem preço não ganha linhas);
-- (3) orçamento de total 0 recusado com VALOR_INVALIDO; (4) telefone do motorista só em AGENDADA, EM_ANDAMENTO e nas
-- 24 h depois da conclusão; (5) limite de leituras de painel_empresa (LIMITE_EXCEDIDO, auditado). As funções seguem
-- SECURITY DEFINER com search_path vazio e só para authenticated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n2b@teste.local', 'Solicitante B',   'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2b@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set telefone = '(47) 99999-1234' where usuario_id = '00000000-0000-0000-0000-0000000000a2';

select set_config('t.contrato', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
-- Empresa A, v1: antiga, sem preço por categoria. Empresa B: tudo a 0 (orçamento de total 0).
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.contrato')::jsonb
  || '{"km_sem_reboque_cent": 0, "km_com_reboque_cent": 0, "taxa_fixa_reboque_cent": 0}'::jsonb,
  now() - interval '1 hour', null, 'Teste');
-- Veículos do motorista: b1 atende Passageiros; b2 só Carga Leve.
insert into app.veiculos (id, motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'Corolla', 'Prata', 'ABC1D23', 4, 300,
   array['PASSAGEIROS']),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'Strada', 'Branca', 'XYZ9K88', 2, 600,
   array['CARGA_LEVE']);

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4', 'a5', 'a8']) u;
select set_config('t.base', '{"duracao_min": 30, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.i_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('p1', interval '3 hours'), ('p2', interval '4 hours'), ('p3', interval '5 hours'),
             ('pz', interval '6 hours')) x(n, d);

-- Telefone (chave e valor) de uma leitura de api.pedido guardada em t.<nome>.
create function pg_temp.tel(nome text) returns jsonb language sql stable as $$
  select case when (r ->> 'ok')::boolean then r #> '{pedido,motorista_telefone}'
              else jsonb_build_object('codigo', r -> 'codigo') end
    from (select current_setting('t.' || nome)::jsonb r) x
$$;

------------------------------------------------------------------ 2. publicar_contrato mantém o preço por categoria
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.v2', api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.contrato')::jsonb,
  '{"PASSAGEIROS":{"km_cent":300,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0},
    "CARGA_PESADA":{"km_cent":700,"taxa_fixa_cent":20000}}'::jsonb, now())::text, true);
-- A tela de Contratos do app atual: publicar_contrato, sem categorias, com outro km.
select set_config('t.v3', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.contrato')::jsonb || '{"km_sem_reboque_cent": 260}'::jsonb, now())::text, true);
select set_config('t.m1', api.publicar_contrato(null, current_setting('t.contrato')::jsonb, now())::text, true);
reset role;
select is(current_setting('t.v2')::jsonb, '{"ok":true,"versao":2}'::jsonb, 'v2 publicada com as 3 categorias');
select is(current_setting('t.v3')::jsonb, '{"ok":true,"versao":3}'::jsonb, 'v3 publicada pela RPC do app atual');
select is((select string_agg(cc.categoria || ':' || cc.km_cent || ':' || cc.taxa_fixa_cent, '|' order by cc.categoria)
             from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v.versao = 3),
  'CARGA_LEVE:500:0|CARGA_PESADA:700:20000|PASSAGEIROS:300:0',
  'a v3 herda o preço por categoria da v2');
select is((select count(*)::int from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v.versao = 2), 3,
  'a v2 continua com as próprias 3 linhas (publicar_contrato_categorias não duplica)');
select is((select km_sem_reboque_cent from app.contratos_versoes
            where empresa_id = '00000000-0000-0000-0000-0000000000e1' and versao = 3), 260::bigint,
  'a v3 grava os campos do contrato enviados');
select is(current_setting('t.m1')::jsonb ->> 'ok', 'true', 'modelo publicado sem versão anterior');
select is((select count(*)::int from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
            where v.empresa_id is null), 0, 'modelo sem preço por categoria na anterior: nada copiado');
select is((select (detalhe ->> 'categorias_copiadas')::int from app.auditoria
            where acao = 'PUBLICAR_CONTRATO' and resultado = 'OK' and alvo = 'contrato:00000000-0000-0000-0000-0000000000e1'
              and (detalhe ->> 'versao')::int = 3), 3,
  'a cópia fica na auditoria da publicação');

------------------------------------------------------------------ 1. orçar com categoria sem veiculo_id
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.p1', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p1'), 'categoria', 'PASSAGEIROS')) ->> 'id', true);
select set_config('t.p2', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p2'), 'categoria', 'PASSAGEIROS')) ->> 'id', true);
select set_config('t.p3', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p3'), 'categoria', 'PASSAGEIROS')) ->> 'id', true);
-- Motorista pelo Orçar do app atual (sem veiculo_id).
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.o1', api.enviar_orcamento(current_setting('t.p1')::uuid, '{"km": 10}', null)::text, true);
-- ADM pelo Orçar reaproveitado (sem veiculo_id).
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.o2', api.enviar_orcamento(current_setting('t.p2')::uuid, '{"km": 10}', null)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.p3')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b2"}', null) ->> 'codigo', 'VEICULO_INVALIDO',
  'veiculo_id explícito de outra categoria: VEICULO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.p3')::uuid, '{"km": 10, "veiculo_id": "x"}', null) ->> 'codigo',
  'VEICULO_INVALIDO', 'veiculo_id explícito malformado: VEICULO_INVALIDO');
reset role;
update app.veiculos set situacao = 'MANUTENCAO' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.p3')::uuid, '{"km": 10}', null) ->> 'codigo', 'VEICULO_INVALIDO',
  'sem veiculo_id e nenhum veículo ativo que atenda a categoria: VEICULO_INVALIDO');
reset role;
update app.veiculos set situacao = 'ATIVO' where id = '00000000-0000-0000-0000-0000000000b1';

select is(current_setting('t.o1')::jsonb ->> 'ok', 'true', 'motorista orça pedido com categoria sem veiculo_id');
select is((current_setting('t.o1')::jsonb ->> 'total_cent')::bigint, 4500::bigint,
  'preço da categoria herdado pela v3 (10 × 300 + retorno)');
select is((select veiculo_id from app.atividades where id = current_setting('t.p1')::uuid),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'o pedido fica com o veículo que atende a categoria');
select is((select detalhe ->> 'veiculo_id' from app.auditoria
            where acao = 'ENVIAR_ORCAMENTO' and resultado = 'OK' and alvo = 'atividade:' || current_setting('t.p1')),
  '00000000-0000-0000-0000-0000000000b1', 'a auditoria registra o veículo escolhido pelo banco');
select is(current_setting('t.o2')::jsonb ->> 'ok', 'true', 'ADM orça pedido com categoria sem veiculo_id');
select is((select status::text || ':' || veiculo_id::text from app.atividades where id = current_setting('t.p2')::uuid),
  'ORCADA:00000000-0000-0000-0000-0000000000b1', 'orçado pelo ADM: veículo do motorista do pedido');
select is((select status::text from app.atividades where id = current_setting('t.p3')::uuid), 'SOLICITADA',
  'as recusas não mudam o pedido');
select is((select count(*)::int from app.auditoria
            where acao = 'ENVIAR_ORCAMENTO' and codigo = 'VEICULO_INVALIDO' and alvo = 'atividade:' || current_setting('t.p3')
              and detalhe = '{"veiculo_id": null, "categoria": "PASSAGEIROS"}'::jsonb), 1,
  'a recusa sem veículo que atenda é auditada com a categoria');

------------------------------------------------------------------ 3. total 0 recusado
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.pz', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_pz'))) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.pz')::uuid, '{"km": 10}', null) ->> 'codigo', 'VALOR_INVALIDO',
  'orçamento de total 0: VALOR_INVALIDO');
reset role;
select ok(current_setting('t.pz') <> '', 'pedido da empresa B (contrato a 0) criado');
select is((select count(*)::int from app.orcamentos where atividade_id = current_setting('t.pz')::uuid), 0,
  'total 0: nenhum orçamento gravado');
select is((select status::text from app.atividades where id = current_setting('t.pz')::uuid), 'SOLICITADA',
  'total 0: o pedido continua SOLICITADA');
select is((select (detalhe ->> 'total_cent')::bigint from app.auditoria
            where acao = 'ENVIAR_ORCAMENTO' and codigo = 'VALOR_INVALIDO'), 0::bigint, 'VALOR_INVALIDO auditado com o total');

------------------------------------------------------------------ 4. telefone do motorista por situação
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.orc', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select interno.transicionar(current_setting('t.p1')::uuid, 'AGENDADA', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ag', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select interno.transicionar(current_setting('t.p1')::uuid, 'EM_ANDAMENTO', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.and', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select interno.transicionar(current_setting('t.p1')::uuid, 'CONCLUIDA', 'teste');
update app.atividades set concluiu_em = now() - interval '23 hours' where id = current_setting('t.p1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.c23', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
update app.atividades set concluiu_em = now() - interval '25 hours' where id = current_setting('t.p1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.c25', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.c25adm', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
update app.atividades set concluiu_em = null where id = current_setting('t.p1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.csem', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select interno.transicionar(current_setting('t.p2')::uuid, 'CANCELADA', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.can', api.pedido(current_setting('t.p2')::uuid)::text, true);
reset role;
select is(pg_temp.tel('orc'), 'null'::jsonb, 'ORCADA: sem telefone');
select is(pg_temp.tel('ag'), '"(47) 99999-1234"'::jsonb, 'AGENDADA: telefone');
select is(pg_temp.tel('and'), '"(47) 99999-1234"'::jsonb, 'EM_ANDAMENTO: telefone');
select is(pg_temp.tel('c23'), '"(47) 99999-1234"'::jsonb, 'CONCLUIDA há 23 h: telefone');
select is(pg_temp.tel('c25'), 'null'::jsonb, 'CONCLUIDA há 25 h: sem telefone');
select is(pg_temp.tel('c25adm'), 'null'::jsonb, 'CONCLUIDA há 25 h: sem telefone nem para o ADM');
select is(pg_temp.tel('csem'), 'null'::jsonb, 'CONCLUIDA sem horário de conclusão: sem telefone');
select is(pg_temp.tel('can'), 'null'::jsonb, 'CANCELADA: sem telefone');

------------------------------------------------------------------ 5. limite de leituras do painel
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.painel_empresa() ->> 'ok', 'true', 'dentro do limite: o painel abre');
reset role;
insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
values ('00000000-0000-0000-0000-0000000000a4', 'PAINEL_EMPRESA',
        to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 120)
on conflict (usuario_id, acao, janela_inicio) do update set contagem = 120;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.painel_empresa() ->> 'codigo', 'LIMITE_EXCEDIDO', 'a 121ª leitura na hora: LIMITE_EXCEDIDO');
reset role;
select is((select count(*)::int from app.auditoria
            where acao = 'PAINEL_EMPRESA' and resultado = 'NEGADO' and codigo = 'LIMITE_EXCEDIDO'
              and usuario_id = '00000000-0000-0000-0000-0000000000a4'), 1, 'a recusa pelo limite é auditada');

------------------------------------------------------------------ privilégios (como em 0001)
select ok((select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
            where p.oid in ('api.enviar_orcamento(uuid, jsonb, timestamptz)'::regprocedure,
                            'api.publicar_contrato(uuid, jsonb, timestamptz)'::regprocedure,
                            'api.pedido(uuid)'::regprocedure,
                            'api.painel_empresa(uuid, date)'::regprocedure)),
  'as 4 funções: security definer com search_path vazio');
select ok(not has_function_privilege('anon', 'api.enviar_orcamento(uuid, jsonb, timestamptz)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.publicar_contrato(uuid, jsonb, timestamptz)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.pedido(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.painel_empresa(uuid, date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.enviar_orcamento(uuid, jsonb, timestamptz)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.publicar_contrato(uuid, jsonb, timestamptz)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.pedido(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.painel_empresa(uuid, date)', 'EXECUTE'),
  'as 4 funções: authenticated executa, anon não');

select * from finish();
rollback;
