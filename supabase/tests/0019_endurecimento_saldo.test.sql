-- Fase 2B, revisão independente do motor de saldo (migration 20261009141000_endurecimento_saldo.sql): travas de
-- atividade sem conflito com FK (I1), disponivel_cent só para cliente/ADM (I2), multa esperada e MULTA_ALTERADA com as
-- fronteiras exatas das faixas (I3), coerência do livro-razão e das reservas (I4), conta protegida (I5), reconciliação
-- com as divergências novas (I6), tópico saldo:<empresa> (M1), idempotência com motivo/comprovante (M2), painel sem
-- datas infinitas (M6), chave de outra ação, chave do colega e escrita direta no livro-razão.
-- Concorrência real (estorno × cancelamento, aprovação × expiração, recarga × aprovação): tests/integracao/saldo.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

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
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local');
update app.perfis set senha_pendente = false;

-- Faixas: ≥ 48 h 0%; ≥ 24 h 25%; ≥ 6 h 50%; ≥ 0 h 100%.
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 24, "multa_bp": 2500},
                          {"antecedencia_min_horas": 6, "multa_bp": 5000}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now() - interval '1 hour', null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.base')::jsonb, now() - interval '1 hour', null, 'Teste');
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']) u;
select set_config('t.k' || i, gen_random_uuid()::text, true) from generate_series(1, 30) i;

-- Pedidos (total = pedágio): p1..p7 e p9 aprovados; p8 fica ORCADA; pb é da empresa B (ORCADA).
create temp table casos (nome text primary key, quem text, atraso interval, aprova boolean) on commit drop;
insert into casos values
  ('p1', 'a5', '5 days', true),            ('p2', 'a5', '5 days 3 hours', true), ('p3', 'a5', '5 days 6 hours', true),
  ('p4', 'a5', '5 days 9 hours', true),    ('p5', 'a5', '5 days 12 hours', true), ('p6', 'a5', '5 days 15 hours', true),
  ('p7', 'a5', '5 days 18 hours', true),   ('p8', 'a5', '5 days 21 hours', false), ('p9', 'a5', '6 days 6 hours', true),
  ('pb', 'a7', '6 days', false);

