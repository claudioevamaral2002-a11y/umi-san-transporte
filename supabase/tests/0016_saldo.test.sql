-- Fase 2B, Task 1 (migration 20261009140000_saldo_livro_razao.sql): contas, convenção de sinais, livro-razão imutável,
-- recarga/ajuste/estorno (só ADM, idempotência por empresa, unicidade de regra), saldo, extrato, painel do ADM e
-- reconciliação (inclusive divergência injetada). Aprovação/cancelamento e privacidade do extrato com pedidos: 0017.
begin;
create extension if not exists pgtap with schema extensions;
select plan(98);

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
  ('n1b@teste.local',  'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local');
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
                                                 'aal', case when u in ('a1', 'a2', 'a3') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) u;
-- ADM sem segundo fator (aal1)
select set_config('t.ca1_aal1', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                                                  'aal', 'aal1')::text, true);
select set_config('t.k' || i, gen_random_uuid()::text, true) from generate_series(1, 12) i;

------------------------------------------------------------------ 1. contas e convenção de sinais
select ok(exists (select 1 from app.contas c join app.empresas e on e.id = c.empresa_id where e.nome = 'Umi San'),
  'empresa existente antes da migração ganhou conta');
select is((select count(*)::int from app.contas
            where empresa_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')
              and saldo_contabil_cent = 0 and reservado_cent = 0), 2, 'empresa nova nasce com conta zerada (trigger)');
select is(interno.efeito_contabil('RECARGA', 100), 100::bigint, 'sinal: RECARGA +valor no contábil');
select is(interno.efeito_reservado('RECARGA', 100), 0::bigint, 'sinal: RECARGA não mexe no reservado');
select is(interno.efeito_contabil('MULTA', -50), -50::bigint, 'sinal: MULTA (negativa) debita o contábil');
select is(interno.efeito_contabil('RESERVA', 700), 0::bigint, 'sinal: RESERVA tem efeito zero no contábil');
select is(interno.efeito_reservado('RESERVA', 700), 700::bigint, 'sinal: RESERVA soma o valor ao reservado');
select is(interno.efeito_contabil('LIBERACAO_RESERVA', 700), 0::bigint, 'sinal: LIBERACAO_RESERVA efeito zero no contábil');
select is(interno.efeito_reservado('LIBERACAO_RESERVA', 700), -700::bigint, 'sinal: LIBERACAO_RESERVA subtrai do reservado');

select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'RECARGA', -1, 'teste', gen_random_uuid()) $$,
  '23514', null, 'RECARGA negativa recusada pelo CHECK');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'AJUSTE', 0, 'teste', gen_random_uuid()) $$,
  '23514', null, 'AJUSTE zero recusado');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'RECARGA', 100, gen_random_uuid()) $$,
  '23514', null, 'RECARGA sem motivo recusada');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'ESTORNO', -100, 'teste', gen_random_uuid()) $$,
  '23514', null, 'ESTORNO sem estorna_id recusado');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -100, gen_random_uuid()) $$,
  '23514', null, 'MULTA sem atividade recusada');

------------------------------------------------------------------ 2. quem lança saldo
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente N1 não lança recarga');
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', 1000, 'Ajuste', gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente N1 não lança ajuste');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente N2 não lança recarga');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'motorista não lança recarga');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', 1000, 'Ajuste', gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'gestor de frota não lança ajuste');
select set_config('request.jwt.claims', current_setting('t.ca1_aal1'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'ADM sem segundo fator não lança');

------------------------------------------------------------------ 3. recarga
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 0, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'recarga zero recusada');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', -10, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'recarga negativa recusada');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, '  ', null, gen_random_uuid()) ->> 'codigo',
  'MOTIVO_OBRIGATORIO', 'recarga sem motivo recusada');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', null, null) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'recarga sem chave de idempotência recusada');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000, 'Pix', repeat('x', 201), gen_random_uuid()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'comprovante acima de 200 caracteres recusado');
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 100000000001, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'VALOR_FORA_DO_LIMITE', 'recarga acima do teto recusada');
select is(api.lancar_recarga('00000000-0000-0000-0000-00000000dead', 1000, 'Pix', null, gen_random_uuid()) ->> 'codigo',
  'NAO_ENCONTRADO', 'recarga para empresa inexistente: NAO_ENCONTRADO');

