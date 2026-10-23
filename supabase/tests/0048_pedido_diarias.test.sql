-- v2.1, Tarefa 3 (migration 20261023120300_pedido_diarias_categorias.sql; docs/fases/v2-1-ajustes-faturamento-nf-desenho.md
-- §4.5, §2): diárias, outros custos e volta à origem no pedido; excluir categoria sem uso.
--   * prévia (categorias_disponiveis) com `diarias` e `volta_a_origem`: HOSPEDAGEM n × diária na categoria que cobra
--     diária (a que não cobra fica sem a linha, sem recusa), sem RETORNO na volta à origem; `cobra_diaria`;
--   * criar_pedido grava diarias_estimadas, outros_custos (aparado) e volta_a_origem; 31 diárias, 121 caracteres ou
--     volta não booleana → CAMPOS_INVALIDOS;
--   * PARIDADE: pedido com 2 diárias e volta à origem → prévia = calcular_orcamento {km, hospedagem_diarias: 2}; sem
--     hospedagem_diarias na entrada valem as diárias do pedido; o `diarias` antigo continua ignorado;
--   * pedido antigo de ida e volta e pedido da v1 (sem categoria, sem as chaves) com o preço de antes;
--   * api.pedido (cliente e motorista) traz as três; a forma de cobrança só o cliente (o motorista não a recebe);
--   * categoria sem tarifa (preço de hoje, pelo contrato) com volta à origem: sem RETORNO na prévia e no orçamento;
--   * excluir_categoria / pode_excluir; extrato com 9 tipos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local');
update app.perfis set senha_pendente = false;

