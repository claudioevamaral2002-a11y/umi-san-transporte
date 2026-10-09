-- Fase 2B, Task 2 (migration 20261009140100_aprovacao_cancelamento.sql): aprovação (permissão, estado, validade com
-- expiração na hora, versão/hash, horário, limite de crédito do contrato vigente, reserva sem efeito no contábil,
-- registro da aprovação, idempotência), simulação e cancelamento de AGENDADA (multa por faixa do SNAPSHOT mesmo depois
-- de publicar outro contrato, arredondamento meio para cima, prestador sem custo com motivo), privacidade do extrato e
-- reconciliação (reserva fora de AGENDADA, AGENDADA sem reserva, cobrança sem aprovação, cobrança duplicada).
-- Concorrência real: tests/integracao/saldo.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

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

-- Faixas: ≥ 48 h 0%; ≥ 24 h 25%; ≥ 6 h 50%; ≥ 0 h 100%. Limite negativo R$ 500,00.
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
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.9", "user-agent": "Navegador pgTAP"}', true);

-- Pedidos (início com microssegundos). A faixa é pelo relógio (clock_timestamp): c2 e c4 ficam 1 minuto ACIMA das
-- fronteiras de 48 h e 24 h; as fronteiras exatas estão em 0019 (interno.calcular_multa com relógio fixo).
create temp table casos (nome text primary key, quem text, atraso interval, total bigint) on commit drop;
insert into casos values
  ('q0', 'a5', '4 days', null),            ('q1', 'a5', '4 days 3 hours', 30000), ('q2', 'a5', '4 days 6 hours', 20000),
  ('q3', 'a5', '4 days 9 hours', 10001),   ('q4', 'a5', '4 days 12 hours', 10000), ('q5', 'a5', '4 days 15 hours', 1000),
  ('q6', 'a5', '4 days 18 hours', 1000),   ('q7', 'a5', '4 days 21 hours', 1000),
  ('c1', 'a5', '72 hours', 1001), ('c2', 'a5', '48 hours 1 minute', 1001), ('c3', 'a5', '30 hours', 1001),
  ('c4', 'a5', '24 hours 1 minute', 1001), ('c5', 'a5', '10 hours', 1001), ('c6', 'a5', '2 hours', 1001),
  ('c7', 'a5', '5 days', 1001),
  ('s1', 'a4', '6 days', 5000), ('s2', 'a4', '6 days 3 hours', 5000), ('s3', 'a4', '6 days 6 hours', 5000);

-- Laços de preparo em DO (as RPCs são SECURITY DEFINER e decidem por auth.uid() das claims, não pelo papel da sessão).
do $$
declare
  x record;
begin
  for x in select * from casos order by nome loop
    perform set_config('request.jwt.claims', current_setting('t.c' || x.quem), true);
    perform set_config('t.' || x.nome, api.criar_pedido(jsonb_build_object(
      'duracao_min', 120, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
      'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
      'inicio', to_char((now() + x.atraso) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ->> 'id', true);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
  for x in select * from casos where total is not null order by nome loop
    perform api.enviar_orcamento(current_setting('t.' || x.nome)::uuid, jsonb_build_object('pedagio_cent', x.total), null);
  end loop;
end $$;
select set_config('t.h_' || o_nome, h, true)
from (select c.nome as o_nome, o.hash as h from casos c
        join app.orcamentos o on o.atividade_id = current_setting('t.' || c.nome)::uuid and o.status = 'PENDENTE') y;
select is((select count(*)::int from app.atividades a join casos c on a.id = current_setting('t.' || c.nome)::uuid
            where a.status = case when c.total is null then 'SOLICITADA' else 'ORCADA' end::app.status_atividade),
  18, '18 pedidos preparados (17 orçados)');
select set_config('t.k' || i, gen_random_uuid()::text, true) from generate_series(1, 40) i;

------------------------------------------------------------------ 1. permissão e validação da aprovação
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 10000, 'Pix inicial', null, gen_random_uuid());
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'SEM_PERMISSAO', 'ADM não aprova pelo cliente');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'SEM_PERMISSAO', 'motorista não aprova');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'SEM_PERMISSAO', 'N3 (visualizador) não aprova');
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'SEM_PERMISSAO', 'N2 não aprova pedido do colega');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente de outra empresa não aprova');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'), null, null) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'aprovação sem chave recusada');
select is(api.aprovar_orcamento(current_setting('t.q0')::uuid, 1, repeat('0', 64), gen_random_uuid(), null) ->> 'codigo',
  'STATUS_INVALIDO', 'pedido sem orçamento (SOLICITADA): STATUS_INVALIDO');
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 2, current_setting('t.h_q1'), gen_random_uuid(), null) ->> 'codigo',
  'ORCAMENTO_ALTERADO', 'versão diferente: ORCAMENTO_ALTERADO');
