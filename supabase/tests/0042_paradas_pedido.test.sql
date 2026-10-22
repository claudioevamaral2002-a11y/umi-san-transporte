-- Fase 4.1, Tarefa 2 (migration 20261022120100_paradas_pedido.sql): paradas, horas estimadas e centro de custo ao pedir;
-- IVO Motorista (veículo do cliente) sem veículo cadastrado; orçamento pela tarifa da categoria (prévia do cliente =
-- cálculo do motorista = orçamento enviado); confirmar_corrida troca o centro de custo; api.pedido e painel_empresa
-- devolvem as paradas. Compatibilidade: o pedido do app atual (sem categoria e sem as chaves novas) não muda.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local');
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

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a4', 'a5', 'a8']) u;

-- Horários distintos (a agenda do motorista não colide).
select set_config('t.i_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('m0', interval '3 hours'), ('m1', interval '3 hours'), ('m2', interval '8 hours'), ('m4', interval '8 hours'),
             ('p2', interval '14 hours'), ('px', interval '16 hours'), ('ap', interval '20 hours'),
             ('vn', interval '24 hours')) x(n, d);

-- Corpos: IVO Motorista (o app da fase 4 manda VEICULO_PROPRIO em toda categoria), Passageiros e o app atual.
select set_config('t.mot', '{"duracao_min": 240, "origem": "Umi San · Rua Araguaia, 49", "destino": "Porto de Itajaí",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO",
  "categoria": "MOTORISTA"}', true);
select set_config('t.pas', '{"duracao_min": 60, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 2, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO",
  "categoria": "PASSAGEIROS"}', true);
select set_config('t.atual', '{"duracao_min": 60, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 2, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO",
  "contato_nome": null, "contato_telefone": null, "observacoes": null, "destino_lat": -26.9, "destino_lng": -48.65}', true);
-- Entrada do Orçar de hoje (src/lib/orcar.ts, montarEntrada, VEICULO_PROPRIO).
select set_config('t.orcar48', '{"modalidade": "VEICULO_PROPRIO", "km": 48, "usa_reboque": false, "espera_horas": 0,
  "pedagio_cent": 0, "hospedagem_diarias": 0}', true);
select set_config('t.duas', '[{"texto": "Centro de Itajaí", "place_id": "ChIJ_parada-1"},
                              {"texto": "Ponto marcado", "lat": -26.91, "lng": -48.66}]', true);

create function pg_temp.linhas(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((l ->> 'codigo') || '=' || (l ->> 'valor_cent'), ',' order by i), '')
    from jsonb_array_elements(r -> 'linhas') with ordinality x(l, i)
$$;
create function pg_temp.cat(r jsonb, p_codigo text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'categorias') x where x ->> 'codigo' = p_codigo
$$;
-- A última negação de criar_pedido (detalhe gravado na auditoria).
create function pg_temp.ultima_negacao() returns jsonb language sql stable as $$
  select detalhe from app.auditoria where acao = 'CRIAR_PEDIDO' and resultado = 'NEGADO' order by id desc limit 1
$$;

------------------------------------------------------------------ 0. estrutura
select has_table('app', 'atividades_paradas', 'tabela app.atividades_paradas');
select has_column('app', 'atividades', 'horas_estimadas', 'app.atividades.horas_estimadas');
select ok(not has_table_privilege('authenticated', 'app.atividades_paradas', 'SELECT')
      and not has_table_privilege('anon', 'app.atividades_paradas', 'SELECT'), 'paradas sem acesso direto');

------------------------------------------------------------------ 1. tabela publicada e recarga
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
select ok(current_setting('t.pub')::jsonb ->> 'ok' = 'true' and current_setting('t.rec')::jsonb ->> 'ok' = 'true',
  'tabela publicada (v2) e recarga');

