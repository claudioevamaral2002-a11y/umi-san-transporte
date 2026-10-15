-- Fase 3A (migration 20261015120100_locais_empresa.sql): os locais usados pela empresa ficam guardados pelo
-- criar_pedido e aparecem primeiro na busca (api.locais_da_empresa), só para a própria empresa.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n2b@teste.local', 'Solicitante B',   'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2b@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.base')::jsonb, now(), null, 'Teste');

select set_config('t.d' || n, to_char((now() + make_interval(days => 3 + n)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true)
from generate_series(1, 8) n;
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u = 'a2' then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a2', 'a5', 'a6', 'a8']) u;
select set_config('t.ped', '{"duracao_min": 60, "origem": "Porto de Itajaí", "destino": "Estaleiro Navegantes",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO",
  "origem_place_id": "ChIJabc", "destino_place_id": "ChIJdef"}', true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d1')));
select api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d2')));
-- Ponto marcado no mapa: coordenadas da própria pessoa, sem place_id.
select api.criar_pedido(current_setting('t.ped')::jsonb - 'destino_place_id'
  || jsonb_build_object('inicio', current_setting('t.d3'), 'destino', 'Marina Itajaí, rampa 2',
                        'destino_lat', -26.91, 'destino_lng', -48.65));

-- Outro pedido com o mesmo place_id mas outro nome não reescreve o local guardado.
select api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.d4'),
  'destino', 'Lugar Falso'));

select is(api.locais_da_empresa('ESTAL') -> 'locais' -> 0 ->> 'nome', 'Estaleiro Navegantes',
  'A encontra o local pelo nome, sem caixa');
select is(api.locais_da_empresa('itajai') -> 'locais' -> 0 ->> 'nome', 'Porto de Itajaí',
  'busca sem acento acha o nome com acento (usado 4 vezes, vem primeiro)');
select is(api.locais_da_empresa('estal') -> 'locais' -> 0 ->> 'place_id', 'ChIJdef', 'devolve o place_id');
select is(api.locais_da_empresa('estal') -> 'locais' -> 0, '{"nome": "Estaleiro Navegantes", "lat": null, "lng": null,
  "place_id": "ChIJdef"}'::jsonb, 'local do Google: só nome e place_id (o primeiro nome vale; sem coordenadas do Google)');
select is(jsonb_array_length(api.locais_da_empresa('') -> 'locais'), 3, 'texto vazio: os mais usados');
select is(api.locais_da_empresa('rampa') -> 'locais' -> 0, '{"nome": "Marina Itajaí, rampa 2",
  "lat": -26.910000, "lng": -48.650000, "place_id": null}'::jsonb, 'o ponto marcado no mapa fica com as coordenadas');
select is(api.locais_da_empresa(repeat('x', 121)) ->> 'codigo', 'CAMPOS_INVALIDOS', 'texto acima de 120');

select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(jsonb_array_length(api.locais_da_empresa('') -> 'locais'), 3, 'N3 da mesma empresa também vê');

select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(jsonb_array_length(api.locais_da_empresa('estal') -> 'locais'), 0, 'B não vê locais de A');

select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.locais_da_empresa('estal') ->> 'codigo', 'SEM_PERMISSAO', 'a equipe da IVO não usa essa busca');

reset role;
select is((select usos from app.locais_empresa where place_id = 'ChIJabc'), 4, 'cada pedido soma um uso');
set local role authenticated;
select throws_ok($$ insert into app.locais_empresa (empresa_id, nome, place_id, chave)
                    values ('00000000-0000-0000-0000-0000000000e1', 'x', 'ChIJx', 'x') $$,
  '42501', null, 'sem escrita direta');

select * from finish();
rollback;