select is(api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, repeat('0', 64), gen_random_uuid(), null) ->> 'codigo',
  'ORCAMENTO_ALTERADO', 'hash diferente: ORCAMENTO_ALTERADO');

------------------------------------------------------------------ 2. aprovação: reserva, AGENDADA, registro
select set_config('t.ap1', api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'),
  current_setting('t.k1')::uuid, 'iPhone do teste')::text, true);
select set_config('t.ap1b', api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'),
  current_setting('t.k1')::uuid, 'iPhone do teste')::text, true);
select set_config('t.ap1c', api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, current_setting('t.h_q1'),
  current_setting('t.k2')::uuid, null)::text, true);
select set_config('t.ap1d', api.aprovar_orcamento(current_setting('t.q1')::uuid, 1, repeat('1', 64),
  current_setting('t.k1')::uuid, null)::text, true);
-- N1 aprova o pedido do colega
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.ap2', api.aprovar_orcamento(current_setting('t.q2')::uuid, 1, current_setting('t.h_q2'),
  current_setting('t.k3')::uuid, null)::text, true);
reset role;

select is(current_setting('t.ap1')::jsonb,
  jsonb_build_object('ok', true, 'atividade_id', current_setting('t.q1'), 'reservado_cent', 30000, 'disponivel_cent', -20000),
  'aprovação: {ok, atividade_id, reservado_cent, disponivel_cent}');
select is(current_setting('t.ap1b')::jsonb, current_setting('t.ap1')::jsonb, 'mesma chave: o resultado original');
select is(current_setting('t.ap1c')::jsonb ->> 'codigo', 'STATUS_INVALIDO', 'outra chave depois de aprovado: STATUS_INVALIDO');
select is(current_setting('t.ap1d')::jsonb ->> 'codigo', 'CHAVE_REUTILIZADA', 'mesma chave com outro hash: CHAVE_REUTILIZADA');
select is((select status::text from app.atividades where id = current_setting('t.q1')::uuid), 'AGENDADA', 'pedido AGENDADA');
select is((select status from app.orcamentos where atividade_id = current_setting('t.q1')::uuid), 'APROVADO', 'orçamento APROVADO');
select ok((select tipo = 'RESERVA' and expira_em is null and ativo from app.agenda_blocos
            where atividade_id = current_setting('t.q1')::uuid), 'pré-reserva da agenda virou RESERVA (sem expiração)');
select is((select count(*)::int from app.reservas where atividade_id = current_setting('t.q1')::uuid and ativa and valor_cent = 30000),
  1, 'uma reserva ativa com o total do orçamento');
select is((select count(*)::int from app.lancamentos l join app.reservas r on r.id = l.reserva_id
            where l.atividade_id = current_setting('t.q1')::uuid and l.tipo = 'RESERVA' and l.valor_cent = 30000
              and l.orcamento_id = r.orcamento_id and l.chave_idempotencia = current_setting('t.k1')::uuid),
  1, 'um lançamento RESERVA (valor = reservado), mesmo com a repetição');
select is((select count(*)::int from app.atividade_historico where atividade_id = current_setting('t.q1')::uuid and para = 'AGENDADA'),
  1, 'histórico registra AGENDADA uma vez');
select ok((select p.usuario_id = '00000000-0000-0000-0000-0000000000a5' and p.orcamento_versao = 1
                  and p.hash = current_setting('t.h_q1') and p.ip = '203.0.113.9' and p.dispositivo = 'iPhone do teste'
                  and p.orcamento_id = o.id and p.chave_idempotencia = current_setting('t.k1')::uuid
             from app.aprovacoes p join app.orcamentos o on o.atividade_id = p.atividade_id
            where p.atividade_id = current_setting('t.q1')::uuid),
  'aprovação gravada: usuário, versão, hash, IP, dispositivo e chave');
