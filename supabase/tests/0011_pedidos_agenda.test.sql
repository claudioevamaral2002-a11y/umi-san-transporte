-- Fase 2A, Task 1 (migrations 20261009130000_pedidos_agenda.sql e 20261009130100_cron_expirar_vencidos.sql):
-- transições (todas as permitidas e proibidas), histórico, exclusion (ativos colidem, inativos não), criar_pedido,
-- recusar_pedido, cancelar_pedido, expiração inline e por expirar_vencidos, permissões por papel/nível.
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B'),
  ('00000000-0000-0000-0000-0000000000e3', 'Empresa C');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',      'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste',  'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',     'GESTOR_FROTA', null, null),
  ('n1a@teste.local',  'Gestora A',        'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local',  'Solicitante A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local',  'Gestora B',        'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('n2a2@teste.local', 'Solicitante A2',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('mot2@teste.local', 'Motorista Dois',   'MOTORISTA',    null, null),
  ('n1c@teste.local',  'Gestora C',        'CLIENTE', '00000000-0000-0000-0000-0000000000e3', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot2@teste.local'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1c@teste.local');
update app.perfis set senha_pendente = false;
-- o segundo motorista é mais novo: o atribuído na v1 é o mais antigo ativo
update app.perfis set criado_em = now() + interval '1 minute' where usuario_id = '00000000-0000-0000-0000-0000000000a9';

-- Contratos vigentes de A e B (C sem contrato).
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.base')::jsonb, now(), null, 'Teste');

-- Pedido-base (sem início) e instantes ISO (UTC). now() é fixo na transação.
select set_config('t.ped', '{"duracao_min": 120, "origem": "Porto de Itajaí", "destino": "Base Navegantes",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 3, "modalidade": "VEICULO_PROPRIO",
  "reboque": "NAO"}', true);
select set_config('t.' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true)
from (values ('d2', interval '2 days'), ('d2b', interval '2 days 1 hour'), ('d2c', interval '2 days 2 hours'),
             ('d3', interval '3 days'), ('h3', interval '3 hours'), ('d4', interval '4 days'), ('d5', interval '5 days'),
             ('d6', interval '6 days'), ('d7', interval '7 days'), ('d8', interval '8 days'),
             ('passado', interval '-1 hour')) x(n, d);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa']) u;

------------------------------------------------------------------ estrutura
select ok(exists (select 1 from pg_extension where extname = 'btree_gist'), 'extensão btree_gist instalada');
select ok(exists (select 1 from cron.job where jobname = 'expirar-vencidos' and schedule = '*/15 * * * *'
                  and command like '%interno.expirar_vencidos()%'),
  'pg_cron: expirar_vencidos a cada 15 min');
select set_eq($$ select de::text || '>' || para::text from app.transicoes_permitidas $$,
  array['SOLICITADA>ORCADA', 'SOLICITADA>RECUSADA', 'SOLICITADA>EXPIRADA', 'SOLICITADA>CANCELADA',
        'ORCADA>AGENDADA', 'ORCADA>REPROVADA', 'ORCADA>SOLICITADA', 'ORCADA>EXPIRADA', 'ORCADA>CANCELADA',
        'AGENDADA>EM_ANDAMENTO', 'AGENDADA>CANCELADA', 'EM_ANDAMENTO>CONCLUIDA'],
  'transicoes_permitidas: exatamente as setas da §4 + revisão');
select throws_ok($$ insert into app.transicoes_permitidas values ('CONCLUIDA', 'SOLICITADA') $$, '42501', null,
  'tabela de transições é imutável');
select ok(exists (select 1 from pg_constraint where conname = 'agenda_blocos_sem_conflito' and contype = 'x'),
  'agenda: exclusion constraint por motorista e período');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'atividades_uma_em_andamento'),
  'índice parcial: 1 EM_ANDAMENTO por motorista');
select is(interno.motorista_padrao(), '00000000-0000-0000-0000-0000000000a2'::uuid, 'motorista atribuído: o ativo mais antigo');
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a2';
select is(interno.motorista_padrao(), '00000000-0000-0000-0000-0000000000a9'::uuid, 'motorista inativo não é atribuído');
update app.perfis set ativo = true where usuario_id = '00000000-0000-0000-0000-0000000000a2';

