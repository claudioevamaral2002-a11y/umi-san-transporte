-- v2.1, Tarefa 2 (migrations 20261023120100_pagamento_fatura_tipo.sql e 20261023120200_faturas.sql;
-- docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.3, §4.4, §6): faturas quinzenais com NF.
--   * itens: entram DEBITO, MULTA, AJUSTE e ESTORNO criados no FATURADO; não entram RECARGA, RESERVA, LIBERACAO_RESERVA,
--     PAGAMENTO_FATURA nem o que é de antes do Faturado; a quinzena é a da data local (America/Sao_Paulo);
--   * recusas: QUINZENA_INVALIDA, QUINZENA_EM_ANDAMENTO, NADA_A_FATURAR, NAO_FATURADO, CAMPOS_INVALIDOS (caminho do PDF
--     de outra empresa, sem .pdf ou não enviado);
--   * gerar duas vezes → NADA_A_FATURAR; cancelar e gerar de novo → os mesmos itens, e a cancelada continua listada;
--   * um estorno com data depois do fim cai na fatura seguinte, e a fatura já gerada não muda;
--   * paga → PAGAMENTO_FATURA e o saldo sobe pelo total; segunda vez → JA_PROCESSADO; estornar o pagamento → recusado;
--   * situacao VENCIDA; quem lê (N1 sim; N2, N3, motorista e N1 de outra empresa não); faturas_resumo só ADM;
--   * paga antes da emissão da NF → CAMPOS_INVALIDOS; quinzena já faturada com lançamento novo nela → NADA_A_FATURAR;
--   * faturas_resumo continua listando a empresa que voltou ao Crédito com fatura aberta;
--   * painel_empresa no FATURADO; a reconciliação continua limpa e acusa as duas divergências novas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local', 'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4', 'a5', 'a6', 'a7']) u;

-- Contrato com limite 0 (o Faturado não usa saldo).
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 0, "alerta_saldo_baixo_cent": 20000}', true);

-- Quinzenas: Q2 = a última fechada; Q1 = a anterior; Q3 = a atual. hoje = dia local.
select set_config('t.hoje', interno.hoje_local()::text, true);
select set_config('t.q2i', (select inicio::text from interno.ultima_quinzena_fechada()), true);
select set_config('t.q2f', (select fim::text from interno.ultima_quinzena_fechada()), true);
select set_config('t.q1f', (current_setting('t.q2i')::date - 1)::text, true);
select set_config('t.q1i', (case when extract(day from current_setting('t.q2i')::date) = 16
                                 then current_setting('t.q2i')::date - 15
                                 else current_setting('t.q1f')::date - (extract(day from current_setting('t.q1f')::date)::int - 16)
                            end)::text, true);
select set_config('t.q3i', (current_setting('t.q2f')::date + 1)::text, true);
select set_config('t.q3f', (case when extract(day from current_setting('t.q3i')::date) = 1
                                 then current_setting('t.q3i')::date + 14
                                 else (current_setting('t.q3i')::date - 15 + interval '1 month')::date - 1 end)::text, true);

-- Um instante local (America/Sao_Paulo) de um dia.
create function pg_temp.em(p_dia text, p_hora time default '12:00') returns timestamptz language sql stable as $$
  select (p_dia::date + p_hora) at time zone 'America/Sao_Paulo'
$$;
-- Lançamento da Empresa A com data escolhida (cenário de teste; o trigger aplica na conta).
create function pg_temp.lanc(p_tipo app.tipo_lancamento, p_valor bigint, p_em timestamptz, p_estorna bigint default null)
returns bigint language sql as $$
  insert into app.lancamentos (empresa_id, tipo, valor_cent, estorna_id, motivo, chave_idempotencia, criado_em)
  values ('00000000-0000-0000-0000-0000000000e1', p_tipo, p_valor, p_estorna, 'Teste', gen_random_uuid(), p_em)
  returning id
$$;
-- PDF já "enviado" ao bucket (o upload de verdade está na integração).
create function pg_temp.pdf(p_empresa text) returns text language sql as $$
  insert into storage.objects (bucket_id, name) values ('notas-fiscais', p_empresa || '/' || gen_random_uuid() || '.pdf')
  returning name
