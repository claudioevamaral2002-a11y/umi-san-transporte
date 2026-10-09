-- Fase 2A, Task 6 (migration 20261009132000_revisao_2a.sql): orçamento anterior para quem orça depois de uma
-- revisão, tópico de tempo real `equipe`, teto do cálculo (R2) e teto da auditoria de negações (R3).
-- A agenda do N2 (R1) está em 0013/0014.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n1a@teste.local',  'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local',  'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local',  'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('mot2@teste.local', 'Motorista Dois',  'MOTORISTA',    null, null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot2@teste.local');
update app.perfis set senha_pendente = false;
-- o segundo motorista é mais novo: o atribuído é a2
update app.perfis set criado_em = now() + interval '1 minute' where usuario_id = '00000000-0000-0000-0000-0000000000a9';

select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');
-- Empresa B: contrato com preço absurdo (só para provar o teto do cálculo pela RPC)
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2',
  current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 9000000000000000}', now(), null, 'Teste');
select set_config('t.cid', (select id::text from app.contratos_versoes where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);

select set_config('t.ped', jsonb_build_object('duracao_min', 120, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes',
  'levar', true, 'trazer', false, 'carga', 'PESSOAS', 'pessoas_qtd', 3, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
  'inicio', to_char((now() + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text, true);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) u;
select set_config('t.entrada1', '{"modalidade": "VEICULO_PROPRIO", "km": 100, "usa_reboque": false, "espera_horas": 1.5,
  "pedagio_cent": 3580, "hospedagem_diarias": 0, "outros": [{"descricao": "Balsa extra", "valor_cent": 2000}]}', true);

------------------------------------------------------------------ 1. orçamento anterior depois da revisão
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.q1', api.criar_pedido(current_setting('t.ped')::jsonb) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.r_antes', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('t.envio1', api.enviar_orcamento(current_setting('t.q1')::uuid, current_setting('t.entrada1')::jsonb, null)::text, true);
select set_config('t.r_orcada', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.rev1', api.pedir_revisao(current_setting('t.q1')::uuid, 'A distância real é 80 km')::text, true);
select set_config('t.r_cli', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.r_n1', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.r_ges', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select set_config('t.r_mot2', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.r_adm', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.r_mot', api.pedido(current_setting('t.q1')::uuid)::text, true);
reset role;

select ok(current_setting('t.q1') <> '' and (current_setting('t.envio1')::jsonb ->> 'ok')::boolean
          and (current_setting('t.rev1')::jsonb ->> 'ok')::boolean,
  'cenário: pedido criado, orçado (v1) e revisão pedida');
select is(current_setting('t.r_antes')::jsonb -> 'orcamento_anterior', 'null'::jsonb,
  'antes de qualquer orçamento: sem orçamento anterior');
select is(current_setting('t.r_orcada')::jsonb -> 'orcamento_anterior', 'null'::jsonb,
  'ORCADA (sem revisão pedida): sem orçamento anterior');
select is(current_setting('t.r_mot')::jsonb -> 'orcamento_anterior',
  (select jsonb_build_object('versao', 1, 'modalidade', 'VEICULO_PROPRIO', 'entrada', o.entrada, 'linhas', o.linhas,
                             'total_cent', o.total_cent, 'motivo_revisao', 'A distância real é 80 km')
     from app.orcamentos o where o.atividade_id = current_setting('t.q1')::uuid and o.versao = 1),
  'motorista atribuído: versão, modalidade, entrada, memorial, total e motivo da revisão');
select is(current_setting('t.r_mot')::jsonb -> 'orcamento_anterior' -> 'entrada', current_setting('t.entrada1')::jsonb,
  'a entrada anterior volta exatamente como foi enviada (pré-preenche o Orçar)');
select ok((current_setting('t.r_mot')::jsonb #>> '{acoes,orcar}')::boolean
          and current_setting('t.r_mot')::jsonb -> 'orcamento' = 'null'::jsonb,
  'motorista pode orçar de novo; não há orçamento vigente');
select is(current_setting('t.r_adm')::jsonb -> 'orcamento_anterior', current_setting('t.r_mot')::jsonb -> 'orcamento_anterior',
  'ADM vê o mesmo orçamento anterior');
select ok(current_setting('t.r_cli')::jsonb -> 'orcamento_anterior' = 'null'::jsonb
          and current_setting('t.r_n1')::jsonb -> 'orcamento_anterior' = 'null'::jsonb
          and (current_setting('t.r_cli')::jsonb ->> 'ok')::boolean and (current_setting('t.r_n1')::jsonb ->> 'ok')::boolean,
  'cliente (dono N2 e N1) não recebe o orçamento anterior');
select ok(current_setting('t.r_ges')::jsonb -> 'orcamento_anterior' = 'null'::jsonb
          and (current_setting('t.r_ges')::jsonb ->> 'ok')::boolean,
  'gestor de frota não recebe o orçamento anterior (sem preços)');
select is(current_setting('t.r_mot2')::jsonb, '{"ok": false, "codigo": "NAO_ENCONTRADO"}'::jsonb,
  'motorista não atribuído não vê o pedido');

-- reenvio e segunda revisão
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.envio2', api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 80}', null)::text, true);
select set_config('t.r_v2', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.rev2', api.pedir_revisao(current_setting('t.q1')::uuid, 'Inclua a espera')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.r_rev2', api.pedido(current_setting('t.q1')::uuid)::text, true);
reset role;
select ok((current_setting('t.envio2')::jsonb ->> 'versao')::int = 2
          and current_setting('t.r_v2')::jsonb -> 'orcamento_anterior' = 'null'::jsonb,
  'reenviado (ORCADA de novo): sem orçamento anterior');
select is(current_setting('t.r_rev2')::jsonb -> 'orcamento_anterior' - 'linhas' - 'total_cent',
  '{"versao": 2, "modalidade": "VEICULO_PROPRIO", "entrada": {"km": 80}, "motivo_revisao": "Inclua a espera"}'::jsonb,
  'segunda revisão (pelo N1): a última versão e o último motivo');

------------------------------------------------------------------ 2. tópico equipe
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select ok(app.pode_ver_topico('equipe') and app.pode_ver_equipe(), 'ADM assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select ok(app.pode_ver_topico('equipe'), 'motorista assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select ok(app.pode_ver_topico('equipe'), 'gestor de frota assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select ok(not app.pode_ver_topico('equipe') and not app.pode_ver_equipe(), 'cliente N1 não assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select ok(not app.pode_ver_topico('equipe'), 'cliente N2 não assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select ok(not app.pode_ver_topico('equipe'), 'cliente de outra empresa não assina equipe');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
                                                          'aal', 'aal1')::text, true);
select ok(not app.pode_ver_topico('equipe') and not app.pode_ver_equipe(), 'motorista em aal1 não assina equipe');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000dead", "role": "authenticated"}', true);
select ok(not app.pode_ver_topico('equipe'), 'sem perfil não assina equipe');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select ok(not app.pode_ver_topico('Equipe') and not app.pode_ver_topico('equipe:x') and not app.pode_ver_topico(' equipe'),
  'só o tópico exato "equipe"');
reset role;
select ok(pg_get_functiondef('interno.atividade_publicar()'::regprocedure) like '%''equipe''%'
          and pg_get_functiondef('interno.atividade_publicar()'::regprocedure) like '%''empresa_id''%',
  'a trigger publica também no tópico equipe, com a empresa');

------------------------------------------------------------------ 3. teto do cálculo (R2)
create function pg_temp.calc(p_levar boolean, p_trazer boolean, p_mod app.modalidade, e jsonb, p_ajuste jsonb default '{}')
returns jsonb language sql as $$
  select interno.calcular_linhas(jsonb_populate_record(c, p_ajuste), p_levar, p_trazer, p_mod, e)
  from app.contratos_versoes c where c.id = current_setting('t.cid')::bigint
$$;
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 100000}', '{"km_sem_reboque_cent": 9000000000000000}'),
  '{"ok": false, "codigo": "VALOR_FORA_DO_LIMITE"}'::jsonb, 'estouro do bigint no km vira VALOR_FORA_DO_LIMITE');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"hospedagem_diarias": 60}', '{"hospedagem_diaria_cent": 900000000000000000}'),
  '{"ok": false, "codigo": "VALOR_FORA_DO_LIMITE"}'::jsonb, 'estouro na multiplicação de diárias também');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 100000}', '{"km_sem_reboque_cent": 2000000}'),
  '{"ok": false, "codigo": "VALOR_FORA_DO_LIMITE"}'::jsonb, 'total acima de R$ 1 bilhão recusado');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 100000}', '{"km_sem_reboque_cent": 1000000}') -> 'total_cent',
  '100000000000'::jsonb, 'exatamente R$ 1 bilhão ainda passa');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10}') -> 'total_cent', '2500'::jsonb, 'cálculo normal inalterado');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.qb', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', to_char((now() + interval '4 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.calc_b', api.calcular_orcamento(current_setting('t.qb')::uuid, '{"km": 100000}')::text, true);