do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca1'), true);
  perform api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000000, 'Pix inicial', null, current_setting('t.k1')::uuid);
  for x in select * from casos order by nome loop
    perform set_config('request.jwt.claims', current_setting('t.c' || x.quem), true);
    perform set_config('t.' || x.nome, api.criar_pedido(jsonb_build_object(
      'duracao_min', 120, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
      'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
      'inicio', to_char((now() + x.atraso) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ->> 'id', true);
    perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
    perform api.enviar_orcamento(current_setting('t.' || x.nome)::uuid, jsonb_build_object('pedagio_cent', 1001), null);
    perform set_config('t.h_' || x.nome, (select o.hash from app.orcamentos o
                                           where o.atividade_id = current_setting('t.' || x.nome)::uuid
                                             and o.status = 'PENDENTE'), true);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select * from casos where aprova order by nome loop
    perform set_config('t.ap_' || x.nome, api.aprovar_orcamento(current_setting('t.' || x.nome)::uuid, 1,
      current_setting('t.h_' || x.nome), case when x.nome = 'p7' then current_setting('t.k7')::uuid else gen_random_uuid() end,
      null)::text, true);
  end loop;
end $$;
select set_config('t.l_k1', (select id::text from app.lancamentos where chave_idempotencia = current_setting('t.k1')::uuid), true);
select is((select count(*)::int from casos c where c.aprova and (current_setting('t.ap_' || c.nome)::jsonb ->> 'ok')::boolean),
  8, 'preparo: 8 pedidos aprovados');

------------------------------------------------------------------ 1. I1: nenhuma trava FOR UPDATE em app.atividades
select is_empty($$
  select n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'app', 'interno') and p.prosrc ~* 'app\.atividades[^;]*for update'
$$, 'I1: toda trava de app.atividades é FOR NO KEY UPDATE (não bloqueia o FOR KEY SHARE da FK do livro-razão)');
select ok((select prosrc from pg_proc where oid = 'api.estornar_lancamento(bigint, text, uuid)'::regprocedure)
            ~* 'app\.atividades[^;]*for no key update',
  'I1: o estorno trava a atividade do lançamento original');
select ok(strpos((select prosrc from pg_proc where oid = 'api.estornar_lancamento(bigint, text, uuid)'::regprocedure),
                 'for no key update') < strpos((select prosrc from pg_proc
                                                 where oid = 'api.estornar_lancamento(bigint, text, uuid)'::regprocedure),
                                                'lancar_manual'),
  'I1: a atividade é travada antes da conta (lancar_manual)');

------------------------------------------------------------------ 2. I2: disponivel_cent só para cliente e ADM
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.cx_p1', api.cancelar_agendado(current_setting('t.p1')::uuid, 'Veículo quebrado', gen_random_uuid())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.cx_p2', api.cancelar_agendado(current_setting('t.p2')::uuid, 'Reorganização', gen_random_uuid())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.cx_p3g', api.cancelar_agendado(current_setting('t.p3')::uuid, 'Gestor', gen_random_uuid(), 0)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cx_p3', api.cancelar_agendado(current_setting('t.p3')::uuid, null, current_setting('t.k8')::uuid, 0)::text, true);
reset role;
select is(current_setting('t.cx_p1')::jsonb - 'atividade_id',
  '{"ok": true, "liberado_cent": 1001, "multa_cent": 0, "faixa": null}'::jsonb,
  'I2: motorista cancela sem custo e NÃO recebe disponivel_cent');
select ok((current_setting('t.cx_p2')::jsonb ? 'disponivel_cent') and (current_setting('t.cx_p2')::jsonb ->> 'ok')::boolean,
  'I2: ADM recebe disponivel_cent');
select is(current_setting('t.cx_p3g')::jsonb, '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb,
  'I2: gestor de frota não cancela nem recebe saldo');
select is((current_setting('t.cx_p3')::jsonb ->> 'disponivel_cent')::bigint,
  (select saldo_contabil_cent - reservado_cent from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  'I2: cliente recebe disponivel_cent (o da conta)');
select is((select resultado ? 'disponivel_cent' from app.idempotencia
            where empresa_id = '00000000-0000-0000-0000-0000000000e1' and acao = 'CANCELAR_AGENDADO'
              and alvo = 'atividade:' || current_setting('t.p1')), false,
  'I2: nem a repetição da chave do motorista devolve saldo');

------------------------------------------------------------------ 3. I3: multa esperada, MULTA_ALTERADA e fronteiras
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.cancelar_agendado(current_setting('t.p4')::uuid, null, gen_random_uuid()) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'I3: cliente sem a multa esperada: CAMPOS_INVALIDOS');
select is(api.cancelar_agendado(current_setting('t.p4')::uuid, null, gen_random_uuid(), -1) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'I3: multa esperada negativa: CAMPOS_INVALIDOS');
select set_config('t.sim_p4', api.simular_cancelamento(current_setting('t.p4')::uuid)::text, true);
reset role;
select is(current_setting('t.sim_p4')::jsonb -> 'faixa', '{"antecedencia_min_horas": 48, "multa_bp": 0}'::jsonb,
  'I3: prévia de p4 (mais de 48 h antes): sem multa');
-- a faixa muda entre a prévia e a confirmação (o horário chegou a menos de 6 h)
update app.atividades set prazo_orcar_ate = least(prazo_orcar_ate, clock_timestamp() + interval '5 hours 59 minutes'),
                          inicio = clock_timestamp() + interval '5 hours 59 minutes'
 where id = current_setting('t.p4')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cx_p4', api.cancelar_agendado(current_setting('t.p4')::uuid, null, current_setting('t.k9')::uuid,
  (current_setting('t.sim_p4')::jsonb ->> 'multa_cent')::bigint)::text, true);
reset role;
select is(current_setting('t.cx_p4')::jsonb,
  '{"ok": false, "codigo": "MULTA_ALTERADA", "multa_cent": 1001, "faixa": {"antecedencia_min_horas": 0, "multa_bp": 10000}}'::jsonb,
  'I3: prévia ≠ cobrança: MULTA_ALTERADA com a multa e a faixa novas');
select is((select a.status::text || '/' || count(r.id) filter (where r.ativa) || '/'
                  || (select count(*) from app.lancamentos l where l.atividade_id = a.id)
             from app.atividades a left join app.reservas r on r.atividade_id = a.id
            where a.id = current_setting('t.p4')::uuid group by a.id, a.status),
  'AGENDADA/1/1', 'I3: MULTA_ALTERADA não muda nada (ainda AGENDADA, reserva ativa, só o lançamento RESERVA)');