select is((select dispositivo from app.aprovacoes where atividade_id = current_setting('t.q2')::uuid), 'Navegador pgTAP',
  'sem dispositivo informado, grava o user-agent');
select is((current_setting('t.ap2')::jsonb ->> 'disponivel_cent')::bigint, -40000::bigint, 'N1 aprova pedido do colega');
select is((select (saldo_contabil_cent, reservado_cent)::text from app.contas
            where empresa_id = '00000000-0000-0000-0000-0000000000e1'), '(10000,50000)',
  'reserva não altera o contábil: só o reservado');
select throws_ok($$ update app.aprovacoes set dispositivo = 'x' $$, '42501', null, 'aprovação imutável');
select throws_ok($$ delete from app.reservas $$, '42501', null, 'reserva não pode ser apagada');
select throws_ok($$ update app.reservas set valor_cent = 1 $$, '42501', null, 'valor da reserva não muda');
select ok(exists (select 1 from app.auditoria where acao = 'APROVAR_ORCAMENTO' and resultado = 'OK'
                    and alvo = 'atividade:' || current_setting('t.q1') and detalhe ->> 'hash' = current_setting('t.h_q1')),
  'aprovação auditada com o hash');

------------------------------------------------------------------ 3. limite de crédito (contrato vigente)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ap3', api.aprovar_orcamento(current_setting('t.q3')::uuid, 1, current_setting('t.h_q3'),
  current_setting('t.k4')::uuid, null)::text, true);
select set_config('t.ap4', api.aprovar_orcamento(current_setting('t.q4')::uuid, 1, current_setting('t.h_q4'),
  current_setting('t.k5')::uuid, null)::text, true);
reset role;
select is(current_setting('t.ap3')::jsonb,
  '{"ok": false, "codigo": "SALDO_INSUFICIENTE", "disponivel_cent": -40000, "limite_cent": 50000, "total_cent": 10001,
    "falta_cent": 1}'::jsonb, 'disponível − total < −limite: SALDO_INSUFICIENTE com os valores');
select is((select status::text from app.atividades where id = current_setting('t.q3')::uuid), 'ORCADA',
  'recusa por saldo não muda o pedido');
select is((select count(*)::int from app.reservas where atividade_id = current_setting('t.q3')::uuid), 0, 'recusa por saldo não reserva');
select ok(exists (select 1 from app.auditoria where acao = 'APROVAR_ORCAMENTO' and codigo = 'SALDO_INSUFICIENTE'
                    and (detalhe ->> 'total_cent')::bigint = 10001), 'recusa por saldo auditada com os valores');
select is((current_setting('t.ap4')::jsonb ->> 'disponivel_cent')::bigint, -50000::bigint,
  'disponível − total = −limite: aprovado (limite inclusivo)');

-- novo contrato vigente: limite maior e faixas sem multa (os orçamentos já enviados mantêm o snapshot antigo)
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb
  || '{"limite_saldo_negativo_cent": 100000, "faixas_cancelamento": [{"antecedencia_min_horas": 0, "multa_bp": 0}]}',
  now(), null, 'Teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
-- a mesma chave da tentativa recusada continua valendo (recusa não consome a chave)
select set_config('t.ap3b', api.aprovar_orcamento(current_setting('t.q3')::uuid, 1, current_setting('t.h_q3'),
  current_setting('t.k4')::uuid, null)::text, true);
reset role;
select is((current_setting('t.ap3b')::jsonb ->> 'disponivel_cent')::bigint, -60001::bigint,
  'limite do contrato VIGENTE (novo): aprovado com a mesma chave da recusa');

------------------------------------------------------------------ 4. validade, horário
alter table app.orcamentos disable trigger orcamentos_imutaveis;
update app.orcamentos set valido_ate = now() - interval '1 second' where atividade_id = current_setting('t.q5')::uuid;
alter table app.orcamentos enable trigger orcamentos_imutaveis;
update app.agenda_blocos set expira_em = now() - interval '1 second' where atividade_id = current_setting('t.q6')::uuid;
update app.agenda_blocos set ativo = false where atividade_id = current_setting('t.q7')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.aprovar_orcamento(current_setting('t.q5')::uuid, 1, current_setting('t.h_q5'), gen_random_uuid(), null) ->> 'codigo',
  'ORCAMENTO_VENCIDO', 'valido_ate no passado: ORCAMENTO_VENCIDO');