select set_config('t.rec1', api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 100000, 'Pix de outubro',
  'E2E-123', current_setting('t.k1')::uuid)::text, true);
select set_config('t.rec1b', api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 100000, 'Pix de outubro',
  'E2E-123', current_setting('t.k1')::uuid)::text, true);
select set_config('t.rec1c', api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 999, 'Outro valor',
  null, current_setting('t.k1')::uuid)::text, true);
-- a mesma chave em outra empresa é outra operação (chave única POR EMPRESA)
select set_config('t.recB', api.lancar_recarga('00000000-0000-0000-0000-0000000000e2', 5000, 'Pix B',
  null, current_setting('t.k1')::uuid)::text, true);
reset role;

select is(current_setting('t.rec1')::jsonb - 'lancamento_id',
  '{"ok": true, "tipo": "RECARGA", "valor_cent": 100000, "saldo_contabil_cent": 100000, "reservado_cent": 0,
    "disponivel_cent": 100000}'::jsonb, 'recarga: saldos depois do lançamento');
select is(current_setting('t.rec1b')::jsonb, current_setting('t.rec1')::jsonb, 'mesma chave: devolve o resultado original');
select is((select count(*)::int from app.lancamentos where empresa_id = '00000000-0000-0000-0000-0000000000e1'), 1,
  'mesma chave: nenhum lançamento novo');
select is(current_setting('t.rec1c')::jsonb ->> 'codigo', 'CHAVE_REUTILIZADA', 'mesma chave com outro valor: CHAVE_REUTILIZADA');
select is((current_setting('t.recB')::jsonb ->> 'saldo_contabil_cent')::bigint, 5000::bigint,
  'mesma chave em outra empresa: operação independente');
select ok((select l.tipo = 'RECARGA' and l.valor_cent = 100000 and l.motivo = 'Pix de outubro' and l.comprovante = 'E2E-123'
                  and l.criado_por = '00000000-0000-0000-0000-0000000000a1' and l.chave_idempotencia = current_setting('t.k1')::uuid
             from app.lancamentos l where l.id = (current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint),
  'recarga gravada com motivo, comprovante, autor e chave');
select is((select (saldo_contabil_cent, reservado_cent)::text from app.contas
            where empresa_id = '00000000-0000-0000-0000-0000000000e1'), '(100000,0)', 'conta atualizada pelo trigger');
select ok(exists (select 1 from app.auditoria where acao = 'LANCAR_RECARGA' and resultado = 'OK'
                    and alvo = 'empresa:00000000-0000-0000-0000-0000000000e1' and (detalhe ->> 'valor_cent')::bigint = 100000),
  'recarga auditada');
select ok(exists (select 1 from app.auditoria where acao = 'LANCAR_RECARGA' and resultado = 'OK'
                    and (detalhe ->> 'repeticao')::boolean),
  'repetição auditada como repetição');

------------------------------------------------------------------ 4. ajuste e estorno
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', 0, 'Correção', gen_random_uuid()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'ajuste zero recusado');
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', -100, 'x', gen_random_uuid()) ->> 'codigo',
  'MOTIVO_OBRIGATORIO', 'ajuste com motivo curto recusado');
select set_config('t.aj1', api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', -30000, 'Correção de lançamento',
  current_setting('t.k2')::uuid)::text, true);
select set_config('t.aj2', api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', 500, 'Bônus',
  current_setting('t.k3')::uuid)::text, true);
