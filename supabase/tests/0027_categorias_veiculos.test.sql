-- Fase 4, Tarefa 1 (migration 20261020120000_categorias_veiculos.sql): categorias, preço por categoria no contrato
-- e veículos do motorista. Cobre: lista de categorias com disponibilidade (veículo ativo que atende) e preço;
-- fallback para o contrato sem preço por categoria (total igual ao da prévia de hoje); preço da categoria quando
-- publicado; veículo em manutenção; quem salva veículo (placa normalizada, duplicada, de outro motorista);
-- publicar_contrato_categorias; imutabilidade de contratos_categorias; salvar_categoria.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',      'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste',  'MOTORISTA', null, null),
  ('mo2@teste.local', 'Motorista Dois',   'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Passageiro A',     'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1a@teste.local', 'Gestora A',        'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mo2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local');
update app.perfis set senha_pendente = false;

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a4', 'a7') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a4', 'a5', 'a6', 'a7', 'a8']) u;

-- as 3 categorias da semente (fase 4.1, 20261022120000: a Carga Leve ganhou reboque e entrou a MOTORISTA, na ordem 3)
select is((select string_agg(codigo || ':' || carga::text || ':' || reboque::text || ':' || descricao_curta, '|' order by ordem, codigo)
             from app.categorias),
  'PASSAGEIROS:PESSOAS:NAO:até 4 pessoas|CARGA_LEVE:EQUIPAMENTO:SIM:até 800 kg|CARGA_PESADA:EQUIPAMENTO:SIM:com reboque'
  || '|MOTORISTA:PESSOAS:NAO:Ivo dirige o carro da sua empresa',
  'semente: categorias com carga, reboque e descrição');
-- Este teste é da fase 4: volta às 3 categorias ativas de então (a 4.1 desligou a Carga Pesada e criou a MOTORISTA).
update app.categorias set ativa = (codigo <> 'MOTORISTA');

------------------------------------------------------------------ 1. sem veículo: nada disponível
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d0', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false}'::jsonb)::text, true);
select is(current_setting('t.d0')::jsonb ->> 'ok', 'true', 'categorias_disponiveis: ok');
select is((select string_agg(x ->> 'codigo', ',') from jsonb_array_elements(current_setting('t.d0')::jsonb -> 'categorias') x),
  'PASSAGEIROS,CARGA_LEVE,CARGA_PESADA', 'as 3 categorias, na ordem');
select is((select count(*)::int from jsonb_array_elements(current_setting('t.d0')::jsonb -> 'categorias') x
            where (x ->> 'disponivel')::boolean), 0, 'sem veículo: nenhuma disponível');
select is((select count(*)::int from jsonb_array_elements(current_setting('t.d0')::jsonb -> 'categorias') x
            where x -> 'total_cent' = 'null'::jsonb and x -> 'linhas' = 'null'::jsonb), 3, 'indisponível vem sem preço');
select is(api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false,"x":1}'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'chave desconhecida: CAMPOS_INVALIDOS');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false}'::jsonb) ->> 'codigo', 'SEM_PERMISSAO',
  'N3 não chama categorias_disponiveis');

------------------------------------------------------------------ 2. quem salva veículo
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"ABC-1D23","lugares":4,"carga_max_kg":800,
  "categorias":["PASSAGEIROS","CARGA_LEVE"]}'::jsonb) ->> 'codigo', 'SEM_PERMISSAO', 'N2 não salva veículo');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"ABC-1D23","lugares":4,"carga_max_kg":800,
  "categorias":[]}'::jsonb) ->> 'codigo', 'VEICULO_INVALIDO', 'categorias vazias: VEICULO_INVALIDO');
select is(api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"AB-123","lugares":4,"carga_max_kg":800,
  "categorias":["PASSAGEIROS"]}'::jsonb) ->> 'codigo', 'VEICULO_INVALIDO', 'placa fora do padrão: VEICULO_INVALIDO');
select is(api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"ABC-1D23","lugares":4,"carga_max_kg":800,
  "categorias":["MOTO"]}'::jsonb) ->> 'codigo', 'VEICULO_INVALIDO', 'categoria desconhecida: VEICULO_INVALIDO');