------------------------------------------------------------------ 2. IVO Motorista, sem nenhum veículo cadastrado
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.m0', api.criar_pedido(current_setting('t.mot')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_m0')))::text, true);
reset role;
select set_config('t.m0d', pg_temp.ultima_negacao()::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.m1', api.criar_pedido(current_setting('t.mot')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_m1'), 'horas_estimadas', 4, 'centro_custo', '  Obra 12  '))::text, true);
select set_config('t.m2', api.criar_pedido(current_setting('t.mot')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_m2'), 'horas_estimadas', 4.3))::text, true);
select set_config('t.m3', api.criar_pedido(current_setting('t.mot')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_m2'), 'horas_estimadas', 24.5))::text, true);
select set_config('t.m4', api.criar_pedido(current_setting('t.mot')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_m4'), 'horas_estimadas', 4, 'modalidade', 'VEICULO_CLIENTE',
                        'centro_custo', 'Obra 15'))::text, true);
select set_config('t.dm', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false,"horas":4}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.cm1', api.calcular_orcamento((current_setting('t.m1')::jsonb ->> 'id')::uuid, '{}'::jsonb)::text, true);
select set_config('t.em1', api.enviar_orcamento((current_setting('t.m1')::jsonb ->> 'id')::uuid, '{"horas": 4}'::jsonb, null)::text, true);
reset role;

select is(current_setting('t.m0')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'IVO Motorista (cobra hora) sem horas_estimadas: CAMPOS_INVALIDOS');
select ok(current_setting('t.m0d')::jsonb -> 'invalidos' ? 'horas_estimadas', 'o detalhe aponta horas_estimadas');
select ok((current_setting('t.m1')::jsonb ->> 'ok')::boolean
          and (select count(*) from app.veiculos) = 0, 'IVO Motorista com 4 h: ok, sem nenhum veículo cadastrado');
select is((select modalidade::text || '|' || horas_estimadas::text || '|' || centro_custo || '|' || reboque::text || '|'
                  || coalesce(veiculo_id::text, '-')
             from app.atividades where id = (current_setting('t.m1')::jsonb ->> 'id')::uuid),
  'VEICULO_CLIENTE|4.0|Obra 12|NAO|-', 'grava VEICULO_CLIENTE, as horas e o centro de custo (aparado)');
select ok(current_setting('t.m2')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.m3')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS',
  'horas fora do passo de 0,5 ou acima de 24: CAMPOS_INVALIDOS');
select ok((current_setting('t.m4')::jsonb ->> 'ok')::boolean
          and (select modalidade::text from app.atividades where id = (current_setting('t.m4')::jsonb ->> 'id')::uuid) = 'VEICULO_CLIENTE',
  'IVO Motorista pedida com VEICULO_CLIENTE também é aceita');
select is(pg_temp.cat(current_setting('t.dm')::jsonb, 'MOTORISTA') -> 'total_cent', '36000'::jsonb,
  'prévia do cliente: 4 h × 9000');
select is(current_setting('t.cm1')::jsonb -> 'total_cent', pg_temp.cat(current_setting('t.dm')::jsonb, 'MOTORISTA') -> 'total_cent',
  'cálculo do motorista sem horas usa as horas estimadas do pedido: igual à prévia');
select ok(current_setting('t.em1')::jsonb @> '{"ok": true, "total_cent": 36000}',
  'enviar_orcamento de MOTORISTA com {horas:4}: 36000, sem veiculo_id');
select is((select o.modalidade::text || '|' || coalesce(a.veiculo_id::text, '-') || '|' || pg_temp.linhas(jsonb_build_object('linhas', o.linhas))
             from app.orcamentos o join app.atividades a on a.id = o.atividade_id
            where o.atividade_id = (current_setting('t.m1')::jsonb ->> 'id')::uuid and o.status = 'PENDENTE'),
  'VEICULO_CLIENTE|-|HORAS=36000', 'orçamento VEICULO_CLIENTE, só a linha de horas, nenhum veículo gravado');

------------------------------------------------------------------ 3. Passageiros com paradas
insert into app.veiculos (id, motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4', 'Spin', 'Prata', 'ABC1D23', 6, 400,
   array['PASSAGEIROS', 'CARGA_LEVE']);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.p2', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p2'), 'paradas', current_setting('t.duas')::jsonb,
                        'centro_custo', 'Obra 7'))::text, true);
select set_config('t.p4', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'paradas', '[{"texto":"Parada 1"},{"texto":"Parada 2"},
       {"texto":"Parada 3"},{"texto":"Parada 4"}]'::jsonb))::text, true);
reset role;
select set_config('t.p4d', pg_temp.ultima_negacao()::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.px', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'paradas',
       '[{"texto":"Centro de Itajaí","place_id":"ChIJ_parada-1","lat":-26.91,"lng":-48.66}]'::jsonb))::text, true);