select is(api.aprovar_orcamento(current_setting('t.q6')::uuid, 1, current_setting('t.h_q6'), gen_random_uuid(), null) ->> 'codigo',
  'ORCAMENTO_VENCIDO', 'pré-reserva vencida: ORCAMENTO_VENCIDO');
select is(api.aprovar_orcamento(current_setting('t.q7')::uuid, 1, current_setting('t.h_q7'), gen_random_uuid(), null) ->> 'codigo',
  'HORARIO_OCUPADO', 'sem bloco ativo na agenda: HORARIO_OCUPADO');
reset role;
select is((select string_agg(a.status::text || '/' || o.status, ',' order by a.numero) from app.atividades a
             join app.orcamentos o on o.atividade_id = a.id
            where a.id in (current_setting('t.q5')::uuid, current_setting('t.q6')::uuid)),
  'EXPIRADA/EXPIRADO,EXPIRADA/EXPIRADO', 'vencido expira na hora (pedido e orçamento), sem esperar o cron');
select is((select count(*)::int from app.agenda_blocos
            where atividade_id in (current_setting('t.q5')::uuid, current_setting('t.q6')::uuid) and ativo), 0,
  'expiração libera a agenda');
select is((select count(*)::int from app.reservas
            where atividade_id in (current_setting('t.q5')::uuid, current_setting('t.q6')::uuid, current_setting('t.q7')::uuid)),
  0, 'vencido/ocupado não reserva');
select is((select status::text from app.atividades where id = current_setting('t.q7')::uuid), 'ORCADA',
  'HORARIO_OCUPADO não muda o pedido');

------------------------------------------------------------------ 5. demais aprovações (multa e prestador)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000000, 'Pix grande', null, gen_random_uuid());
reset role;
do $$
declare
  x record;
begin
  for x in select * from casos where nome ~ '^[cs]' order by nome loop
    perform set_config('request.jwt.claims', current_setting('t.c' || x.quem), true);
    perform set_config('t.ap_' || x.nome, api.aprovar_orcamento(current_setting('t.' || x.nome)::uuid, 1,
      current_setting('t.h_' || x.nome), gen_random_uuid(), null)::text, true);
  end loop;
end $$;
select is((select count(*)::int from casos c
            where c.nome ~ '^[cs]' and (current_setting('t.ap_' || c.nome)::jsonb ->> 'ok')::boolean), 10,
  '7 pedidos do cliente e 3 do N1 aprovados');
-- c7: o início já passou (ainda AGENDADA; sem saída não há débito): vale a faixa de 0 h
update app.atividades set inicio = now() - interval '1 hour', prazo_orcar_ate = now() - interval '2 hours'
 where id = current_setting('t.c7')::uuid;

------------------------------------------------------------------ 6. simulação
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.sim5', api.simular_cancelamento(current_setting('t.c5')::uuid)::text, true);
select is(api.simular_cancelamento(current_setting('t.q3')::uuid) -> 'faixa',
  '{"antecedencia_min_horas": 48, "multa_bp": 0}'::jsonb, 'simulação: mais de 48 h antes, faixa de 0%');
select is(api.simular_cancelamento(current_setting('t.q7')::uuid) ->> 'codigo', 'STATUS_INVALIDO', 'simulação só em AGENDADA');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.sim5m', api.simular_cancelamento(current_setting('t.c5')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.simular_cancelamento(current_setting('t.c5')::uuid) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não simula cancelamento');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.simular_cancelamento(current_setting('t.c5')::uuid) ->> 'codigo', 'SEM_PERMISSAO', 'outra empresa não simula');
reset role;
select is(current_setting('t.sim5')::jsonb - 'atividade_id' - 'numero',
  '{"ok": true, "total_cent": 1001, "liberado_cent": 1001, "horas_antes": 10.00,
    "faixa": {"antecedencia_min_horas": 6, "multa_bp": 5000}, "multa_cent": 501, "cobra_multa": true,
    "motivo_obrigatorio": false}'::jsonb,
  'simulação do cliente: faixa de 6 h, 50% de 1001 = 500,5 → 501 (meio para cima)');
select is(current_setting('t.sim5m')::jsonb - 'atividade_id' - 'numero' - 'horas_antes',
  '{"ok": true, "total_cent": 1001, "liberado_cent": 1001, "faixa": null, "multa_cent": 0, "cobra_multa": false,
    "motivo_obrigatorio": true}'::jsonb,
  'simulação do motorista: sem custo, motivo obrigatório');
