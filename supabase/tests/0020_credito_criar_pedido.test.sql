-- Crédito na criação do pedido (migration 20261013120000_credito_ao_criar_pedido.sql): sem crédito nenhum
-- (disponível + limite ≤ 0) → SEM_CREDITO auditado (Adendo A2) e nada criado; abaixo do alerta → criado normalmente;
-- a ordem das checagens (permissão, contrato) continua a mesma.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B'),
  ('00000000-0000-0000-0000-0000000000e3', 'Empresa C');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local', 'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('n1c@teste.local', 'Gestora C',       'CLIENTE', '00000000-0000-0000-0000-0000000000e3', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1c@teste.local');
update app.perfis set senha_pendente = false;

-- A: limite 500,00 e alerta 200,00. B: limite zero. C: sem contrato.
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2',
  current_setting('t.base')::jsonb || '{"limite_saldo_negativo_cent": 0}', now(), null, 'Teste');

select set_config('t.ped', '{"duracao_min": 60, "origem": "Porto de Itajaí", "destino": "Base Navegantes",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO",
  "reboque": "NAO"}', true);
-- Um início diferente por pedido (sem conflito de agenda entre eles).
select set_config('t.d' || n, to_char((now() + make_interval(days => 3 + n)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true)
from generate_series(1, 8) n;
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a5', 'a6', 'a7', 'aa']) u;

set local role authenticated;

------------------------------------------------------------------ A: saldo 0, limite 500 → cria (abaixo do alerta)
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is((api.saldo_empresa() ->> 'abaixo_alerta')::boolean, true, 'A começa abaixo do alerta (0 < 200,00)');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d1'))) ->> 'ok',
  'true', 'abaixo do alerta, com limite: pedido criado');

------------------------------------------------------------------ A: disponível = −limite → SEM_CREDITO
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_ajuste('00000000-0000-0000-0000-0000000000e1', -50000, 'Consumo antigo', gen_random_uuid()) ->> 'ok',
  'true', 'ADM leva A ao fim do limite (−500,00)');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2'))) ->> 'codigo',
  'SEM_CREDITO', 'disponível + limite = 0: SEM_CREDITO');
-- A checagem vem antes da validação dos campos (nada a corrigir no formulário enquanto não houver crédito).
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'levar', false)) ->> 'codigo',
  'SEM_CREDITO', 'sem crédito: SEM_CREDITO antes de CAMPOS_INVALIDOS');
-- Permissão continua primeiro: N3 da mesma empresa recebe SEM_PERMISSAO.
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2'))) ->> 'codigo',
  'SEM_PERMISSAO', 'N3 continua SEM_PERMISSAO (não SEM_CREDITO)');

------------------------------------------------------------------ A: um centavo de crédito volta a liberar
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1, 'Pix', null, gen_random_uuid()) ->> 'ok', 'true',
  'recarga de R$ 0,01');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d4'))) ->> 'ok',
  'true', 'disponível + limite = 1: pedido criado (a aprovação é que confere o valor)');

------------------------------------------------------------------ B: limite zero
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d5'))) ->> 'codigo',
  'SEM_CREDITO', 'saldo 0 e limite 0: SEM_CREDITO');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e2', 10000, 'Pix', null, gen_random_uuid()) ->> 'ok', 'true',
  'recarga de B');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d5'))) ->> 'ok',
  'true', 'B com saldo: pedido criado');

------------------------------------------------------------------ C: sem contrato continua SEM_CONTRATO
select set_config('request.jwt.claims', current_setting('t.caa'), true);
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d6'))) ->> 'codigo',
  'SEM_CONTRATO', 'sem contrato: SEM_CONTRATO (antes do crédito)');

------------------------------------------------------------------ auditoria e efeitos
reset role;
select is((select count(*)::int from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'NEGADO' and codigo = 'SEM_CREDITO'),
  3, 'as 3 negações SEM_CREDITO ficaram auditadas (a transação não abortou)');
select is((select detalhe from app.auditoria where acao = 'CRIAR_PEDIDO' and codigo = 'SEM_CREDITO'
            and usuario_id = '00000000-0000-0000-0000-0000000000a7'),
  '{"disponivel_cent": 0, "limite_cent": 0}'::jsonb, 'auditoria guarda disponível e limite');
select is((select count(*)::int from app.atividades), 3, 'só os 3 pedidos com crédito foram criados');
select is((select count(*)::int from app.lancamentos where tipo = 'RESERVA'), 0, 'criar pedido não mexe no saldo (sem reserva)');

select * from finish();
rollback;