------------------------------------------------------------------ criar_pedido: permissões
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente N3 não cria pedido');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'SEM_PERMISSAO', 'motorista não cria pedido');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'SEM_PERMISSAO', 'ADM não cria pedido');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'SEM_PERMISSAO', 'gestor de frota não cria pedido');
select set_config('request.jwt.claims', current_setting('t.caa'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'SEM_CONTRATO', 'empresa sem contrato vigente não cria pedido');

------------------------------------------------------------------ criar_pedido: validação (cliente N2)
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'), 'preco_cent', 1)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo desconhecido recusado');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'), 'levar', false)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'trajeto sem Levar nem Trazer recusado');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.passado'))) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'início no passado recusado');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || '{"inicio": "2030-01-01T10:00"}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'início sem fuso recusado');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'), 'duracao_min', 20)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'duração abaixo de 30 min recusada');
select is(api.criar_pedido((current_setting('t.ped')::jsonb - 'pessoas_qtd') || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'carga PESSOAS sem quantidade recusada');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'), 'equipamento_desc', 'Bomba')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'carga PESSOAS com equipamento recusada');
select is(api.criar_pedido((current_setting('t.ped')::jsonb - 'pessoas_qtd') || jsonb_build_object('inicio', current_setting('t.d8'), 'carga', 'EQUIPAMENTO')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'carga EQUIPAMENTO sem descrição recusada');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'), 'origem', 'ab')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'origem curta recusada');
select is(api.criar_pedido('[]'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS', 'entrada que não é objeto recusada');

------------------------------------------------------------------ criar_pedido: sucesso e conflito
select set_config('t.r', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2')))::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'cliente N2 cria pedido (P1)');
select set_config('t.p1', current_setting('t.r')::jsonb ->> 'id', true);
select set_config('t.r', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.h3')))::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'pedido para daqui a 3 h (P4)');
select set_config('t.p4', current_setting('t.r')::jsonb ->> 'id', true);
select set_config('t.p6', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d4'))) ->> 'id', true);
select set_config('t.p8', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d6'))) ->> 'id', true);
select set_config('t.p9', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d7'))) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2b'))) ->> 'codigo',
  'HORARIO_OCUPADO', 'horário sobreposto recusado (mesma empresa)');
select set_config('t.r', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3')))::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'cliente N1 cria pedido (P3)');
select set_config('t.p3', current_setting('t.r')::jsonb ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2'))) ->> 'codigo',
  'HORARIO_OCUPADO', 'horário sobreposto recusado (outra empresa, mesmo motorista)');
select set_config('t.r', api.criar_pedido((current_setting('t.ped')::jsonb - 'pessoas_qtd') || jsonb_build_object(
  'inicio', current_setting('t.d2c'), 'carga', 'AMBOS', 'pessoas_qtd', 2, 'equipamento_desc', 'Gerador portátil',
  'peso_kg', 80.5, 'dimensoes', '1x1x1 m', 'trazer', true, 'contato_nome', 'Zé', 'contato_telefone', '+55 47 99999-0000',
  'observacoes', 'Portão 3'))::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'horário adjacente ([fim) livre) aceito (P2, outra empresa)');
select set_config('t.p2', current_setting('t.r')::jsonb ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.p7', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d5'))) ->> 'id', true);
reset role;

select ok((select status = 'SOLICITADA' and empresa_id = '00000000-0000-0000-0000-0000000000e1'
                  and solicitante_id = '00000000-0000-0000-0000-0000000000a5' and motorista_id = '00000000-0000-0000-0000-0000000000a2'
                  and prazo_orcar_ate = now() + interval '12 hours' and not trazer and carga = 'PESSOAS'
           from app.atividades where id = current_setting('t.p1')::uuid),
  'P1: SOLICITADA, empresa/solicitante/motorista e prazo de orçar = criação + 12 h');
select ok((select b.tipo = 'PRE_RESERVA' and b.ativo and b.motorista_id = '00000000-0000-0000-0000-0000000000a2'
                  and b.periodo = tstzrange(a.inicio, a.inicio + interval '2 hours', '[)') and b.expira_em = a.prazo_orcar_ate
           from app.agenda_blocos b join app.atividades a on a.id = b.atividade_id where a.id = current_setting('t.p1')::uuid),
  'P1: pré-reserva ativa [início, início + duração), expira no prazo de orçar');
select is((select prazo_orcar_ate from app.atividades where id = current_setting('t.p4')::uuid),
  (select inicio from app.atividades where id = current_setting('t.p4')::uuid), 'prazo de orçar nunca passa do início');
select ok((select count(*) = 1 and bool_and(de is null and para = 'SOLICITADA' and por = '00000000-0000-0000-0000-0000000000a5')
           from app.atividade_historico where atividade_id = current_setting('t.p1')::uuid),
  'histórico: criação registrada (nulo → SOLICITADA, por quem pediu)');
select ok((select a2.numero > a1.numero from app.atividades a1, app.atividades a2
           where a1.id = current_setting('t.p1')::uuid and a2.id = current_setting('t.p2')::uuid),
  'número sequencial legível');
select ok((select equipamento_desc = 'Gerador portátil' and peso_kg = 80.5 and pessoas_qtd = 2 and levar and trazer
                  and contato_telefone = '+55 47 99999-0000' and observacoes = 'Portão 3'
           from app.atividades where id = current_setting('t.p2')::uuid),
  'P2: carga AMBOS, Levar+Trazer, contato e observações gravados');
select is((select count(*)::int from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'NEGADO' and codigo = 'HORARIO_OCUPADO'),
  2, 'HORARIO_OCUPADO devolvido como negação auditada');
select is((select count(*)::int from app.atividades), 8, 'tentativas recusadas não deixam atividade');
select is((select count(*)::int from app.agenda_blocos), 8, 'tentativas recusadas não deixam bloco');
select is((select count(*)::int from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'OK'), 8, 'criações auditadas');
select is((select count(*)::int from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'),
  4, 'negações por papel/nível auditadas');

------------------------------------------------------------------ exclusion direto na tabela
with x as (
  insert into app.atividades (empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer,
                              carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate)
  select empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer, carga, pessoas_qtd,
         modalidade, reboque, prazo_orcar_ate
  from app.atividades where id = current_setting('t.p1')::uuid
  returning id)
select set_config('t.x1', id::text, true) from x;
with x as (
  insert into app.atividades (empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer,
                              carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate)
  select empresa_id, solicitante_id, '00000000-0000-0000-0000-0000000000a9', inicio, duracao_min, origem, destino, levar,
         trazer, carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate
  from app.atividades where id = current_setting('t.p1')::uuid
  returning id)
select set_config('t.x2', id::text, true) from x;
select throws_ok($$ insert into app.agenda_blocos (atividade_id, motorista_id, periodo, tipo, expira_em)
  select current_setting('t.x1')::uuid, motorista_id, periodo, 'PRE_RESERVA', expira_em
  from app.agenda_blocos where atividade_id = current_setting('t.p1')::uuid $$,
  '23P01', null, 'bloco ativo sobreposto recusado pelo banco (mesmo motorista)');
select lives_ok($$ insert into app.agenda_blocos (atividade_id, motorista_id, periodo, tipo, ativo, expira_em)
  select current_setting('t.x1')::uuid, motorista_id, periodo, 'PRE_RESERVA', false, expira_em
  from app.agenda_blocos where atividade_id = current_setting('t.p1')::uuid $$,
  'bloco inativo sobreposto não colide');
select throws_ok($$ update app.agenda_blocos set ativo = true where atividade_id = current_setting('t.x1')::uuid $$,
  '23P01', null, 'reativar bloco sobreposto recusado');
select lives_ok($$ insert into app.agenda_blocos (atividade_id, motorista_id, periodo, tipo, expira_em)
  select current_setting('t.x2')::uuid, '00000000-0000-0000-0000-0000000000a9', periodo, 'PRE_RESERVA', expira_em
  from app.agenda_blocos where atividade_id = current_setting('t.p1')::uuid $$,
  'mesmo período para outro motorista não colide');
select throws_ok($$ insert into app.atividades (empresa_id, solicitante_id, motorista_id, status, inicio, duracao_min, origem,
                              destino, levar, trazer, carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate)
  select empresa_id, solicitante_id, motorista_id, 'ORCADA', inicio + interval '30 days', duracao_min, origem, destino, levar,
         trazer, carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate
  from app.atividades where id = current_setting('t.p1')::uuid $$,
  '23514', null, 'atividade nasce SOLICITADA');

------------------------------------------------------------------ expiração inline ao ocupar o horário
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.p1')::uuid;
update app.atividades set prazo_orcar_ate = now() - interval '1 minute' where id = current_setting('t.p1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.r', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.d2b'), 'duracao_min', 60))::text, true);
select is(current_setting('t.r')::jsonb ->> 'ok', 'true', 'pedido sobre pré-reserva vencida entra (P5)');
select set_config('t.p5', current_setting('t.r')::jsonb ->> 'id', true);
reset role;
select ok((select a.status = 'EXPIRADA' and not b.ativo
           from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = current_setting('t.p1')::uuid),
  'pré-reserva vencida expirada na mesma transação e bloco liberado');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.p1')::uuid
                  and de = 'SOLICITADA' and para = 'EXPIRADA' and observacao = 'Prazo vencido'),
  'histórico registra a expiração');
select ok(exists (select 1 from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'OK'
                  and alvo = 'atividade:' || current_setting('t.p5') and (detalhe ->> 'expiradas')::int = 1),
  'criação audita a expiração inline');

------------------------------------------------------------------ recusar_pedido
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select is(api.recusar_pedido(current_setting('t.p2')::uuid, 'Sem agenda') ->> 'codigo', 'SEM_PERMISSAO',
  'motorista não atribuído não recusa');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.recusar_pedido(current_setting('t.p2')::uuid, 'Não quero') ->> 'codigo', 'SEM_PERMISSAO', 'cliente não recusa');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.recusar_pedido(current_setting('t.p2')::uuid, 'Sem agenda') ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não recusa');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.recusar_pedido(current_setting('t.p2')::uuid, ' ') ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'recusa exige motivo');
select is(api.recusar_pedido(current_setting('t.p2')::uuid, 'Veículo em manutenção') ->> 'ok', 'true',
  'motorista atribuído recusa (P2)');
select is(api.recusar_pedido(current_setting('t.p2')::uuid, 'De novo') ->> 'codigo', 'STATUS_INVALIDO',
  'recusar pedido já recusado: STATUS_INVALIDO');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.recusar_pedido('00000000-0000-0000-0000-00000000dead', 'Inexistente') ->> 'codigo', 'NAO_ENCONTRADO',
  'ADM: pedido inexistente');
select is(api.recusar_pedido(current_setting('t.p5')::uuid, 'Recusa pelo ADM') ->> 'ok', 'true', 'ADM recusa (P5)');
reset role;
select ok((select a.status = 'RECUSADA' and not b.ativo
           from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = current_setting('t.p2')::uuid),
  'P2 recusada e agenda liberada');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.p2')::uuid
                  and de = 'SOLICITADA' and para = 'RECUSADA' and observacao = 'Veículo em manutenção'
                  and por = '00000000-0000-0000-0000-0000000000a2'),
  'histórico da recusa com motivo e autor');