select set_config('t.env_b', api.enviar_orcamento(current_setting('t.qb')::uuid, '{"km": 100000}', null)::text, true);
reset role;
select ok(current_setting('t.calc_b')::jsonb = '{"ok": false, "codigo": "VALOR_FORA_DO_LIMITE"}'::jsonb
          and current_setting('t.env_b')::jsonb = '{"ok": false, "codigo": "VALOR_FORA_DO_LIMITE"}'::jsonb,
  'RPCs devolvem {ok:false, VALOR_FORA_DO_LIMITE} (sem erro 500)');
select ok((select status from app.atividades where id = current_setting('t.qb')::uuid) = 'SOLICITADA'
          and not exists (select 1 from app.orcamentos where atividade_id = current_setting('t.qb')::uuid),
  'nada gravado: segue SOLICITADA e sem orçamento');

------------------------------------------------------------------ 4. teto da auditoria de negações (R3)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.negs', (select count(*) filter (where api.pedido(gen_random_uuid()) ->> 'codigo' = 'NAO_ENCONTRADO')
                               from generate_series(1, 305))::text, true);
reset role;
select is(current_setting('t.negs')::int, 305, 'todas as 305 chamadas continuam negadas');
select is((select count(*)::int from app.auditoria
            where usuario_id = '00000000-0000-0000-0000-0000000000a8' and acao = 'VER_PEDIDO' and resultado = 'NEGADO'),
  300, 'só as primeiras 300 negações da hora são auditadas');
select is((select count(*)::int from app.auditoria
            where usuario_id = '00000000-0000-0000-0000-0000000000a8' and acao = 'AUDITORIA_LIMITADA'
              and codigo = 'LIMITE_EXCEDIDO' and detalhe ->> 'acao' = 'VER_PEDIDO'),
  1, 'uma linha AUDITORIA_LIMITADA marca o corte');

select set_config('request.jwt.claims', '', true);
select set_config('t.aud_antes', (select count(*)::text from app.auditoria where acao = 'TESTE_SISTEMA'), true);
select interno.negar('TESTE_SISTEMA', 'teste', 'SEM_PERMISSAO');
select is((select count(*)::int from app.auditoria where acao = 'TESTE_SISTEMA'), current_setting('t.aud_antes')::int + 1,
  'sem usuário (sistema): a negação é sempre auditada');

select * from finish();
rollback;
