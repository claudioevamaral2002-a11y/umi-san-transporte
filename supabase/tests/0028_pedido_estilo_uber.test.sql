-- Fase 4, Tarefa 2 (migration 20261020120100_pedido_estilo_uber.sql): pedido por categoria, "Agora", proposta de outro
-- valor (ajuste do motorista), confirmação com centro de custo, avaliação e atraso automático pela chegada prevista.
-- Cobre: criar com categoria (gravada, inconsistente com a categoria, categoria sem veículo); "Agora" (prazos de 15 min,
-- janela do início, o caso das 23h30 que não expira na criação); orçar com categoria (preço da categoria, veículo
-- obrigatório, ativo e da categoria); ajuste no limite exato e um centavo além; motivo; validade do "Agora";
-- confirmar_corrida (centro de custo, reserva, hash errado); centro de custo no extrato; avaliação; atraso automático
-- (marca, ignora mudança de até 5 min, limpa); api.pedido (veículo a partir de ORCADA, última posição) e pendências.
-- Compatibilidade do app atual (pedido e orçamento sem os campos novos) também é conferida.
begin;
create extension if not exists pgtap with schema extensions;
select plan(85);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Passageiro A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local');
update app.perfis set senha_pendente = false;

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');
-- Preço por categoria nesta versão: Passageiros a 300/km (o pedido sem categoria segue nos 250/km do contrato).
insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
select c.id, k.codigo, k.km, k.taxa
  from app.contratos_versoes c,
       (values ('PASSAGEIROS', 300, 0), ('CARGA_LEVE', 500, 0), ('CARGA_PESADA', 700, 20000)) k(codigo, km, taxa)
 where c.empresa_id = '00000000-0000-0000-0000-0000000000e1';
-- Veículos do motorista: v1 atende Passageiros; v2 só Carga Leve. Ninguém atende Carga Pesada.
insert into app.veiculos (id, motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'Corolla', 'Prata', 'ABC1D23', 4, 300,
   array['PASSAGEIROS']),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'Strada', 'Branca', 'XYZ9K88', 2, 600,
   array['CARGA_LEVE']);

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4', 'a5', 'a6']) u;
select set_config('t.base', '{"duracao_min": 30, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.equip', '{"duracao_min": 30, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "EQUIPAMENTO", "equipamento_desc": "Gerador portátil", "modalidade": "VEICULO_PROPRIO",
  "reboque": "NAO"}', true);
-- pc [+5 min, +35 min) categoria; pa [+61 min) "Agora"; pd [+95 min) sem campos novos; pb [+20 h) "Agora" das 23h30.
select set_config('t.i_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('pc', interval '5 minutes'), ('pa', interval '61 minutes'), ('pd', interval '95 minutes'),
             ('pb', interval '20 hours'), ('p30', interval '30 minutes'), ('px', interval '3 hours')) x(n, d);
select set_config('t.eta_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('marca', interval '40 minutes'), ('perto', interval '42 minutes'), ('limpa', interval '10 minutes')) x(n, d);

------------------------------------------------------------------ 1. criar com categoria e "Agora"
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.r_pc', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_pc'), 'categoria', 'PASSAGEIROS'))::text, true);
select set_config('t.r_pd', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_pd')))::text, true);
select set_config('t.r_pa', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_pa'), 'categoria', 'PASSAGEIROS', 'agora', true))::text, true);
select set_config('t.r_pb', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_pb'), 'categoria', 'PASSAGEIROS', 'agora', true))::text, true);
select is(api.criar_pedido(current_setting('t.equip')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'categoria', 'PASSAGEIROS')) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'Passageiros com carga EQUIPAMENTO: CAMPOS_INVALIDOS');
select is(api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'categoria', 'PASSAGEIROS', 'modalidade', 'VEICULO_CLIENTE'))
  ->> 'codigo', 'CAMPOS_INVALIDOS', 'categoria com veículo do cliente: CAMPOS_INVALIDOS');