select ok(exists (select 1 from app.auditoria where acao = 'RECUSAR_PEDIDO' and resultado = 'OK'
                  and alvo = 'atividade:' || current_setting('t.p2') and detalhe ->> 'motivo' = 'Veículo em manutenção'),
  'recusa auditada');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2c'))) ->> 'ok',
  'true', 'horário de pedido recusado volta a ficar livre');

------------------------------------------------------------------ cancelar_pedido (sem custo)
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO', 'N2 não cancela pedido de colega');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não cancela');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO',
  'N1 de outra empresa não cancela');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, 'Gestor cancela') ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não cancela');
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, 'Outro motorista') ->> 'codigo', 'SEM_PERMISSAO',
  'motorista não atribuído não cancela');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.cancelar_pedido(current_setting('t.p7')::uuid, null) ->> 'ok', 'true', 'N1 cancela pedido de colega (sem motivo)');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, 'Mudança de planos') ->> 'ok', 'true', 'N2 cancela o próprio pedido');
select is(api.cancelar_pedido(current_setting('t.p6')::uuid, null) ->> 'codigo', 'STATUS_INVALIDO', 'cancelar de novo: STATUS_INVALIDO');
select is(api.cancelar_pedido(current_setting('t.p9')::uuid, repeat('x', 501)) ->> 'codigo', 'MOTIVO_OBRIGATORIO',
  'motivo acima de 500 caracteres recusado');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.cancelar_pedido(current_setting('t.p3')::uuid, null) ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'motorista cancela só com motivo');
