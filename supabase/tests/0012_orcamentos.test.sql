-- Fase 2A, Task 2 (migration 20261009130200_orcamentos.sql): cálculo no servidor a partir do contrato (cada
-- modalidade, retorno em trecho único, reboque, espera, outros, arredondamento meio-para-cima, campos
-- incompatíveis, preço nunca vem da entrada), snapshot/hash, imutabilidade, calcular/enviar_orcamento,
-- pedir_revisao, reprovar_orcamento, fechamento do orçamento nas transições e permissões por papel/nível.
begin;
create extension if not exists pgtap with schema extensions;
select plan(99);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n1a@teste.local',  'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local',  'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local',  'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('mot2@teste.local', 'Motorista Dois',  'MOTORISTA',    null, null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot2@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set criado_em = now() + interval '1 minute' where usuario_id = '00000000-0000-0000-0000-0000000000a9';

select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 6, "multa_bp": 5000},
                          {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', current_setting('t.base')::jsonb, now(), null, 'Teste');
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e2', current_setting('t.base')::jsonb, now(), null, 'Teste');
select set_config('t.cid', (select id::text from app.contratos_versoes where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);

select set_config('t.ped', '{"duracao_min": 120, "origem": "Porto de Itajaí", "destino": "Base Navegantes",
  "levar": true, "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 3, "modalidade": "VEICULO_PROPRIO",
  "reboque": "NAO"}', true);
select set_config('t.' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), true)
from (values ('d2', interval '2 days'), ('h5', interval '5 hours'), ('d3', interval '3 days'), ('d4', interval '4 days'),
             ('d5', interval '5 days'), ('d6', interval '6 days'), ('d7', interval '7 days'), ('d8', interval '8 days'))
     x(n, d);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) u;

------------------------------------------------------------------ cálculo (interno.calcular_linhas, contrato da Empresa A)
create function pg_temp.calc(p_levar boolean, p_trazer boolean, p_mod app.modalidade, e jsonb, p_ajuste jsonb default '{}')
returns jsonb language sql as $$
  select interno.calcular_linhas(jsonb_populate_record(c, p_ajuste), p_levar, p_trazer, p_mod, e)
  from app.contratos_versoes c where c.id = current_setting('t.cid')::bigint
$$;

select is(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 100}') -> 'total_cent', '37500'::jsonb,
  'só Levar: 100 km × R$ 2,50 + retorno 50% = R$ 375,00');
select is(jsonb_path_query_array(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 100}'), '$.linhas[*].codigo'),
  '["KM", "RETORNO"]'::jsonb, 'trecho único: linha de km + linha própria de retorno');
select is(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 100}') -> 'linhas' -> 1 ->> 'descricao', 'Retorno (50%)',
  'retorno descrito com o percentual do contrato');
select is(pg_temp.calc(false, true, 'VEICULO_PROPRIO', '{"km": 100}') -> 'total_cent', '37500'::jsonb,
  'só Trazer também é trecho único (com retorno)');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 100}'),
  '{"ok": true, "modalidade": "VEICULO_PROPRIO", "total_cent": 25000, "linhas": [{"codigo": "KM",
    "descricao": "Km rodados (ida e volta)", "quantidade": 100, "unitario_cent": 250, "percentual_bp": null,
    "base_cent": null, "valor_cent": 25000}]}'::jsonb,
  'Levar+Trazer: km já é ida e volta (sem retorno); memorial completo');
select is(jsonb_path_query_array(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10, "usa_reboque": true}'),
                                 '$.linhas[*].valor_cent'),
  '[3500, 15000]'::jsonb, 'reboque: km com reboque (R$ 3,50) + taxa fixa');
select is(jsonb_path_query_array(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10, "usa_reboque": true}'), '$.linhas[*].codigo'),
  '["KM_COM_REBOQUE", "REBOQUE"]'::jsonb, 'reboque: linhas KM_COM_REBOQUE e REBOQUE');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"espera_horas": 1.5}') -> 'total_cent', '7500'::jsonb,
  'espera: 1,5 h × R$ 50,00');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"espera_horas": 1.25}') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'espera fora de 0,5 em 0,5 recusada');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"pedagio_cent": 1234, "hospedagem_diarias": 2}') -> 'total_cent',
  '37234'::jsonb, 'pedágio (valor informado) + 2 diárias de hospedagem do contrato');