-- Contrato: km 250, retorno 50%, diária 18000.
select set_config('t.contrato', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a3', 'a4', 'a5']) u;
create function pg_temp.inicio(p_horas int) returns text language sql stable as $$
  select to_char((now() + make_interval(hours => p_horas)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function pg_temp.linhas(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((l ->> 'codigo') || '=' || (l ->> 'valor_cent'), ',' order by i), '')
    from jsonb_array_elements(r -> 'linhas') with ordinality x(l, i)
$$;
create function pg_temp.cat(r jsonb, p_codigo text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'categorias') x where x ->> 'codigo' = p_codigo
$$;
-- Pedido de Passageiros, trecho único (o resto em p_extra).
create function pg_temp.ped(p_horas int, p_extra jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'inicio', pg_temp.inicio(p_horas), 'duracao_min', 60, 'origem', 'Glória', 'destino', 'Glória',
    'levar', true, 'trazer', false, 'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO',
    'reboque', 'NAO', 'categoria', 'PASSAGEIROS') || p_extra
$$;

-- Tabela publicada: PASSAGEIROS (taxa 4000, km 350, retorno 20%, diária 18000); CARGA_LEVE sem diária; e o veículo.
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.pub', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', '{
  "PASSAGEIROS": {"taxa_fixa_cent": 4000, "km_cent": 350, "hora_cent": 0, "hora_espera_cent": 5000, "parada_cent": 1500,
                  "retorno_bp": 2000, "reboque_cent": 0, "hospedagem_diaria_cent": 18000},
  "CARGA_LEVE":  {"taxa_fixa_cent": 0, "km_cent": 500, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 2500, "hospedagem_diaria_cent": 0},
  "MOTORISTA":   {"taxa_fixa_cent": 0, "km_cent": 0, "hora_cent": 9000, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 18000}}'::jsonb, now())::text, true);
select set_config('t.rec', api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000000, 'Pix inicial', null,
  gen_random_uuid())::text, true);
reset role;
insert into app.veiculos (id, motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4', 'Spin', 'Prata', 'ABC1D23', 6, 400,
   array['PASSAGEIROS', 'CARGA_LEVE']);
select ok(current_setting('t.pub')::jsonb ->> 'ok' = 'true' and current_setting('t.rec')::jsonb ->> 'ok' = 'true',
  'tabela publicada e recarga');

------------------------------------------------------------------ 1. prévia do cliente
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.pv', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":2,"volta_a_origem":true}'::jsonb)::text, true);
select set_config('t.pd', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":2}'::jsonb)::text, true);
select set_config('t.p0', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.pf', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":0,"volta_a_origem":false}'::jsonb)::text, true);
select set_config('t.x1', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":31}'::jsonb)::text, true);
select set_config('t.x2', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":"2"}'::jsonb)::text, true);
select set_config('t.x3', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"diarias":1.5}'::jsonb)::text, true);
select set_config('t.x4', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"volta_a_origem":"sim"}'::jsonb)::text, true);
reset role;

select is(pg_temp.linhas(pg_temp.cat(current_setting('t.pv')::jsonb, 'PASSAGEIROS')), 'TAXA_FIXA=4000,KM=10500,HOSPEDAGEM=36000',
  'prévia com 2 diárias e volta à origem: HOSPEDAGEM 2 × 18000 e sem RETORNO');
select is(pg_temp.linhas(pg_temp.cat(current_setting('t.pd')::jsonb, 'PASSAGEIROS')),
  'TAXA_FIXA=4000,KM=10500,RETORNO=2100,HOSPEDAGEM=36000', 'sem a volta à origem: com RETORNO');
select ok(pg_temp.cat(current_setting('t.pd')::jsonb, 'CARGA_LEVE') ->> 'disponivel' = 'true'
          and pg_temp.linhas(pg_temp.cat(current_setting('t.pd')::jsonb, 'CARGA_LEVE')) !~ 'HOSPEDAGEM'
          and pg_temp.cat(current_setting('t.pd')::jsonb, 'CARGA_LEVE') -> 'total_cent'
              = pg_temp.cat(current_setting('t.p0')::jsonb, 'CARGA_LEVE') -> 'total_cent',
  'categoria que não cobra diária: sem a linha HOSPEDAGEM e sem recusa');
select is(array[pg_temp.cat(current_setting('t.p0')::jsonb, 'PASSAGEIROS') ->> 'cobra_diaria',
                pg_temp.cat(current_setting('t.p0')::jsonb, 'CARGA_LEVE') ->> 'cobra_diaria',
                pg_temp.cat(current_setting('t.p0')::jsonb, 'MOTORISTA') ->> 'cobra_diaria'],
  array['true', 'false', 'true'], 'cobra_diaria: a tarifa tem diária de hospedagem');
select is(current_setting('t.pf')::jsonb, current_setting('t.p0')::jsonb, 'diarias 0 e volta false = sem as chaves');
select ok(current_setting('t.x1')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x2')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x3')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x4')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS',
  'diarias 31, texto ou fração e volta não booleana: CAMPOS_INVALIDOS');

------------------------------------------------------------------ 2. criar_pedido
-- as entradas montadas antes (pg_temp não é executável pelo papel authenticated)
select set_config('t.q0', (pg_temp.ped(14, '{"diarias_estimadas": 2, "volta_a_origem": true,
  "outros_custos": "  pedágio da BR-101, balsa  "}'))::text, true);
select set_config('t.q1', (pg_temp.ped(20, '{"volta_a_origem": false}'))::text, true);
select set_config('t.q2', (pg_temp.ped(26, '{"diarias_estimadas": 31}'))::text, true);
select set_config('t.q3', (pg_temp.ped(26, jsonb_build_object('outros_custos', repeat('x', 121))))::text, true);
select set_config('t.q4', (pg_temp.ped(26, '{"volta_a_origem": "sim"}'))::text, true);
select set_config('t.q5', (pg_temp.ped(26, '{"diarias_estimadas": -1}'))::text, true);
select set_config('t.q6', (pg_temp.ped(26, jsonb_build_object('outros_custos', repeat('y', 120),
  'diarias_estimadas', 30)))::text, true);
select set_config('t.q7', (pg_temp.ped(32, '{"trazer": true, "destino": "Porto de Vitória"}'))::text, true);
select set_config('t.q8', (pg_temp.ped(38) - 'categoria')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r1', api.criar_pedido(current_setting('t.q0')::jsonb)::text, true);
select set_config('t.r2', api.criar_pedido(current_setting('t.q1')::jsonb)::text, true);
select set_config('t.e1', api.criar_pedido(current_setting('t.q2')::jsonb)::text, true);
select set_config('t.e2', api.criar_pedido(current_setting('t.q3')::jsonb)::text, true);
select set_config('t.e3', api.criar_pedido(current_setting('t.q4')::jsonb)::text, true);
select set_config('t.e4', api.criar_pedido(current_setting('t.q5')::jsonb)::text, true);
select set_config('t.r3', api.criar_pedido(current_setting('t.q6')::jsonb)::text, true);
-- pedido antigo de ida e volta (sem as chaves novas)
select set_config('t.r4', api.criar_pedido(current_setting('t.q7')::jsonb)::text, true);
-- pedido da v1: sem categoria e sem as chaves novas
select set_config('t.r5', api.criar_pedido(current_setting('t.q8')::jsonb)::text, true);
reset role;

select ok((current_setting('t.r1')::jsonb ->> 'ok')::boolean and (current_setting('t.r2')::jsonb ->> 'ok')::boolean
          and (current_setting('t.r3')::jsonb ->> 'ok')::boolean and (current_setting('t.r4')::jsonb ->> 'ok')::boolean
          and (current_setting('t.r5')::jsonb ->> 'ok')::boolean, 'pedidos criados');
select is((select row(diarias_estimadas, outros_custos, volta_a_origem)::text from app.atividades
            where id = (current_setting('t.r1')::jsonb ->> 'id')::uuid),
  row(2, 'pedágio da BR-101, balsa', true)::text, 'grava diárias, outros custos (aparado) e volta à origem');
select is((select row(diarias_estimadas, char_length(outros_custos))::text from app.atividades
            where id = (current_setting('t.r3')::jsonb ->> 'id')::uuid), row(30, 120)::text, '30 diárias e 120 caracteres: aceitos');
select is(array[current_setting('t.e1')::jsonb ->> 'codigo', current_setting('t.e2')::jsonb ->> 'codigo',
                current_setting('t.e3')::jsonb ->> 'codigo', current_setting('t.e4')::jsonb ->> 'codigo'],
  array['CAMPOS_INVALIDOS', 'CAMPOS_INVALIDOS', 'CAMPOS_INVALIDOS', 'CAMPOS_INVALIDOS'],
  '31 diárias, 121 caracteres, volta não booleana e diárias negativas: CAMPOS_INVALIDOS');
select is((select detalhe -> 'invalidos' from app.auditoria
            where acao = 'CRIAR_PEDIDO' and resultado = 'NEGADO' order by id limit 1), '["diarias_estimadas"]'::jsonb,
  'o detalhe aponta diarias_estimadas');
select is((select row(diarias_estimadas, outros_custos, volta_a_origem)::text from app.atividades
            where id in ((current_setting('t.r4')::jsonb ->> 'id')::uuid, (current_setting('t.r5')::jsonb ->> 'id')::uuid)
            group by 1), row(null::smallint, null::text, false)::text,
  'pedido sem as chaves (ida e volta antigo e v1): sem diárias, sem outros custos, volta false');

------------------------------------------------------------------ 3. PARIDADE prévia = orçamento do motorista
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.c_h2', api.calcular_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid,
  '{"km": 30, "hospedagem_diarias": 2}')::text, true);
select set_config('t.c_sem', api.calcular_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid, '{"km": 30}')::text, true);
select set_config('t.c_h0', api.calcular_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid,
  '{"km": 30, "hospedagem_diarias": 0}')::text, true);