select set_config('t.est1', api.estornar_lancamento((current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint,
  'Pix devolvido', current_setting('t.k4')::uuid)::text, true);
select set_config('t.est1b', api.estornar_lancamento((current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint,
  'Pix devolvido', current_setting('t.k4')::uuid)::text, true);
select set_config('t.est2', api.estornar_lancamento((current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint,
  'De novo', current_setting('t.k5')::uuid)::text, true);
select set_config('t.est3', api.estornar_lancamento((current_setting('t.est1')::jsonb ->> 'lancamento_id')::bigint,
  'Estorno do estorno', current_setting('t.k6')::uuid)::text, true);
select is(api.estornar_lancamento(999999999, 'Inexistente', gen_random_uuid()) ->> 'codigo', 'NAO_ENCONTRADO',
  'estorno de lançamento inexistente: NAO_ENCONTRADO');
select is(api.estornar_lancamento((current_setting('t.aj1')::jsonb ->> 'lancamento_id')::bigint, '', gen_random_uuid()) ->> 'codigo',
  'MOTIVO_OBRIGATORIO', 'estorno sem motivo recusado');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.estornar_lancamento((current_setting('t.aj1')::jsonb ->> 'lancamento_id')::bigint, 'Cliente', gen_random_uuid()) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente não estorna');
reset role;

select is((current_setting('t.aj1')::jsonb ->> 'saldo_contabil_cent')::bigint, 70000::bigint, 'ajuste negativo debita');
select is((current_setting('t.aj2')::jsonb ->> 'saldo_contabil_cent')::bigint, 70500::bigint, 'ajuste positivo credita');
select is(current_setting('t.est1')::jsonb - 'lancamento_id',
  '{"ok": true, "tipo": "ESTORNO", "valor_cent": -100000, "saldo_contabil_cent": -29500, "reservado_cent": 0,
    "disponivel_cent": -29500}'::jsonb, 'estorno lança o valor oposto');
select is((select estorna_id from app.lancamentos where id = (current_setting('t.est1')::jsonb ->> 'lancamento_id')::bigint),
  (current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint, 'estorno aponta o lançamento estornado');
select is(current_setting('t.est1b')::jsonb, current_setting('t.est1')::jsonb, 'estorno repetido com a mesma chave: mesmo resultado');
select is(current_setting('t.est2')::jsonb ->> 'codigo', 'JA_PROCESSADO', 'segundo estorno (outra chave): JA_PROCESSADO');
select is(current_setting('t.est3')::jsonb ->> 'codigo', 'NAO_ESTORNAVEL', 'estorno de estorno: NAO_ESTORNAVEL');
select is((select count(*)::int from app.lancamentos where tipo = 'ESTORNO'), 1, 'um único estorno gravado');
select ok(exists (select 1 from app.auditoria where acao = 'ESTORNAR_LANCAMENTO' and resultado = 'NEGADO' and codigo = 'JA_PROCESSADO'),
  'JA_PROCESSADO auditado');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, estorna_id, motivo, chave_idempotencia)
                    select empresa_id, 'ESTORNO', -valor_cent, id, 'duplicado', gen_random_uuid()
                    from app.lancamentos where id = (current_setting('t.rec1')::jsonb ->> 'lancamento_id')::bigint $$,
  '23505', null, 'unicidade: 1 ESTORNO por lançamento mesmo por fora das RPCs');

------------------------------------------------------------------ 5. imutabilidade e acesso direto
select throws_ok($$ update app.lancamentos set valor_cent = 1 $$, '42501', null, 'UPDATE em lançamento recusado (postgres)');
select throws_ok($$ delete from app.lancamentos $$, '42501', null, 'DELETE em lançamento recusado (postgres)');
select throws_ok($$ truncate app.lancamentos cascade $$, '42501', null, 'TRUNCATE em lançamentos recusado');
select throws_ok($$ update app.idempotencia set resultado = '{}' $$, '42501', null, 'idempotência imutável');
select throws_ok($$ truncate app.reconciliacoes $$, '42501', null, 'reconciliações imutáveis');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select throws_ok($$ select * from app.lancamentos $$, '42501', null, 'ADM não lê app.lancamentos direto');
select throws_ok($$ insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
                    values ('00000000-0000-0000-0000-0000000000e1', 'RECARGA', 1, 'xxx', gen_random_uuid()) $$,
  '42501', null, 'ninguém insere lançamento direto');
select throws_ok($$ update app.contas set saldo_contabil_cent = 1 $$, '42501', null, 'ninguém altera conta direto');
select throws_ok($$ select interno.reconciliar() $$, '42501', null, 'interno.reconciliar não é chamável');
reset role;

------------------------------------------------------------------ 6. saldo
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.s_n3', api.saldo_empresa(null)::text, true);
select is(api.saldo_empresa('00000000-0000-0000-0000-0000000000e2') ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não vê saldo de outra empresa');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is((api.saldo_empresa('00000000-0000-0000-0000-0000000000e1') ->> 'disponivel_cent')::bigint, -29500::bigint,
  'N2 vê o saldo da própria empresa');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.saldo_empresa('00000000-0000-0000-0000-0000000000e1') ->> 'codigo', 'SEM_PERMISSAO', 'motorista não vê saldo');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.saldo_empresa('00000000-0000-0000-0000-0000000000e1') ->> 'codigo', 'SEM_PERMISSAO', 'gestor de frota não vê saldo');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is((api.saldo_empresa('00000000-0000-0000-0000-0000000000e2') ->> 'saldo_contabil_cent')::bigint, 5000::bigint,
  'ADM vê o saldo de qualquer empresa');