select ok(exists (select 1 from app.auditoria where acao = 'CANCELAR_AGENDADO' and resultado = 'NEGADO'
                    and codigo = 'MULTA_ALTERADA' and alvo = 'atividade:' || current_setting('t.p4')
                    and (detalhe ->> 'multa_esperada_cent')::bigint = 0 and (detalhe ->> 'multa_cent')::bigint = 1001),
  'I3: MULTA_ALTERADA auditada com a multa esperada e a calculada');
select is((select count(*)::int from app.idempotencia where chave = current_setting('t.k9')::uuid), 0,
  'I3: MULTA_ALTERADA não consome a chave');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cx_p4b', api.cancelar_agendado(current_setting('t.p4')::uuid, null, current_setting('t.k10')::uuid,
  1001)::text, true);
reset role;
select is(current_setting('t.cx_p4b')::jsonb - 'atividade_id' - 'disponivel_cent',
  '{"ok": true, "liberado_cent": 1001, "multa_cent": 1001, "faixa": {"antecedencia_min_horas": 0, "multa_bp": 10000}}'::jsonb,
  'I3: nova confirmação (chave nova, multa nova): cancela com a multa que o cliente viu');

-- fronteiras pela RPC (margem de 30 s do relógio): pouco acima de 6 h → 50%; início já passado → 100%
update app.atividades set prazo_orcar_ate = least(prazo_orcar_ate, clock_timestamp() + interval '6 hours 30 seconds'),
                          inicio = clock_timestamp() + interval '6 hours 30 seconds'
 where id = current_setting('t.p5')::uuid;
update app.atividades set prazo_orcar_ate = least(prazo_orcar_ate, clock_timestamp() - interval '2 seconds'),
                          inicio = clock_timestamp() - interval '1 second'
 where id = current_setting('t.p6')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.sim_p5', api.simular_cancelamento(current_setting('t.p5')::uuid)::text, true);
select set_config('t.sim_p6', api.simular_cancelamento(current_setting('t.p6')::uuid)::text, true);
select set_config('t.cx_p5', api.cancelar_agendado(current_setting('t.p5')::uuid, null, gen_random_uuid(),
  (current_setting('t.sim_p5')::jsonb ->> 'multa_cent')::bigint)::text, true);
select set_config('t.cx_p6', api.cancelar_agendado(current_setting('t.p6')::uuid, null, gen_random_uuid(),
  (current_setting('t.sim_p6')::jsonb ->> 'multa_cent')::bigint)::text, true);
reset role;
select is(current_setting('t.cx_p5')::jsonb -> 'faixa', '{"antecedencia_min_horas": 6, "multa_bp": 5000}'::jsonb,
  'I3: pouco acima de 6 h: faixa de 6 h');
select is((current_setting('t.cx_p5')::jsonb ->> 'multa_cent')::bigint, 501::bigint, 'I3: prévia = cobrança: 50% de 1001 = 501');
select is((current_setting('t.cx_p6')::jsonb ->> 'multa_cent')::bigint, 1001::bigint, 'I3: depois do início: faixa de 0 h (100%)');
select is((select l.orcamento_id from app.lancamentos l where l.atividade_id = current_setting('t.p5')::uuid and l.tipo = 'MULTA'),
  (select r.orcamento_id from app.reservas r where r.atividade_id = current_setting('t.p5')::uuid),
  'M5: a MULTA aponta o orçamento da reserva');

-- fronteiras exatas (relógio fixo em p_agora)
select set_config('t.fx', current_setting('t.base')::jsonb ->> 'faixas_cancelamento', true);
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-10 06:00:00+00') - 'horas_antes',
  '{"faixa": {"antecedencia_min_horas": 6, "multa_bp": 5000}, "multa_cent": 501}'::jsonb, 'fronteira: exatamente 6 h antes → faixa de 6 h');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-10 06:00:00.000001+00') -> 'faixa',
  '{"antecedencia_min_horas": 0, "multa_bp": 10000}'::jsonb, 'fronteira: 1 µs depois de 6 h antes → faixa de 0 h');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-10 05:59:59.999999+00') -> 'faixa',
  '{"antecedencia_min_horas": 6, "multa_bp": 5000}'::jsonb, 'fronteira: 1 µs antes de 6 h antes → faixa de 6 h');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-10 12:00:00+00'),
  '{"horas_antes": 0.00, "faixa": {"antecedencia_min_horas": 0, "multa_bp": 10000}, "multa_cent": 1001}'::jsonb,
  'fronteira: exatamente 0 h (no início) → faixa de 0 h');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-10 13:00:00+00') -> 'faixa',
  '{"antecedencia_min_horas": 0, "multa_bp": 10000}'::jsonb, 'depois do início → faixa de 0 h');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-09 12:00:00+00') -> 'multa_cent',
  '250'::jsonb, 'fronteira: exatamente 24 h → 25% (250,25 → 250)');
