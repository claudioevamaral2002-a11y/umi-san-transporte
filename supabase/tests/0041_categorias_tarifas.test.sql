-- Fase 4.1, Tarefa 1 (migration 20261022120000_categorias_tarifas.sql): categorias livres, tabela de preço por categoria
-- (app.tarifas_categoria) e cálculo pela tarifa. Cobre: semente (Carga Leve com reboque, Carga Pesada desligada, IVO
-- Motorista nova com veículo do cliente); código gerado do nome; criar e editar categoria (código imutável, nome único
-- entre as ativas, só o Master); pedido antigo com a categoria desligada continua lido; veículo só com categoria que usa
-- veículo da IVO; fallback sem tarifa (preço de hoje); linhas da tarifa (taxa fixa, km, retorno, horas, paradas,
-- reboque só na categoria com reboque, total zero recusado); publicar_tarifas (todas as ativas, campos comuns copiados
-- da vigente, só o Master); publicar_contrato e publicar_contrato_categorias levam as tarifas adiante; categoria nova
-- sem tarifa fica indisponível; categorias_adm com a tarifa da versão ou a inicial.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

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
-- v1: publicada antes da 4.1 (sem tarifas nem preço por categoria).
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  now() - interval '1 hour', null, 'Teste');
-- Veículo do motorista: Passageiros e Carga Leve.
insert into app.veiculos (id, motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4', 'Fiorino', 'Branca', 'ABC1D23', 4, 650,
   array['PASSAGEIROS', 'CARGA_LEVE']);

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a4', 'a5', 'a8']) u;