select is(pg_temp.calc(true, true, 'VEICULO_CLIENTE', '{"diarias": 2}') -> 'total_cent', '60000'::jsonb,
  'veículo do cliente: 2 diárias do motorista');
select is(pg_temp.calc(true, true, 'VEICULO_CLIENTE', '{"diarias": 1, "km": 10}') ->> 'codigo', 'CAMPOS_INCOMPATIVEIS',
  'veículo do cliente com km: CAMPOS_INCOMPATIVEIS');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10, "diarias": 1}') ->> 'codigo', 'CAMPOS_INCOMPATIVEIS',
  'veículo próprio com diárias: CAMPOS_INCOMPATIVEIS');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"modalidade": "VEICULO_CLIENTE", "diarias": 1}') - 'linhas',
  '{"ok": true, "modalidade": "VEICULO_CLIENTE", "total_cent": 30000}'::jsonb, 'o motorista pode trocar a modalidade');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO',
  '{"outros": [{"descricao": "Estacionamento", "valor_cent": 2500}, {"descricao": "Lavagem", "valor_cent": 3000}]}') -> 'total_cent',
  '5500'::jsonb, 'outros: somados');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"outros": [{"descricao": " Estacionamento ", "valor_cent": 2500}]}')
  -> 'linhas' -> 0 ->> 'descricao', 'Outros: Estacionamento', 'outros: descrição no memorial');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"outros": [{"descricao": "ab", "valor_cent": 2500}]}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'outros: descrição curta recusada');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', jsonb_build_object('outros',
  (select jsonb_agg(jsonb_build_object('descricao', 'Item ' || i, 'valor_cent', 100)) from generate_series(1, 6) i))) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'outros: no máximo 5');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"outros": [{"descricao": "Brinde", "valor_cent": 0}]}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'outros: valor precisa ser > 0');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10, "km_sem_reboque_cent": 1}') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'preço na entrada é recusado');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"outros": [{"descricao": "Taxa", "valor_cent": 100, "unitario_cent": 1}]}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo extra em "outros" recusado');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10}') -> 'linhas' -> 0 -> 'unitario_cent', '250'::jsonb,
  'preço unitário vem do contrato');
select is(jsonb_path_query_array(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 0.5}', '{"km_sem_reboque_cent": 333}'),
                                 '$.linhas[*].valor_cent'),
  '[167, 84]'::jsonb, 'meio para cima por linha: 0,5 × 333 = 166,5 → 167; 50% de 167 = 83,5 → 84');
select is(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 0.5}', '{"km_sem_reboque_cent": 333}') -> 'total_cent', '251'::jsonb,
  'total = soma das linhas já arredondadas');
select is(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 100}', '{"retorno_trecho_unico_bp": 2550}') -> 'linhas' -> 1,
  '{"codigo": "RETORNO", "descricao": "Retorno (25,5%)", "quantidade": null, "unitario_cent": null, "percentual_bp": 2550,
    "base_cent": 25000, "valor_cent": 6375}'::jsonb,
  'retorno: percentual sobre os centavos da linha de km');
select is(pg_temp.calc(true, false, 'VEICULO_PROPRIO', '{"km": 10}', '{"retorno_trecho_unico_bp": 0}') -> 'linhas',
  '[{"codigo": "KM", "descricao": "Km rodados (trecho único)", "quantidade": 10, "unitario_cent": 250, "percentual_bp": null,
     "base_cent": null, "valor_cent": 2500}]'::jsonb,
  'retorno 0% não gera linha');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": 10.25}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'km com 2 casas recusado');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{"km": "10"}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'km em texto recusado');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '{}'),
  '{"ok": true, "modalidade": "VEICULO_PROPRIO", "linhas": [], "total_cent": 0}'::jsonb, 'entrada vazia: sem linhas, total zero');
