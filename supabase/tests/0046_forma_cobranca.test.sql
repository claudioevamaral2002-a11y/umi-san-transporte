-- v2.1, Tarefa 1 (migration 20261023120000_forma_cobranca.sql; docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.1,
-- §4.2): forma de cobrança no contrato (CREDITO ou FATURADO).
--   * sem a chave, a versão nova herda a forma da última versão (maior número, mesmo agendada) da mesma empresa; sem
--     versão, a do modelo; sem modelo, CREDITO;
--   * FATURADO grava; valor inválido → CAMPOS_INVALIDOS com o detalhe forma_cobranca; publicar_tarifas mantém a forma;
--   * no FATURADO, criar_pedido não exige crédito e aprovar_orcamento não recusa por saldo: a reserva e o RESERVA
--     continuam, o disponível fica negativo e a saída gera o DEBITO;
--   * a mesma empresa de volta ao CREDITO: SEM_CREDITO e SALDO_INSUFICIENTE como antes;
--   * saldo_empresa, painel_empresa e as leituras de contrato trazem a forma; no FATURADO o alerta não se aplica (nem no
--     painel do ADM).
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local');
update app.perfis set senha_pendente = false;

-- Os 13 campos de hoje (sem forma_cobranca), com limite de saldo negativo zero.
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 0, "alerta_saldo_baixo_cent": 20000}', true);
-- Todas as categorias ativas (como em 0045).
select set_config('t.tar', '{
  "PASSAGEIROS": {"taxa_fixa_cent": 4000, "km_cent": 350, "hora_cent": 0, "hora_espera_cent": 5000, "parada_cent": 1500,
                  "retorno_bp": 2000, "reboque_cent": 0, "hospedagem_diaria_cent": 18000},
  "CARGA_LEVE":  {"taxa_fixa_cent": 0, "km_cent": 500, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 2500, "hospedagem_diaria_cent": 0},
  "MOTORISTA":   {"taxa_fixa_cent": 0, "km_cent": 0, "hora_cent": 9000, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 18000}}', true);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a5']) u;

create function pg_temp.forma(p_empresa uuid, p_versao int) returns text language sql stable as $$
  select c.forma_cobranca from app.contratos_versoes c where c.empresa_id = p_empresa and c.versao = p_versao
$$;

------------------------------------------------------------------ 1. coluna e versão de antes
select has_column('app', 'contratos_versoes', 'forma_cobranca', 'contratos_versoes tem forma_cobranca');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb,
  now() - interval '1 hour', null, 'Teste');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e1', 1), 'CREDITO', 'sem a chave e sem vigente: CREDITO');
select throws_ok(
  $$ insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent,
       km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent,
       diaria_motorista_cent, faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
       limite_saldo_negativo_cent, alerta_saldo_baixo_cent, forma_cobranca)
     values ('00000000-0000-0000-0000-0000000000e2', 99, now(), 'Teste', 0, 0, 0, 0, 0, 0, 0,
       '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0, 'BOLETO') $$,
  '23514', null, 'a tabela só aceita CREDITO ou FATURADO');