-- Tarifas publicadas na seção 6 (todas as categorias ativas naquele momento).
select set_config('t.tar', '{
  "PASSAGEIROS":   {"taxa_fixa_cent": 4000, "km_cent": 350, "hora_cent": 0, "hora_espera_cent": 5000, "parada_cent": 1500,
                    "retorno_bp": 2000, "reboque_cent": 2500, "hospedagem_diaria_cent": 18000},
  "CARGA_LEVE":    {"taxa_fixa_cent": 0, "km_cent": 500, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                    "retorno_bp": 0, "reboque_cent": 2500, "hospedagem_diaria_cent": 0},
  "MOTORISTA":     {"taxa_fixa_cent": 0, "km_cent": 0, "hora_cent": 9000, "hora_espera_cent": 0, "parada_cent": 0,
                    "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 18000},
  "VAN_EXECUTIVA": {"taxa_fixa_cent": 0, "km_cent": 400, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                    "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 0}}', true);

-- "CODIGO=valor" das linhas, na ordem do memorial.
create function pg_temp.linhas(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((l ->> 'codigo') || '=' || (l ->> 'valor_cent'), ',' order by i), '')
    from jsonb_array_elements(r -> 'linhas') with ordinality x(l, i)
$$;
-- Uma categoria da lista de categorias_disponiveis / categorias_adm.
create function pg_temp.cat(r jsonb, p_codigo text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'categorias') x where x ->> 'codigo' = p_codigo
$$;
-- Tarifa avulsa (para chamar interno.linhas_da_tarifa sem publicar).
create function pg_temp.tarifa(p_categoria text, p jsonb) returns app.tarifas_categoria language sql stable as $$
  select jsonb_populate_record(null::app.tarifas_categoria,
    '{"taxa_fixa_cent":0,"km_cent":0,"hora_cent":0,"hora_espera_cent":0,"parada_cent":0,"retorno_bp":0,"reboque_cent":0,
      "hospedagem_diaria_cent":0}'::jsonb || p || jsonb_build_object('contrato_id', 1, 'categoria', p_categoria))
$$;

------------------------------------------------------------------ 0. estrutura e semente
select has_table('app', 'tarifas_categoria', 'tabela app.tarifas_categoria');
select is((select string_agg(codigo || ':' || ativa::text || ':' || reboque::text || ':' || veiculo_cliente::text, '|'
                             order by ordem, codigo) from app.categorias),
  'PASSAGEIROS:true:NAO:false|CARGA_LEVE:true:SIM:false|CARGA_PESADA:false:SIM:false|MOTORISTA:true:NAO:true',
  'semente: Carga Leve com reboque, Carga Pesada desligada, IVO Motorista com veículo do cliente');
select is((select nome || '|' || descricao_curta || '|' || carga::text || '|' || ordem from app.categorias where codigo = 'MOTORISTA'),
  'IVO Motorista|Ivo dirige o carro da sua empresa|PESSOAS|3', 'IVO Motorista: nome, descrição, carga e ordem');
select is(interno.codigo_categoria('IVO Motorista'), 'MOTORISTA_2', 'código: sem "IVO"; repetido ganha _2');
select is(interno.codigo_categoria('Ônibus Executivo'), 'ONIBUS_EXECUTIVO', 'código: sem acento, maiúsculas, _ no espaço');
select is(interno.codigo_categoria('  ivo Caminhão-baú 3/4 '), 'CAMINHAO_BAU_3_4', 'código: prefixo em minúsculas e símbolos');
select ok(has_function_privilege('authenticated', 'api.publicar_tarifas(uuid, jsonb, timestamptz)', 'EXECUTE')
      and not has_function_privilege('anon', 'api.publicar_tarifas(uuid, jsonb, timestamptz)', 'EXECUTE')
      and not has_table_privilege('authenticated', 'app.tarifas_categoria', 'SELECT'),
  'publicar_tarifas só para authenticated; tarifas sem acesso direto');

------------------------------------------------------------------ 1. antes de publicar: fallback e tarifa inicial
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.pv', api.previa_orcamento('{"km":42,"usa_reboque":false,"levar":true,"trazer":false,"modalidade":"VEICULO_PROPRIO"}'::jsonb)::text, true);
select set_config('t.d0', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.d0p', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false,"paradas":2,"horas":4}'::jsonb)::text, true);
select set_config('t.d0x', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false,"paradas":4}'::jsonb)::text, true);
select set_config('t.d0h', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false,"horas":0.3}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm0', api.categorias_adm('00000000-0000-0000-0000-0000000000e1')::text, true);
reset role;

select is(pg_temp.cat(current_setting('t.d0')::jsonb, 'PASSAGEIROS') -> 'total_cent', current_setting('t.pv')::jsonb -> 'total_cent',
  'fallback: sem tarifa, Passageiros (km 42) = prévia de hoje');
select is(pg_temp.cat(current_setting('t.d0')::jsonb, 'CARGA_LEVE') -> 'total_cent',
  to_jsonb(42 * 250 + 42 * 250 / 2), 'fallback: Carga Leve continua sem reboque (preço de hoje)');
select is(pg_temp.cat(current_setting('t.d0p')::jsonb, 'PASSAGEIROS') -> 'total_cent', current_setting('t.pv')::jsonb -> 'total_cent',
  'fallback: paradas e horas não mudam o preço de hoje');
select is((select string_agg(x ->> 'codigo', ',') from jsonb_array_elements(current_setting('t.d0')::jsonb -> 'categorias') x),
  'PASSAGEIROS,CARGA_LEVE,MOTORISTA', 'lista as categorias ativas do banco, na ordem (Carga Pesada desligada fora)');
select is((pg_temp.cat(current_setting('t.d0')::jsonb, 'MOTORISTA') ->> 'disponivel')::boolean, false,
  'IVO Motorista sem tarifa: indisponível');
select is(pg_temp.cat(current_setting('t.d0')::jsonb, 'PASSAGEIROS')
            - array['codigo', 'nome', 'descricao_curta', 'disponivel', 'total_cent', 'linhas', 'carga', 'reboque'],
  '{"veiculo_cliente": false, "cobra_hora": false, "cobra_parada": false}'::jsonb,
  'cada categoria traz veiculo_cliente, cobra_hora e cobra_parada');
select ok(current_setting('t.d0x')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS'
      and current_setting('t.d0h')::jsonb ->> 'codigo' = 'CAMPOS_INVALIDOS', '4 paradas ou horas fora do passo: CAMPOS_INVALIDOS');
select is(pg_temp.cat(current_setting('t.adm0')::jsonb, 'PASSAGEIROS') -> 'tarifa',
  '{"taxa_fixa_cent": 0, "km_cent": 250, "hora_cent": 0, "hora_espera_cent": 5000, "parada_cent": 0, "retorno_bp": 5000,
    "reboque_cent": 0, "hospedagem_diaria_cent": 18000, "inicial": true}'::jsonb,
  'categorias_adm sem versão: tarifa inicial com os valores de hoje');
select is(pg_temp.cat(current_setting('t.adm0')::jsonb, 'CARGA_LEVE') -> 'tarifa' -> 'reboque_cent', '15000'::jsonb,
  'tarifa inicial: Carga Leve (com reboque) traz a taxa de reboque do contrato');
select ok(pg_temp.cat(current_setting('t.adm0')::jsonb, 'MOTORISTA') @> '{"veiculo_cliente": true, "reboque": "NAO"}'
      and pg_temp.cat(current_setting('t.adm0')::jsonb, 'CARGA_PESADA') @> '{"ativa": false, "reboque": "SIM"}',
  'categorias_adm traz veiculo_cliente e reboque');

------------------------------------------------------------------ 2. criar e editar categoria
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.s0', api.salvar_categoria('{"nome":"IVO Van Executiva","descricao_curta":"até 7 pessoas","ordem":4}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.s1', api.salvar_categoria('{"nome":"IVO Van Executiva","descricao_curta":"até 7 pessoas","ordem":4}'::jsonb)::text, true);
select set_config('t.s2', api.salvar_categoria('{"codigo":"VAN_EXECUTIVA","nome":"IVO Van Premium","descricao_curta":"até 6 pessoas",
  "ordem":5,"ativa":true}'::jsonb)::text, true);
select set_config('t.s3', api.salvar_categoria('{"nome":"IVO Passageiros","descricao_curta":"outra","ordem":6}'::jsonb)::text, true);
select set_config('t.s4', api.salvar_categoria('{"nome":"IVO Guincho","descricao_curta":"x","ordem":6,"veiculo_cliente":true,
  "reboque":"SIM"}'::jsonb)::text, true);
select set_config('t.s5', api.salvar_categoria('{"codigo":"MOTO","nome":"IVO Moto","descricao_curta":"1 pessoa","ordem":6,
  "ativa":true}'::jsonb)::text, true);
reset role;

select is(current_setting('t.s0')::jsonb, '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'N1 não cria categoria');
select ok(exists (select 1 from app.auditoria where acao = 'SALVAR_CATEGORIA' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'
                     and usuario_id = '00000000-0000-0000-0000-0000000000a8'), 'negação do N1 auditada');
select is(current_setting('t.s1')::jsonb, '{"ok": true, "codigo": "VAN_EXECUTIVA"}'::jsonb, 'Master cria: código gerado do nome');
select is((select codigo || '|' || nome || '|' || descricao_curta || '|' || ordem || '|' || ativa::text || '|' || veiculo_cliente::text
             || '|' || reboque::text || '|' || carga::text from app.categorias where nome = 'IVO Van Premium'),
  'VAN_EXECUTIVA|IVO Van Premium|até 6 pessoas|5|true|false|NAO|PESSOAS', 'editar não troca o código');
select is(current_setting('t.s2')::jsonb, '{"ok": true}'::jsonb, 'edição devolve ok');
select is(current_setting('t.s3')::jsonb ->> 'codigo', 'CATEGORIA_DUPLICADA', 'nome repetido entre as ativas: recusado');
select is(current_setting('t.s4')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'veículo do cliente com reboque: recusado');
select is(current_setting('t.s5')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'editar código inexistente: NAO_ENCONTRADO');

------------------------------------------------------------------ 3. Carga Pesada desligada: pedido antigo continua lido
insert into app.atividades (id, empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer,
                            carga, equipamento_desc, modalidade, reboque, prazo_orcar_ate, categoria)
values ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a5',
        '00000000-0000-0000-0000-0000000000a4', now() + interval '2 days', 60, 'Porto de Itajaí', 'Base Navegantes', true, false,
        'EQUIPAMENTO', 'Gerador', 'VEICULO_PROPRIO', 'SIM', now() + interval '1 day', 'CARGA_PESADA');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ped', api.pedido('00000000-0000-0000-0000-000000000101')::text, true);
reset role;
select ok(current_setting('t.ped')::jsonb @> '{"ok": true, "pedido": {"categoria": "CARGA_PESADA", "categoria_nome": "IVO Carga Pesada"}}',
  'pedido antigo da Carga Pesada (desligada) continua lido, com o nome');

------------------------------------------------------------------ 4. veículos: só categorias que usam veículo da IVO
select throws_ok($$insert into app.veiculos (motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias)
  values ('00000000-0000-0000-0000-0000000000a4', 'Gol', 'Prata', 'GHI3J45', 4, 300, array['MOTORISTA'])$$,
  '23514', null, 'veículo com MOTORISTA (veículo do cliente) recusado no banco');
select throws_ok($$insert into app.veiculos (motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias)
  values ('00000000-0000-0000-0000-0000000000a4', 'Gol', 'Prata', 'GHI3J45', 4, 300, array['PASSAGEIROS', 'XPTO'])$$,
  '23514', null, 'veículo com código inexistente recusado no banco');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.salvar_veiculo('{"modelo":"Gol","cor":"Prata","placa":"GHI3J45","lugares":4,"carga_max_kg":300,
  "categorias":["MOTORISTA"]}'::jsonb) ->> 'codigo', 'VEICULO_INVALIDO', 'salvar_veiculo com MOTORISTA: VEICULO_INVALIDO');
select is(api.salvar_veiculo('{"modelo":"Gol","cor":"Prata","placa":"GHI3J45","lugares":4,"carga_max_kg":300,
  "categorias":["VAN_EXECUTIVA"]}'::jsonb) ->> 'ok', 'true', 'salvar_veiculo com categoria nova (veículo da IVO): ok');
reset role;

------------------------------------------------------------------ 5. linhas da tarifa
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS',
            '{"taxa_fixa_cent":4000,"km_cent":350,"parada_cent":1500,"retorno_bp":2000}'), false, true, false,
            '{"km":48,"paradas":1}')),
  'TAXA_FIXA=4000,KM=16800,RETORNO=3360,PARADAS=1500', 'tarifa: taxa fixa, km, retorno sobre o km e paradas');
select is(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS',
            '{"taxa_fixa_cent":4000,"km_cent":350,"parada_cent":1500,"retorno_bp":2000}'), false, true, false,
            '{"km":48,"paradas":1}') -> 'total_cent', '25660'::jsonb, 'tarifa: total = soma das linhas');
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS',
            '{"taxa_fixa_cent":4000,"km_cent":350,"parada_cent":1500,"retorno_bp":2000}'), false, true, true,
            '{"km":96,"paradas":0}')),
  'TAXA_FIXA=4000,KM=33600', 'ida e volta: sem retorno; parada 0 não gera linha');
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('MOTORISTA', '{"hora_cent":9000}'), false, true, false,
            '{"km":30,"horas":4}')),
  'HORAS=36000', 'IVO Motorista: 4 h × 9000, sem linha de km (zerado = não cobra)');
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('CARGA_LEVE', '{"km_cent":500,"reboque_cent":2500}'), true, true, true,
            '{"km":10}')),
  'KM=5000,REBOQUE=2500', 'categoria com reboque e taxa > 0: linha REBOQUE');
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS', '{"km_cent":500,"reboque_cent":2500}'), false, true, true,
            '{"km":10}')),
  'KM=5000', 'a mesma tarifa numa categoria sem reboque: sem REBOQUE');