select is(api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'categoria', 'MOTO')) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'categoria desconhecida: CAMPOS_INVALIDOS');
select is(api.criar_pedido(current_setting('t.equip')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'categoria', 'CARGA_PESADA', 'reboque', 'SIM')) ->> 'codigo',
  'CATEGORIA_INDISPONIVEL', 'categoria sem veículo: CATEGORIA_INDISPONIVEL');
select is(api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p30'), 'categoria', 'PASSAGEIROS', 'agora', true)) ->> 'codigo',
  'CAMPOS_INVALIDOS', '"Agora" com início em 30 min: CAMPOS_INVALIDOS');
select is(api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_px'), 'agora', 'sim')) ->> 'codigo',
  'CAMPOS_INVALIDOS', '"agora" que não é booleano: CAMPOS_INVALIDOS');
reset role;
select ok((current_setting('t.r_pc')::jsonb ->> 'ok')::boolean and (current_setting('t.r_pd')::jsonb ->> 'ok')::boolean
          and (current_setting('t.r_pa')::jsonb ->> 'ok')::boolean and (current_setting('t.r_pb')::jsonb ->> 'ok')::boolean,
  'os 4 pedidos válidos foram criados');
select set_config('t.' || n, current_setting('t.r_' || n)::jsonb ->> 'id', true) from unnest(array['pc', 'pd', 'pa', 'pb']) n;

select is((select categoria || ':' || agora::text from app.atividades where id = current_setting('t.pc')::uuid),
  'PASSAGEIROS:false', 'pedido com categoria: categoria gravada, agora=false');
select ok((select categoria is null and not agora and veiculo_id is null and centro_custo is null and avaliacao is null
             and prazo_orcar_ate = least(now() + interval '12 hours', inicio)
             from app.atividades where id = current_setting('t.pd')::uuid),
  'pedido sem campos novos: igual a hoje (sem categoria, prazo do contrato)');
select is((select detalhe -> 'invalidos' from app.auditoria
            where acao = 'CRIAR_PEDIDO' and codigo = 'CAMPOS_INVALIDOS' order by id limit 1),
  '["categoria"]'::jsonb, 'carga diferente da categoria: detalhe categoria');
select is((select count(*)::int from app.auditoria where acao = 'CRIAR_PEDIDO' and codigo = 'CATEGORIA_INDISPONIVEL'), 1,
  'CATEGORIA_INDISPONIVEL auditado');
select ok((select agora and prazo_orcar_ate <= now() + interval '15 minutes' and prazo_orcar_ate <= inicio
             from app.atividades where id = current_setting('t.pa')::uuid),
  '"Agora" em +61 min: prazo de orçar ≤ agora + 15 min e ≤ início');
select is((select prazo_orcar_ate from app.atividades where id = current_setting('t.pb')::uuid), now() + interval '15 minutes',
  '"Agora" em +20 h (o caso das 23h30): prazo de orçar = agora + 15 min');
select is((current_setting('t.r_pb')::jsonb ->> 'prazo_orcar_ate')::timestamptz, now() + interval '15 minutes',
  'criar_pedido devolve o prazo do "Agora"');
select is((select expira_em from app.agenda_blocos where atividade_id = current_setting('t.pb')::uuid and ativo),
  now() + interval '15 minutes', 'pré-reserva do "Agora" vence junto com o prazo');
select lives_ok($$select interno.expirar_vencidos()$$, 'expirar_vencidos roda na hora da criação');
select is((select status::text from app.atividades where id = current_setting('t.pb')::uuid), 'SOLICITADA',
  '"Agora" das 23h30 não expira na criação');