select is(pg_temp.calc(true, true, 'VEICULO_PROPRIO', '[]') ->> 'codigo', 'CAMPOS_INVALIDOS', 'entrada que não é objeto recusada');
select is(interno.calcular_linhas(null::app.contratos_versoes, true, true, 'VEICULO_PROPRIO', '{}') ->> 'codigo', 'SEM_CONTRATO',
  'sem contrato: SEM_CONTRATO');
select ok(interno.arred(2.5) = 3 and interno.arred(2.4999) = 2 and interno.arred(0) = 0, 'arred: meio para cima');

------------------------------------------------------------------ pedidos de teste (cliente N2 da Empresa A)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.q' || n, api.criar_pedido(current_setting('t.ped')::jsonb || jsonb_build_object('inicio', current_setting('t.' || d))) ->> 'id', true)
from (values ('1', 'd2'), ('2', 'h5'), ('3', 'd3'), ('4', 'd4'), ('5', 'd5'), ('6', 'd6'), ('7', 'd7'), ('8', 'd8')) x(n, d);
reset role;
select is((select count(*)::int from app.atividades where status = 'SOLICITADA'), 8, '8 pedidos SOLICITADA para os testes');

------------------------------------------------------------------ calcular_orcamento (prévia)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') ->> 'codigo', 'SEM_PERMISSAO',
  'prévia: motorista não atribuído não calcula');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') ->> 'codigo', 'SEM_PERMISSAO',
  'prévia: cliente não calcula');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') ->> 'codigo', 'SEM_PERMISSAO',
  'prévia: gestor de frota não calcula (não vê preço)');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') - 'linhas',
  jsonb_build_object('ok', true, 'modalidade', 'VEICULO_PROPRIO', 'total_cent', 37500, 'valido_ate', now() + interval '24 hours'),
  'prévia do motorista atribuído: total e validade');
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"diarias": 1}') ->> 'codigo', 'CAMPOS_INCOMPATIVEIS',
  'prévia: campos incompatíveis');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') ->> 'total_cent', '37500', 'prévia do ADM');
reset role;
select is((select count(*)::int from app.orcamentos), 0, 'prévia não grava orçamento');
select is((select count(*)::int from app.auditoria where acao = 'CALCULAR_ORCAMENTO' and resultado = 'NEGADO'), 4,
  'negações da prévia auditadas');

------------------------------------------------------------------ enviar_orcamento
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null) ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não envia orçamento');
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null) ->> 'codigo', 'SEM_PERMISSAO',
  'motorista não atribuído não envia');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', now() - interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'horário sugerido no passado recusado');
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100, "km_sem_reboque_cent": 1}', null) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'envio com preço na entrada recusado');
select set_config('t.r', api.enviar_orcamento(current_setting('t.q1')::uuid,
  '{"km": 100, "pedagio_cent": 1500, "outros": [{"descricao": "Estacionamento", "valor_cent": 2500}]}',
  now() + interval '3 days')::text, true);
select is(current_setting('t.r')::jsonb - 'orcamento_id',
  jsonb_build_object('ok', true, 'versao', 1, 'total_cent', 41500, 'valido_ate', now() + interval '24 hours'),
  'motorista atribuído envia: versão 1, total calculado no servidor');
select set_config('t.o1', current_setting('t.r')::jsonb ->> 'orcamento_id', true);
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null) ->> 'codigo', 'STATUS_INVALIDO',
  'segundo envio sobre ORCADA: STATUS_INVALIDO');
select is(api.calcular_orcamento(current_setting('t.q1')::uuid, '{"km": 100}') ->> 'codigo', 'STATUS_INVALIDO',
  'prévia sobre ORCADA: STATUS_INVALIDO');
select set_config('t.r', api.enviar_orcamento(current_setting('t.q2')::uuid, '{"km": 10}', null)::text, true);
reset role;
select is((current_setting('t.r')::jsonb ->> 'valido_ate')::timestamptz,
  (select inicio from app.atividades where id = current_setting('t.q2')::uuid), 'validade nunca passa do início');

