-- Fase 3A (migration 20261015120000_mapas_enderecos.sql), dentro dos termos do Google (decisão do dono, 2026-10-15):
-- de um ponto do Google o pedido guarda só o place_id (coordenadas, endereço formatado e km do Google não são
-- guardados); coordenadas só de ponto marcado no mapa pela pessoa. O detalhe diz quantos trechos o motorista orça.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');

select set_config('t.d' || n, to_char((now() + make_interval(days => 3 + n)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true)
from generate_series(1, 8) n;
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u = 'a2' then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a2', 'a5']) u;
select set_config('t.ped', '{"duracao_min": 120, "origem": "Porto de Itajaí", "destino": "Estaleiro Navegantes",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 2, "modalidade": "VEICULO_PROPRIO",
  "reboque": "NAO"}', true);
-- Origem do Google (só o place_id); destino marcado no mapa (só coordenadas).
select set_config('t.geo', '{"origem_place_id": "ChIJabc", "destino_lat": -26.91, "destino_lng": -48.65}', true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);

select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d1'))) ->> 'ok',
  'true', 'pedido sem pontos escolhidos continua válido');
select set_config('t.id', api.criar_pedido(current_setting('t.ped')::jsonb || current_setting('t.geo')::jsonb
  || jsonb_build_object('inicio', current_setting('t.d2'))) ->> 'id', true);
select isnt(nullif(current_setting('t.id'), ''), null, 'pedido com place_id na origem e ponto marcado no destino');

select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'destino_lat', 120, 'destino_lng', -48)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'latitude fora de -90..90');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'destino_lat', -26.9)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'latitude sem longitude');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'origem_place_id', 'x y/../')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'place_id com caracteres inválidos');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'),
  'origem_place_id', 'ChIJabc', 'origem_lat', -26.9, 'origem_lng', -48.66)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'coordenadas de um ponto do Google não são guardadas');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'km_estimado', 38.2)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'km da rota não é guardado (é calculado na hora)');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'origem_endereco', 'Av. X')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'endereço formatado do Google não é guardado');

select is(api.pedido(current_setting('t.id')::uuid) -> 'pedido' ->> 'origem_place_id', 'ChIJabc', 'o detalhe devolve o place_id');
select is((api.pedido(current_setting('t.id')::uuid) -> 'pedido' ->> 'trechos_km')::int, 1, 'trecho único: um trecho');
select set_config('t.id2', api.criar_pedido(current_setting('t.ped')::jsonb || current_setting('t.geo')::jsonb
  || jsonb_build_object('inicio', current_setting('t.d5'), 'trazer', true)) ->> 'id', true);
select is((api.pedido(current_setting('t.id2')::uuid) -> 'pedido' ->> 'trechos_km')::int, 2,
  'ida e volta: o km do orçamento é o dobro do trecho da rota');

reset role;
select results_eq($$ select origem_place_id, origem_lat, destino_place_id, destino_lat, destino_lng
                     from app.atividades where id = current_setting('t.id')::uuid $$,
  $$ values ('ChIJabc'::text, null::numeric, null::text, -26.910000::numeric, -48.650000::numeric) $$,
  'só o place_id do ponto do Google; coordenadas só do ponto marcado');

select * from finish();
rollback;