------------------------------------------------------------------ 2. orçar com categoria: veículo e preço da categoria
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is((api.calcular_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1"}') ->> 'total_cent')::bigint, 4500::bigint,
  'prévia do Orçar com categoria: preço da categoria (10 × 300 + retorno), chaves da corrida ignoradas');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid, '{"km": 10}', null) ->> 'codigo', 'VEICULO_INVALIDO',
  'pedido com categoria sem veículo: VEICULO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b2"}', null) ->> 'codigo', 'VEICULO_INVALIDO',
  'veículo de outra categoria: VEICULO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000ff"}', null) ->> 'codigo', 'VEICULO_INVALIDO',
  'veículo inexistente: VEICULO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "4501", "ajuste_motivo": "Pedágio extra"}',
  null) ->> 'codigo', 'AJUSTE_FORA_DO_LIMITE', '+100% + 1 centavo: AJUSTE_FORA_DO_LIMITE');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "-2251", "ajuste_motivo": "Desconto"}',
  null) ->> 'codigo', 'AJUSTE_FORA_DO_LIMITE', '−50% − 1 centavo: AJUSTE_FORA_DO_LIMITE');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "1000", "ajuste_motivo": "ab"}',
  null) ->> 'codigo', 'MOTIVO_INVALIDO', 'motivo "ab": MOTIVO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "1000"}',
  null) ->> 'codigo', 'MOTIVO_INVALIDO', 'ajuste sem motivo: MOTIVO_INVALIDO');
select is(api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "10,5", "ajuste_motivo": "Pedágio"}',
  null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'ajuste que não é inteiro: CAMPOS_INVALIDOS');
select set_config('t.o_pc1', api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "4500", "ajuste_motivo": " Pedágio extra "}',
  null)::text, true);
reset role;
select is(current_setting('t.o_pc1')::jsonb ->> 'ok', 'true', '+100% exato: ok');
select is((current_setting('t.o_pc1')::jsonb ->> 'total_cent')::bigint, 9000::bigint, '+100%: total = 2 × a tabela');
select is((select l from app.orcamentos o, jsonb_array_elements(o.linhas) l
            where o.atividade_id = current_setting('t.pc')::uuid and o.versao = 1 and l ->> 'codigo' = 'AJUSTE_MOTORISTA'),
  jsonb_build_object('codigo', 'AJUSTE_MOTORISTA', 'descricao', 'Pedágio extra', 'quantidade', 1, 'unitario_cent', 4500,
                     'percentual_bp', null, 'base_cent', null, 'valor_cent', 4500),
  'linha AJUSTE_MOTORISTA com o motivo aparado');
select is((select sum((l ->> 'valor_cent')::bigint) from app.orcamentos o, jsonb_array_elements(o.linhas) l
            where o.atividade_id = current_setting('t.pc')::uuid and o.versao = 1)::bigint, 9000::bigint,
  'total = soma das linhas (tabela + ajuste)');
select ok((select o.hash = interno.hash_orcamento(o, a) from app.orcamentos o join app.atividades a on a.id = o.atividade_id
            where o.atividade_id = current_setting('t.pc')::uuid and o.versao = 1),
  'hash calculado com a linha do ajuste (a aprovação confere)');
select is((select veiculo_id from app.atividades where id = current_setting('t.pc')::uuid),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'veículo gravado no pedido');
select is((select count(*)::int from app.auditoria where acao = 'ENVIAR_ORCAMENTO' and resultado = 'NEGADO'
             and codigo in ('VEICULO_INVALIDO', 'AJUSTE_FORA_DO_LIMITE', 'MOTIVO_INVALIDO')), 7,
  'negações de veículo, ajuste e motivo auditadas');

-- api.pedido: veículo a partir de ORCADA; some quando volta a SOLICITADA
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.v_pc', api.pedido(current_setting('t.pc')::uuid)::text, true);
select is(current_setting('t.v_pc')::jsonb #> '{pedido,veiculo}',
  '{"modelo": "Corolla", "cor": "Prata", "placa": "ABC1D23"}'::jsonb, 'N2 dono vê o veículo a partir de ORCADA');