select ok((select status = 'ORCADA' from app.atividades where id = current_setting('t.q1')::uuid)
          and exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.q1')::uuid
                      and de = 'SOLICITADA' and para = 'ORCADA' and por = '00000000-0000-0000-0000-0000000000a2'),
  'atividade ORCADA, com histórico');
select ok((select status = 'PENDENTE' and versao = 1 and modalidade = 'VEICULO_PROPRIO' and contrato_versao = 1
                  and enviado_por = '00000000-0000-0000-0000-0000000000a2' and horario_sugerido = now() + interval '3 days'
                  and entrada ->> 'km' = '100'
                  and jsonb_path_query_array(linhas, '$[*].codigo') = '["KM", "RETORNO", "PEDAGIO", "OUTROS"]'::jsonb
           from app.orcamentos where id = current_setting('t.o1')::uuid),
  'orçamento PENDENTE com memorial, entrada, contrato e horário sugerido');
select is((select snapshot from app.orcamentos where id = current_setting('t.o1')::uuid),
  (select interno.snapshot_contrato(c) from app.contratos_versoes c where c.id = current_setting('t.cid')::bigint),
  'snapshot = cópia do contrato vigente');
select ok((select snapshot ? 'faixas_cancelamento' and jsonb_array_length(snapshot -> 'faixas_cancelamento') = 3
                  and snapshot ? 'limite_saldo_negativo_cent' and snapshot ? 'validade_orcamento_horas'
           from app.orcamentos where id = current_setting('t.o1')::uuid),
  'snapshot traz TODO o contrato, inclusive as faixas de cancelamento');
select is((select o.hash from app.orcamentos o where o.id = current_setting('t.o1')::uuid),
  (select interno.hash_orcamento(o, a) from app.orcamentos o join app.atividades a on a.id = o.atividade_id
    where o.id = current_setting('t.o1')::uuid),
  'hash = sha256 do conteúdo canônico (recalculável)');
select isnt((select interno.hash_orcamento(jsonb_populate_record(o, '{"total_cent": 41501}'), a)
             from app.orcamentos o join app.atividades a on a.id = o.atividade_id where o.id = current_setting('t.o1')::uuid),
  (select o.hash from app.orcamentos o where o.id = current_setting('t.o1')::uuid),
  'hash muda se o conteúdo muda');
select ok((select b.ativo and b.expira_em = o.valido_ate
           from app.agenda_blocos b join app.orcamentos o on o.atividade_id = b.atividade_id
           where o.id = current_setting('t.o1')::uuid),
  'pré-reserva estendida até a validade do orçamento');
select ok(exists (select 1 from app.auditoria where acao = 'ENVIAR_ORCAMENTO' and resultado = 'OK'
                  and alvo = 'atividade:' || current_setting('t.q1')
                  and detalhe ->> 'hash' = (select hash from app.orcamentos where id = current_setting('t.o1')::uuid)
                  and (detalhe ->> 'total_cent')::int = 41500),
  'envio auditado com total e hash');
select throws_ok(format('update app.orcamentos set total_cent = 1 where id = %L', current_setting('t.o1')), '42501', null,
  'orçamento imutável (valores)');
select throws_ok(format('delete from app.orcamentos where id = %L', current_setting('t.o1')), '42501', null,
  'orçamento não pode ser apagado');

-- contrato novo publicado depois: o orçamento enviado não muda; o próximo usa o novo preço
select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1',
  current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 999}', now(), null, 'Teste');
select is((select (snapshot ->> 'km_sem_reboque_cent')::int from app.orcamentos where id = current_setting('t.o1')::uuid), 250,
  'contrato novo não altera o snapshot do orçamento enviado');

