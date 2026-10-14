-- Fase 3A (migration 20261015120000_mapas_enderecos.sql): coordenadas, endereço formatado, place_id e km/minutos
-- estimados pela rota, todos opcionais no criar_pedido; validados no banco; devolvidos no detalhe (api.pedido).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
select set_config('t.geo', '{"origem_lat": -26.9078, "origem_lng": -48.6619, "destino_lat": -26.8986, "destino_lng": -48.6542,
  "origem_endereco": "Av. Min. Victor Konder, Itajaí", "destino_endereco": "Av. Pref. Cirino Adolfo Cabral, 1500",
  "origem_place_id": "ChIJabc", "destino_place_id": "ChIJdef", "km_estimado": 38.2, "minutos_estimados": 45}', true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);

select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d1'))) ->> 'ok',
  'true', 'pedido sem coordenadas continua válido');
select set_config('t.id', api.criar_pedido(current_setting('t.ped')::jsonb || current_setting('t.geo')::jsonb
  || jsonb_build_object('inicio', current_setting('t.d2'))) ->> 'id', true);
select isnt(nullif(current_setting('t.id'), ''), null, 'pedido com coordenadas, endereço, place_id e km estimado');

select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'origem_lat', 120, 'origem_lng', -48)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'latitude fora de -90..90');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'km_estimado', 9000)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'km acima de 5000');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'origem_lat', -26.9)) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'latitude sem longitude');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'origem_place_id', 'x y/../')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'place_id com caracteres inválidos');
select is(api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d3'), 'km_estimado', '38')) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'km como texto');

select is((api.pedido(current_setting('t.id')::uuid) -> 'pedido' ->> 'km_estimado')::numeric, 38.2,
  'o detalhe devolve o km estimado');
select is(api.pedido(current_setting('t.id')::uuid) -> 'pedido' ->> 'destino_endereco', 'Av. Pref. Cirino Adolfo Cabral, 1500',
  'o detalhe devolve o endereço formatado');

reset role;
select results_eq($$ select origem_lat, origem_lng, destino_place_id, km_estimado, minutos_estimados
                     from app.atividades where id = current_setting('t.id')::uuid $$,
  $$ values (-26.907800::numeric, -48.661900::numeric, 'ChIJdef'::text, 38.2::numeric, 45) $$,
  'colunas gravadas');

select * from finish();
rollback;