$$;
create function pg_temp.ids(p jsonb) returns bigint[] language sql immutable as $$
  select coalesce(array_agg((x ->> 'lancamento_id')::bigint order by (x ->> 'lancamento_id')::bigint), '{}')
    from jsonb_array_elements(p) x
$$;

-- Empresa A: CREDITO desde 40 dias antes de Q1; FATURADO desde 10 dias antes de Q1. Empresa B: CREDITO.
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb,
  pg_temp.em(current_setting('t.q1i')) - interval '40 days', null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "FATURADO"}',
  pg_temp.em(current_setting('t.q1i')) - interval '10 days', null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.base')::jsonb,
  now() - interval '1 hour', null, 'Teste');

-- Lançamentos com data: L0 antes do Faturado; RECARGA em Q1; L1 e L2 em Q1 (L2 às 23h30 do último dia: ainda Q1 no
-- horário de Brasília, já o dia seguinte em UTC); L3 em Q2.
select set_config('t.l0', pg_temp.lanc('AJUSTE', -5000, pg_temp.em(current_setting('t.q1i')) - interval '20 days')::text, true);
select set_config('t.lr', pg_temp.lanc('RECARGA', 100000, pg_temp.em(current_setting('t.q1i')) + interval '1 day')::text, true);
select set_config('t.l1', pg_temp.lanc('AJUSTE', -30000, pg_temp.em(current_setting('t.q1i')))::text, true);
select set_config('t.l2', pg_temp.lanc('AJUSTE', -20000, pg_temp.em(current_setting('t.q1f'), '23:30'))::text, true);
select set_config('t.l3', pg_temp.lanc('AJUSTE', -50000, pg_temp.em(current_setting('t.q2i')))::text, true);
select set_config('t.pdf1', pg_temp.pdf('00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.pdf2', pg_temp.pdf('00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.pdf3', pg_temp.pdf('00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.pdf4', pg_temp.pdf('00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.pdfb', pg_temp.pdf('00000000-0000-0000-0000-0000000000e2'), true);

------------------------------------------------------------------ 1. corridas de agora (Q3): DEBITO, MULTA e ESTORNO
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ped', '{"origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true, "trazer": false,
  "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO", "centro_custo": "CC-7"}', true);
select set_config('t.r1', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('duracao_min', 30,
  'inicio', to_char((now() + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text, true);
select set_config('t.r2', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('duracao_min', 30,
  'inicio', to_char((now() + interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.o1', api.enviar_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid, '{"pedagio_cent": 10000}', null)::text, true);
select set_config('t.o2', api.enviar_orcamento((current_setting('t.r2')::jsonb ->> 'id')::uuid, '{"pedagio_cent": 12000}', null)::text, true);
reset role;
select set_config('t.a1', (current_setting('t.r1')::jsonb ->> 'id'), true);
select set_config('t.a2', (current_setting('t.r2')::jsonb ->> 'id'), true);
select set_config('t.' || k || n, (select case k when 'tot' then o.total_cent::text when 'v' then o.versao::text
                                                  else o.hash end
                                      from app.orcamentos o
                                     where o.atividade_id = current_setting('t.a' || n)::uuid and o.status = 'PENDENTE'), true)
from unnest(array['tot', 'v', 'h']) k, unnest(array['1', '2']) n;

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ap1', api.aprovar_orcamento(current_setting('t.a1')::uuid, current_setting('t.v1')::int,
  current_setting('t.h1'), gen_random_uuid(), null)::text, true);
select set_config('t.ap2', api.aprovar_orcamento(current_setting('t.a2')::uuid, current_setting('t.v2')::int,
  current_setting('t.h2'), gen_random_uuid(), null)::text, true);
select set_config('t.cx2', api.cancelar_agendado(current_setting('t.a2')::uuid, 'Mudou o plano', gen_random_uuid(),
  current_setting('t.tot2')::bigint)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.saida', api.registrar_saida(current_setting('t.a1')::uuid, gen_random_uuid())::text, true);
reset role;
select set_config('t.deb', (select id::text from app.lancamentos
                             where atividade_id = current_setting('t.a1')::uuid and tipo = 'DEBITO'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.est', api.estornar_lancamento(current_setting('t.deb')::bigint, 'Corrida cobrada a mais',
  gen_random_uuid())::text, true);
select set_config('t.pv3', api.previa_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q3i')::date,
  current_setting('t.q3f')::date)::text, true);
reset role;

select ok((current_setting('t.ap1')::jsonb ->> 'ok')::boolean and (current_setting('t.ap2')::jsonb ->> 'ok')::boolean
          and (current_setting('t.cx2')::jsonb ->> 'ok')::boolean and (current_setting('t.saida')::jsonb ->> 'ok')::boolean
          and (current_setting('t.est')::jsonb ->> 'ok')::boolean,
  'fluxo de agora: aprova sem saldo, cancela com multa, sai e o ADM estorna o débito');
select is(current_setting('t.pv3')::jsonb ->> 'ok', 'true', 'previa_fatura da quinzena atual');
select is(array(select x ->> 'tipo' from jsonb_array_elements(current_setting('t.pv3')::jsonb -> 'itens') x order by 1),
  array['AJUSTE', 'AJUSTE', 'AJUSTE', 'DEBITO', 'ESTORNO', 'MULTA'],
  'itens: DEBITO, MULTA, AJUSTE e ESTORNO (sem RECARGA, RESERVA nem LIBERACAO_RESERVA)');
select ok(not (current_setting('t.l0')::bigint = any (pg_temp.ids(current_setting('t.pv3')::jsonb -> 'itens'))),
  'o lançamento de antes do Faturado fica fora');
select is((current_setting('t.pv3')::jsonb ->> 'total_cent')::bigint, 100000 + current_setting('t.tot2')::bigint,
  'total = −Σ valor (o estorno desconta o débito)');
select is((select x - 'lancamento_id' - 'criado_em' - 'valor_cent'
             from jsonb_array_elements(current_setting('t.pv3')::jsonb -> 'itens') x where x ->> 'tipo' = 'DEBITO'),
  jsonb_build_object('tipo', 'DEBITO', 'numero', (select numero from app.atividades where id = current_setting('t.a1')::uuid),
    'solicitante_nome', 'Solicitante A', 'origem', 'Porto de Itajaí', 'paradas', '[]'::jsonb, 'destino', 'Base Navegantes',
    'categoria_nome', null, 'centro_custo', 'CC-7'),
  'o item traz a corrida: número, quem pediu, De → Para, categoria e centro de custo');
select is((select x -> 'numero' from jsonb_array_elements(current_setting('t.pv3')::jsonb -> 'itens') x
            where (x ->> 'lancamento_id')::bigint = current_setting('t.l1')::bigint), 'null'::jsonb,
  'o AJUSTE não tem corrida');

------------------------------------------------------------------ 2. recusas
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.nf', jsonb_build_object('numero', ' 101 ', 'emitida_em', current_setting('t.q2i'),
  'pdf_caminho', current_setting('t.pdf1'))::text, true);
select set_config('t.g_inv1', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1i')::date + 10, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.g_inv2', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q2f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.g_and', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q3i')::date,
  current_setting('t.q3f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.g_nf', api.gerar_fatura('00000000-0000-0000-0000-0000000000e2', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.g_pdfb', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || jsonb_build_object('pdf_caminho', current_setting('t.pdfb')))::text, true);
select set_config('t.g_pdfx', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || jsonb_build_object('pdf_caminho', replace(current_setting('t.pdf1'), '.pdf', '.txt')))::text, true);
select set_config('t.g_pdfn', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || jsonb_build_object('pdf_caminho', '00000000-0000-0000-0000-0000000000e1/' || gen_random_uuid() || '.pdf'))::text, true);
select set_config('t.g_campos', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || '{"numero": "", "emitida_em": "2026-02-30", "vencimento": "ontem"}')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.g_n1', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.pv_n1', api.previa_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date)::text, true);
reset role;

select is(current_setting('t.g_inv1')::jsonb ->> 'codigo', 'QUINZENA_INVALIDA', 'do dia 1 ao 11: QUINZENA_INVALIDA');
select is(current_setting('t.g_inv2')::jsonb ->> 'codigo', 'QUINZENA_INVALIDA', 'duas quinzenas: QUINZENA_INVALIDA');
select is(current_setting('t.g_and')::jsonb ->> 'codigo', 'QUINZENA_EM_ANDAMENTO', 'a quinzena atual: QUINZENA_EM_ANDAMENTO');
select is(current_setting('t.g_nf')::jsonb ->> 'codigo', 'NAO_FATURADO', 'empresa no Crédito: NAO_FATURADO');
select is(current_setting('t.g_pdfb')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'PDF de outra empresa: CAMPOS_INVALIDOS');
select is(current_setting('t.g_pdfx')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'caminho sem .pdf: CAMPOS_INVALIDOS');
select is(current_setting('t.g_pdfn')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'PDF não enviado: CAMPOS_INVALIDOS');
select is((select detalhe -> 'invalidos' from app.auditoria
            where acao = 'GERAR_FATURA' and codigo = 'CAMPOS_INVALIDOS' order by id desc limit 1),
  '["numero", "emitida_em", "vencimento"]'::jsonb, 'o detalhe aponta número, emissão e vencimento');
select is(current_setting('t.g_n1')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'N1 não gera fatura');
select is(current_setting('t.pv_n1')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'N1 não vê a prévia');
select is((select count(*)::int from app.faturas), 0, 'nenhuma recusa gravou fatura');

------------------------------------------------------------------ 3. gerar, gerar de novo, cancelar e gerar outra vez
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.pv1', api.previa_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date)::text, true);
select set_config('t.g1', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.f1', current_setting('t.g1')::jsonb ->> 'fatura', true);
select set_config('t.d1', api.fatura(current_setting('t.f1')::uuid)::text, true);
select set_config('t.g1b', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb)::text, true);
select set_config('t.cm', api.cancelar_fatura(current_setting('t.f1')::uuid, 'x')::text, true);
select set_config('t.c1', api.cancelar_fatura(current_setting('t.f1')::uuid, '  NF cancelada na prefeitura  ')::text, true);
select set_config('t.c1b', api.cancelar_fatura(current_setting('t.f1')::uuid, 'De novo')::text, true);
select set_config('t.g2', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || jsonb_build_object('numero', '102', 'pdf_caminho', current_setting('t.pdf2'),
                          'vencimento', (current_setting('t.hoje')::date + 10)::text))::text, true);
select set_config('t.f2', current_setting('t.g2')::jsonb ->> 'fatura', true);
select set_config('t.d2', api.fatura(current_setting('t.f2')::uuid)::text, true);
reset role;

select is(pg_temp.ids(current_setting('t.pv1')::jsonb -> 'itens'),
  array[current_setting('t.l1')::bigint, current_setting('t.l2')::bigint],
  'prévia de Q1: L1 e L2 (23h30 do último dia, horário de Brasília); sem L0, RECARGA nem Q2');
select is(current_setting('t.g1')::jsonb - 'fatura', '{"ok": true, "numero": 1}'::jsonb, 'gera a fatura nº 1');
select is((current_setting('t.d1')::jsonb -> 'fatura') - 'id',
  jsonb_build_object('numero', 1, 'inicio', current_setting('t.q1i'), 'fim', current_setting('t.q1f'), 'total_cent', 50000,
    'nf_numero', '101', 'nf_emitida_em', current_setting('t.q2i'), 'nf_pdf_caminho', current_setting('t.pdf1'),
    'vencimento', (current_setting('t.q2i')::date + 30)::text, 'status', 'ABERTA',
    'situacao', case when current_setting('t.q2i')::date + 30 < current_setting('t.hoje')::date then 'VENCIDA'
                     else 'ABERTA' end, 'paga_em', null),
  'cabeçalho: total 50000, NF aparada e vencimento = emissão + 30');
select is(pg_temp.ids(current_setting('t.d1')::jsonb -> 'itens'),
  array[current_setting('t.l1')::bigint, current_setting('t.l2')::bigint], 'a fatura tem os itens da prévia');
select is(current_setting('t.g1b')::jsonb ->> 'codigo', 'NADA_A_FATURAR', 'gerar de novo a mesma quinzena: NADA_A_FATURAR');
select is(current_setting('t.cm')::jsonb ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'cancelar sem motivo (3 a 200): recusado');
select is(current_setting('t.c1')::jsonb, '{"ok": true}'::jsonb, 'cancela a fatura aberta');
select is((select cancelada_motivo from app.faturas where id = current_setting('t.f1')::uuid), 'NF cancelada na prefeitura',
  'o motivo fica guardado');
select is(current_setting('t.c1b')::jsonb ->> 'codigo', 'FATURA_CANCELADA', 'cancelar a cancelada: FATURA_CANCELADA');
select is(current_setting('t.g2')::jsonb ->> 'numero', '2', 'gerar de novo depois de cancelar: fatura nº 2');
select is(pg_temp.ids(current_setting('t.d2')::jsonb -> 'itens'),
  array[current_setting('t.l1')::bigint, current_setting('t.l2')::bigint], 'os mesmos itens voltam, sem duplicar');
select is((select count(*)::int from app.faturas_itens where ativa), 2, 'só os itens da nº 2 estão ativos');
select is((current_setting('t.d2')::jsonb #>> '{fatura,total_cent}')::bigint, 50000::bigint, 'o mesmo total');

------------------------------------------------------------------ 4. estorno depois do fechamento → fatura seguinte
select set_config('t.el1', pg_temp.lanc('ESTORNO', 30000, pg_temp.em((current_setting('t.q2i')::date + 1)::text),
  current_setting('t.l1')::bigint)::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.rs1', api.faturas_resumo()::text, true);
select set_config('t.d2b', api.fatura(current_setting('t.f2')::uuid)::text, true);
select set_config('t.g3', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q2i')::date,
  current_setting('t.q2f')::date, jsonb_build_object('numero', 'NF-103', 'emitida_em',
    (current_setting('t.hoje')::date - 40)::text, 'pdf_caminho', current_setting('t.pdf3')))::text, true);
select set_config('t.f3', current_setting('t.g3')::jsonb ->> 'fatura', true);
select set_config('t.d3', api.fatura(current_setting('t.f3')::uuid)::text, true);
select set_config('t.rs2', api.faturas_resumo()::text, true);
reset role;

select is(current_setting('t.d2b')::jsonb, current_setting('t.d2')::jsonb, 'a fatura nº 2, já gerada, não muda');
select is((select x -> 'quinzena_pronta' from jsonb_array_elements(current_setting('t.rs1')::jsonb -> 'empresas') x
            where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e1'),
  jsonb_build_object('inicio', current_setting('t.q2i'), 'fim', current_setting('t.q2f')),
  'faturas_resumo: a última quinzena fechada está pronta para faturar');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('t.rs1')::jsonb -> 'empresas') x
                       where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e2'),
  'faturas_resumo: empresa no Crédito fica fora');
select is(pg_temp.ids(current_setting('t.d3')::jsonb -> 'itens'),
  array[current_setting('t.l3')::bigint, current_setting('t.el1')::bigint], 'nº 3 (Q2): L3 e o estorno de L1');
select is((current_setting('t.d3')::jsonb #>> '{fatura,total_cent}')::bigint, 20000::bigint,
  'total da nº 3: 50000 − 30000 do estorno');
select is(current_setting('t.d3')::jsonb #>> '{fatura,vencimento}', (current_setting('t.hoje')::date - 10)::text,
  'vencimento padrão: emissão + 30');
select is(current_setting('t.d3')::jsonb #>> '{fatura,situacao}', 'VENCIDA', 'aberta com vencimento passado: VENCIDA');
select is(current_setting('t.d3')::jsonb #>> '{fatura,status}', 'ABERTA', 'o status continua ABERTA');
select is((select x -> 'quinzena_pronta' from jsonb_array_elements(current_setting('t.rs2')::jsonb -> 'empresas') x
            where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e1'), 'null'::jsonb,
  'depois de faturada, nenhuma quinzena pronta');
select is((select x - 'empresa_id' - 'quinzena_pronta' from jsonb_array_elements(current_setting('t.rs2')::jsonb -> 'empresas') x
            where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e1'),
  jsonb_build_object('empresa_nome', 'Empresa A', 'a_faturar_cent', current_setting('t.tot2')::bigint,
                     'em_aberto_cent', 70000, 'vencidas_cent', 20000),
  'faturas_resumo: A faturar (multa de agora), Em aberto (nº 2 + nº 3) e Vencidas (nº 3)');

------------------------------------------------------------------ 5. pagar, trocar PDF e estornar o pagamento
select set_config('t.saldo0', (select saldo_contabil_cent::text from app.contas
                                where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.pg_fut', api.marcar_fatura_paga(current_setting('t.f2')::uuid,
  current_setting('t.hoje')::date + 1)::text, true);
select set_config('t.pg_ant', api.marcar_fatura_paga(current_setting('t.f3')::uuid,
  current_setting('t.hoje')::date - 41)::text, true);
select set_config('t.pg', api.marcar_fatura_paga(current_setting('t.f2')::uuid, current_setting('t.hoje')::date)::text, true);
select set_config('t.pg2', api.marcar_fatura_paga(current_setting('t.f2')::uuid, current_setting('t.hoje')::date)::text, true);
select set_config('t.pgc', api.marcar_fatura_paga(current_setting('t.f1')::uuid, current_setting('t.hoje')::date)::text, true);
select set_config('t.cp', api.cancelar_fatura(current_setting('t.f2')::uuid, 'Tentativa')::text, true);
select set_config('t.tp', api.trocar_pdf_fatura(current_setting('t.f2')::uuid, current_setting('t.pdf4'))::text, true);
select set_config('t.tp3x', api.trocar_pdf_fatura(current_setting('t.f3')::uuid, current_setting('t.pdfb'))::text, true);
select set_config('t.tp3', api.trocar_pdf_fatura(current_setting('t.f3')::uuid, current_setting('t.pdf4'))::text, true);
select set_config('t.estp', api.estornar_lancamento((current_setting('t.pg')::jsonb ->> 'lancamento_id')::bigint,
  'Estornar pagamento', gen_random_uuid())::text, true);
select set_config('t.lf', api.faturas('00000000-0000-0000-0000-0000000000e1')::text, true);
reset role;

select is(current_setting('t.pg_fut')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'paga no futuro: recusado');
select is(current_setting('t.pg_ant')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'paga antes da emissão da NF: recusado');
select is(current_setting('t.pg')::jsonb ->> 'ok', 'true', 'marca a nº 2 como paga');
select is((select tipo::text || ':' || valor_cent from app.lancamentos
            where id = (current_setting('t.pg')::jsonb ->> 'lancamento_id')::bigint), 'PAGAMENTO_FATURA:50000',
  'PAGAMENTO_FATURA igual ao total');
select is((select saldo_contabil_cent from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('t.saldo0')::bigint + 50000, 'o saldo sobe pelo total');
select is(current_setting('t.pg2')::jsonb ->> 'codigo', 'JA_PROCESSADO', 'paga de novo: JA_PROCESSADO');
select is((select count(*)::int from app.lancamentos where tipo = 'PAGAMENTO_FATURA'), 1, 'um pagamento só');
select is(current_setting('t.pgc')::jsonb ->> 'codigo', 'FATURA_CANCELADA', 'pagar a cancelada: FATURA_CANCELADA');
select is(current_setting('t.cp')::jsonb ->> 'codigo', 'FATURA_PAGA', 'cancelar a paga: FATURA_PAGA');
select is(current_setting('t.tp')::jsonb ->> 'codigo', 'FATURA_PAGA', 'trocar o PDF da paga: FATURA_PAGA');
select is(current_setting('t.tp3x')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'trocar por PDF de outra empresa: recusado');
select ok((current_setting('t.tp3')::jsonb ->> 'ok')::boolean
          and (select nf_pdf_caminho from app.faturas where id = current_setting('t.f3')::uuid) = current_setting('t.pdf4'),
  'troca o PDF da aberta');
select is(current_setting('t.estp')::jsonb ->> 'codigo', 'NAO_ESTORNAVEL', 'estornar o PAGAMENTO_FATURA: recusado');
select is(array(select x ->> 'situacao' from jsonb_array_elements(current_setting('t.lf')::jsonb -> 'faturas') x),
  array['VENCIDA', 'PAGA', 'CANCELADA'], 'faturas: a cancelada continua listada (nº 3, 2, 1)');
select is((select x ->> 'paga_em' from jsonb_array_elements(current_setting('t.lf')::jsonb -> 'faturas') x
            where x ->> 'situacao' = 'PAGA'), current_setting('t.hoje'), 'a paga traz paga_em');
select is(current_setting('t.lf')::jsonb - 'faturas' - 'a_faturar',
  jsonb_build_object('ok', true, 'forma_cobranca', 'FATURADO', 'em_aberto_cent', 20000, 'vencidas_cent', 20000),
  'faturas: forma, Em aberto e Vencidas');
select is(array(select x ->> 'tipo' from jsonb_array_elements(current_setting('t.lf')::jsonb #> '{a_faturar,itens}') x
                 order by 1),
  array['DEBITO', 'ESTORNO', 'MULTA'], 'A faturar: as corridas de agora (o pagamento nunca entra)');
select is((current_setting('t.lf')::jsonb #>> '{a_faturar,total_cent}')::bigint, current_setting('t.tot2')::bigint,
  'A faturar: total');

------------------------------------------------------------------ 6. quem lê
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.n1', api.faturas(null)::text, true);
select set_config('t.n1e', api.faturas('00000000-0000-0000-0000-0000000000e1')::text, true);
select set_config('t.n1x', api.faturas('00000000-0000-0000-0000-0000000000e2')::text, true);
select set_config('t.n1f', api.fatura(current_setting('t.f2')::uuid)::text, true);
select set_config('t.n1r', api.faturas_resumo()::text, true);
select set_config('t.n1p', api.painel_empresa()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.n2', (api.faturas(null) ->> 'codigo') || ',' || (api.fatura(current_setting('t.f2')::uuid) ->> 'codigo'), true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.n3', (api.faturas(null) ->> 'codigo') || ',' || (api.fatura(current_setting('t.f2')::uuid) ->> 'codigo'), true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.mot', (api.faturas('00000000-0000-0000-0000-0000000000e1') ->> 'codigo') || ','
  || (api.fatura(current_setting('t.f2')::uuid) ->> 'codigo'), true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.n1b', (api.fatura(current_setting('t.f2')::uuid) ->> 'codigo') || ','
  || (api.faturas(null) -> 'faturas')::text || ',' || (api.painel_empresa() -> 'resumo' ? 'a_faturar_cent')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm_nf', api.fatura(gen_random_uuid())::text, true);
reset role;

select is(current_setting('t.n1')::jsonb, current_setting('t.lf')::jsonb, 'N1 lê as faturas da empresa (sem passar a empresa)');
select is(current_setting('t.n1e')::jsonb ->> 'ok', 'true', 'N1 lê passando a própria empresa');
select is(current_setting('t.n1x')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'N1 não lê outra empresa');
select is(current_setting('t.n1f')::jsonb -> 'itens', current_setting('t.d2')::jsonb -> 'itens', 'N1 lê o detalhe da fatura');
select is(current_setting('t.n1r')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'faturas_resumo é só do ADM');
select is((current_setting('t.n1p')::jsonb -> 'resumo') - 'mes' - 'gasto_cent' - 'reservado_cent' - 'disponivel_cent'
            - 'total_mes_cent' - 'contato_recarga',
  jsonb_build_object('forma_cobranca', 'FATURADO', 'a_faturar_cent', current_setting('t.tot2')::bigint,
                     'em_aberto_cent', 20000, 'vencidas_cent', 20000),
  'painel_empresa no FATURADO: A faturar, Em aberto e Vencidas');
select is(current_setting('t.n2'), 'SEM_PERMISSAO,SEM_PERMISSAO', 'N2 não lê faturas');
select is(current_setting('t.n3'), 'SEM_PERMISSAO,SEM_PERMISSAO', 'N3 não lê faturas');
select is(current_setting('t.mot'), 'SEM_PERMISSAO,SEM_PERMISSAO', 'o motorista não lê faturas');
select is(current_setting('t.n1b'), 'SEM_PERMISSAO,[],false',
  'N1 de outra empresa: não lê a fatura; a dele vem vazia, e o painel no Crédito não traz os números da fatura');
select is(current_setting('t.adm_nf')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'ADM: fatura inexistente');

------------------------------------------------------------------ 6b. quinzena já faturada; empresa de volta ao Crédito
-- um lançamento datado em Q1 depois de a nº 2 (Q1) já existir: gerar Q1 de novo não cria outra fatura da mesma quinzena
select set_config('t.lq1', pg_temp.lanc('AJUSTE', -1000, pg_temp.em(current_setting('t.q1i')) + interval '2 days')::text, true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "CREDITO"}', now(), null, 'Teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.gq1', api.gerar_fatura('00000000-0000-0000-0000-0000000000e1', current_setting('t.q1i')::date,
  current_setting('t.q1f')::date, current_setting('t.nf')::jsonb
    || jsonb_build_object('numero', '104', 'pdf_caminho', current_setting('t.pdf2')))::text, true);
select set_config('t.rs3', api.faturas_resumo()::text, true);
reset role;
select is(current_setting('t.gq1')::jsonb ->> 'codigo', 'NADA_A_FATURAR',
  'quinzena com fatura não cancelada e um lançamento novo nela: NADA_A_FATURAR (sem erro de índice)');
select is((select count(*)::int from app.faturas where empresa_id = '00000000-0000-0000-0000-0000000000e1'), 3,
  'nenhuma fatura nova');
select is(array(select x ->> 'empresa_id' from jsonb_array_elements(current_setting('t.rs3')::jsonb -> 'empresas') x),
  array['00000000-0000-0000-0000-0000000000e1'],
  'faturas_resumo: a empresa de volta ao Crédito com fatura aberta continua listada (a B, sem nada, não)');

------------------------------------------------------------------ 7. reconciliação
select is(interno.reconciliar() -> 'divergencias', '[]'::jsonb, 'reconciliação limpa depois de todo o fluxo');
-- divergências injetadas (cenário de teste): fatura com total errado e o L1 também nela (a nº 2, paga, já o tem)
insert into app.faturas (id, empresa_id, numero, inicio, fim, total_cent, nf_numero, nf_emitida_em, nf_pdf_caminho, vencimento)
values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000e1', 99, current_setting('t.q3i')::date,
        current_setting('t.q3f')::date, 12345, '999', current_setting('t.q2i')::date, current_setting('t.pdf1'),
        current_setting('t.q2i')::date);
alter table app.faturas_itens disable trigger faturas_itens_validar;
insert into app.faturas_itens (fatura_id, lancamento_id, ativa)
values ('00000000-0000-0000-0000-0000000000f9', current_setting('t.l1')::bigint, false);
alter table app.faturas_itens enable trigger faturas_itens_validar;
select set_config('t.rdiv', interno.reconciliar()::text, true);
select is(array(select x ->> 'tipo' from jsonb_array_elements(current_setting('t.rdiv')::jsonb -> 'divergencias') x order by 1),
  array['FATURA_TOTAL_DIVERGENTE', 'LANCAMENTO_EM_DUAS_FATURAS'], 'acusa o total divergente e o lançamento em duas faturas');

------------------------------------------------------------------ 8. tabelas e privilégios
select throws_ok($$ delete from app.faturas where id = '00000000-0000-0000-0000-0000000000f9' $$, '42501', null,
  'fatura não se apaga');
select throws_ok($$ update app.faturas set total_cent = 1 where id = '00000000-0000-0000-0000-0000000000f9' $$, '42501', null,
  'o total da fatura não muda');
select throws_ok(format($$ update app.faturas set nf_pdf_caminho = 'x' where id = %L $$, current_setting('t.f2')), '42501', null,
  'a paga não muda mais');
select throws_ok(format($$ update app.faturas_itens set ativa = true where fatura_id = %L $$, current_setting('t.f1')), '42501',
  null, 'item só passa de ativo para inativo');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'PAGAMENTO_FATURA', 0, 'teste', gen_random_uuid()) $$,
  '23514', null, 'PAGAMENTO_FATURA é sempre positivo');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api'
     and p.proname in ('previa_fatura', 'gerar_fatura', 'marcar_fatura_paga', 'cancelar_fatura', 'trocar_pdf_fatura',
                       'faturas', 'fatura', 'faturas_resumo')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
$$, 'RPCs de fatura: authenticated executa, anon não');
select is((select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',')
             from storage.buckets where id = 'notas-fiscais'), 'false:5242880:application/pdf',
  'bucket notas-fiscais: privado, 5 MB, só PDF');

select * from finish();
rollback;