------------------------------------------------------------------ pedir_revisao
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Revisar valores') ->> 'codigo', 'SEM_PERMISSAO', 'N3 não pede revisão');
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Revisar valores') ->> 'codigo', 'SEM_PERMISSAO',
  'N2 não pede revisão de pedido de colega');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Revisar valores') ->> 'codigo', 'SEM_PERMISSAO',
  'N1 de outra empresa não pede revisão');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Revisar valores') ->> 'codigo', 'SEM_PERMISSAO',
  'motorista não pede revisão');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, '') ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'revisão exige motivo');
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Valor acima do esperado') -> 'ok', 'true'::jsonb,
  'dono pede revisão');
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'De novo') ->> 'codigo', 'STATUS_INVALIDO',
  'revisão sobre SOLICITADA: STATUS_INVALIDO');
reset role;
select ok((select a.status = 'SOLICITADA' and o.status = 'SUBSTITUIDO'
           from app.atividades a join app.orcamentos o on o.atividade_id = a.id where o.id = current_setting('t.o1')::uuid),
  'revisão: atividade volta a SOLICITADA e o orçamento fica SUBSTITUIDO');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.q1')::uuid
                  and de = 'ORCADA' and para = 'SOLICITADA' and observacao = 'Valor acima do esperado'
                  and por = '00000000-0000-0000-0000-0000000000a5'),
  'histórico da revisão com motivo e autor');
select ok((select a.prazo_orcar_ate = now() + interval '12 hours' and b.expira_em = a.prazo_orcar_ate and b.ativo
           from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = current_setting('t.q1')::uuid),
  'revisão: novo prazo de orçar, pré-reserva mantida');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null) ->> 'versao', '2', 'reenvio: versão 2');
reset role;
select is((select count(*)::int from app.orcamentos where atividade_id = current_setting('t.q1')::uuid and status = 'PENDENTE'), 1,
  'no máximo 1 orçamento PENDENTE por atividade');
select ok((select versao = 2 and contrato_versao = 2 and (linhas -> 0 ->> 'unitario_cent')::int = 999 and total_cent = 149850
           from app.orcamentos where atividade_id = current_setting('t.q1')::uuid and status = 'PENDENTE'),
  'versão 2 calculada com o contrato vigente no envio');
select throws_ok(format('update app.orcamentos set status = %L where id = %L', 'PENDENTE', current_setting('t.o1')), '23514', null,
  'status de orçamento só sai de PENDENTE');
insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
values ('00000000-0000-0000-0000-0000000000a5', 'PEDIR_REVISAO', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 10)
on conflict (usuario_id, acao, janela_inicio) do update set contagem = 10;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.pedir_revisao(current_setting('t.q1')::uuid, 'Mais uma revisão') ->> 'codigo', 'LIMITE_EXCEDIDO',
  'pedir_revisao: limite de 10/h');

------------------------------------------------------------------ reprovar_orcamento
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.q3')::uuid, '{"km": 10}', null) ->> 'ok', 'true', 'orçamento de Q3 enviado');
select is(api.enviar_orcamento(current_setting('t.q6')::uuid, '{"km": 10}', null) ->> 'ok', 'true', 'orçamento de Q6 enviado');
select is(api.enviar_orcamento(current_setting('t.q5')::uuid, '{"km": 10}', null) ->> 'ok', 'true', 'orçamento de Q5 enviado');
select is(api.enviar_orcamento(current_setting('t.q8')::uuid, '{"km": 10}', null) ->> 'ok', 'true', 'orçamento de Q8 enviado');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(api.reprovar_orcamento(current_setting('t.q3')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não reprova');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.reprovar_orcamento(current_setting('t.q3')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO', 'ADM não reprova pelo cliente');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select is(api.reprovar_orcamento(current_setting('t.q3')::uuid, 'Preferimos outra data') ->> 'ok', 'true',
  'N1 reprova orçamento de pedido de colega');
select is(api.reprovar_orcamento(current_setting('t.q3')::uuid, null) ->> 'codigo', 'STATUS_INVALIDO', 'reprovar de novo: STATUS_INVALIDO');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.reprovar_orcamento(current_setting('t.q4')::uuid, null) ->> 'codigo', 'STATUS_INVALIDO',
  'reprovar pedido sem orçamento: STATUS_INVALIDO');