select set_config('t.py', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'paradas', '[{"texto":"ab"}]'::jsonb))::text, true);
select set_config('t.pz', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'paradas', '[{"texto":"Parada 1","lat":-26.91}]'::jsonb))::text, true);
select set_config('t.pc', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'centro_custo', repeat('x', 81)))::text, true);
select set_config('t.dp', api.categorias_disponiveis('{"km":48,"levar":true,"trazer":false,"paradas":2}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.cp2', api.calcular_orcamento((current_setting('t.p2')::jsonb ->> 'id')::uuid, current_setting('t.orcar48')::jsonb)::text, true);
select set_config('t.cp2b', api.calcular_orcamento((current_setting('t.p2')::jsonb ->> 'id')::uuid, '{"km": 48, "paradas": 1}'::jsonb)::text, true);
select set_config('t.ep2', api.enviar_orcamento((current_setting('t.p2')::jsonb ->> 'id')::uuid, current_setting('t.orcar48')::jsonb, null)::text, true);
reset role;

select ok((current_setting('t.p2')::jsonb ->> 'ok')::boolean, 'Passageiros com 2 paradas: ok');
select is((select string_agg(ordem || ':' || texto || ':' || coalesce(place_id, '-') || ':' || coalesce(lat::text, '-')
                             || ':' || coalesce(lng::text, '-'), '|' order by ordem)
             from app.atividades_paradas where atividade_id = (current_setting('t.p2')::jsonb ->> 'id')::uuid),
  '1:Centro de Itajaí:ChIJ_parada-1:-:-|2:Ponto marcado:-:-26.910000:-48.660000',
  'as paradas gravadas na ordem: do Google só o place_id; do mapa, o ponto marcado');
select is((select centro_custo || '|' || coalesce(horas_estimadas::text, '-') from app.atividades where id = (current_setting('t.p2')::jsonb ->> 'id')::uuid),
  'Obra 7|-', 'centro de custo gravado ao pedir; sem horas');
select is(current_setting('t.p4')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'quarta parada: CAMPOS_INVALIDOS');
select ok(current_setting('t.p4d')::jsonb -> 'invalidos' ? 'paradas', 'quarta parada: o detalhe aponta paradas');
select is(current_setting('t.px')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'parada com place_id e lat ao mesmo tempo: recusada');
select ok(current_setting('t.py')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.pz')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS',
  'parada com texto curto ou lat sem lng: recusada');
select is(current_setting('t.pc')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'centro de custo com 81 caracteres: CAMPOS_INVALIDOS');
select is((select count(*)::int from app.atividades where inicio = current_setting('t.i_px')::timestamptz), 0,
  'nenhuma recusa criou pedido');
select throws_ok($$insert into app.atividades_paradas (atividade_id, ordem, texto, place_id, lat, lng)
  values ((current_setting('t.p2')::jsonb ->> 'id')::uuid, 3, 'Dupla', 'ChIJ_x', -26.9, -48.6)$$,
  '23514', null, 'o banco recusa parada com place_id e coordenadas');
select throws_ok($$insert into app.atividades_paradas (atividade_id, ordem, texto) values
  ((current_setting('t.p2')::jsonb ->> 'id')::uuid, 4, 'Quarta')$$, '23514', null, 'o banco recusa a ordem 4');

-- Invariante (prévia = orçamento): a tarifa vale na prévia do cliente, no cálculo e no envio do motorista.
select is(pg_temp.cat(current_setting('t.dp')::jsonb, 'PASSAGEIROS') -> 'total_cent', '27160'::jsonb,
  'prévia do cliente: taxa 4000 + km 16800 + retorno 3360 + 2 paradas 3000');
select is(current_setting('t.cp2')::jsonb -> 'total_cent', pg_temp.cat(current_setting('t.dp')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'cálculo do motorista (Orçar de hoje, sem paradas na entrada) = prévia: as paradas vêm do pedido');
select is(pg_temp.linhas(current_setting('t.cp2')::jsonb), 'TAXA_FIXA=4000,KM=16800,RETORNO=3360,PARADAS=3000',
  'as linhas da tarifa no cálculo');
select is(current_setting('t.ep2')::jsonb -> 'total_cent', pg_temp.cat(current_setting('t.dp')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'orçamento enviado = prévia do cliente');
select is(current_setting('t.cp2b')::jsonb -> 'total_cent', '25660'::jsonb, 'o motorista ajusta as paradas na entrada');
select is((select veiculo_id from app.atividades where id = (current_setting('t.p2')::jsonb ->> 'id')::uuid), '00000000-0000-0000-0000-0000000000b1'::uuid,
  'Passageiros: o veículo que atende a categoria continua gravado');

------------------------------------------------------------------ 4. confirmar_corrida troca o centro de custo
select set_config('t.h_p2', (select hash from app.orcamentos where atividade_id = (current_setting('t.p2')::jsonb ->> 'id')::uuid and status = 'PENDENTE'), true);
select set_config('t.h_m1', (select hash from app.orcamentos where atividade_id = (current_setting('t.m1')::jsonb ->> 'id')::uuid and status = 'PENDENTE'), true);
select set_config('t.k_p2', gen_random_uuid()::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cf2', api.confirmar_corrida((current_setting('t.p2')::jsonb ->> 'id')::uuid, 1, current_setting('t.h_p2'),
  current_setting('t.k_p2')::uuid, '  Obra 9 ', null)::text, true);
select set_config('t.cf2r', api.confirmar_corrida((current_setting('t.p2')::jsonb ->> 'id')::uuid, 1, current_setting('t.h_p2'),
  current_setting('t.k_p2')::uuid, 'Outro centro', null)::text, true);
select set_config('t.cf1', api.confirmar_corrida((current_setting('t.m1')::jsonb ->> 'id')::uuid, 1, current_setting('t.h_m1'), gen_random_uuid(), null,
  null)::text, true);
reset role;
select ok((current_setting('t.cf2')::jsonb ->> 'ok')::boolean
          and (select centro_custo from app.atividades where id = (current_setting('t.p2')::jsonb ->> 'id')::uuid) = 'Obra 9',
  'confirmar_corrida com outro valor troca o centro de custo gravado');
select is((select centro_custo from app.atividades where id = (current_setting('t.p2')::jsonb ->> 'id')::uuid), 'Obra 9',
  'a repetição com a mesma chave não troca de novo');
select ok((current_setting('t.cf1')::jsonb ->> 'ok')::boolean
          and (select centro_custo from app.atividades where id = (current_setting('t.m1')::jsonb ->> 'id')::uuid) = 'Obra 12',
  'confirmar_corrida com null mantém o centro de custo do pedido');

------------------------------------------------------------------ 5. api.pedido e painel_empresa
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.v5', api.pedido((current_setting('t.p2')::jsonb ->> 'id')::uuid)::text, true);
select set_config('t.v5m', api.pedido((current_setting('t.m1')::jsonb ->> 'id')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.v4', api.pedido((current_setting('t.p2')::jsonb ->> 'id')::uuid)::text, true);
select set_config('t.pd4', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.mp5', api.meus_pedidos('{}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.pn', api.painel_empresa(null, null)::text, true);
reset role;
select is(current_setting('t.v5')::jsonb #> '{pedido,paradas}',
  '[{"texto": "Centro de Itajaí", "place_id": "ChIJ_parada-1", "lat": null, "lng": null},
    {"texto": "Ponto marcado", "place_id": null, "lat": -26.91, "lng": -48.66}]'::jsonb,
  'api.pedido: o N2 dono vê as paradas na ordem');
select is(current_setting('t.v4')::jsonb #> '{pedido,paradas}', current_setting('t.v5')::jsonb #> '{pedido,paradas}',
  'api.pedido: o motorista vê as mesmas paradas');
select ok(current_setting('t.v5m')::jsonb -> 'pedido' @> '{"horas_estimadas": 4, "centro_custo": "Obra 12", "paradas": []}',
  'api.pedido: horas estimadas, centro de custo e lista vazia sem paradas');
select is((select x -> 'paradas' from jsonb_array_elements(current_setting('t.pn')::jsonb -> 'proximas') x
            where x ->> 'id' = current_setting('t.p2')::jsonb ->> 'id'),
  '["Centro de Itajaí", "Ponto marcado"]'::jsonb, 'painel_empresa: o pedido traz os textos das paradas');
select ok((select x -> 'paradas' from jsonb_array_elements(current_setting('t.mp5')::jsonb -> 'itens') x
            where x ->> 'id' = current_setting('t.p2')::jsonb ->> 'id') = '["Centro de Itajaí", "Ponto marcado"]'::jsonb
      and (select x -> 'paradas' from jsonb_array_elements(current_setting('t.mp5')::jsonb -> 'itens') x
            where x ->> 'id' = current_setting('t.m1')::jsonb ->> 'id') = '[]'::jsonb,
  'meus_pedidos: cada item traz os textos das paradas ([] sem paradas)');
select ok((select x -> 'paradas' from jsonb_array_elements(current_setting('t.pd4')::jsonb -> 'proximos') x
            where x ->> 'id' = current_setting('t.p2')::jsonb ->> 'id') = '["Centro de Itajaí", "Ponto marcado"]'::jsonb
      and (select x -> 'paradas' from jsonb_array_elements(current_setting('t.pd4')::jsonb -> 'aguardando_orcamento') x
            where x ->> 'id' = current_setting('t.m4')::jsonb ->> 'id') = '[]'::jsonb,
  'pendencias: cada item traz os textos das paradas ([] sem paradas)');

------------------------------------------------------------------ 6. app atual e categoria sem tabela
insert into app.categorias (codigo, nome, descricao_curta, carga, reboque, ordem)
values ('VAN', 'IVO Van', 'até 7 pessoas', 'PESSOAS', 'NAO', 5);
update app.veiculos set categorias = array['PASSAGEIROS', 'CARGA_LEVE', 'VAN'] where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ap', api.criar_pedido(current_setting('t.atual')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_ap')))::text, true);
select set_config('t.vn', api.criar_pedido(current_setting('t.pas')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_vn'), 'categoria', 'VAN'))::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.cap', api.calcular_orcamento((current_setting('t.ap')::jsonb ->> 'id')::uuid, current_setting('t.orcar48')::jsonb
  || '{"paradas": 1}'::jsonb)::text, true);
select set_config('t.eap', api.enviar_orcamento((current_setting('t.ap')::jsonb ->> 'id')::uuid, current_setting('t.orcar48')::jsonb, null)::text, true);
reset role;
select ok((current_setting('t.ap')::jsonb ->> 'ok')::boolean
          and (select horas_estimadas is null and centro_custo is null and modalidade = 'VEICULO_PROPRIO'
                 from app.atividades where id = (current_setting('t.ap')::jsonb ->> 'id')::uuid)
          and not exists (select 1 from app.atividades_paradas where atividade_id = (current_setting('t.ap')::jsonb ->> 'id')::uuid),
  'app atual (sem categoria e sem chaves novas): pedido como hoje');
select ok(current_setting('t.eap')::jsonb @> '{"ok": true, "total_cent": 18000}',
  'app atual: orçamento pelo contrato, como hoje (48 km × 250 + retorno 50%)');
select is(current_setting('t.cap')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'sem categoria, paradas na entrada não valem');
select ok(current_setting('t.vn')::jsonb @> '{"ok": false, "codigo": "CATEGORIA_INDISPONIVEL"}',
  'categoria criada depois da última publicação: CATEGORIA_INDISPONIVEL, mesmo com veículo');

------------------------------------------------------------------ 7. revisão: Orçar do app atual na IVO Motorista
-- O Orçar de hoje (src/lib/orcar.ts, montarEntrada) manda `diarias` em todo pedido VEICULO_CLIENTE; com a tabela
-- publicada ele precisa continuar orçando, pelo preço da prévia (horas estimadas do pedido).
select set_config('t.orcar_cli', '{"modalidade": "VEICULO_CLIENTE", "diarias": 1, "pedagio_cent": 0,
  "hospedagem_diarias": 0}', true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.cm4', api.calcular_orcamento((current_setting('t.m4')::jsonb ->> 'id')::uuid,
  current_setting('t.orcar_cli')::jsonb)::text, true);
