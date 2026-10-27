-- v2.2, Tarefa 1 (migrations 20261027120000_capacidade_categoria.sql e 20261027120100_leituras_auditoria.sql;
-- docs/fases/v2-2-correcoes-auditoria-desenho.md §4 e §6):
--   * capacidade: PASSAGEIROS com 4; 4 pessoas ok, 5 → ACIMA_DA_CAPACIDADE (auditado, com pessoas_max); categoria sem
--     limite aceita 99; pedido sem categoria (v1) não tem limite; salvar_categoria sem a chave mantém, null tira o limite,
--     0 e 100 → CAMPOS_INVALIDOS; categorias_disponiveis e categorias_adm trazem pessoas_max;
--   * agenda.concluidas: só as que quem chama pode ver (outra empresa nunca; o N2 só as próprias);
--   * locais: listar (qualquer nível), renomear e excluir (só o N1 da empresa do local);
--   * contato_ivo, ajuda_cliente e acoes_auditoria;
--   * meus_pedidos.multa_cent e pedido.cobranca, com e sem multa; o motorista recebe nulo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local', 'Gestor B',        'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.contrato', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');
insert into app.configuracao (id, retencao_fotos_dias, contato_recarga) values (true, 30, '(47) 99999-1234')
  on conflict (id) do update set contato_recarga = excluded.contato_recarga;

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a3', 'a4', 'a5', 'a6', 'a7']) u;
create function pg_temp.inicio(p_horas int) returns text language sql stable as $$
  select to_char((now() + make_interval(hours => p_horas)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function pg_temp.cat(r jsonb, p_codigo text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'categorias') x where x ->> 'codigo' = p_codigo
$$;
create function pg_temp.ped(p_horas int, p_extra jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'inicio', pg_temp.inicio(p_horas), 'duracao_min', 60, 'origem', 'Glória', 'destino', 'Porto de Vitória',
    'levar', true, 'trazer', false, 'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO',
    'reboque', 'NAO', 'categoria', 'PASSAGEIROS') || p_extra
$$;
create function pg_temp.ids(r jsonb, p_caminho text) returns text[] language sql immutable as $$
  select coalesce(array_agg(x ->> 'id' order by x ->> 'id'), '{}') from jsonb_array_elements(r -> p_caminho) x
$$;
create function pg_temp.item(r jsonb, p_id text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'itens') x where x ->> 'id' = p_id
$$;

-- Tabelas publicadas da Empresa A (como 0048), recarga e o veículo.
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

------------------------------------------------------------------ 1. capacidade
select has_column('app', 'categorias', 'pessoas_max', 'categorias tem pessoas_max');
select is((select pessoas_max::int from app.categorias where codigo = 'PASSAGEIROS'), 4, 'PASSAGEIROS leva até 4');
select throws_ok($$ update app.categorias set pessoas_max = 100 where codigo = 'CARGA_LEVE' $$, '23514', null,
  'pessoas_max acima de 99: check');

select set_config('t.q4', (pg_temp.ped(14, '{"pessoas_qtd": 4, "origem": "Porto de Itajaí", "origem_place_id": "ChIJporto"}'))::text, true);
select set_config('t.q5', (pg_temp.ped(16, '{"pessoas_qtd": 5}'))::text, true);
select set_config('t.q99', (pg_temp.ped(18, '{"pessoas_qtd": 99, "categoria": "MOTORISTA", "horas_estimadas": 2}'))::text, true);
select set_config('t.qv1', (pg_temp.ped(22, '{"pessoas_qtd": 5}') - 'categoria')::text, true);
select set_config('t.q7', (pg_temp.ped(24, '{"pessoas_qtd": 7}'))::text, true);
select set_config('t.q6', (pg_temp.ped(26, '{"pessoas_qtd": 6}'))::text, true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r4', api.criar_pedido(current_setting('t.q4')::jsonb)::text, true);
select set_config('t.r5', api.criar_pedido(current_setting('t.q5')::jsonb)::text, true);
select set_config('t.r99', api.criar_pedido(current_setting('t.q99')::jsonb)::text, true);
select set_config('t.rv1', api.criar_pedido(current_setting('t.qv1')::jsonb)::text, true);
select set_config('t.disp', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm', api.categorias_adm('00000000-0000-0000-0000-0000000000e1')::text, true);
-- salvar_categoria: sem a chave, 0, 100, texto, 6 e null
select set_config('t.s_sem', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"até 4 pessoas","ordem":1}')::text, true);
reset role;
select set_config('t.s_sem_v', (select pessoas_max::text from app.categorias where codigo = 'PASSAGEIROS'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.s0', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"até 4 pessoas","ordem":1,"pessoas_max":0}')::text, true);
select set_config('t.s100', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"até 4 pessoas","ordem":1,"pessoas_max":100}')::text, true);
select set_config('t.stx', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"até 4 pessoas","ordem":1,"pessoas_max":"4"}')::text, true);
select set_config('t.s6', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"até 6 pessoas","ordem":1,"pessoas_max":6}')::text, true);
reset role;
select set_config('t.s6_v', coalesce((select pessoas_max::text from app.categorias where codigo = 'PASSAGEIROS'), 'null'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r7_6', api.criar_pedido(current_setting('t.q7')::jsonb)::text, true);
select set_config('t.r6', api.criar_pedido(current_setting('t.q6')::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.snull', api.salvar_categoria('{"codigo":"PASSAGEIROS","nome":"IVO Passageiros","descricao_curta":"sem limite","ordem":1,"pessoas_max":null}')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r7', api.criar_pedido(current_setting('t.q7')::jsonb)::text, true);
reset role;

select ok((current_setting('t.r4')::jsonb ->> 'ok')::boolean, '4 pessoas em Passageiros: ok');
select is(current_setting('t.r5')::jsonb, '{"ok": false, "codigo": "ACIMA_DA_CAPACIDADE", "pessoas_max": 4}'::jsonb,
  '5 pessoas em Passageiros: ACIMA_DA_CAPACIDADE com pessoas_max');
select is((select detalhe ->> 'pessoas_max' from app.auditoria
            where acao = 'CRIAR_PEDIDO' and codigo = 'ACIMA_DA_CAPACIDADE' order by id limit 1), '4', 'a recusa é auditada com pessoas_max');
select ok((current_setting('t.r99')::jsonb ->> 'ok')::boolean, 'categoria sem limite (IVO Motorista) aceita 99');
select ok((current_setting('t.rv1')::jsonb ->> 'ok')::boolean, 'pedido sem categoria (v1) com 5 pessoas: ok');
select is(pg_temp.cat(current_setting('t.disp')::jsonb, 'PASSAGEIROS') -> 'pessoas_max', '4'::jsonb,
  'categorias_disponiveis: PASSAGEIROS com pessoas_max 4');
select ok(pg_temp.cat(current_setting('t.disp')::jsonb, 'CARGA_LEVE') ? 'pessoas_max'
          and pg_temp.cat(current_setting('t.disp')::jsonb, 'CARGA_LEVE') -> 'pessoas_max' = 'null'::jsonb,
  'categorias_disponiveis: sem limite = pessoas_max null');
select is(pg_temp.cat(current_setting('t.adm')::jsonb, 'PASSAGEIROS') -> 'pessoas_max', '4'::jsonb,
  'categorias_adm traz pessoas_max');
select ok(current_setting('t.s_sem')::jsonb = '{"ok": true}'::jsonb and current_setting('t.s_sem_v') = '4',
  'salvar_categoria sem a chave: mantém o 4');
select is(array[current_setting('t.s0')::jsonb ->> 'codigo', current_setting('t.s100')::jsonb ->> 'codigo',
                current_setting('t.stx')::jsonb ->> 'codigo'],
  array['CAMPOS_INVALIDOS', 'CAMPOS_INVALIDOS', 'CAMPOS_INVALIDOS'], 'pessoas_max 0, 100 ou texto: CAMPOS_INVALIDOS');
select is((select detalhe -> 'invalidos' from app.auditoria
            where acao = 'SALVAR_CATEGORIA' and codigo = 'CAMPOS_INVALIDOS' order by id limit 1),
  '["pessoas_max"]'::jsonb, 'o detalhe aponta pessoas_max');
select ok(current_setting('t.s6_v') = '6' and (current_setting('t.r6')::jsonb ->> 'ok')::boolean
          and current_setting('t.r7_6')::jsonb ->> 'codigo' = 'ACIMA_DA_CAPACIDADE',
  'pessoas_max 6: 6 passa, 7 é recusado');
select ok((current_setting('t.snull')::jsonb ->> 'ok')::boolean
          and (select pessoas_max from app.categorias where codigo = 'PASSAGEIROS') is null
          and (current_setting('t.r7')::jsonb ->> 'ok')::boolean,
  'pessoas_max null: sem limite (7 passa)');
select ok((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure)
            ~ 'pg_advisory_xact_lock\(hashtext\(''agenda:'' \|\| v_motorista::text\)\)'
          and strpos((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure), 'ACIMA_DA_CAPACIDADE')
              < strpos((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure), 'pg_advisory_xact_lock'),
  'criar_pedido mantém a trava da agenda, e a capacidade vem antes dela');

------------------------------------------------------------------ 2. agenda.concluidas
select set_config('t.qa5', (pg_temp.ped(70) - 'categoria')::text, true);
select set_config('t.qa3', (pg_temp.ped(72))::text, true);
select set_config('t.qb', (pg_temp.ped(74) - 'categoria')::text, true);
select set_config('t.de', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.a5', api.criar_pedido(current_setting('t.qa5')::jsonb) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.a3', api.criar_pedido(current_setting('t.qa3')::jsonb) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.b', api.criar_pedido(current_setting('t.qb')::jsonb) ->> 'id', true);
reset role;
alter table app.atividades disable trigger atividades_status;
update app.atividades set status = 'CONCLUIDA' where id in (current_setting('t.a5')::uuid, current_setting('t.b')::uuid);
update app.atividades set status = 'EM_ANDAMENTO' where id = current_setting('t.a3')::uuid;
alter table app.atividades enable trigger atividades_status;

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.ag3', api.agenda(now(), now() + interval '30 days')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ag5', api.agenda(now(), now() + interval '30 days')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.ag6', api.agenda(now(), now() + interval '30 days')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.ag7', api.agenda(now(), now() + interval '30 days')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.ag4', api.agenda(now(), now() + interval '30 days')::text, true);
select set_config('t.agx', api.agenda(now() + interval '30 days', now() + interval '31 days')::text, true);
reset role;

select is(pg_temp.ids(current_setting('t.ag3')::jsonb, 'concluidas'),
  (select array_agg(x order by x) from unnest(array[current_setting('t.a5'), current_setting('t.a3')]) x),
  'N1: as da própria empresa (concluída e em andamento), nunca a da outra');
select is(pg_temp.ids(current_setting('t.ag5')::jsonb, 'concluidas'), array[current_setting('t.a5')],
  'N2: só a própria');
select is(pg_temp.ids(current_setting('t.ag6')::jsonb, 'concluidas'),
  (select array_agg(x order by x) from unnest(array[current_setting('t.a5'), current_setting('t.a3')]) x),
  'N3: as da empresa (vê como o N1)');
select is(pg_temp.ids(current_setting('t.ag7')::jsonb, 'concluidas'), array[current_setting('t.b')],
  'outra empresa: só a dela');
select is(cardinality(pg_temp.ids(current_setting('t.ag4')::jsonb, 'concluidas')), 3, 'motorista: as dele (as três)');
select is(current_setting('t.agx')::jsonb -> 'concluidas', '[]'::jsonb, 'fora do período: vazia');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.ag5')::jsonb -> 'concluidas' -> 0) k),
  array['categoria_nome', 'destino', 'duracao_min', 'id', 'inicio', 'numero', 'origem', 'status'],
  'item de concluidas: só os campos combinados');
select ok((current_setting('t.ag3')::jsonb #>> '{concluidas,0,status}') in ('CONCLUIDA', 'EM_ANDAMENTO')
          and current_setting('t.ag3')::jsonb ? 'blocos', 'concluidas traz o status; os blocos continuam');

------------------------------------------------------------------ 3. locais
with i as (insert into app.locais_empresa (empresa_id, nome, lat, lng, place_id, chave, usos) values
  ('00000000-0000-0000-0000-0000000000e1', 'Base', -26.9, -48.6, null, 'base@-26.90000,-48.60000', 3) returning id)
select set_config('t.l2', id::text, true) from i;
with i as (insert into app.locais_empresa (empresa_id, nome, lat, lng, place_id, chave, usos) values
  ('00000000-0000-0000-0000-0000000000e1', 'Depósito', -26.9, -48.6, null, 'depósito@-26.90000,-48.60000', 2) returning id)
select set_config('t.l3', id::text, true) from i;
with i as (insert into app.locais_empresa (empresa_id, nome, lat, lng, place_id, chave, usos) values
  ('00000000-0000-0000-0000-0000000000e2', 'Sede B', null, null, 'ChIJsedeb', 'ChIJsedeb', 1) returning id)
select set_config('t.lb', id::text, true) from i;
select set_config('t.l1', (select id::text from app.locais_empresa where chave = 'ChIJporto'), true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.lst', api.locais_empresa_todos()::text, true);
select set_config('t.ren_n2', api.renomear_local(current_setting('t.l2')::bigint, 'Base Nova')::text, true);
select set_config('t.exc_n2', api.excluir_local(current_setting('t.l2')::bigint)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.ren_n3', api.renomear_local(current_setting('t.l2')::bigint, 'Base Nova')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.lst_mot', api.locais_empresa_todos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.ren_b', api.renomear_local(current_setting('t.lb')::bigint, 'Minha')::text, true);
select set_config('t.exc_b', api.excluir_local(current_setting('t.lb')::bigint)::text, true);
select set_config('t.ren_curto', api.renomear_local(current_setting('t.l2')::bigint, ' X ')::text, true);
select set_config('t.ren_dup', api.renomear_local(current_setting('t.l3')::bigint, ' BASE ')::text, true);
select set_config('t.ren_ok', api.renomear_local(current_setting('t.l2')::bigint, '  Base Navegantes  ')::text, true);
select set_config('t.ren_g', api.renomear_local(current_setting('t.l1')::bigint, 'Porto')::text, true);
select set_config('t.exc_ok', api.excluir_local(current_setting('t.l1')::bigint)::text, true);
reset role;

select is(array(select x ->> 'nome' from jsonb_array_elements(current_setting('t.lst')::jsonb -> 'locais') x),
  array['Base', 'Depósito', 'Porto de Itajaí'], 'N2 lista os locais da empresa, mais usados primeiro (sem os da outra)');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.lst')::jsonb -> 'locais' -> 0) k),
  array['id', 'lat', 'lng', 'nome', 'place_id', 'ultimo_uso', 'usos'], 'campos de cada local');
select is(array[current_setting('t.ren_n2')::jsonb ->> 'codigo', current_setting('t.exc_n2')::jsonb ->> 'codigo',
                current_setting('t.ren_n3')::jsonb ->> 'codigo', current_setting('t.lst_mot')::jsonb ->> 'codigo'],
  array['SEM_PERMISSAO', 'SEM_PERMISSAO', 'SEM_PERMISSAO', 'SEM_PERMISSAO'],
  'N2 e N3 não renomeiam nem excluem; o motorista não lista');
select is(array[current_setting('t.ren_b')::jsonb ->> 'codigo', current_setting('t.exc_b')::jsonb ->> 'codigo'],
  array['NAO_ENCONTRADO', 'NAO_ENCONTRADO'], 'N1 com id de outra empresa: NAO_ENCONTRADO');
select is((select nome from app.locais_empresa where id = current_setting('t.lb')::bigint), 'Sede B',
  'o local da outra empresa não muda');
select is(current_setting('t.ren_curto')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'nome com 1 caractere: CAMPOS_INVALIDOS');
select is(current_setting('t.ren_dup')::jsonb ->> 'codigo', 'JA_EXISTE', 'mesma chave de outro local: JA_EXISTE');
select is((select row(nome, chave)::text from app.locais_empresa where id = current_setting('t.l2')::bigint),
  row('Base Navegantes', 'base navegantes@-26.90000,-48.60000')::text, 'N1 renomeia (aparado; a chave do ponto muda)');
select ok(current_setting('t.ren_g')::jsonb = '{"ok": true}'::jsonb
          and current_setting('t.exc_ok')::jsonb = '{"ok": true}'::jsonb
          and not exists (select 1 from app.locais_empresa where id = current_setting('t.l1')::bigint),
  'N1 renomeia o do Google e exclui');
select is((select origem from app.atividades where id = (current_setting('t.r4')::jsonb ->> 'id')::uuid),
  'Porto de Itajaí', 'excluir o local não mexe no pedido');
select is((select count(*)::int from app.auditoria where acao in ('RENOMEAR_LOCAL', 'EXCLUIR_LOCAL') and resultado = 'OK'),
  3, 'renomear e excluir são auditados');

------------------------------------------------------------------ 4. contato, ajuda e ações da auditoria
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.ct_mot', api.contato_ivo()::text, true);
select set_config('t.aj_mot', api.ajuda_cliente()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ct_n2', api.contato_ivo()::text, true);
select set_config('t.aj_n2', api.ajuda_cliente()::text, true);
select set_config('t.ac_n1', api.acoes_auditoria()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.ac_adm', api.acoes_auditoria()::text, true);
reset role;

select is(current_setting('t.ct_mot')::jsonb, '{"ok": true, "contato": "(47) 99999-1234"}'::jsonb, 'contato_ivo como motorista');
select is(current_setting('t.ct_n2')::jsonb ->> 'contato', '(47) 99999-1234', 'contato_ivo como cliente');
select is(current_setting('t.aj_mot')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'ajuda_cliente como motorista: SEM_PERMISSAO');
select is(current_setting('t.aj_n2')::jsonb,
  jsonb_build_object('ok', true, 'faixas_cancelamento', current_setting('t.contrato')::jsonb -> 'faixas_cancelamento',
                     'prazo_orcar_horas', 12, 'validade_orcamento_horas', 24, 'forma_cobranca', 'CREDITO'),
  'ajuda_cliente: as regras do contrato vigente');
select is(current_setting('t.ac_n1')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'acoes_auditoria como cliente: SEM_PERMISSAO');
select ok(exists (select 1 from jsonb_array_elements(current_setting('t.ac_adm')::jsonb -> 'acoes') x
                   where x ->> 'acao' = 'CRIAR_PEDIDO' and (x ->> 'total')::int >= 1)
          and (current_setting('t.ac_adm')::jsonb -> 'acoes' -> 0) ?& array['acao', 'total'],
  'acoes_auditoria como Master: traz CRIAR_PEDIDO com o total');
select has_index('app', 'auditoria', 'auditoria_acao', 'índice em auditoria.acao');

------------------------------------------------------------------ 5. cobrança: com e sem multa
select set_config('t.qm', (pg_temp.ped(30) - 'categoria')::text, true);
select set_config('t.qs', (pg_temp.ped(60) - 'categoria')::text, true);
do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  perform set_config('t.m', api.criar_pedido(current_setting('t.qm')::jsonb) ->> 'id', true);
  perform set_config('t.s', api.criar_pedido(current_setting('t.qs')::jsonb) ->> 'id', true);
  perform set_config('request.jwt.claims', current_setting('t.ca4'), true);
  perform api.enviar_orcamento(current_setting('t.m')::uuid, '{"pedagio_cent": 10000}', null);
  perform api.enviar_orcamento(current_setting('t.s')::uuid, '{"pedagio_cent": 10000}', null);
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select o.atividade_id, o.versao, o.hash from app.orcamentos o
            where o.atividade_id in (current_setting('t.m')::uuid, current_setting('t.s')::uuid) and o.status = 'PENDENTE'
            order by o.atividade_id loop
    perform api.aprovar_orcamento(x.atividade_id, x.versao, x.hash, gen_random_uuid(), null);
  end loop;
  perform set_config('t.total', (select o.total_cent::text from app.orcamentos o
                                  where o.atividade_id = current_setting('t.m')::uuid and o.status = 'APROVADO'), true);
  perform set_config('t.cm', api.cancelar_agendado(current_setting('t.m')::uuid, null, gen_random_uuid(),
                                                   current_setting('t.total')::bigint)::text, true);
  perform set_config('t.cs', api.cancelar_agendado(current_setting('t.s')::uuid, null, gen_random_uuid(), 0)::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.mp', api.meus_pedidos('{}')::text, true);
select set_config('t.pm', api.pedido(current_setting('t.m')::uuid)::text, true);
select set_config('t.ps', api.pedido(current_setting('t.s')::uuid)::text, true);
select set_config('t.p4', api.pedido((current_setting('t.r4')::jsonb ->> 'id')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.mp_mot', api.meus_pedidos('{}')::text, true);
select set_config('t.pm_mot', api.pedido(current_setting('t.m')::uuid)::text, true);
reset role;

select ok((current_setting('t.cm')::jsonb ->> 'ok')::boolean and (current_setting('t.cs')::jsonb ->> 'ok')::boolean
          and (current_setting('t.cm')::jsonb ->> 'multa_cent')::bigint = current_setting('t.total')::bigint
          and (current_setting('t.total'))::bigint > 0,
  'dois agendados cancelados: um com multa (100%), outro sem');
select is(pg_temp.item(current_setting('t.mp')::jsonb, current_setting('t.m')) -> 'multa_cent',
  to_jsonb(current_setting('t.total')::bigint), 'meus_pedidos: multa_cent do cancelado com multa');
select ok(pg_temp.item(current_setting('t.mp')::jsonb, current_setting('t.s')) ? 'multa_cent'
          and pg_temp.item(current_setting('t.mp')::jsonb, current_setting('t.s')) -> 'multa_cent' = 'null'::jsonb,
  'meus_pedidos: sem multa = null');
select is(current_setting('t.pm')::jsonb -> 'cobranca',
  jsonb_build_object('debito_cent', null, 'multa_cent', current_setting('t.total')::bigint,
                     'liberado_cent', current_setting('t.total')::bigint),
  'pedido.cobranca com multa: multa e reserva devolvida');
select is(current_setting('t.ps')::jsonb -> 'cobranca',
  jsonb_build_object('debito_cent', null, 'multa_cent', null, 'liberado_cent', current_setting('t.total')::bigint),
  'pedido.cobranca sem multa: só a reserva devolvida');
select is(current_setting('t.p4')::jsonb -> 'cobranca',
  '{"debito_cent": null, "multa_cent": null, "liberado_cent": null}'::jsonb, 'pedido sem lançamentos: tudo nulo');
select ok(current_setting('t.pm_mot')::jsonb -> 'cobranca' = 'null'::jsonb
          and pg_temp.item(current_setting('t.mp_mot')::jsonb, current_setting('t.m')) -> 'multa_cent' = 'null'::jsonb,
  'motorista: cobranca e multa_cent nulos');

------------------------------------------------------------------ 6. privilégios
select ok(has_function_privilege('authenticated', 'api.locais_empresa_todos()', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.renomear_local(bigint, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.excluir_local(bigint)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.contato_ivo()', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.ajuda_cliente()', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.acoes_auditoria()', 'EXECUTE')
          and not has_function_privilege('anon', 'api.locais_empresa_todos()', 'EXECUTE')
          and not has_function_privilege('anon', 'api.renomear_local(bigint, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.excluir_local(bigint)', 'EXECUTE')
          and not has_function_privilege('anon', 'api.contato_ivo()', 'EXECUTE')
          and not has_function_privilege('anon', 'api.ajuda_cliente()', 'EXECUTE')
          and not has_function_privilege('anon', 'api.acoes_auditoria()', 'EXECUTE'),
  'as RPCs novas: authenticated executa, anon não');

select * from finish();
rollback;