reset role;
select ok((select a.status = 'REPROVADA' and o.status = 'REPROVADO' and not b.ativo
           from app.atividades a join app.orcamentos o on o.atividade_id = a.id join app.agenda_blocos b on b.atividade_id = a.id
           where a.id = current_setting('t.q3')::uuid),
  'reprovado: atividade REPROVADA, orçamento REPROVADO, agenda liberada');
select ok(exists (select 1 from app.atividade_historico where atividade_id = current_setting('t.q3')::uuid
                  and de = 'ORCADA' and para = 'REPROVADA' and observacao = 'Preferimos outra data'
                  and por = '00000000-0000-0000-0000-0000000000a4'),
  'histórico da reprovação');
select ok(exists (select 1 from app.auditoria where acao = 'REPROVAR_ORCAMENTO' and resultado = 'OK'
                  and alvo = 'atividade:' || current_setting('t.q3')),
  'reprovação auditada');

------------------------------------------------------------------ cancelar ORCADA e expiração do orçamento
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.cancelar_pedido(current_setting('t.q6')::uuid, null) ->> 'ok', 'true', 'dono cancela pedido ORCADA (sem custo)');
reset role;
select ok((select a.status = 'CANCELADA' and o.status = 'CANCELADO' and not b.ativo
           from app.atividades a join app.orcamentos o on o.atividade_id = a.id join app.agenda_blocos b on b.atividade_id = a.id
           where a.id = current_setting('t.q6')::uuid),
  'cancelado: orçamento CANCELADO e agenda liberada');

update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.q5')::uuid;
select is(interno.expirar_vencidos(), 1, 'cron expira o orçamento vencido');
select ok((select a.status = 'EXPIRADA' and o.status = 'EXPIRADO' and not b.ativo
           from app.atividades a join app.orcamentos o on o.atividade_id = a.id join app.agenda_blocos b on b.atividade_id = a.id
           where a.id = current_setting('t.q5')::uuid),
  'ORCADA vencida: atividade EXPIRADA e orçamento EXPIRADO');

update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.q8')::uuid;
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.q7')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.reprovar_orcamento(current_setting('t.q8')::uuid, null) ->> 'codigo', 'PRAZO_VENCIDO',
  'reprovar orçamento vencido: PRAZO_VENCIDO (checado com now())');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_orcamento(current_setting('t.q7')::uuid, '{"km": 10}', null) ->> 'codigo', 'PRAZO_VENCIDO',
  'enviar depois do prazo de orçar: PRAZO_VENCIDO (checado com now())');
reset role;
select ok((select a.status = 'EXPIRADA' and o.status = 'EXPIRADO'
           from app.atividades a join app.orcamentos o on o.atividade_id = a.id where a.id = current_setting('t.q8')::uuid),
  'orçamento vencido expira na mesma transação da negação');
select ok((select status = 'EXPIRADA' from app.atividades where id = current_setting('t.q7')::uuid)
          and not exists (select 1 from app.orcamentos where atividade_id = current_setting('t.q7')::uuid),
  'pedido com prazo de orçar vencido expira sem orçamento');
select is((select count(*)::int from app.orcamentos where status = 'PENDENTE'), 2,
  'restam só os PENDENTES válidos (Q1 v2 e Q2)');

------------------------------------------------------------------ privilégios
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('calcular_orcamento', 'enviar_orcamento', 'pedir_revisao', 'reprovar_orcamento')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE') or not p.prosecdef)
$$, 'RPCs de orçamento: authenticated sim, anon/service_role não, SECURITY DEFINER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('calcular_orcamento', 'enviar_orcamento', 'pedir_revisao', 'reprovar_orcamento')), 4,
  'existem as 4 RPCs de orçamento');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select throws_ok($$ select interno.calcular_linhas(null::app.contratos_versoes, true, true, 'VEICULO_PROPRIO', '{}') $$, '42501', null,
  'authenticated não executa interno.calcular_linhas');
reset role;

select * from finish();
rollback;