select is((select count(*)::int from app.lancamentos where tipo in ('MULTA', 'LIBERACAO_RESERVA')), 0, 'simulação não grava nada');

------------------------------------------------------------------ 7. cancelamento pelo cliente (snapshot antigo)
do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select nome, row_number() over (order by nome) as i from casos where nome ~ '^c' order by nome loop
    -- a multa esperada é a da prévia (a tela devolve o que mostrou)
    perform set_config('t.cx_' || x.nome, api.cancelar_agendado(current_setting('t.' || x.nome)::uuid, null,
      current_setting('t.k' || (10 + x.i))::uuid,
      (api.simular_cancelamento(current_setting('t.' || x.nome)::uuid) ->> 'multa_cent')::bigint)::text, true);
  end loop;
end $$;
set local role authenticated;
select set_config('t.cx_c5b', api.cancelar_agendado(current_setting('t.c5')::uuid, null, current_setting('t.k15')::uuid, 501)::text, true);
select set_config('t.cx_c5c', api.cancelar_agendado(current_setting('t.c5')::uuid, null, current_setting('t.k30')::uuid, 501)::text, true);
select is(api.cancelar_agendado(current_setting('t.s1')::uuid, null, gen_random_uuid()) ->> 'codigo', 'SEM_PERMISSAO',
  'N2 não cancela pedido do colega');
select is(api.cancelar_agendado(current_setting('t.q7')::uuid, null, gen_random_uuid(), 0) ->> 'codigo', 'STATUS_INVALIDO',
  'cancelar_agendado em ORCADA: STATUS_INVALIDO');
select is(api.cancelar_pedido(current_setting('t.q1')::uuid, null) ->> 'codigo', 'STATUS_INVALIDO',
  'cancelar_pedido (sem custo) não vale para AGENDADA');
select is(api.cancelar_agendado(current_setting('t.q1')::uuid, null, null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'cancelamento sem chave recusado');
select is(api.cancelar_agendado(current_setting('t.q1')::uuid, repeat('x', 501), gen_random_uuid(), 0) ->> 'codigo',
  'MOTIVO_OBRIGATORIO', 'motivo acima de 500 caracteres recusado');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.cancelar_agendado(current_setting('t.q1')::uuid, null, gen_random_uuid()) ->> 'codigo', 'SEM_PERMISSAO',
  'N3 não cancela');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.cancelar_agendado(current_setting('t.q1')::uuid, 'Gestor', gen_random_uuid()) ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não cancela');
reset role;

select is((select jsonb_agg((current_setting('t.cx_' || nome)::jsonb ->> 'multa_cent')::bigint order by nome)
             from casos where nome ~ '^c'),
  '[0, 0, 250, 250, 501, 1001, 1001]'::jsonb,
  'multa por faixa do snapshot: 72 h 0%; 48 h + 1 min 0%; 30 h 25%; 24 h + 1 min 25%; 10 h 50% (501); 2 h 100%; depois do início 100%');
select is(current_setting('t.cx_c3')::jsonb #> '{faixa}', '{"antecedencia_min_horas": 24, "multa_bp": 2500}'::jsonb,
  'faixa aplicada devolvida (25%: 250,25 → 250)');
select is(current_setting('t.cx_c5b')::jsonb, current_setting('t.cx_c5')::jsonb, 'cancelamento repetido (mesma chave): mesmo resultado');
select is(current_setting('t.cx_c5c')::jsonb ->> 'codigo', 'STATUS_INVALIDO', 'segundo cancelamento (outra chave): STATUS_INVALIDO');
select is((select count(*)::int from app.lancamentos l join casos c on l.atividade_id = current_setting('t.' || c.nome)::uuid
            where c.nome ~ '^c' and l.tipo = 'LIBERACAO_RESERVA' and l.valor_cent = 1001), 7,
  'cada cancelamento libera a reserva (LIBERACAO_RESERVA = valor reservado)');
select is((select jsonb_agg(l.valor_cent order by c.nome) from app.lancamentos l
             join casos c on l.atividade_id = current_setting('t.' || c.nome)::uuid where l.tipo = 'MULTA'),
  '[-250, -250, -501, -1001, -1001]'::jsonb, 'MULTA só quando > 0, com sinal negativo');