select is(pg_temp.linhas(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS', '{"hora_espera_cent":5000,"hospedagem_diaria_cent":18000}'),
            false, true, false,
            '{"km":10,"espera_horas":1.5,"pedagio_cent":1200,"hospedagem_diarias":2,"outros":[{"descricao":"Estacionamento","valor_cent":800}]}')),
  'ESPERA=7500,PEDAGIO=1200,HOSPEDAGEM=36000,OUTROS=800', 'espera, pedágio, hospedagem e outros como hoje');
select is(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS', '{}'), false, true, false, '{"km":10,"paradas":2,"horas":3}'),
  '{"ok": false, "codigo": "VALOR_INVALIDO"}'::jsonb, 'tarifa toda zerada: VALOR_INVALIDO');
select is(interno.linhas_da_tarifa(pg_temp.tarifa('PASSAGEIROS', '{"km_cent":350}'), false, true, false, '{"km":10,"km_cent":1}')
  ->> 'codigo', 'CAMPOS_INVALIDOS', 'preço na entrada: CAMPOS_INVALIDOS');

------------------------------------------------------------------ 6. publicar_tarifas
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.p0', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb, now())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.p1', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.tar')::jsonb - 'VAN_EXECUTIVA', now())::text, true);
select set_config('t.p2', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1',
  jsonb_set(current_setting('t.tar')::jsonb, '{PASSAGEIROS,retorno_bp}', '10001'), now())::text, true);
