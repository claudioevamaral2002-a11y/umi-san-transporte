-- Fase 4.1, Ruling F4 (migration 20261022120300_km_volta.sql): api.categorias_disponiveis aceita `km_volta` (opcional).
-- Ida e volta com km_volta: o km do preço é a ida (pelas paradas) + a volta direta, como o motorista calcula
-- (especificação §5). Sem km_volta, ida e volta dobra o km, como hoje. Em trecho único, km_volta é ignorado.
-- Invariante: prévia do cliente = cálculo do motorista com o km total.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local');
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
from unnest(array['a1', 'a4', 'a5']) u;
select set_config('t.inicio', to_char((now() + interval '14 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true);

create function pg_temp.linhas(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((l ->> 'codigo') || '=' || (l ->> 'valor_cent'), ',' order by i), '')
    from jsonb_array_elements(r -> 'linhas') with ordinality x(l, i)
$$;
create function pg_temp.cat(r jsonb, p_codigo text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'categorias') x where x ->> 'codigo' = p_codigo
$$;
create function pg_temp.negacoes() returns int language sql stable as $$
  select count(*)::int from app.auditoria
   where acao = 'CATEGORIAS_DISPONIVEIS' and resultado = 'NEGADO' and codigo = 'CAMPOS_INVALIDOS'
$$;

-- Tabela publicada (PASSAGEIROS: taxa 4000, km 350, retorno 20%, parada 1500) e o veículo que atende.
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
select set_config('t.n0', pg_temp.negacoes()::text, true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.iv', api.categorias_disponiveis('{"km":30,"km_volta":25,"levar":true,"trazer":true,"paradas":2}'::jsonb)::text, true);
select set_config('t.i2', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":true,"paradas":2}'::jsonb)::text, true);
select set_config('t.in', api.categorias_disponiveis('{"km":30,"km_volta":null,"levar":true,"trazer":true,"paradas":2}'::jsonb)::text, true);
select set_config('t.uv', api.categorias_disponiveis('{"km":30,"km_volta":25,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.u0', api.categorias_disponiveis('{"km":30,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.tv', api.categorias_disponiveis('{"km":30,"km_volta":25,"levar":false,"trazer":true}'::jsonb)::text, true);
select set_config('t.t0', api.categorias_disponiveis('{"km":30,"levar":false,"trazer":true}'::jsonb)::text, true);
select set_config('t.x1', api.categorias_disponiveis('{"km":30,"km_volta":"25","levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.x2', api.categorias_disponiveis('{"km":30,"km_volta":5000.1,"levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.x3', api.categorias_disponiveis('{"km":30,"km_volta":25.55,"levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.x4', api.categorias_disponiveis('{"km":30,"km_volta":-1,"levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.x5', api.categorias_disponiveis('{"km":30,"km_volta":12345,"levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.x6', api.categorias_disponiveis('{"km":30,"km_volta":true,"levar":true,"trazer":true}'::jsonb)::text, true);
select set_config('t.ok5000', api.categorias_disponiveis('{"km":30,"km_volta":5000,"levar":true,"trazer":true}'::jsonb)::text, true);
reset role;

select is(pg_temp.cat(current_setting('t.iv')::jsonb, 'PASSAGEIROS') -> 'total_cent', '26250'::jsonb,
  'ida e volta com km_volta: 30 + 25 = 55 km (taxa 4000 + km 19250 + 2 paradas 3000)');
select is(pg_temp.linhas(pg_temp.cat(current_setting('t.iv')::jsonb, 'PASSAGEIROS')), 'TAXA_FIXA=4000,KM=19250,PARADAS=3000',
  'ida e volta com km_volta: linha KM de 55 km, sem retorno');
select is(pg_temp.cat(current_setting('t.i2')::jsonb, 'PASSAGEIROS') -> 'total_cent', '28000'::jsonb,
  'ida e volta sem km_volta: 60 km, como hoje (taxa 4000 + km 21000 + 2 paradas 3000)');
select is(pg_temp.cat(current_setting('t.in')::jsonb, 'PASSAGEIROS') -> 'total_cent', '28000'::jsonb,
  'km_volta null vale como ausente: 60 km');
select ok((current_setting('t.uv')::jsonb ->> 'ok')::boolean
          and current_setting('t.uv')::jsonb = current_setting('t.u0')::jsonb
          and pg_temp.cat(current_setting('t.uv')::jsonb, 'PASSAGEIROS') -> 'total_cent' = '16600'::jsonb,
  'só levar com km_volta: ignorado, mesmo resultado de sem km_volta (30 km + retorno)');
select ok((current_setting('t.tv')::jsonb ->> 'ok')::boolean
          and current_setting('t.tv')::jsonb = current_setting('t.t0')::jsonb,
  'só trazer com km_volta: ignorado, mesmo resultado de sem km_volta');
select ok(current_setting('t.x1')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x2')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x3')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x4')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x5')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
          and current_setting('t.x6')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS',
  'km_volta texto, acima de 5000, duas casas, negativo, cinco dígitos ou booleano: CAMPOS_INVALIDOS');
select is(pg_temp.negacoes() - current_setting('t.n0')::int, 6, 'cada recusa de km_volta fica na auditoria');
select ok((current_setting('t.ok5000')::jsonb ->> 'ok')::boolean, 'km_volta 5000 (o limite) é aceito');

------------------------------------------------------------------ 2. prévia = cálculo do motorista com o km total
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.p', api.criar_pedido(jsonb_build_object(
  'inicio', current_setting('t.inicio'), 'duracao_min', 60, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes',
  'levar', true, 'trazer', true, 'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
  'categoria', 'PASSAGEIROS',
  'paradas', '[{"texto": "Centro de Itajaí"}, {"texto": "Ponto marcado", "lat": -26.91, "lng": -48.66}]'::jsonb))::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.cp', api.calcular_orcamento((current_setting('t.p')::jsonb ->> 'id')::uuid, '{"km": 55}'::jsonb)::text, true);
reset role;
select ok((current_setting('t.p')::jsonb ->> 'ok')::boolean
          and current_setting('t.cp')::jsonb -> 'total_cent' = pg_temp.cat(current_setting('t.iv')::jsonb, 'PASSAGEIROS') -> 'total_cent',
  'motorista manda 55 km no pedido de ida e volta com 2 paradas: calcular_orcamento = prévia com km_volta');

select * from finish();
rollback;