select is(current_setting('t.v_pc')::jsonb #>> '{pedido,categoria_nome}', 'IVO Passageiros', 'detalhe com o nome da categoria');
select ok((current_setting('t.v_pc')::jsonb #>> '{pedido,categoria}') = 'PASSAGEIROS'
          and (current_setting('t.v_pc')::jsonb #> '{pedido,agora}') = 'false'::jsonb
          and (current_setting('t.v_pc')::jsonb #> '{pedido,centro_custo}') = 'null'::jsonb
          and (current_setting('t.v_pc')::jsonb #> '{pedido,avaliacao}') = 'null'::jsonb
          and (current_setting('t.v_pc')::jsonb #> '{pedido,ultima_posicao}') = 'null'::jsonb,
  'detalhe com categoria, agora, centro_custo, avaliacao e ultima_posicao');
select is(api.pedir_revisao(current_setting('t.pc')::uuid, 'Valor alto demais') ->> 'ok', 'true', 'cliente pede revisão');
select is(api.pedido(current_setting('t.pc')::uuid) #> '{pedido,veiculo}', 'null'::jsonb,
  'de volta a SOLICITADA: veículo não aparece');

select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.o_pc2', api.enviar_orcamento(current_setting('t.pc')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1", "ajuste_cent": "-2250", "ajuste_motivo": "Retorno vazio"}',
  null)::text, true);
select set_config('t.o_pa', api.enviar_orcamento(current_setting('t.pa')::uuid,
  '{"km": 10, "veiculo_id": "00000000-0000-0000-0000-0000000000b1"}', null)::text, true);
select set_config('t.o_pd', api.enviar_orcamento(current_setting('t.pd')::uuid, '{"km": 10}', null)::text, true);
reset role;
select is(current_setting('t.o_pc2')::jsonb ->> 'ok', 'true', '−50% exato: ok');
select is((current_setting('t.o_pc2')::jsonb ->> 'total_cent')::bigint, 2250::bigint, '−50%: total = metade da tabela');
select ok((current_setting('t.o_pa')::jsonb ->> 'valido_ate')::timestamptz <= now() + interval '15 minutes'
          and (select valido_ate <= now() + interval '15 minutes' from app.orcamentos
                where atividade_id = current_setting('t.pa')::uuid and status = 'PENDENTE'),
  '"Agora": validade do orçamento ≤ agora + 15 min');
select is((select expira_em from app.agenda_blocos where atividade_id = current_setting('t.pa')::uuid and ativo),
  (current_setting('t.o_pa')::jsonb ->> 'valido_ate')::timestamptz, '"Agora": pré-reserva vence com o orçamento');
select is((current_setting('t.o_pd')::jsonb ->> 'total_cent')::bigint, 3750::bigint,
  'sem categoria e sem veículo: igual a hoje (preço do contrato, 10 × 250 + retorno)');
select ok((select veiculo_id is null and not exists (select 1 from jsonb_array_elements(o.linhas) l
                                                      where l ->> 'codigo' = 'AJUSTE_MOTORISTA')
             from app.atividades a join app.orcamentos o on o.atividade_id = a.id and o.status = 'PENDENTE'
            where a.id = current_setting('t.pd')::uuid),
  'sem categoria: sem veículo e sem linha de ajuste');
select ok((select valido_ate = least(now() + interval '24 hours', a.inicio)
             from app.orcamentos o join app.atividades a on a.id = o.atividade_id
            where o.atividade_id = current_setting('t.pd')::uuid and o.status = 'PENDENTE'),
  'sem "Agora": validade do contrato, como hoje');

------------------------------------------------------------------ 3. confirmar_corrida
select set_config('t.h_pc', (select hash from app.orcamentos where atividade_id = current_setting('t.pc')::uuid
                                and status = 'PENDENTE'), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 1000000, 'Pix inicial', null, gen_random_uuid()) ->> 'ok',
  'true', 'recarga');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.confirmar_corrida(current_setting('t.pc')::uuid, 2, current_setting('t.h_pc'), gen_random_uuid(), null, null)
  ->> 'codigo', 'SEM_PERMISSAO', 'N3 não confirma');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.confirmar_corrida(current_setting('t.pc')::uuid, 2, current_setting('t.h_pc'), gen_random_uuid(),
  repeat('x', 81), null) ->> 'codigo', 'CENTRO_CUSTO_INVALIDO', 'centro de custo com 81 caracteres: CENTRO_CUSTO_INVALIDO');
reset role;
select is((select count(*)::int from app.reservas where atividade_id = current_setting('t.pc')::uuid), 0,
  '81 caracteres: nenhuma reserva');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.confirmar_corrida(current_setting('t.pc')::uuid, 2, repeat('0', 64), gen_random_uuid(), 'Operações 4.100', null)
  ->> 'codigo', 'ORCAMENTO_ALTERADO', 'hash errado: o código da aprovação');