select is(api.saldo_empresa(null) ->> 'codigo', 'NAO_ENCONTRADO', 'ADM sem empresa: NAO_ENCONTRADO');
select is(api.saldo_empresa('00000000-0000-0000-0000-0000000000e2') ->> 'limite_cent', '0',
  'empresa sem contrato vigente: limite 0');
reset role;
select is(current_setting('t.s_n3')::jsonb - 'atualizado_em',
  '{"ok": true, "empresa_id": "00000000-0000-0000-0000-0000000000e1", "saldo_contabil_cent": -29500, "reservado_cent": 0,
    "disponivel_cent": -29500, "limite_cent": 50000, "alerta_cent": 20000, "abaixo_alerta": true,
    "forma_cobranca": "CREDITO"}'::jsonb,
  'N3 vê o saldo da própria empresa (limite e alerta do contrato vigente)');

------------------------------------------------------------------ 7. extrato
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.x_n3', api.extrato(null, '{}')::text, true);
select is(jsonb_array_length(api.extrato(null, '{"tipos": ["RECARGA"]}') -> 'itens'), 1, 'extrato filtra por tipo');
select is(jsonb_array_length(api.extrato(null, '{"limite": 2}') -> 'itens'), 2, 'extrato respeita o limite');
select is(jsonb_array_length(api.extrato(null, jsonb_build_object('de', now() + interval '1 minute')) -> 'itens'), 0,
  'extrato filtra pelo período');