select set_config('t.em4', api.enviar_orcamento((current_setting('t.m4')::jsonb ->> 'id')::uuid,
  current_setting('t.orcar_cli')::jsonb, null)::text, true);
reset role;
select set_config('t.h_m4', (select hash from app.orcamentos
  where atividade_id = (current_setting('t.m4')::jsonb ->> 'id')::uuid and status = 'PENDENTE'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cf4', api.confirmar_corrida((current_setting('t.m4')::jsonb ->> 'id')::uuid, 1,
  current_setting('t.h_m4'), gen_random_uuid(), '', null)::text, true);
reset role;
select ok(current_setting('t.cm4')::jsonb @> '{"ok": true}'
          and current_setting('t.cm4')::jsonb -> 'total_cent' = pg_temp.cat(current_setting('t.dm')::jsonb, 'MOTORISTA') -> 'total_cent',
  'Orçar de hoje (VEICULO_CLIENTE, com diarias): calcular_orcamento = prévia (36000)');
select ok(current_setting('t.em4')::jsonb @> '{"ok": true, "total_cent": 36000}',
  'Orçar de hoje (VEICULO_CLIENTE, com diarias): enviar_orcamento = prévia (36000)');
select is(pg_temp.linhas(current_setting('t.cm4')::jsonb), 'HORAS=36000', 'diarias ignorado: só a linha de horas da tarifa');
select ok((current_setting('t.cf4')::jsonb ->> 'ok')::boolean
          and (select centro_custo is null from app.atividades where id = (current_setting('t.m4')::jsonb ->> 'id')::uuid),
  'confirmar_corrida com vazio limpa o centro de custo do pedido');

select * from finish();
rollback;