select is((select count(*)::int from app.reservas r join casos c on r.atividade_id = current_setting('t.' || c.nome)::uuid
            where c.nome ~ '^c' and r.ativa), 0, 'nenhuma reserva ativa nos cancelados');
select is((select count(*)::int from app.atividades a join casos c on a.id = current_setting('t.' || c.nome)::uuid
            where c.nome ~ '^c' and a.status = 'CANCELADA'), 7, 'pedidos CANCELADA');
select is((select count(*)::int from app.agenda_blocos b join casos c on b.atividade_id = current_setting('t.' || c.nome)::uuid
            where c.nome ~ '^c' and b.ativo), 0, 'cancelamento libera a agenda');
select ok((select bool_and(l.motivo like 'Multa de cancelamento do pedido nº %') from app.lancamentos l where l.tipo = 'MULTA'),
  'MULTA com descrição');
select throws_ok(format($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, chave_idempotencia)
                           values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -1, %L, gen_random_uuid()) $$,
                        current_setting('t.c6')),
  '23505', null, 'unicidade: 1 MULTA por atividade mesmo por fora das RPCs');

------------------------------------------------------------------ 8. cancelamento pelo prestador
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.cancelar_agendado(current_setting('t.s1')::uuid, '  ', gen_random_uuid()) ->> 'codigo', 'MOTIVO_OBRIGATORIO',
  'motorista cancela só com motivo');
select set_config('t.cs1', api.cancelar_agendado(current_setting('t.s1')::uuid, 'Veículo quebrado', gen_random_uuid())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.cs2', api.cancelar_agendado(current_setting('t.s2')::uuid, 'Reorganização da agenda', gen_random_uuid())::text, true);
reset role;
select is(current_setting('t.cs1')::jsonb - 'atividade_id',
  '{"ok": true, "liberado_cent": 5000, "multa_cent": 0, "faixa": null}'::jsonb,
  'motorista: libera a reserva, sem custo, e não recebe o saldo (sem disponivel_cent)');
select is((current_setting('t.cs2')::jsonb ->> 'multa_cent')::bigint, 0::bigint, 'ADM: sem custo');
select ok(current_setting('t.cs2')::jsonb ? 'disponivel_cent', 'ADM recebe o disponível');
select is((select count(*)::int from app.lancamentos where tipo = 'MULTA'
             and atividade_id in (current_setting('t.s1')::uuid, current_setting('t.s2')::uuid)), 0, 'prestador não gera MULTA');
select is((select observacao from app.atividade_historico where atividade_id = current_setting('t.s1')::uuid and para = 'CANCELADA'),
  'Veículo quebrado', 'motivo no histórico');

------------------------------------------------------------------ 9. saldos finais, extrato (privacidade), painel
select is((select (saldo_contabil_cent, reservado_cent)::text from app.contas
            where empresa_id = '00000000-0000-0000-0000-0000000000e1'), '(1006997,75001)',
  'conta: contábil = recargas − multas; reservado = reservas ativas (q1, q2, q3, q4, s3)');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.x8', api.extrato(null, '{"limite": 500}')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.x4', api.extrato(null, '{"limite": 500}')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.x6', api.extrato(null, '{"tipos": ["MULTA"]}')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.painel', api.painel_adm(now() - interval '1 day', now() + interval '1 day')::text, true);
reset role;
select is((select x - 'id' - 'criado_em' from jsonb_array_elements(current_setting('t.x8')::jsonb -> 'itens') x
            where x ->> 'tipo' = 'RESERVA' and (x ->> 'valor_cent')::bigint = 30000),
  jsonb_build_object('tipo', 'RESERVA', 'valor_cent', 30000, 'efeito_contabil_cent', 0, 'efeito_reservado_cent', 30000,
                     'numero', (select numero from app.atividades where id = current_setting('t.q1')::uuid),
                     'solicitante_nome', 'Solicitante A', 'pode_abrir', false, 'atividade_id', null, 'estorna_id', null),
  'extrato do N2 colega: vê data, tipo, valor, nº e solicitante, mas não abre o pedido nem recebe o id');
select ok((select bool_and((x ->> 'pode_abrir')::boolean and x ->> 'atividade_id' is not null)
             from jsonb_array_elements(current_setting('t.x4')::jsonb -> 'itens') x where x ->> 'numero' is not null),
  'extrato do N1: abre todos os pedidos da empresa');