select is(interno.calcular_multa(1001, current_setting('t.fx')::jsonb, '2030-01-10 12:00:00+00', '2030-01-08 12:00:00+00') -> 'multa_cent',
  '0'::jsonb, 'fronteira: exatamente 48 h → 0%');
select throws_ok($$ select interno.calcular_multa(1000, null, now(), now()) $$, 'XX001', null,
  'M5: sem faixas: erro de integridade (nunca multa 0 calada)');
select throws_ok($$ select interno.calcular_multa(1000, '[]', now(), now()) $$, 'XX001', null, 'M5: faixas vazias: erro');
select throws_ok($$ select interno.calcular_multa(null, '[{"antecedencia_min_horas": 0, "multa_bp": 100}]', now(), now()) $$,
  'XX001', null, 'M5: sem total: erro');
select throws_ok(format($$ select interno.orcamento_da_reserva(%L) $$, current_setting('t.p8')), 'XX001', null,
  'M5: atividade sem reserva ativa: orçamento da reserva é erro de integridade');

------------------------------------------------------------------ 4. chave do colega e de outra ação
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.aprovar_orcamento(current_setting('t.p7')::uuid, 1, current_setting('t.h_p7'), current_setting('t.k7')::uuid, null),
  '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'colega N2 repetindo a chave da aprovação do outro: SEM_PERMISSAO');
select is(api.cancelar_agendado(current_setting('t.p3')::uuid, null, current_setting('t.k8')::uuid, 0),
  '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'colega N2 repetindo a chave do cancelamento do outro: SEM_PERMISSAO');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', 100, 'Ajuste com chave da recarga', current_setting('t.k1')::uuid) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'chave da recarga num ajuste: CHAVE_REUTILIZADA');
select is(api.estornar_lancamento(current_setting('t.l_k1')::bigint,
  'Estorno com chave da recarga', current_setting('t.k1')::uuid) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'chave da recarga num estorno: CHAVE_REUTILIZADA');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.aprovar_orcamento(current_setting('t.p8')::uuid, 1, current_setting('t.h_p8'), current_setting('t.k1')::uuid, null) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'chave da recarga numa aprovação (mesma empresa): CHAVE_REUTILIZADA');
select is(api.cancelar_agendado(current_setting('t.p9')::uuid, null, current_setting('t.k7')::uuid, 0) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'chave da aprovação num cancelamento: CHAVE_REUTILIZADA');
reset role;
select is((select status::text from app.atividades where id = current_setting('t.p8')::uuid), 'ORCADA',
  'chave reutilizada não aprova');

------------------------------------------------------------------ 5. M2: idempotência confere motivo e comprovante
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.r2', api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 5000, 'Pix A', 'E2E-A', current_setting('t.k2')::uuid)::text, true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 5000, 'Pix A', 'E2E-A', current_setting('t.k2')::uuid),
  current_setting('t.r2')::jsonb, 'M2: mesma chave e mesmos dados: o resultado original');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 5000, 'Pix B', 'E2E-A', current_setting('t.k2')::uuid) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'M2: recarga com a mesma chave e outro motivo: CHAVE_REUTILIZADA');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 5000, 'Pix A', 'E2E-B', current_setting('t.k2')::uuid) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'M2: recarga com a mesma chave e outro comprovante: CHAVE_REUTILIZADA');
select set_config('t.aj3', api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', -300, 'Correção A', current_setting('t.k3')::uuid)::text, true);
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', -300, 'Correção B', current_setting('t.k3')::uuid) ->> 'codigo',
  'CHAVE_REUTILIZADA', 'M2: ajuste com a mesma chave e outro motivo: CHAVE_REUTILIZADA');