select is(api.extrato(null, '{"tipos": ["PIX"]}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'tipo desconhecido recusado');
select is(api.extrato(null, '{"limite": 501}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'limite acima de 500 recusado');
select is(api.extrato(null, '{"x": 1}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'chave de filtro desconhecida recusada');
select is(api.extrato('00000000-0000-0000-0000-0000000000e2', '{}') ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não vê extrato de outra empresa');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.extrato('00000000-0000-0000-0000-0000000000e1', '{}') ->> 'codigo', 'SEM_PERMISSAO', 'motorista não vê extrato');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.x_adm', api.extrato('00000000-0000-0000-0000-0000000000e1', '{}')::text, true);
reset role;
select is(jsonb_path_query_array(current_setting('t.x_n3')::jsonb, '$.itens[*].tipo'),
  '["ESTORNO", "AJUSTE", "AJUSTE", "RECARGA"]'::jsonb, 'extrato do cliente: todos os lançamentos, do mais novo ao mais antigo');
select is(jsonb_path_query_array(current_setting('t.x_n3')::jsonb, '$.itens[*].efeito_contabil_cent'),
  '[-100000, 500, -30000, 100000]'::jsonb, 'extrato traz o efeito no contábil de cada linha');
select ok(not (current_setting('t.x_n3')::jsonb -> 'itens' -> 0 ? 'motivo')
          and not (current_setting('t.x_n3')::jsonb -> 'itens' -> 0 ? 'comprovante'),
  'cliente não vê motivo nem comprovante');
select is(current_setting('t.x_adm')::jsonb #>> '{itens,3,comprovante}', 'E2E-123', 'ADM vê o comprovante');
select is(current_setting('t.x_adm')::jsonb #>> '{itens,3,criado_por_nome}', 'Admin Teste', 'ADM vê quem lançou');

------------------------------------------------------------------ 8. reconciliação e painel
select set_config('t.rec_ok', interno.reconciliar()::text, true);
select is(current_setting('t.rec_ok')::jsonb -> 'divergencias', '[]'::jsonb, 'reconciliação limpa: sem divergências');
select ok((select ok from app.reconciliacoes where id = (current_setting('t.rec_ok')::jsonb ->> 'reconciliacao_id')::bigint),
  'reconciliação limpa gravada como ok');

-- injeta divergência: lançamento sem passar pelo trigger da conta (só nesta transação de teste)
alter table app.lancamentos disable trigger lancamentos_aplicar;
insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia)
values ('00000000-0000-0000-0000-0000000000e2', 'RECARGA', 777, 'injetado', gen_random_uuid());
alter table app.lancamentos enable trigger lancamentos_aplicar;
-- e uma reserva fantasma no contador da conta (a conta só muda pelo livro-razão: desliga a proteção nesta transação)
alter table app.contas disable trigger contas_proteger;
update app.contas set reservado_cent = 10 where empresa_id = '00000000-0000-0000-0000-0000000000e1';
alter table app.contas enable trigger contas_proteger;
select set_config('t.rec_div', interno.reconciliar()::text, true);
select ok(not (current_setting('t.rec_div')::jsonb ->> 'ok')::boolean, 'reconciliação detecta a divergência injetada');
select is((select jsonb_agg(x ->> 'empresa_id' order by x ->> 'empresa_id')
             from jsonb_array_elements(current_setting('t.rec_div')::jsonb -> 'divergencias') x
            where x ->> 'tipo' = 'CONTA_DIVERGENTE'),
  '["00000000-0000-0000-0000-0000000000e1", "00000000-0000-0000-0000-0000000000e2"]'::jsonb,
  'CONTA_DIVERGENTE nas duas empresas (contábil e reservado)');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.rec_div')::jsonb -> 'divergencias') x
                   where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e2'
                     and (x ->> 'contabil_conta')::bigint = 5000 and (x ->> 'contabil_livro')::bigint = 5777),
  'divergência traz o valor da conta e o recalculado');
select ok(exists (select 1 from app.auditoria where acao = 'RECONCILIAR_SALDOS' and resultado = 'ERRO'
                    and codigo = 'DIVERGENCIA_SALDO'), 'divergência auditada como ERRO');
select ok(exists (select 1 from cron.job where jobname = 'reconciliar-saldos' and schedule = '0 6 * * *'
                    and command = 'select interno.reconciliar()'),
  'reconciliação diária às 06:00 UTC (03:00 em São Paulo)');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.painel', api.painel_adm()::text, true);
select is(api.painel_adm(now(), now() - interval '1 day') ->> 'codigo', 'CAMPOS_INVALIDOS', 'painel: período invertido recusado');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.painel_adm() ->> 'codigo', 'SEM_PERMISSAO', 'cliente não vê o painel');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.painel_adm() ->> 'codigo', 'SEM_PERMISSAO', 'motorista não vê o painel');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.painel_adm() ->> 'codigo', 'SEM_PERMISSAO', 'gestor de frota não vê o painel');
reset role;
select is((select x - 'atualizado_em' from jsonb_array_elements(current_setting('t.painel')::jsonb -> 'empresas') x
            where x ->> 'empresa_id' = '00000000-0000-0000-0000-0000000000e1'),
  '{"empresa_id": "00000000-0000-0000-0000-0000000000e1", "empresa_nome": "Empresa A", "tem_contrato": true,
    "saldo_contabil_cent": -29500, "reservado_cent": 10, "disponivel_cent": -29510, "limite_cent": 50000,
    "alerta_cent": 20000, "abaixo_alerta": true, "forma_cobranca": "CREDITO"}'::jsonb,
  'painel: crédito por empresa com limite, alerta e sinal de alerta');
select is(current_setting('t.painel')::jsonb #>> '{ultima_reconciliacao,ok}', 'false', 'painel: última reconciliação (com divergência)');
select ok((current_setting('t.painel')::jsonb #>> '{ultima_reconciliacao,divergencias_qtd}')::int >= 2,
  'painel: quantidade de divergências');
select ok((current_setting('t.painel')::jsonb #>> '{pendencias,empresas_abaixo_alerta}')::int >= 1,
  'painel: empresas abaixo do alerta');
select is(current_setting('t.painel')::jsonb -> 'aprovado', '{"total_cent": 0, "quantidade": 0}'::jsonb,
  'painel: nada aprovado ainda no período');

-- conta criada sob demanda se faltar (só para empresa sem lançamentos; com histórico é integridade: 0019)
insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e3', 'Empresa C');
alter table app.contas disable trigger contas_proteger;
delete from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e3';
alter table app.contas enable trigger contas_proteger;
select is((interno.travar_conta('00000000-0000-0000-0000-0000000000e3')).saldo_contabil_cent, 0::bigint,
  'travar_conta recria a conta que faltar (empresa sem lançamentos)');

select * from finish();
rollback;