------------------------------------------------------------------ 2. publicar: grava, herda e recusa
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.p2', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "FATURADO"}', now())::text, true);
select set_config('t.p3', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb, now())::text, true);
select set_config('t.pb', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "BOLETO"}', now())::text, true);
select set_config('t.p4', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.tar')::jsonb, now())::text, true);
-- modelo FATURADO; a Empresa B (sem contrato) herda do modelo
select set_config('t.pm', api.publicar_contrato(null,
  current_setting('t.base')::jsonb || '{"forma_cobranca": "FATURADO"}', now())::text, true);
select set_config('t.pe2', api.publicar_contrato('00000000-0000-0000-0000-0000000000e2',
  current_setting('t.base')::jsonb, now())::text, true);
reset role;

select is(current_setting('t.p2')::jsonb, '{"ok": true, "versao": 2}'::jsonb, 'publica a v2 com FATURADO');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e1', 2), 'FATURADO', 'com FATURADO: grava');
select is(current_setting('t.p3')::jsonb, '{"ok": true, "versao": 3}'::jsonb, 'publica a v3 sem a chave (como a v1 envia)');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e1', 3), 'FATURADO', 'sem a chave: herda a forma da vigente');
select is(current_setting('t.pb')::jsonb, '{"ok": false, "codigo": "CAMPOS_INVALIDOS"}'::jsonb, '''BOLETO'': CAMPOS_INVALIDOS');
select is((select detalhe from app.auditoria
            where acao = 'PUBLICAR_CONTRATO' and resultado = 'NEGADO' and codigo = 'CAMPOS_INVALIDOS'
              and alvo = 'contrato:00000000-0000-0000-0000-0000000000e1'),
  '{"desconhecidos": [], "ausentes": [], "invalidos": ["forma_cobranca"]}'::jsonb, 'o detalhe aponta forma_cobranca');
select is(current_setting('t.p4')::jsonb, '{"ok": true, "versao": 4}'::jsonb, 'publicar_tarifas publica a v4');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e1', 4), 'FATURADO', 'publicar_tarifas mantém a forma');
select ok((current_setting('t.pm')::jsonb ->> 'ok')::boolean and (current_setting('t.pe2')::jsonb ->> 'ok')::boolean,
  'modelo FATURADO e primeira versão da Empresa B publicados');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e2', 1), 'FATURADO', 'sem a chave e sem vigente: herda do modelo');
select is(interno.forma_cobranca('00000000-0000-0000-0000-0000000000e1'), 'FATURADO', 'interno.forma_cobranca: a da vigente');

------------------------------------------------------------------ 3. FATURADO: pedir e aprovar sem saldo
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.s0', api.saldo_empresa()::text, true);
select set_config('t.ped', '{"origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true, "trazer": false,
  "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.r1', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('duracao_min', 30,
  'inicio', to_char((now() + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text, true);
select set_config('t.r2', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('duracao_min', 60,
  'inicio', to_char((now() + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.o1', api.enviar_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid, '{"pedagio_cent": 10000}', null)::text, true);
select set_config('t.o2', api.enviar_orcamento((current_setting('t.r2')::jsonb ->> 'id')::uuid, '{"pedagio_cent": 12000}', null)::text, true);
reset role;

select is(current_setting('t.s0')::jsonb ->> 'forma_cobranca', 'FATURADO', 'saldo_empresa traz forma_cobranca');
select ok((current_setting('t.s0')::jsonb ->> 'disponivel_cent')::bigint = 0
          and (current_setting('t.s0')::jsonb ->> 'limite_cent')::bigint = 0, 'saldo 0 e limite 0');
select is(current_setting('t.r1')::jsonb ->> 'ok', 'true', 'FATURADO sem saldo: criar_pedido ok');
select ok((current_setting('t.r2')::jsonb ->> 'ok')::boolean and (current_setting('t.o1')::jsonb ->> 'ok')::boolean
          and (current_setting('t.o2')::jsonb ->> 'ok')::boolean, 'segundo pedido criado e os dois orçados');
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
select set_config('t.s1', api.saldo_empresa()::text, true);
reset role;

select is(current_setting('t.ap1')::jsonb ->> 'ok', 'true', 'FATURADO sem saldo: aprovar_orcamento ok');
select is((select status::text from app.atividades where id = current_setting('t.a1')::uuid), 'AGENDADA', 'pedido AGENDADA');
select is((select valor_cent from app.lancamentos where atividade_id = current_setting('t.a1')::uuid and tipo = 'RESERVA'),
  current_setting('t.tot1')::bigint, 'a reserva continua: lançamento RESERVA do total');
select ok((select ativa from app.reservas where atividade_id = current_setting('t.a1')::uuid), 'reserva ativa');
select is((current_setting('t.s1')::jsonb ->> 'disponivel_cent')::bigint, -current_setting('t.tot1')::bigint,
  'o disponível fica negativo (o valor devido)');
select is((current_setting('t.s1')::jsonb ->> 'alerta_cent')::bigint, 0::bigint, 'FATURADO: alerta_cent 0');
select is((current_setting('t.s1')::jsonb ->> 'abaixo_alerta')::boolean, false,
  'FATURADO: abaixo_alerta false (o contrato tem alerta de 20000 e o disponível é negativo)');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.saida', api.registrar_saida(current_setting('t.a1')::uuid, gen_random_uuid())::text, true);
reset role;
select is(current_setting('t.saida')::jsonb ->> 'ok', 'true', 'o motorista sai');
select is((select valor_cent from app.lancamentos where atividade_id = current_setting('t.a1')::uuid and tipo = 'DEBITO'),
  -current_setting('t.tot1')::bigint, 'a saída gera o DEBITO');

------------------------------------------------------------------ 4. leituras do ADM
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.painel', api.painel_empresa('00000000-0000-0000-0000-0000000000e1')::text, true);
select is(current_setting('t.painel')::jsonb #>> '{resumo,forma_cobranca}', 'FATURADO', 'painel_empresa: o resumo traz a forma');
select is((select forma_cobranca from api.listar_contratos() where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  'FATURADO', 'listar_contratos traz a forma da vigente');
-- as duas empresas estão no FATURADO com o disponível abaixo do alerta do contrato: nenhuma conta
select is(api.painel_adm() #>> '{pendencias,empresas_abaixo_alerta}', '0',
  'painel_adm: empresa no FATURADO não conta em empresas_abaixo_alerta');

------------------------------------------------------------------ 5. a mesma empresa no CREDITO: como antes
select set_config('t.p5', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "CREDITO"}', now())::text, true);
select is(array(select forma_cobranca from api.historico_contrato('00000000-0000-0000-0000-0000000000e1')),
  array['CREDITO', 'FATURADO', 'FATURADO', 'FATURADO', 'CREDITO'], 'historico_contrato traz a forma de cada versão');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r3', api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('duracao_min', 60,
  'inicio', to_char((now() + interval '5 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text, true);
select set_config('t.ap2', api.aprovar_orcamento(current_setting('t.a2')::uuid, current_setting('t.v2')::int,
  current_setting('t.h2'), gen_random_uuid(), null)::text, true);
select set_config('t.s2', api.saldo_empresa()::text, true);
reset role;

select is(current_setting('t.p5')::jsonb ->> 'ok', 'true', 'volta ao CREDITO (limite 0)');
select is(current_setting('t.r3')::jsonb ->> 'codigo', 'SEM_CREDITO', 'CREDITO sem crédito: SEM_CREDITO, como antes');
select is(current_setting('t.ap2')::jsonb ->> 'codigo', 'SALDO_INSUFICIENTE', 'CREDITO sem saldo: SALDO_INSUFICIENTE, como antes');
select is(current_setting('t.s2')::jsonb ->> 'forma_cobranca', 'CREDITO', 'saldo_empresa no CREDITO');

------------------------------------------------------------------ 5b. herda da última versão, mesmo agendada
-- vigente CREDITO (v5); o Master agenda a troca para FATURADO (v6, daqui a 10 dias) e depois publica outra versão sem a
-- chave (v7, como a v1 envia): ela herda a troca agendada, não a vigente.
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.p6', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"forma_cobranca": "FATURADO"}', now() + interval '10 days')::text, true);
select set_config('t.p7', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb, now() + interval '20 days')::text, true);
reset role;
select ok((current_setting('t.p6')::jsonb ->> 'ok')::boolean and (current_setting('t.p7')::jsonb ->> 'ok')::boolean
          and interno.forma_cobranca('00000000-0000-0000-0000-0000000000e1') = 'CREDITO',
  'FATURADO agendado e mais uma versão sem a chave; a vigente continua CREDITO');
select is(pg_temp.forma('00000000-0000-0000-0000-0000000000e1', 7), 'FATURADO',
  'sem a chave: herda da última versão publicada (a agendada), não da vigente');

------------------------------------------------------------------ 6. privilégios
select ok(not has_function_privilege('authenticated', 'interno.forma_cobranca(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'interno.forma_cobranca(uuid)', 'EXECUTE'),
  'interno.forma_cobranca fechada');
select ok(has_function_privilege('authenticated', 'api.listar_contratos()', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.historico_contrato(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.listar_contratos()', 'EXECUTE')
          and not has_function_privilege('anon', 'api.historico_contrato(uuid)', 'EXECUTE'),
  'leituras de contrato: authenticated executa, anon não');

select * from finish();
rollback;