select set_config('t.es4', api.estornar_lancamento((current_setting('t.aj3')::jsonb ->> 'lancamento_id')::bigint, 'Estorno A',
  current_setting('t.k4')::uuid)::text, true);
select is(api.estornar_lancamento((current_setting('t.aj3')::jsonb ->> 'lancamento_id')::bigint, 'Estorno B',
  current_setting('t.k4')::uuid) ->> 'codigo', 'CHAVE_REUTILIZADA', 'M2: estorno com a mesma chave e outro motivo: CHAVE_REUTILIZADA');
reset role;
select is((select count(*)::int from app.lancamentos where chave_idempotencia = current_setting('t.k2')::uuid), 1,
  'M2: um único lançamento da recarga');

------------------------------------------------------------------ 6. escrita direta no livro-razão e na conta
set local role authenticated;
select throws_ok($$ update app.lancamentos set valor_cent = 1 $$, '42501', null, 'authenticated: UPDATE em lançamentos recusado');
select throws_ok($$ delete from app.lancamentos $$, '42501', null, 'authenticated: DELETE em lançamentos recusado');
select throws_ok($$ delete from app.contas $$, '42501', null, 'authenticated: DELETE em contas recusado');
reset role;
select throws_ok($$ update app.contas set atualizado_em = now() where empresa_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'I5: UPDATE direto na conta recusado (mesmo para postgres)');
select throws_ok($$ update app.contas set saldo_contabil_cent = saldo_contabil_cent + 1 $$, '42501', null,
  'I5: nem saldo nem reservado mudam por fora do livro-razão');
select throws_ok($$ delete from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e2' $$, '42501', null,
  'I5: DELETE de conta recusado');
select throws_ok($$ truncate app.contas $$, '42501', null, 'I5: TRUNCATE de contas recusado');
select throws_ok($$ insert into app.contas (empresa_id, saldo_contabil_cent) values ('00000000-0000-0000-0000-0000000000e1', 5) $$,
  '42501', null, 'I5: conta não nasce com saldo');
select is((select (saldo_contabil_cent, reservado_cent)::text from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e2'),
  '(0,0)', 'I5: o lançamento continua atualizando a conta (empresa B intacta)');

------------------------------------------------------------------ 7. I4: coerência (postgres por fora das RPCs) → 23514
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, motivo, chave_idempotencia)
                          values ('00000000-0000-0000-0000-0000000000e1', 'AJUSTE', 10, %L, 'injetado', gen_random_uuid()) $$,
                        current_setting('t.pb')),
  '23514', null, 'I4: lançamento com atividade de outra empresa');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, chave_idempotencia)
                          values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -10, %L,
                                  (select id from app.orcamentos where atividade_id = %L), gen_random_uuid()) $$,
                        current_setting('t.p8'), current_setting('t.pb')),
  '23514', null, 'I4: lançamento com orçamento de outra atividade');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, chave_idempotencia)
                          select r.empresa_id, 'LIBERACAO_RESERVA', r.valor_cent - 1, r.atividade_id, r.orcamento_id, r.id, gen_random_uuid()
                            from app.reservas r where r.atividade_id = %L $$, current_setting('t.p1')),
  '23514', null, 'I4: liberação com valor diferente do reservado');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, chave_idempotencia)
                          select r.empresa_id, 'LIBERACAO_RESERVA', r.valor_cent, r.atividade_id, r.orcamento_id, r.id, gen_random_uuid()
                            from app.reservas r where r.atividade_id = %L and r.ativa $$, current_setting('t.p7')),
  '23514', null, 'I4: liberação de reserva ainda ativa');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, chave_idempotencia)
                          select r.empresa_id, 'RESERVA', r.valor_cent, r.atividade_id, r.orcamento_id, r.id, gen_random_uuid()
                            from app.reservas r where r.atividade_id = %L $$, current_setting('t.p1')),
  '23514', null, 'I4: RESERVA de reserva já liberada');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, reserva_id, chave_idempotencia)
                          select '00000000-0000-0000-0000-0000000000e2', 'LIBERACAO_RESERVA', r.valor_cent, r.atividade_id, r.id, gen_random_uuid()
                            from app.reservas r where r.atividade_id = %L $$, current_setting('t.p1')),
  '23514', null, 'I4: liberação de reserva de outra empresa');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, estorna_id, motivo, chave_idempotencia)
                    select empresa_id, 'ESTORNO', -valor_cent + 1, id, 'injetado', gen_random_uuid()
                      from app.lancamentos where chave_idempotencia = current_setting('t.k2')::uuid $$,
  '23514', null, 'I4: estorno com valor ≠ −original');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, estorna_id, motivo, chave_idempotencia)
                    select '00000000-0000-0000-0000-0000000000e2', 'ESTORNO', -valor_cent, id, 'injetado', gen_random_uuid()
                      from app.lancamentos where chave_idempotencia = current_setting('t.k2')::uuid $$,
  '23514', null, 'I4: estorno em outra empresa');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, estorna_id, motivo, chave_idempotencia)
                          select empresa_id, 'ESTORNO', -valor_cent, atividade_id, id, 'injetado', gen_random_uuid()
                            from app.lancamentos where atividade_id = %L and tipo = 'RESERVA' $$, current_setting('t.p7')),
  '23514', null, 'I4: estorno de lançamento não estornável (RESERVA)');