select is(api.cancelar_pedido(current_setting('t.p3')::uuid, 'Imprevisto do motorista') ->> 'ok', 'true', 'motorista atribuído cancela');
reset role;
select ok((select a.status = 'CANCELADA' and not b.ativo
           from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = current_setting('t.p6')::uuid),
  'P6 cancelada e agenda liberada');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.p6')::uuid
                  and de = 'SOLICITADA' and para = 'CANCELADA' and observacao = 'Mudança de planos'
                  and por = '00000000-0000-0000-0000-0000000000a5'),
  'histórico do cancelamento com motivo e autor');
select ok((select count(*) = 3 and bool_and((detalhe ->> 'multa_cent')::int = 0)
           from app.auditoria where acao = 'CANCELAR_PEDIDO' and resultado = 'OK'),
  'cancelamentos auditados, sem custo');
select ok(exists (select 1 from app.auditoria where acao = 'CANCELAR_PEDIDO' and resultado = 'OK'
                  and alvo = 'atividade:' || current_setting('t.p3') and (detalhe ->> 'prestador')::boolean),
  'cancelamento pelo motorista auditado como prestador');

------------------------------------------------------------------ prazo checado com now() na ação (sem cron)
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.p4')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.cancelar_pedido(current_setting('t.p4')::uuid, null) ->> 'codigo', 'PRAZO_VENCIDO',
  'ação sobre pedido com prazo vencido: PRAZO_VENCIDO');