reset role;
select ok((select centro_custo is null and status = 'ORCADA' from app.atividades where id = current_setting('t.pc')::uuid),
  'hash errado: centro de custo continua nulo');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.k_pc', gen_random_uuid()::text, true);
select set_config('t.cf', api.confirmar_corrida(current_setting('t.pc')::uuid, 2, current_setting('t.h_pc'),
  current_setting('t.k_pc')::uuid, '  Operações 4.100  ', null)::text, true);
select is(api.confirmar_corrida(current_setting('t.pc')::uuid, 2, current_setting('t.h_pc'),
  current_setting('t.k_pc')::uuid, 'Outro centro', null), current_setting('t.cf')::jsonb,
  'mesma chave: o resultado original');
reset role;
select ok((current_setting('t.cf')::jsonb ->> 'ok')::boolean
          and (current_setting('t.cf')::jsonb ->> 'reservado_cent')::bigint = 2250,
  'confirmar_corrida devolve o resultado da aprovação');
select is((select centro_custo from app.atividades where id = current_setting('t.pc')::uuid), 'Operações 4.100',
  'centro de custo gravado (aparado; a repetição não troca)');
select is((select status::text from app.atividades where id = current_setting('t.pc')::uuid), 'AGENDADA', 'passa a AGENDADA');
select is((select count(*)::int from app.lancamentos where atividade_id = current_setting('t.pc')::uuid and tipo = 'RESERVA'
             and valor_cent = 2250), 1, 'lança uma RESERVA do total com ajuste');
select is((select count(*)::int from app.auditoria where acao = 'CONFIRMAR_CORRIDA' and codigo = 'CENTRO_CUSTO_INVALIDO'), 1,
  'CENTRO_CUSTO_INVALIDO auditado');

------------------------------------------------------------------ 4. saída, extrato e atraso automático
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_saida(current_setting('t.pc')::uuid, gen_random_uuid()) ->> 'ok', 'true', 'motorista sai');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is((select x -> 'centro_custo' from jsonb_array_elements(api.extrato(null, '{}') -> 'itens') x
            where x ->> 'tipo' = 'DEBITO'), '"Operações 4.100"'::jsonb, 'extrato: o DEBITO traz o centro de custo');
select ok((select bool_and(not (x ? 'centro_custo')) from jsonb_array_elements(api.extrato(null, '{}') -> 'itens') x
            where x ->> 'tipo' = 'RECARGA'), 'lançamento sem pedido: sem centro de custo');

select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_posicao(current_setting('t.pc')::uuid,
  jsonb_build_object('lat', -26.9, 'lng', -48.66, 'eta', current_setting('t.eta_marca'))) ->> 'ok', 'true',
  'posição com chegada prevista');
reset role;
select is((select atraso_anterior_ate from app.atividades where id = current_setting('t.pa')::uuid),
  now() + interval '70 minutes', 'chegada + duração restante depois do início do próximo: próximo marcado');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_posicao(current_setting('t.pc')::uuid,
  jsonb_build_object('lat', -26.9, 'lng', -48.66, 'eta', current_setting('t.eta_perto'))) ->> 'ok', 'true',
  'nova posição com chegada 2 min depois');
reset role;
select is((select atraso_anterior_ate from app.atividades where id = current_setting('t.pa')::uuid),
  now() + interval '70 minutes', 'mudança de até 5 min: não remarca');
select ok((select atraso_anterior_ate is null from app.atividades where id = current_setting('t.pb')::uuid)
          and (select atraso_anterior_ate is null from app.atividades where id = current_setting('t.pd')::uuid),
  'só o próximo é marcado');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.v_n1', api.pedido(current_setting('t.pc')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.v_n3', api.pedido(current_setting('t.pc')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_posicao(current_setting('t.pc')::uuid,
  jsonb_build_object('lat', -26.9, 'lng', -48.66, 'eta', current_setting('t.eta_limpa'))) ->> 'ok', 'true',
  'posição com chegada antes do próximo');