select is(api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"ABC-1D23","lugares":4,"carga_max_kg":800,
  "categorias":["PASSAGEIROS"],"preco":1}'::jsonb) ->> 'codigo', 'VEICULO_INVALIDO', 'chave desconhecida: VEICULO_INVALIDO');
select set_config('t.v1', api.salvar_veiculo('{"modelo":"Hilux","cor":"Branca","placa":"ABC-1D23","lugares":4,"carga_max_kg":800,
  "categorias":["PASSAGEIROS","CARGA_LEVE"]}'::jsonb)::text, true);
select is(current_setting('t.v1')::jsonb ->> 'ok', 'true', 'motorista salva o próprio veículo');
select set_config('t.v1', current_setting('t.v1')::jsonb ->> 'id', true);

select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.salvar_veiculo('{"modelo":"Strada","cor":"Prata","placa":"abc1d23","lugares":2,"carga_max_kg":600,
  "categorias":["CARGA_LEVE"]}'::jsonb) ->> 'codigo', 'PLACA_DUPLICADA', 'placa duplicada (mesmo em minúsculas)');
select set_config('t.v2', api.salvar_veiculo('{"modelo":"Strada","cor":"Prata","placa":"XYZ9K88","lugares":2,"carga_max_kg":600,
  "categorias":["CARGA_LEVE"]}'::jsonb) ->> 'id', true);
select is(api.salvar_veiculo(jsonb_build_object('id', current_setting('t.v1'), 'modelo', 'Hilux', 'cor', 'Preta',
  'placa', 'ABC1D23', 'lugares', 4, 'carga_max_kg', 800, 'categorias', jsonb_build_array('PASSAGEIROS'))) ->> 'codigo',
  'SEM_PERMISSAO', 'motorista não edita veículo de outro');
select is(api.mudar_situacao_veiculo(current_setting('t.v1')::uuid, 'MANUTENCAO') ->> 'codigo', 'SEM_PERMISSAO',
  'motorista não muda a situação do veículo de outro');

select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.v3', api.salvar_veiculo('{"motorista_id":"00000000-0000-0000-0000-0000000000a4","modelo":"Scania","cor":"Azul",
  "placa":"DEF2G34","lugares":2,"carga_max_kg":20000,"reboque_desc":"Carreta prancha","categorias":["CARGA_PESADA"]}'::jsonb)::text, true);
select is(current_setting('t.v3')::jsonb ->> 'ok', 'true', 'ADM salva veículo informando o motorista');
select set_config('t.v3', current_setting('t.v3')::jsonb ->> 'id', true);
select is(api.salvar_veiculo('{"modelo":"X","cor":"Y","placa":"GHI3J45","lugares":1,"carga_max_kg":1,"categorias":["CARGA_LEVE"]}'::jsonb)
  ->> 'codigo', 'VEICULO_INVALIDO', 'ADM sem motorista_id: VEICULO_INVALIDO');

select is(jsonb_array_length(api.meus_veiculos() -> 'veiculos'), 3, 'ADM vê os veículos de todos');
select ok((api.meus_veiculos() -> 'veiculos' -> 0) ? 'motorista_nome', 'ADM: veículo com motorista_nome');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(jsonb_array_length(api.meus_veiculos() -> 'veiculos'), 2, 'motorista vê só os próprios');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.meus_veiculos() ->> 'codigo', 'SEM_PERMISSAO', 'cliente não lista veículos');
reset role;

select is((select placa from app.veiculos where id = current_setting('t.v1')::uuid), 'ABC1D23', 'placa gravada sem hífen');
select is((select count(*)::int from app.auditoria where acao = 'SALVAR_VEICULO' and resultado = 'NEGADO'
             and codigo = 'SEM_PERMISSAO'), 2, 'negações de salvar_veiculo auditadas');

------------------------------------------------------------------ 3. disponibilidade e fallback
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d1', api.categorias_disponiveis('{"km":42,"levar":true,"trazer":false}'::jsonb)::text, true);
select is((select string_agg(x ->> 'codigo', ',' order by x ->> 'codigo') from jsonb_array_elements(current_setting('t.d1')::jsonb -> 'categorias') x
            where (x ->> 'disponivel')::boolean), 'CARGA_LEVE,CARGA_PESADA,PASSAGEIROS',
  'com veículos: as três disponíveis (motorista padrão = o mais antigo)');
select set_config('t.pv', api.previa_orcamento('{"km":42,"usa_reboque":false,"levar":true,"trazer":false,"modalidade":"VEICULO_PROPRIO"}'::jsonb)::text, true);
select is((select (x ->> 'total_cent')::bigint from jsonb_array_elements(current_setting('t.d1')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'PASSAGEIROS'), (current_setting('t.pv')::jsonb ->> 'total_cent')::bigint,
  'fallback: sem preço por categoria, Passageiros = prévia de hoje');
select is((select (x -> 'linhas') from jsonb_array_elements(current_setting('t.d1')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'PASSAGEIROS'), current_setting('t.pv')::jsonb -> 'linhas', 'fallback: mesmas linhas');
select is((select (x ->> 'total_cent')::bigint from jsonb_array_elements(current_setting('t.d1')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'CARGA_PESADA'),
  (api.previa_orcamento('{"km":42,"usa_reboque":true,"levar":true,"trazer":false,"modalidade":"VEICULO_PROPRIO"}'::jsonb) ->> 'total_cent')::bigint,
  'fallback: Carga Pesada = prévia de hoje com reboque');
select is((select (x ->> 'total_cent')::bigint from jsonb_array_elements(
    api.categorias_disponiveis('{"km":10,"levar":true,"trazer":true}'::jsonb) -> 'categorias') x where x ->> 'codigo' = 'PASSAGEIROS'),
  (api.previa_orcamento('{"km":10,"usa_reboque":false,"levar":true,"trazer":true,"modalidade":"VEICULO_PROPRIO"}'::jsonb) ->> 'total_cent')::bigint,
  'levar e trazer: km dobrado, como na prévia');

------------------------------------------------------------------ 4. preço por categoria
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000, "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb,
  '{"PASSAGEIROS":{"km_cent":300,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0},
    "CARGA_PESADA":{"km_cent":700,"taxa_fixa_cent":20000}}'::jsonb, now()) ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não publica contrato com categorias');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000, "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb,
  '{"PASSAGEIROS":{"km_cent":300,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0}}'::jsonb, now()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'falta uma das 3 categorias: CAMPOS_INVALIDOS');
select is(api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000, "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb,
  '{"PASSAGEIROS":{"km_cent":-1,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0},
    "CARGA_PESADA":{"km_cent":700,"taxa_fixa_cent":20000}}'::jsonb, now()) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'preço negativo: CAMPOS_INVALIDOS');
select set_config('t.pub', api.publicar_contrato_categorias('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000, "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb,
  '{"PASSAGEIROS":{"km_cent":300,"taxa_fixa_cent":0},"CARGA_LEVE":{"km_cent":500,"taxa_fixa_cent":0},
    "CARGA_PESADA":{"km_cent":700,"taxa_fixa_cent":20000}}'::jsonb, now())::text, true);
select is(current_setting('t.pub')::jsonb, '{"ok":true,"versao":2}'::jsonb, 'ADM publica a v2 com as 3 categorias (as recusas não criaram versão)');
reset role;
select is((select count(*)::int from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1'), 3, '3 linhas em contratos_categorias, todas da v2');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d2', api.categorias_disponiveis('{"km":10,"levar":true,"trazer":false}'::jsonb)::text, true);
-- Carga Leve: 10 km × 500 = 5000, retorno de 50% = 2500
select is((select (select (l ->> 'valor_cent')::bigint from jsonb_array_elements(x -> 'linhas') l where l ->> 'codigo' = 'KM')
             from jsonb_array_elements(current_setting('t.d2')::jsonb -> 'categorias') x where x ->> 'codigo' = 'CARGA_LEVE'),
  5000::bigint, 'Carga Leve: linha de km = 10 × 500');
select is((select (select (l ->> 'valor_cent')::bigint from jsonb_array_elements(x -> 'linhas') l where l ->> 'codigo' = 'RETORNO')
             from jsonb_array_elements(current_setting('t.d2')::jsonb -> 'categorias') x where x ->> 'codigo' = 'CARGA_LEVE'),
  2500::bigint, 'Carga Leve: mais o retorno do contrato');
select is((select (x ->> 'total_cent')::bigint from jsonb_array_elements(current_setting('t.d2')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'PASSAGEIROS'), 4500::bigint, 'Passageiros: 10 × 300 + retorno');
select is((select string_agg(l ->> 'codigo' || '=' || (l ->> 'valor_cent'), ',' order by l ->> 'codigo')
             from jsonb_array_elements(current_setting('t.d2')::jsonb -> 'categorias') x, jsonb_array_elements(x -> 'linhas') l
            where x ->> 'codigo' = 'CARGA_PESADA'),
  'KM_COM_REBOQUE=7000,REBOQUE=20000,RETORNO=3500', 'Carga Pesada: km com reboque 700, taxa 20000 da categoria');

------------------------------------------------------------------ 5. situação do veículo
select is(api.mudar_situacao_veiculo(current_setting('t.v1')::uuid, 'MANUTENCAO') ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não muda a situação');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.mudar_situacao_veiculo(current_setting('t.v1')::uuid, 'QUEBRADO') ->> 'codigo', 'VEICULO_INVALIDO',
  'situação desconhecida: VEICULO_INVALIDO');
select is(api.mudar_situacao_veiculo(current_setting('t.v1')::uuid, 'MANUTENCAO') ->> 'ok', 'true', 'motorista põe o próprio em manutenção');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.d3', api.categorias_disponiveis('{"km":10,"levar":true,"trazer":false}'::jsonb)::text, true);
select is((select string_agg(x ->> 'codigo', ',' order by x ->> 'codigo') from jsonb_array_elements(current_setting('t.d3')::jsonb -> 'categorias') x
            where (x ->> 'disponivel')::boolean), 'CARGA_PESADA', 'veículo em manutenção: Passageiros e Carga Leve indisponíveis');
select is((select x -> 'total_cent' from jsonb_array_elements(current_setting('t.d3')::jsonb -> 'categorias') x
            where x ->> 'codigo' = 'CARGA_LEVE'), 'null'::jsonb, 'categoria indisponível sem preço');

------------------------------------------------------------------ 6. categorias (ADM)
select is(api.salvar_categoria('{"codigo":"CARGA_LEVE","nome":"IVO Carga Leve","descricao_curta":"até 800 kg","ordem":2,"ativa":true}'::jsonb)
  ->> 'codigo', 'SEM_PERMISSAO', 'cliente não salva categoria');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.salvar_categoria('{"codigo":"CARGA_LEVE","nome":"IVO Carga Leve","descricao_curta":"até 900 kg","ordem":2,"ativa":false}'::jsonb)
  ->> 'ok', 'true', 'ADM salva categoria');
select is(api.salvar_categoria('{"codigo":"MOTO","nome":"IVO Moto","descricao_curta":"1 pessoa","ordem":4,"ativa":true}'::jsonb)
  ->> 'codigo', 'NAO_ENCONTRADO', 'categoria nova não se cria');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is((select string_agg(x ->> 'codigo', ',') from jsonb_array_elements(
    api.categorias_disponiveis('{"km":10,"levar":true,"trazer":false}'::jsonb) -> 'categorias') x),
  'PASSAGEIROS,CARGA_PESADA', 'categoria inativa sai da lista');
reset role;
select is((select nome || '|' || descricao_curta || '|' || carga::text || '|' || reboque::text from app.categorias where codigo = 'CARGA_LEVE'),
  'IVO Carga Leve|até 900 kg|EQUIPAMENTO|SIM', 'categoria alterada; carga e reboque intocados');

------------------------------------------------------------------ 7. imutabilidade
select throws_ok($$update app.contratos_categorias set km_cent = 1$$, '42501', null, 'contratos_categorias é imutável (update)');
select throws_ok($$delete from app.contratos_categorias$$, '42501', null, 'contratos_categorias é imutável (delete)');

select * from finish();
rollback;