select is(jsonb_array_length(current_setting('t.x6')::jsonb -> 'itens'), 5, 'extrato do N3: as 5 multas');
select ok((select bool_and((x ->> 'pode_abrir')::boolean) from jsonb_array_elements(current_setting('t.x6')::jsonb -> 'itens') x),
  'N3 abre os pedidos da empresa');
select is((select count(*)::int from jsonb_array_elements(current_setting('t.x8')::jsonb -> 'itens') x
            where x ->> 'tipo' in ('LIBERACAO_RESERVA', 'MULTA')), 7 + 2 + 5,
  'extrato mostra liberações e multas');
select is(current_setting('t.painel')::jsonb -> 'aprovado', '{"total_cent": 92008, "quantidade": 14}'::jsonb,
  'painel: valor aprovado no período (reservas criadas)');
select is(current_setting('t.painel')::jsonb -> 'corridas', '{"agendadas": 5, "em_andamento": 0}'::jsonb,
  'painel: corridas agendadas e em andamento');
select is((current_setting('t.painel')::jsonb -> 'pendencias') - 'empresas_abaixo_alerta',
  '{"aguardando_orcamento": 1, "aguardando_aprovacao": 1}'::jsonb, 'painel: pendências');

------------------------------------------------------------------ 10. depois da saída não há cancelamento; reconciliação
select set_config('t.r_limpa', interno.reconciliar()::text, true);
select is(current_setting('t.r_limpa')::jsonb -> 'divergencias', '[]'::jsonb, 'reconciliação limpa depois do fluxo completo');

-- saída simulada (fase 3): EM_ANDAMENTO sem passar pelo débito
select interno.transicionar(current_setting('t.s3')::uuid, 'EM_ANDAMENTO', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.cancelar_agendado(current_setting('t.s3')::uuid, null, gen_random_uuid(), 0) ->> 'codigo', 'STATUS_INVALIDO',
  'EM_ANDAMENTO: cancelamento recusado');
select is(api.simular_cancelamento(current_setting('t.s3')::uuid) ->> 'codigo', 'STATUS_INVALIDO',
  'EM_ANDAMENTO: simulação recusada');
reset role;

-- divergências injetadas (só nesta transação de teste)
update app.reservas set ativa = false, liberada_em = now() where atividade_id = current_setting('t.q2')::uuid;
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, chave_idempotencia)
values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -10, current_setting('t.q7')::uuid, gen_random_uuid());
drop index app.lancamentos_uma_multa;
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, chave_idempotencia)
values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -10, current_setting('t.c6')::uuid,
        (select orcamento_id from app.aprovacoes where atividade_id = current_setting('t.c6')::uuid), gen_random_uuid());
select set_config('t.r_div', interno.reconciliar()::text, true);
select set_config('t.r_tipos', (select jsonb_object_agg(t, n) from (
  select x ->> 'tipo' as t, count(*) as n from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
  group by 1) y)::text, true);
select is(current_setting('t.r_tipos')::jsonb,
  '{"RESERVA_FORA_DE_AGENDADA": 1, "AGENDADA_SEM_RESERVA": 1, "CONTA_DIVERGENTE": 1, "COBRANCA_SEM_APROVACAO": 1,
    "COBRANCA_DUPLICADA": 1, "RESERVA_SEM_PAR": 1}'::jsonb,
  'reconciliação detecta cada divergência injetada');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
                   where x ->> 'tipo' = 'RESERVA_FORA_DE_AGENDADA' and x ->> 'atividade_id' = current_setting('t.s3')
                     and x ->> 'status' = 'EM_ANDAMENTO'), 'reserva ativa em EM_ANDAMENTO apontada');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
                   where x ->> 'tipo' = 'AGENDADA_SEM_RESERVA' and x ->> 'atividade_id' = current_setting('t.q2')),
  'AGENDADA sem reserva apontada');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
                   where x ->> 'tipo' = 'COBRANCA_SEM_APROVACAO' and x ->> 'atividade_id' = current_setting('t.q7')),
  'multa sem aprovação apontada');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.r_div')::jsonb -> 'divergencias') x
                   where x ->> 'tipo' = 'COBRANCA_DUPLICADA' and x ->> 'atividade_id' = current_setting('t.c6')
                     and (x ->> 'quantidade')::int = 2), 'atividade com 2 multas apontada');

select * from finish();
rollback;