select throws_ok(format($$ insert into app.reservas (empresa_id, atividade_id, orcamento_id, valor_cent)
                          select '00000000-0000-0000-0000-0000000000e2', o.atividade_id, o.id, 1 from app.orcamentos o
                           where o.atividade_id = %L $$, current_setting('t.p8')),
  '23514', null, 'I4: reserva de outra empresa que não a da atividade');
select throws_ok(format($$ insert into app.reservas (empresa_id, atividade_id, orcamento_id, valor_cent)
                          values ('00000000-0000-0000-0000-0000000000e1', %L, (select id from app.orcamentos where atividade_id = %L), 1) $$,
                        current_setting('t.p8'), current_setting('t.pb')),
  '23514', null, 'I4: reserva com orçamento de outra atividade');

------------------------------------------------------------------ 8. M1: tópico saldo:<empresa>
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select ok(app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e1'), 'M1: N1 assina o saldo da empresa');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select ok(app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e1'), 'M1: N2 assina o saldo da empresa');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select ok(app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e1'), 'M1: N3 assina o saldo da empresa');
select ok(not app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e2'), 'M1: cliente não assina o saldo de outra empresa');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select ok(app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e2'), 'M1: ADM assina o saldo de qualquer empresa');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select ok(not app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e1'), 'M1: motorista não assina saldo');
select ok(app.pode_ver_topico('empresa:00000000-0000-0000-0000-0000000000e1'), 'M1: motorista continua no tópico de status da empresa');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select ok(not app.pode_ver_topico('saldo:00000000-0000-0000-0000-0000000000e1'), 'M1: gestor de frota não assina saldo');
select ok(not app.pode_ver_topico('saldo:00000000-0000-0000-0000-00000000dead'), 'M1: empresa inexistente recusada');
reset role;
select ok((select prosrc from pg_proc where oid = 'interno.lancamento_aplicar()'::regprocedure) ~ '''saldo:'' \|\| new\.empresa_id',
  'M1: lançamento publica `saldo` em saldo:<empresa>');
select ok(strpos((select prosrc from pg_proc where oid = 'interno.lancamento_aplicar()'::regprocedure), 'empresa:') = 0,
  'M1: nenhum evento de saldo no tópico empresa:<id> (que a equipe assina)');

------------------------------------------------------------------ 9. M6: painel sem datas infinitas
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.painel_adm('infinity', null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'M6: de = infinity recusado');
select is(api.painel_adm(null, 'infinity') ->> 'codigo', 'CAMPOS_INVALIDOS', 'M6: até = infinity recusado');
select is(api.painel_adm('-infinity', now()) ->> 'codigo', 'CAMPOS_INVALIDOS', 'M6: de = -infinity recusado');
select is(api.painel_adm(now() - interval '1 day', now()) ->> 'ok', 'true', 'M6: período finito continua valendo');
reset role;

------------------------------------------------------------------ 10. I6: reconciliação (limpa e com cada divergência nova)
select is(interno.reconciliar() -> 'divergencias', '[]'::jsonb, 'I6: reconciliação limpa depois de todo o fluxo acima');

alter table app.lancamentos disable trigger lancamentos_validar;
-- EMPRESA_DIVERGENTE: lançamento da empresa A apontando atividade da B
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, motivo, chave_idempotencia)
values ('00000000-0000-0000-0000-0000000000e1', 'AJUSTE', 10, current_setting('t.pb')::uuid, 'injetado', gen_random_uuid());
-- ESTORNO_DIVERGENTE: estorno de valor diferente do original
insert into app.lancamentos (empresa_id, tipo, valor_cent, estorna_id, motivo, chave_idempotencia)
select empresa_id, 'ESTORNO', -1, id, 'injetado', gen_random_uuid()
  from app.lancamentos where chave_idempotencia = current_setting('t.k2')::uuid;
-- RESERVA_VALOR_DIVERGENTE: p7 liberada com valor diferente do reservado
update app.reservas set ativa = false, liberada_em = now() where atividade_id = current_setting('t.p7')::uuid;
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, chave_idempotencia)
select r.empresa_id, 'LIBERACAO_RESERVA', r.valor_cent - 1, r.atividade_id, r.orcamento_id, r.id, gen_random_uuid()
  from app.reservas r where r.atividade_id = current_setting('t.p7')::uuid;
-- COBRANCA_SEM_APROVACAO: multa em atividade aprovada, mas sem o orçamento aprovado (p3 cancelada sem multa)
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, chave_idempotencia)
values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -10, current_setting('t.p3')::uuid, gen_random_uuid());
alter table app.lancamentos enable trigger lancamentos_validar;
-- RESERVA_SEM_PAR: p9 liberada sem o lançamento de liberação
update app.reservas set ativa = false, liberada_em = now() where atividade_id = current_setting('t.p9')::uuid;
-- AGENDADA_SEM_APROVACAO: p8 agendada por fora da aprovação
select interno.transicionar(current_setting('t.p8')::uuid, 'AGENDADA', 'injetado');

select set_config('t.r_div', interno.reconciliar()::text, true);
create function pg_temp.div(p_tipo text, p_campo text, p_valor text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
                  where x ->> 'tipo' = p_tipo and x ->> p_campo = p_valor)
$$;
select ok(pg_temp.div('EMPRESA_DIVERGENTE', 'atividade_id', current_setting('t.pb')), 'I6: EMPRESA_DIVERGENTE apontada');
select ok(pg_temp.div('ESTORNO_DIVERGENTE', 'estorna_id',
            (select id::text from app.lancamentos where chave_idempotencia = current_setting('t.k2')::uuid and tipo = 'RECARGA')),
  'I6: ESTORNO_DIVERGENTE apontado');
select ok(pg_temp.div('RESERVA_VALOR_DIVERGENTE', 'atividade_id', current_setting('t.p7')), 'I6: RESERVA_VALOR_DIVERGENTE apontada');
select ok(pg_temp.div('COBRANCA_SEM_APROVACAO', 'atividade_id', current_setting('t.p3')),
  'I6: COBRANCA_SEM_APROVACAO exige a aprovação do mesmo orçamento');
select ok(pg_temp.div('RESERVA_SEM_PAR', 'atividade_id', current_setting('t.p9')), 'I6: RESERVA_SEM_PAR apontada');
select ok(pg_temp.div('AGENDADA_SEM_APROVACAO', 'atividade_id', current_setting('t.p8')), 'I6: AGENDADA_SEM_APROVACAO apontada');
select ok(not pg_temp.div('RESERVA_SEM_PAR', 'atividade_id', current_setting('t.p7')),
  'I6: reserva liberada COM lançamento de liberação não é RESERVA_SEM_PAR');
select ok(not pg_temp.div('COBRANCA_SEM_APROVACAO', 'atividade_id', current_setting('t.p5')),
  'I6: multa com o orçamento aprovado não é apontada');

-- I5: conta que some com histórico é corrupção; sem histórico é recriada zerada
alter table app.contas disable trigger contas_proteger;
delete from app.contas where empresa_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
alter table app.contas enable trigger contas_proteger;
select throws_ok($$ select interno.travar_conta('00000000-0000-0000-0000-0000000000e1') $$, 'XX001', null,
  'I5: conta sumida de empresa com lançamentos: erro de integridade (não recria zerada)');
select is((interno.travar_conta('00000000-0000-0000-0000-0000000000e2')).saldo_contabil_cent, 0::bigint,
  'I5: empresa sem lançamentos: conta recriada zerada');

select * from finish();
rollback;