select set_config('t.p3', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb, now())::text, true);
reset role;

select is(current_setting('t.p0')::jsonb, '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'N1 não publica tarifas');
select ok(exists (select 1 from app.auditoria where acao = 'PUBLICAR_TARIFAS' and resultado = 'NEGADO'
                     and usuario_id = '00000000-0000-0000-0000-0000000000a8'), 'negação de publicar_tarifas auditada');
select is(current_setting('t.p1')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'sem uma categoria ativa: CAMPOS_INVALIDOS');
select is(current_setting('t.p2')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'retorno acima de 100%: CAMPOS_INVALIDOS');
select is(current_setting('t.p3')::jsonb, '{"ok": true, "versao": 2}'::jsonb, 'Master publica a v2 (as recusas não criaram versão)');
select is((select to_jsonb(v2) - array['id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em']
             from app.contratos_versoes v2 where v2.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v2.versao = 2),
          (select to_jsonb(v1) - array['id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em']
             from app.contratos_versoes v1 where v1.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v1.versao = 1),
  'v2 copia da vigente os campos comuns (prazos, faixas, crédito e preços de hoje)');
select is((select string_agg(t.categoria || ':' || t.km_cent || ':' || t.hora_cent, ',' order by t.categoria)
             from app.tarifas_categoria t join app.contratos_versoes v on v.id = t.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v.versao = 2),
  'CARGA_LEVE:500:0,MOTORISTA:0:9000,PASSAGEIROS:350:0,VAN_EXECUTIVA:400:0', 'as tarifas da v2 gravadas');
select throws_ok($$update app.tarifas_categoria set km_cent = 1$$, '42501', null, 'tarifas_categoria é imutável (update)');

------------------------------------------------------------------ 7. preço pela tarifa
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d1', api.categorias_disponiveis('{"km":48,"levar":true,"trazer":false,"paradas":1,"horas":4}'::jsonb)::text, true);
reset role;
select is(pg_temp.linhas(pg_temp.cat(current_setting('t.d1')::jsonb, 'PASSAGEIROS')),
  'TAXA_FIXA=4000,KM=16800,RETORNO=3360,PARADAS=1500', 'com tarifa: Passageiros km 48 e 1 parada');
select is(pg_temp.linhas(pg_temp.cat(current_setting('t.d1')::jsonb, 'CARGA_LEVE')), 'KM=24000,REBOQUE=2500',
  'Carga Leve (com reboque) cobra o reboque da tarifa');
select ok(pg_temp.cat(current_setting('t.d1')::jsonb, 'MOTORISTA')
            @> '{"disponivel": true, "total_cent": 36000, "veiculo_cliente": true, "cobra_hora": true, "cobra_parada": false}',
  'IVO Motorista sem veículo: disponível (motorista ativo), 4 h × 9000');
select ok(pg_temp.cat(current_setting('t.d1')::jsonb, 'PASSAGEIROS') @> '{"cobra_parada": true, "cobra_hora": false}',
  'Passageiros cobra parada, não hora');

------------------------------------------------------------------ 8. publicar_contrato e publicar_contrato_categorias levam as tarifas
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.v3', api.publicar_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.contrato')::jsonb || '{"km_sem_reboque_cent": 260}'::jsonb, now())::text, true);
select set_config('t.v4', api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1', current_setting('t.contrato')::jsonb,
  '{"PASSAGEIROS":{"km_cent":300,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0},
    "CARGA_PESADA":{"km_cent":700,"taxa_fixa_cent":20000}}'::jsonb, now())::text, true);