reset role;
select ok((select a.status = 'EXPIRADA' and not b.ativo
           from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = current_setting('t.p4')::uuid),
  'e o pedido vencido é expirado na mesma transação (confirmada com a negação)');
select ok(exists (select 1 from app.auditoria where acao = 'CANCELAR_PEDIDO' and resultado = 'NEGADO' and codigo = 'PRAZO_VENCIDO'),
  'negação por prazo auditada');

------------------------------------------------------------------ expirar_vencidos (cron)
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.p8')::uuid;
-- como no pg_cron: sem usuário na sessão
select set_config('request.jwt.claims', '', true);
select is(interno.expirar_vencidos(), 1, 'expirar_vencidos expira só a pré-reserva vencida');
select ok((select status = 'EXPIRADA' from app.atividades where id = current_setting('t.p8')::uuid)
          and (select status = 'SOLICITADA' from app.atividades where id = current_setting('t.p9')::uuid),
  'vencido expira; dentro do prazo continua SOLICITADA');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.p8')::uuid
                  and para = 'EXPIRADA' and por is null),
  'expiração pelo cron registrada sem usuário');
select is(interno.expirar_vencidos(), 0, 'segunda execução não expira nada');
select ok((select count(*) = 1 and bool_and((detalhe ->> 'expiradas')::int = 1)
           from app.auditoria where acao = 'EXPIRAR_VENCIDOS'),
  'execução do cron auditada com a quantidade');

------------------------------------------------------------------ limite 20/h
insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
values ('00000000-0000-0000-0000-0000000000a8', 'CRIAR_PEDIDO',
        to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 20)
on conflict (usuario_id, acao, janela_inicio) do update set contagem = 20;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d8'))) ->> 'codigo',
  'LIMITE_EXCEDIDO', 'criar_pedido: limite de 20/h');
select throws_ok($$ select interno.expirar_vencidos() $$, '42501', null, 'authenticated não executa interno.expirar_vencidos');
reset role;

------------------------------------------------------------------ transições: todas as 72 mudanças
create function pg_temp.setas_aceitas() returns setof text language plpgsql as $$
declare
  v_id uuid := current_setting('t.x1')::uuid;
  d app.status_atividade;
  p app.status_atividade;
begin
  foreach d in array enum_range(null::app.status_atividade) loop
    foreach p in array enum_range(null::app.status_atividade) loop
      continue when d = p;
      alter table app.atividades disable trigger atividades_status;
      update app.atividades set status = d where id = v_id;
      alter table app.atividades enable trigger atividades_status;
      begin
        update app.atividades set status = p where id = v_id;
        return next d::text || '>' || p::text;
      exception when check_violation then
        null;
      end;
    end loop;
  end loop;
end $$;
select set_eq($$ select * from pg_temp.setas_aceitas() $$,
  $$ select de::text || '>' || para::text from app.transicoes_permitidas $$,
  'das 72 mudanças de status possíveis, só as 12 setas da tabela passam');
select throws_ok(format('select interno.transicionar(%L, %L, null)', current_setting('t.p9'), 'CONCLUIDA'), '23514', null,
  'transicionar recusa seta inexistente');
select throws_ok($$ update app.atividade_historico set observacao = 'x' $$, '42501', null, 'histórico é imutável');
select lives_ok(format('select interno.transicionar(%L, %L, %L)', current_setting('t.p9'), 'CANCELADA', 'Teste'),
  'transicionar aceita seta da tabela');
select ok((select count(*) = 1 from app.atividade_historico where atividade_id = current_setting('t.p9')::uuid
           and de = 'SOLICITADA' and para = 'CANCELADA' and observacao = 'Teste'),
  'transicionar grava histórico');
select ok((select not ativo from app.agenda_blocos where atividade_id = current_setting('t.p9')::uuid),
  'transicionar para estado final libera a agenda');

------------------------------------------------------------------ privilégios
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('criar_pedido', 'recusar_pedido', 'cancelar_pedido')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE') or not p.prosecdef)
$$, 'RPCs de pedido: authenticated sim, anon/service_role não, SECURITY DEFINER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('criar_pedido', 'recusar_pedido', 'cancelar_pedido')), 3,
  'existem as 3 RPCs de pedido');

select * from finish();
rollback;