select set_config('t.c_ant', api.calcular_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid,
  '{"km": 30, "diarias": 5}')::text, true);
select set_config('t.c_vol', api.calcular_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid,
  '{"km": 30, "hospedagem_diarias": 2, "volta_a_origem": false}')::text, true);
select set_config('t.c2', api.calcular_orcamento((current_setting('t.r2')::jsonb ->> 'id')::uuid, '{"km": 30}')::text, true);
select set_config('t.c4', api.calcular_orcamento((current_setting('t.r4')::jsonb ->> 'id')::uuid, '{"km": 60}')::text, true);
select set_config('t.c5', api.calcular_orcamento((current_setting('t.r5')::jsonb ->> 'id')::uuid, '{"km": 30}')::text, true);
select set_config('t.env', api.enviar_orcamento((current_setting('t.r1')::jsonb ->> 'id')::uuid, '{"km": 30}', null)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.iv', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":true}'::jsonb)::text, true);
reset role;

select is(current_setting('t.c_h2')::jsonb -> 'total_cent', pg_temp.cat(current_setting('t.pv')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'PARIDADE: 2 diárias e volta à origem: prévia = calcular_orcamento {km, hospedagem_diarias: 2}');
select is(pg_temp.linhas(current_setting('t.c_h2')::jsonb), pg_temp.linhas(pg_temp.cat(current_setting('t.pv')::jsonb, 'PASSAGEIROS')),
  'PARIDADE: as mesmas linhas');
select is(pg_temp.linhas(current_setting('t.c_sem')::jsonb), 'TAXA_FIXA=4000,KM=10500,HOSPEDAGEM=36000',
  'sem hospedagem_diarias na entrada: as diárias do pedido');
select is(pg_temp.linhas(current_setting('t.c_h0')::jsonb), 'TAXA_FIXA=4000,KM=10500',
  'o motorista zera as diárias: sem HOSPEDAGEM');
select is(current_setting('t.c_ant')::jsonb -> 'total_cent', '50500'::jsonb,
  '`diarias` da entrada antiga: aceito e ignorado (valem as do pedido)');
select is(current_setting('t.c_vol')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS',
  'volta_a_origem não vem do motorista: a do pedido vale sempre');
select is(pg_temp.linhas(current_setting('t.c2')::jsonb), 'TAXA_FIXA=4000,KM=10500,RETORNO=2100',
  'pedido sem volta à origem e sem diárias: com RETORNO, sem HOSPEDAGEM');
select ok((current_setting('t.env')::jsonb ->> 'ok')::boolean and current_setting('t.env')::jsonb -> 'total_cent' = '50500'::jsonb,
  'enviar_orcamento sem hospedagem_diarias: as diárias do pedido (50500)');
select is(current_setting('t.c4')::jsonb -> 'total_cent', pg_temp.cat(current_setting('t.iv')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'pedido antigo de ida e volta: o preço de antes (60 km, sem retorno) = prévia de ida e volta');
select is(current_setting('t.c5')::jsonb - 'valido_ate',
  interno.calcular_linhas((select c from interno.contrato_vigente('00000000-0000-0000-0000-0000000000e1') c), true, false,
                          'VEICULO_PROPRIO', '{"km": 30}'),
  'pedido da v1 (sem categoria): o cálculo de hoje, com o retorno do contrato');

------------------------------------------------------------------ 4. detalhe do pedido
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d1', api.pedido((current_setting('t.r1')::jsonb ->> 'id')::uuid)::text, true);
select set_config('t.d5', api.pedido((current_setting('t.r5')::jsonb ->> 'id')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.dm', api.pedido((current_setting('t.r1')::jsonb ->> 'id')::uuid)::text, true);
reset role;

select is(jsonb_build_object('d', current_setting('t.d1')::jsonb #> '{pedido,diarias_estimadas}',
                             'o', current_setting('t.d1')::jsonb #> '{pedido,outros_custos}',
                             'v', current_setting('t.d1')::jsonb #> '{pedido,volta_a_origem}',
                             'f', current_setting('t.d1')::jsonb #> '{pedido,forma_cobranca}'),
  '{"d": 2, "o": "pedágio da BR-101, balsa", "v": true, "f": "CREDITO"}'::jsonb,
  'cliente: diárias, outros custos, volta à origem e forma de cobrança');
select is((current_setting('t.dm')::jsonb -> 'pedido') - array(select k from jsonb_object_keys(current_setting('t.dm')::jsonb -> 'pedido') k
                                                                 where k not in ('diarias_estimadas', 'outros_custos', 'volta_a_origem')),
  '{"diarias_estimadas": 2, "outros_custos": "pedágio da BR-101, balsa", "volta_a_origem": true}'::jsonb,
  'motorista: as três no detalhe (a calculadora começa com as diárias)');
select is(coalesce(current_setting('t.dm')::jsonb #> '{pedido,forma_cobranca}', 'null'::jsonb), 'null'::jsonb,
  'motorista: sem a forma de cobrança da empresa');
select is(jsonb_build_object('d', current_setting('t.d5')::jsonb #> '{pedido,diarias_estimadas}',
                             'o', current_setting('t.d5')::jsonb #> '{pedido,outros_custos}',
                             'v', current_setting('t.d5')::jsonb #> '{pedido,volta_a_origem}'),
  '{"d": null, "o": null, "v": false}'::jsonb, 'pedido da v1: nulos e volta false');

------------------------------------------------------------------ 5. excluir categoria
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.k1', api.salvar_categoria('{"nome":"IVO Van Nova","descricao_curta":"até 7 pessoas","ordem":7}')::text, true);
select set_config('t.k2', api.salvar_categoria('{"nome":"IVO Furgão","descricao_curta":"carga","ordem":8}')::text, true);
reset role;
update app.veiculos set categorias = categorias || (current_setting('t.k2')::jsonb ->> 'codigo')
 where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm', api.categorias_adm('00000000-0000-0000-0000-0000000000e1')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.x_n1', api.excluir_categoria(current_setting('t.k1')::jsonb ->> 'codigo')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.x_pas', api.excluir_categoria('PASSAGEIROS')::text, true);
select set_config('t.x_vei', api.excluir_categoria(current_setting('t.k2')::jsonb ->> 'codigo')::text, true);
select set_config('t.x_nao', api.excluir_categoria('NAO_EXISTE')::text, true);
select set_config('t.x_ok', api.excluir_categoria(current_setting('t.k1')::jsonb ->> 'codigo')::text, true);
select set_config('t.x_de_novo', api.excluir_categoria(current_setting('t.k1')::jsonb ->> 'codigo')::text, true);
reset role;

select is(array(select (x ->> 'codigo') || ':' || (x ->> 'pode_excluir')
                  from jsonb_array_elements(current_setting('t.adm')::jsonb -> 'categorias') x
                 where x ->> 'codigo' in ('PASSAGEIROS', current_setting('t.k1')::jsonb ->> 'codigo',
                                          current_setting('t.k2')::jsonb ->> 'codigo')
                 order by x ->> 'codigo'),
  array(select y from unnest(array['PASSAGEIROS:false',
                                   (current_setting('t.k1')::jsonb ->> 'codigo') || ':true',
                                   (current_setting('t.k2')::jsonb ->> 'codigo') || ':false']) y order by y),
  'pode_excluir: só a nova sem uso (a com pedido, com tarifa ou num veículo não)');
select is(current_setting('t.x_n1')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'N1 não exclui categoria');
select is(current_setting('t.x_pas')::jsonb ->> 'codigo', 'CATEGORIA_EM_USO', 'PASSAGEIROS: CATEGORIA_EM_USO');
select is(current_setting('t.x_vei')::jsonb ->> 'codigo', 'CATEGORIA_EM_USO', 'categoria num veículo: CATEGORIA_EM_USO');
select is(current_setting('t.x_nao')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'código inexistente: NAO_ENCONTRADO');
select ok(current_setting('t.x_ok')::jsonb = '{"ok": true}'::jsonb
          and not exists (select 1 from app.categorias where codigo = current_setting('t.k1')::jsonb ->> 'codigo')
          and exists (select 1 from app.auditoria where acao = 'EXCLUIR_CATEGORIA' and resultado = 'OK'),
  'a categoria nova sem uso é excluída (e auditada)');
select is(current_setting('t.x_de_novo')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'excluir de novo: NAO_ENCONTRADO');

------------------------------------------------------------------ 6. extrato e privilégios
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.ex9', api.extrato('00000000-0000-0000-0000-0000000000e1', jsonb_build_object('tipos',
  to_jsonb(enum_range(null::app.tipo_lancamento)::text[])))::text, true);
reset role;
select ok(cardinality(enum_range(null::app.tipo_lancamento)) = 9 and (current_setting('t.ex9')::jsonb ->> 'ok')::boolean,
  'extrato aceita os 9 tipos no filtro');
select ok(has_function_privilege('authenticated', 'api.excluir_categoria(text)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.excluir_categoria(text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'interno.categoria_em_uso(text)', 'EXECUTE')
          and not has_function_privilege('authenticated',
                'interno.linhas_para_categoria(app.contratos_versoes, boolean, boolean, text, jsonb, boolean)', 'EXECUTE')
          and not has_function_privilege('authenticated',
                'interno.linhas_da_tarifa(app.tarifas_categoria, boolean, boolean, boolean, jsonb, boolean)', 'EXECUTE'),
  'excluir_categoria: authenticated executa, anon não; as internas fechadas');

------------------------------------------------------------------ 7. categoria sem tarifa (preço de hoje) e volta à origem
-- Versão nova do contrato, sem tarifas por categoria (mesmo instante, versão maior: passa a ser a vigente). PASSAGEIROS
-- cai no preço de hoje: km 250 e retorno de 50% do contrato.
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb, now(), null, 'Teste');
select set_config('t.q9', (pg_temp.ped(44, '{"volta_a_origem": true}'))::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.sv', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"volta_a_origem":true}'::jsonb)::text, true);
select set_config('t.sr', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.r9', api.criar_pedido(current_setting('t.q9')::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.c9', api.calcular_orcamento((current_setting('t.r9')::jsonb ->> 'id')::uuid, '{"km": 30}')::text, true);
reset role;

select ok(not exists (select 1 from app.tarifas_categoria t join app.contratos_versoes c on c.id = t.contrato_id
                       where c.id = (select x.id from interno.contrato_vigente('00000000-0000-0000-0000-0000000000e1') x))
          and pg_temp.linhas(pg_temp.cat(current_setting('t.sr')::jsonb, 'PASSAGEIROS')) ~ 'RETORNO'
          and pg_temp.linhas(pg_temp.cat(current_setting('t.sv')::jsonb, 'PASSAGEIROS')) !~ 'RETORNO'
          and pg_temp.cat(current_setting('t.sv')::jsonb, 'PASSAGEIROS') ->> 'disponivel' = 'true',
  'sem tarifa: a prévia com volta à origem fica sem RETORNO (sem a volta, com)');
select ok((current_setting('t.c9')::jsonb ->> 'ok')::boolean
          and pg_temp.linhas(current_setting('t.c9')::jsonb) !~ 'RETORNO'
          and current_setting('t.c9')::jsonb -> 'total_cent'
              = pg_temp.cat(current_setting('t.sv')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'sem tarifa: calcular_orcamento do pedido com volta à origem sem RETORNO, igual à prévia');

select * from finish();
rollback;