reset role;
select ok((select atraso_anterior_ate is null from app.atividades where id = current_setting('t.pa')::uuid),
  'chegada volta para antes do início do próximo: marcação limpa');
select ok((current_setting('t.v_n1')::jsonb #>> '{pedido,ultima_posicao,lat}')::numeric = -26.9
          and (current_setting('t.v_n1')::jsonb #>> '{pedido,ultima_posicao,em}') is not null,
  'N1 em andamento: última posição gravada');
select is(current_setting('t.v_n3')::jsonb #> '{pedido,ultima_posicao}', 'null'::jsonb, 'N3: sem última posição');

------------------------------------------------------------------ 5. pendências
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is((select jsonb_build_object('agora', x -> 'agora', 'categoria_nome', x -> 'categoria_nome')
             from jsonb_array_elements(api.pendencias() -> 'aguardando_orcamento') x where x ->> 'id' = current_setting('t.pb')),
  '{"agora": true, "categoria_nome": "IVO Passageiros"}'::jsonb, 'pendências: item com categoria_nome e agora');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is((select jsonb_build_object('agora', x -> 'agora', 'categoria_nome', x -> 'categoria_nome')
             from jsonb_array_elements(api.pendencias() -> 'aguardando_aprovacao') x where x ->> 'id' = current_setting('t.pd')),
  '{"agora": false, "categoria_nome": null}'::jsonb, 'pendências: pedido sem categoria');

------------------------------------------------------------------ 6. avaliação
select is(api.avaliar(current_setting('t.pd')::uuid, 5, null) ->> 'codigo', 'STATUS_INVALIDO', 'antes de concluir: STATUS_INVALIDO');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.concluir(current_setting('t.pc')::uuid, null) ->> 'ok', 'true', 'motorista conclui');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.avaliar(current_setting('t.pc')::uuid, 5, null) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não avalia');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.avaliar(current_setting('t.pc')::uuid, 5, null) ->> 'codigo', 'SEM_PERMISSAO', 'motorista não avalia');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.avaliar(current_setting('t.pc')::uuid, 6, null) ->> 'codigo', 'NOTA_INVALIDA', 'nota 6: NOTA_INVALIDA');
select is(api.avaliar(current_setting('t.pc')::uuid, 4, repeat('x', 501)) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'comentário acima de 500: CAMPOS_INVALIDOS');
select is(api.pedido(current_setting('t.pc')::uuid) #> '{acoes,avaliar}', 'true'::jsonb, 'concluída: dono pode avaliar');
select is(api.avaliar(current_setting('t.pc')::uuid, 5, '  Pontual  ') ->> 'ok', 'true', 'dono avalia');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.avaliar(current_setting('t.pc')::uuid, 4, null) ->> 'codigo', 'JA_AVALIADO', 'segunda avaliação: JA_AVALIADO');
select ok((api.pedido(current_setting('t.pc')::uuid) #>> '{pedido,avaliacao}')::int = 5
          and not (api.pedido(current_setting('t.pc')::uuid) #>> '{acoes,avaliar}')::boolean,
  'detalhe com a nota; avaliar some');
reset role;
select is((select avaliacao || '|' || avaliacao_comentario from app.atividades where id = current_setting('t.pc')::uuid),
  '5|Pontual', 'nota e comentário aparado gravados');
select ok((select avaliado_em is not null from app.atividades where id = current_setting('t.pc')::uuid), 'avaliado_em gravado');
select is((select count(*)::int from app.auditoria where acao = 'AVALIAR' and resultado = 'NEGADO'), 6,
  'negações da avaliação auditadas');

------------------------------------------------------------------ 7. reconciliação
select is(interno.reconciliar() -> 'divergencias', '[]'::jsonb, 'reconciliação limpa depois do ajuste, confirmação e saída');

select * from finish();
rollback;