reset role;
select ok(current_setting('t.v3')::jsonb = '{"ok": true, "versao": 3}' and current_setting('t.v4')::jsonb = '{"ok": true, "versao": 4}',
  'v3 (publicar_contrato) e v4 (publicar_contrato_categorias) publicadas');
select is((select string_agg(v.versao || ':' || t.categoria || ':' || t.km_cent, ',' order by v.versao, t.categoria)
             from app.tarifas_categoria t join app.contratos_versoes v on v.id = t.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v.versao in (3, 4)),
  '3:CARGA_LEVE:500,3:MOTORISTA:0,3:PASSAGEIROS:350,3:VAN_EXECUTIVA:400,'
  || '4:CARGA_LEVE:500,4:MOTORISTA:0,4:PASSAGEIROS:350,4:VAN_EXECUTIVA:400',
  'as tarifas seguem para a v3 e a v4');

------------------------------------------------------------------ 9. categoria criada depois da última publicação
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.s6', api.salvar_categoria('{"nome":"IVO Guincho","descricao_curta":"com reboque","ordem":7,"reboque":"SIM",
  "carga":"EQUIPAMENTO"}'::jsonb)::text, true);
reset role;
update app.veiculos set categorias = array['PASSAGEIROS', 'CARGA_LEVE', 'GUINCHO'] where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d2', api.categorias_disponiveis('{"km":48,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.adm1', api.categorias_adm('00000000-0000-0000-0000-0000000000e1')::text, true);
reset role;
select is(current_setting('t.s6')::jsonb, '{"ok": true, "codigo": "GUINCHO"}'::jsonb, 'Master cria IVO Guincho');
select ok(pg_temp.cat(current_setting('t.d2')::jsonb, 'GUINCHO') @> '{"disponivel": false, "total_cent": null}',
  'categoria nova sem tarifa: indisponível, mesmo com veículo que a atende');
select ok((pg_temp.cat(current_setting('t.adm1')::jsonb, 'PASSAGEIROS') -> 'tarifa') @> '{"inicial": false, "taxa_fixa_cent": 4000}'
      and (pg_temp.cat(current_setting('t.adm1')::jsonb, 'GUINCHO') -> 'tarifa') @> '{"inicial": true}',
  'categorias_adm: tarifa da versão vigente; a categoria nova vem com a inicial');

------------------------------------------------------------------ 10. revisão: Carga Leve pedida pelo app da fase 4 (reboque NAO)
select set_config('t.i_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('cl1', interval '3 hours'), ('cl2', interval '5 hours')) x(n, d);
select set_config('t.equip', '{"duracao_min": 30, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "EQUIPAMENTO", "equipamento_desc": "Gerador portátil", "modalidade": "VEICULO_PROPRIO",
  "categoria": "CARGA_LEVE"}', true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.cl1', api.criar_pedido(current_setting('t.equip')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_cl1'), 'reboque', 'NAO'))::text, true);
select set_config('t.cl2', api.criar_pedido(current_setting('t.equip')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_cl2'), 'reboque', 'SIM'))::text, true);
reset role;
select ok((current_setting('t.cl1')::jsonb ->> 'ok')::boolean
          and (select reboque::text || ':' || carga::text from app.atividades
                where id = (current_setting('t.cl1')::jsonb ->> 'id')::uuid) = 'SIM:EQUIPAMENTO',
  'Carga Leve com reboque NAO (app da fase 4 em cache): aceita e gravada com o reboque da categoria');
select ok((current_setting('t.cl2')::jsonb ->> 'ok')::boolean
          and (select reboque::text || ':' || carga::text from app.atividades
                where id = (current_setting('t.cl2')::jsonb ->> 'id')::uuid) = 'SIM:EQUIPAMENTO',
  'Carga Leve com reboque SIM: aceita e gravada com o reboque da categoria');

------------------------------------------------------------------ 11. revisão: tarifa que nunca dá preço fica indisponível
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.v5', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb
  || '{"GUINCHO": {"taxa_fixa_cent": 0, "km_cent": 0, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                   "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 0}}'::jsonb, now())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d3', api.categorias_disponiveis('{"km":48,"levar":true,"trazer":false}'::jsonb)::text, true);
select set_config('t.d4', api.categorias_disponiveis('{"km":48,"levar":true,"trazer":false,"horas":4}'::jsonb)::text, true);
reset role;
select ok(current_setting('t.v5')::jsonb ->> 'ok' = 'true'
          and pg_temp.cat(current_setting('t.d3')::jsonb, 'GUINCHO') @> '{"disponivel": false, "total_cent": null}',
  'tarifa toda zerada (com veículo): indisponível');
select ok(pg_temp.cat(current_setting('t.d3')::jsonb, 'MOTORISTA') @> '{"disponivel": true, "total_cent": null, "cobra_hora": true}',
  'IVO Motorista só com valor por hora e sem horas: disponível, preço pendente');
select is(pg_temp.cat(current_setting('t.d4')::jsonb, 'MOTORISTA') -> 'total_cent', '36000'::jsonb,
  'IVO Motorista com horas 4: com preço');

select * from finish();
rollback;
