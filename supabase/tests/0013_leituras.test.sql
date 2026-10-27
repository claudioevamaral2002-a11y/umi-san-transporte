-- Fase 2A, Task 3 (migration 20261009131000_leituras_tempo_real.sql): leituras por perfil sem vazamento entre
-- empresas — meus_pedidos, pedido (snapshot filtrado por perfil), agenda (outras empresas só como "ocupado"),
-- horarios_livres (pré-reserva vencida = livre, dia_cheio) e pendencias (prazo e urgência).
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

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
-- o segundo motorista é mais novo: o atribuído (e o da agenda de pedidos novos) é a2
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

-- Dia D (America/Sao_Paulo) daqui a 10 dias; horários locais desse dia. now() é fixo na transação.
select set_config('t.dia', ((now() at time zone 'America/Sao_Paulo')::date + 10)::text, true);
create function pg_temp.loc(p_h text, p_dias int default 0) returns timestamptz language sql stable as $$
  select ((current_setting('t.dia')::date + p_dias) + p_h::time) at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.iso(t timestamptz) returns text language sql stable as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
create function pg_temp.ids(r text, caminho text) returns jsonb language sql stable as $$
  select jsonb_path_query_array(r::jsonb, caminho::jsonpath)
$$;
create function pg_temp.lista(variadic nomes text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(current_setting('t.' || n)) order by o), '[]') from unnest(nomes) with ordinality x(n, o)
$$;
create function pg_temp.horarios(variadic hs text[]) returns jsonb language sql stable as $$
  select jsonb_agg(to_jsonb(pg_temp.loc(h)) order by o) from unnest(hs) with ordinality x(h, o)
$$;
create function pg_temp.chaves(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k
$$;

select set_config('t.ped', '{"duracao_min": 120, "destino": "Base Navegantes", "levar": true, "trazer": false,
  "carga": "PESSOAS", "pessoas_qtd": 3, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.i1', pg_temp.iso(pg_temp.loc('10:00')), true);
select set_config('t.i2', pg_temp.iso(pg_temp.loc('14:00')), true);
select set_config('t.ib', pg_temp.iso(pg_temp.loc('18:00')), true);
select set_config('t.i4', pg_temp.iso(now() + interval '5 hours'), true);
select set_config('t.ic', pg_temp.iso(pg_temp.loc('04:00', 1)), true);
select set_config('t.de', pg_temp.loc('00:00')::text, true);
select set_config('t.ate', pg_temp.loc('00:00', 1)::text, true);
select set_config('t.ontem', ((now() at time zone 'America/Sao_Paulo')::date - 1)::text, true);
select set_config('t.f_periodo', jsonb_build_object('de', pg_temp.iso(pg_temp.loc('12:00')),
                                                    'ate', pg_temp.iso(pg_temp.loc('23:00')))::text, true);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) u;

------------------------------------------------------------------ cenário: q1 (A, N2 a5, ORCADA), q4 (A, a5, urgente),
------------------------------------------------------------------ q2 (A, N2 a8), qB (B, N1 a7)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.q1', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i1'), 'origem', 'Origem Secreta A1')) ->> 'id', true);
select set_config('t.q4', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i4'), 'origem', 'Origem Secreta A4')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.q2', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i2'), 'origem', 'Origem Secreta A2')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.qb', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.ib'), 'origem', 'Origem B')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.envio', api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null)::text, true);
reset role;
select ok(current_setting('t.q1') <> '' and current_setting('t.q2') <> '' and current_setting('t.q4') <> ''
          and current_setting('t.qb') <> '' and (current_setting('t.envio')::jsonb ->> 'ok')::boolean,
  'cenário: 4 pedidos criados e q1 orçado');

------------------------------------------------------------------ meus_pedidos
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000dead", "role": "authenticated"}', true);
select set_config('t.anon', jsonb_build_array(api.meus_pedidos(), api.pedido(current_setting('t.q1')::uuid),
  api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz),
  api.horarios_livres(current_setting('t.dia')::date, 60), api.pendencias())::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.mp_a1', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.mp_a2', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.mp_a3', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.mp_a4', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.mp_a5', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.mp_a6', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.mp_a7', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.mp_a8', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select set_config('t.mp_a9', api.meus_pedidos()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.mp_status', api.meus_pedidos('{"status": ["ORCADA"]}')::text, true);
select set_config('t.mp_periodo', api.meus_pedidos(current_setting('t.f_periodo')::jsonb)::text, true);
select set_config('t.mp_limite', api.meus_pedidos('{"limite": 1}')::text, true);
select set_config('t.mp_inv', jsonb_build_array(api.meus_pedidos('{"status": ["XYZ"]}'), api.meus_pedidos('{"foo": 1}'),
  api.meus_pedidos('{"limite": 0}'), api.meus_pedidos('{"de": "ontem"}'), api.meus_pedidos('[]'))::text, true);
reset role;

select is(jsonb_path_query_array(current_setting('t.anon')::jsonb, '$[*].codigo'),
  '["SEM_PERMISSAO", "SEM_PERMISSAO", "SEM_PERMISSAO", "SEM_PERMISSAO", "SEM_PERMISSAO"]'::jsonb,
  'sem perfil: todas as leituras recusadas');
select is(pg_temp.ids(current_setting('t.mp_a5'), '$.itens[*].id'), pg_temp.lista('q1', 'q4'), 'N2 vê só os próprios');
select is(pg_temp.ids(current_setting('t.mp_a8'), '$.itens[*].id'), pg_temp.lista('q2'), 'outro N2 vê só o seu');
select is(pg_temp.ids(current_setting('t.mp_a4'), '$.itens[*].id'), pg_temp.lista('q2', 'q1', 'q4'),
  'N1 vê os da empresa (início decrescente)');
select is(pg_temp.ids(current_setting('t.mp_a6'), '$.itens[*].id'), pg_temp.lista('q2', 'q1', 'q4'), 'N3 vê os da empresa');
select is(pg_temp.ids(current_setting('t.mp_a7'), '$.itens[*].id'), pg_temp.lista('qb'), 'outra empresa: só os dela');
select is(pg_temp.ids(current_setting('t.mp_a2'), '$.itens[*].id'), pg_temp.lista('qb', 'q2', 'q1', 'q4'),
  'motorista vê os atribuídos');
select is(pg_temp.ids(current_setting('t.mp_a9'), '$.itens[*].id'), '[]'::jsonb, 'motorista não atribuído não vê nada');
select is(pg_temp.ids(current_setting('t.mp_a1'), '$.itens[*].id'), pg_temp.lista('qb', 'q2', 'q1', 'q4'), 'ADM vê todos');
select is(pg_temp.ids(current_setting('t.mp_a3'), '$.itens[*].id'), pg_temp.lista('qb', 'q2', 'q1', 'q4'), 'gestor vê todos');
select is(pg_temp.ids(current_setting('t.mp_status'), '$.itens[*].id'), pg_temp.lista('q1'), 'filtro por status');
select is(pg_temp.ids(current_setting('t.mp_periodo'), '$.itens[*].id'), pg_temp.lista('q2'), 'filtro por período (início)');
select is(pg_temp.ids(current_setting('t.mp_limite'), '$.itens[*].id'), pg_temp.lista('q2'), 'limite');
select is(pg_temp.ids(current_setting('t.mp_inv'), '$[*].codigo'),
  '["CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS"]'::jsonb,
  'filtro inválido recusado');
select is(pg_temp.chaves(current_setting('t.mp_a5')::jsonb -> 'itens' -> 0),
  array['destino', 'duracao_min', 'empresa_nome', 'id', 'inicio', 'levar', 'modalidade', 'multa_cent', 'numero',
        'origem', 'paradas', 'prazo_orcar_ate', 'prazo_vencido', 'status', 'total_cent', 'trazer', 'valido_ate'],
  'item da lista: só campos de lista');
select is((current_setting('t.mp_a5')::jsonb -> 'itens' -> 0)
            - array['id', 'numero', 'inicio', 'destino', 'duracao_min', 'levar', 'trazer', 'modalidade', 'origem'],
  jsonb_build_object('status', 'ORCADA', 'total_cent', 37500, 'valido_ate', now() + interval '24 hours',
                     'prazo_orcar_ate', null, 'prazo_vencido', false, 'empresa_nome', null, 'paradas', '[]'::jsonb,
                     'multa_cent', null),
  'cliente: total e validade do orçamento vigente, sem nome de empresa');
select is((current_setting('t.mp_a5')::jsonb -> 'itens' -> 1 ->> 'prazo_orcar_ate')::timestamptz,
  (select prazo_orcar_ate from app.atividades where id = current_setting('t.q4')::uuid),
  'SOLICITADA: prazo de orçar na lista');
select is(jsonb_path_query_first(current_setting('t.mp_a3')::jsonb, '$.itens[*] ? (@.status == "ORCADA")')
            -> 'total_cent', 'null'::jsonb, 'gestor de frota não vê valores');
select is(jsonb_path_query_first(current_setting('t.mp_a1')::jsonb, '$.itens[*] ? (@.status == "ORCADA")')
            - array['id', 'numero', 'inicio', 'destino', 'duracao_min', 'levar', 'trazer', 'modalidade', 'origem',
                    'status', 'valido_ate', 'prazo_orcar_ate', 'prazo_vencido'],
  '{"total_cent": 37500, "empresa_nome": "Empresa A", "paradas": [], "multa_cent": null}'::jsonb, 'ADM vê valor e empresa');

------------------------------------------------------------------ pedido (detalhe)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.p_b', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.p_a8', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select set_config('t.p_a9', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.p_x', api.pedido(gen_random_uuid())::text, true);
select set_config('t.p_a5', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.p_a6', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.p_a4', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.p_a2', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('t.p_a2q2', api.pedido(current_setting('t.q2')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.p_a1', api.pedido(current_setting('t.q1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.p_a3', api.pedido(current_setting('t.q1')::uuid)::text, true);
reset role;

select is(current_setting('t.p_b')::jsonb, '{"ok": false, "codigo": "NAO_ENCONTRADO"}'::jsonb,
  'cliente de outra empresa: NAO_ENCONTRADO');
select is(current_setting('t.p_a8')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'outro N2 da empresa: NAO_ENCONTRADO');
select is(current_setting('t.p_a9')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'motorista não atribuído: NAO_ENCONTRADO');
select is(current_setting('t.p_x')::jsonb ->> 'codigo', 'NAO_ENCONTRADO', 'id inexistente: mesmo código (sem sondagem)');
select is((select count(*)::int from app.auditoria where acao = 'VER_PEDIDO' and resultado = 'NEGADO' and codigo = 'NAO_ENCONTRADO'),
  4, 'negações do detalhe auditadas');
select ok((current_setting('t.p_a5')::jsonb ->> 'ok')::boolean
          and current_setting('t.p_a5')::jsonb -> 'pedido' ->> 'id' = current_setting('t.q1')
          and current_setting('t.p_a5')::jsonb -> 'pedido' ->> 'origem' = 'Origem Secreta A1'
          and current_setting('t.p_a5')::jsonb -> 'pedido' ->> 'solicitante_nome' = 'Solicitante A'
          and current_setting('t.p_a5')::jsonb -> 'pedido' ->> 'motorista_nome' = 'Motorista Teste'
          and current_setting('t.p_a5')::jsonb -> 'pedido' ->> 'empresa_nome' = 'Empresa A',
  'dono vê o detalhe');
select is(jsonb_path_query_array(current_setting('t.p_a5')::jsonb, '$.historico[*].para'), '["SOLICITADA", "ORCADA"]'::jsonb,
  'histórico na ordem');
select is(current_setting('t.p_a5')::jsonb -> 'historico' -> 1 ->> 'por_nome', 'Motorista Teste', 'histórico com o autor');
select is(pg_temp.chaves(current_setting('t.p_a5')::jsonb -> 'orcamento'),
  array['enviado_em', 'hash', 'horario_sugerido', 'id', 'linhas', 'modalidade', 'regras', 'status', 'total_cent',
        'valido_ate', 'versao'],
  'cliente: orçamento sem entrada, snapshot, versão do contrato ou autor');
select is(current_setting('t.p_a5')::jsonb -> 'orcamento' -> 'regras',
  jsonb_build_object('faixas_cancelamento', current_setting('t.base')::jsonb -> 'faixas_cancelamento',
                     'prazo_orcar_horas', 12, 'validade_orcamento_horas', 24, 'limiar_urgente_horas', 6),
  'cliente: regras do snapshot (faixas e prazos)');
select ok((current_setting('t.p_a5')::jsonb -> 'orcamento' ->> 'total_cent')::int = 37500
          and jsonb_array_length(current_setting('t.p_a5')::jsonb -> 'orcamento' -> 'linhas') = 2
          and (current_setting('t.p_a5')::jsonb -> 'orcamento' ->> 'valido_ate')::timestamptz = now() + interval '24 hours',
  'cliente: memorial, total e validade');
select ok(current_setting('t.p_a5') not like '%limite_saldo%' and current_setting('t.p_a5') not like '%alerta_saldo%'
          and current_setting('t.p_a5') not like '%publicado%' and current_setting('t.p_a5') not like '%contrato_versao%'
          and current_setting('t.p_a5') not like '%entrada%' and current_setting('t.p_a5') not like '%km_sem_reboque%',
  'cliente: nada de limites, autor, versão, entrada ou tabela de preços');
select is(current_setting('t.p_a5')::jsonb -> 'acoes',
  '{"orcar": false, "recusar": false, "pedir_revisao": true, "reprovar": true, "cancelar": true, "aprovar": true,
    "cancelar_agendado": false, "sair": false, "informar_previsao": false, "concluir": false,
    "enviar_fotos": false, "avaliar": false}'::jsonb,
  'dono: pode pedir revisão, reprovar, cancelar e aprovar');
select ok((current_setting('t.p_a6')::jsonb ->> 'ok')::boolean
          and current_setting('t.p_a6')::jsonb -> 'acoes'
              = '{"orcar": false, "recusar": false, "pedir_revisao": false, "reprovar": false, "cancelar": false,
                  "aprovar": false, "cancelar_agendado": false, "sair": false, "informar_previsao": false,
                  "concluir": false, "enviar_fotos": false, "avaliar": false}'::jsonb,
  'N3 vê o detalhe, sem ações');
select is(current_setting('t.p_a4')::jsonb -> 'acoes' -> 'reprovar', 'true'::jsonb, 'N1 decide pelo pedido da empresa');
select is(current_setting('t.p_a2')::jsonb -> 'orcamento' -> 'entrada', '{"km": 100}'::jsonb, 'motorista: vê a entrada');
select is(current_setting('t.p_a2')::jsonb -> 'orcamento' -> 'precos',
  '{"km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000, "retorno_trecho_unico_bp": 5000,
    "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000, "diaria_motorista_cent": 30000}'::jsonb,
  'motorista: preços do snapshot');
select ok(current_setting('t.p_a2') not like '%limite_saldo%' and current_setting('t.p_a2') not like '%alerta_saldo%'
          and current_setting('t.p_a2') not like '%publicado%' and current_setting('t.p_a2') not like '%contrato_versao%'
          and current_setting('t.p_a2') not like '%vigente_desde%'
          and (current_setting('t.p_a2')::jsonb -> 'orcamento' ->> 'total_cent')::int = 37500,
  'motorista: nunca limites, versão do contrato ou autor');
select is(current_setting('t.p_a2q2')::jsonb -> 'acoes',
  '{"orcar": true, "recusar": true, "pedir_revisao": false, "reprovar": false, "cancelar": true, "aprovar": false,
    "cancelar_agendado": false, "sair": false, "informar_previsao": false, "concluir": false,
    "enviar_fotos": false, "avaliar": false}'::jsonb,
  'motorista atribuído pode orçar, recusar e cancelar o SOLICITADA');
select ok(current_setting('t.p_a2q2')::jsonb -> 'orcamento' = 'null'::jsonb, 'sem orçamento vigente: nulo');
select is(current_setting('t.p_a1')::jsonb -> 'orcamento' -> 'snapshot',
  (select snapshot from app.orcamentos where atividade_id = current_setting('t.q1')::uuid), 'ADM: snapshot completo');
select ok((current_setting('t.p_a1')::jsonb -> 'orcamento' ->> 'contrato_versao')::int = 1
          and current_setting('t.p_a1')::jsonb -> 'orcamento' ->> 'enviado_por_nome' = 'Motorista Teste'
          and current_setting('t.p_a1')::jsonb -> 'orcamento' -> 'entrada' = '{"km": 100}'::jsonb,
  'ADM: versão do contrato, autor e entrada');
select is(pg_temp.chaves(current_setting('t.p_a3')::jsonb -> 'orcamento'),
  array['enviado_em', 'horario_sugerido', 'id', 'modalidade', 'status', 'valido_ate', 'versao'],
  'gestor de frota: orçamento sem valores');
select ok(current_setting('t.p_a3') not like '%valor_cent%' and current_setting('t.p_a3') not like '%total_cent%'
          and current_setting('t.p_a3') not like '%unitario%',
  'gestor de frota: nenhum preço no detalhe');

------------------------------------------------------------------ pendencias
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.pd_a1', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.pd_a2', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.pd_a3', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.pd_a4', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.pd_a5', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.pd_a6', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.pd_a7', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.pd_a8', api.pendencias()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select set_config('t.pd_a9', api.pendencias()::text, true);
reset role;

select is(pg_temp.ids(current_setting('t.pd_a2'), '$.aguardando_orcamento[*].id'), pg_temp.lista('q4', 'q2', 'qb'),
  'motorista: aguardando seu orçamento, por prazo');
select is(pg_temp.ids(current_setting('t.pd_a2'), '$.aguardando_orcamento[*].urgente'), '[true, false, false]'::jsonb,
  'urgente = faltam até limiar_urgente_horas (6 h) do contrato');
select is((current_setting('t.pd_a2')::jsonb -> 'aguardando_orcamento' -> 1 ->> 'prazo')::timestamptz,
  now() + interval '12 hours', 'prazo = prazo de orçar');
select is(current_setting('t.pd_a2')::jsonb -> 'aguardando_aprovacao', '[]'::jsonb, 'motorista: nada a aprovar');
select ok(current_setting('t.pd_a9')::jsonb -> 'aguardando_orcamento' = '[]'::jsonb
          and current_setting('t.pd_a9')::jsonb -> 'aguardando_aprovacao' = '[]'::jsonb,
  'motorista não atribuído: sem pendências');
select is(pg_temp.ids(current_setting('t.pd_a5'), '$.aguardando_orcamento[*].id'), pg_temp.lista('q4'), 'N2: os próprios aguardando orçamento');
select is((current_setting('t.pd_a5')::jsonb -> 'aguardando_aprovacao' -> 0) - 'inicio' - 'duracao_min' - 'destino' - 'numero',
  jsonb_build_object('id', current_setting('t.q1'), 'status', 'ORCADA', 'origem', 'Origem Secreta A1',
                     'prazo', now() + interval '24 hours', 'urgente', false, 'versao', 1, 'total_cent', 37500,
                     'empresa_nome', null, 'categoria_nome', null, 'agora', false, 'paradas', '[]'::jsonb),
  'N2: aguardando sua aprovação, com validade e total');
select ok(current_setting('t.pd_a8')::jsonb -> 'aguardando_aprovacao' = '[]'::jsonb
          and pg_temp.ids(current_setting('t.pd_a8'), '$.aguardando_orcamento[*].id') = pg_temp.lista('q2'),
  'outro N2: não decide o pedido alheio');
select ok(pg_temp.ids(current_setting('t.pd_a4'), '$.aguardando_aprovacao[*].id') = pg_temp.lista('q1')
          and pg_temp.ids(current_setting('t.pd_a4'), '$.aguardando_orcamento[*].id') = pg_temp.lista('q4', 'q2'),
  'N1: os da empresa');
select ok(current_setting('t.pd_a6')::jsonb -> 'aguardando_aprovacao' = '[]'::jsonb
          and pg_temp.ids(current_setting('t.pd_a6'), '$.aguardando_orcamento[*].id') = pg_temp.lista('q4', 'q2'),
  'N3: acompanha, mas nada a aprovar');
select ok(current_setting('t.pd_a7')::jsonb -> 'aguardando_aprovacao' = '[]'::jsonb
          and pg_temp.ids(current_setting('t.pd_a7'), '$.aguardando_orcamento[*].id') = pg_temp.lista('qb')
          and current_setting('t.pd_a7') not like '%Secreta%',
  'outra empresa: só os dela');
select ok(pg_temp.ids(current_setting('t.pd_a1'), '$.aguardando_orcamento[*].id') = pg_temp.lista('q4', 'q2', 'qb')
          and pg_temp.ids(current_setting('t.pd_a1'), '$.aguardando_aprovacao[*].total_cent') = '[37500]'::jsonb
          and pg_temp.ids(current_setting('t.pd_a1'), '$.aguardando_aprovacao[*].empresa_nome') = '["Empresa A"]'::jsonb
          and current_setting('t.pd_a1')::jsonb -> 'proximos' = '[]'::jsonb,
  'ADM: tudo agregado, com valores e empresa');
select is(pg_temp.ids(current_setting('t.pd_a3'), '$.aguardando_aprovacao[*].total_cent'), '[null]'::jsonb,
  'gestor de frota: sem valores');

-- q4: orçado (validade = início, a ~5 h → urgente), depois revisão pedida.
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.envio4', api.enviar_orcamento(current_setting('t.q4')::uuid, '{"km": 10}', null)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.pd_orc4', api.pendencias()::text, true);
select set_config('t.rev4', api.pedir_revisao(current_setting('t.q4')::uuid, 'Valor acima do esperado')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.pd_rev', api.pendencias()::text, true);
reset role;
select ok(pg_temp.ids(current_setting('t.pd_orc4'), '$.aguardando_aprovacao[*].id') = pg_temp.lista('q4', 'q1')
          and pg_temp.ids(current_setting('t.pd_orc4'), '$.aguardando_aprovacao[*].urgente') = '[true, false]'::jsonb,
  'orçamento perto de vencer: urgente pelo limiar do snapshot');
select is(jsonb_path_query_array(current_setting('t.pd_rev')::jsonb, '$.aguardando_orcamento[*] ? (@.revisao == true).id'),
  pg_temp.lista('q4'), 'revisão pedida volta para o motorista marcada como revisão');

------------------------------------------------------------------ agenda
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.ag_inv', jsonb_build_array(
  api.agenda(current_setting('t.ate')::timestamptz, current_setting('t.de')::timestamptz),
  api.agenda(current_setting('t.de')::timestamptz, current_setting('t.de')::timestamptz + interval '63 days'),
  api.agenda(null, current_setting('t.de')::timestamptz))::text, true);
select set_config('t.ag_62', api.agenda(current_setting('t.de')::timestamptz,
                                        current_setting('t.de')::timestamptz + interval '62 days')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.ag_a1', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.ag_a2', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.ag_a3', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ag_a5', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.ag_a7', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
reset role;

select is(pg_temp.ids(current_setting('t.ag_inv'), '$[*].codigo'), '["CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS"]'::jsonb,
  'agenda: período invertido, maior que 62 dias ou nulo recusado');
select is((current_setting('t.ag_62')::jsonb ->> 'ok')::boolean, true, 'agenda: 62 dias aceito');
select is(current_setting('t.ag_a7')::jsonb -> 'blocos' -> 0,
  jsonb_build_object('inicio', pg_temp.loc('10:00'), 'fim', pg_temp.loc('12:00'), 'ocupado', true),
  'outra empresa: bloco alheio só como ocupado');
select is(current_setting('t.ag_a7')::jsonb -> 'blocos' -> 1,
  jsonb_build_object('inicio', pg_temp.loc('14:00'), 'fim', pg_temp.loc('16:00'), 'ocupado', true),
  'outra empresa: segundo bloco alheio também só ocupado');
select ok(current_setting('t.ag_a7')::jsonb -> 'blocos' -> 2 ->> 'atividade_id' = current_setting('t.qb')
          and current_setting('t.ag_a7')::jsonb -> 'blocos' -> 2 ->> 'origem' = 'Origem B'
          and (current_setting('t.ag_a7')::jsonb -> 'blocos' -> 2 ->> 'pode_abrir')::boolean
          and not (current_setting('t.ag_a7')::jsonb -> 'blocos' -> 2 ? 'empresa_nome'),
  'outra empresa: o próprio bloco com detalhes');
select ok(current_setting('t.ag_a7') not like '%Secreta%' and current_setting('t.ag_a7') not like '%Empresa A%'
          and current_setting('t.ag_a7') not like '%' || current_setting('t.q1') || '%',
  'outra empresa: nenhum endereço, empresa ou id alheio');
select ok(pg_temp.ids(current_setting('t.ag_a5'), '$.blocos[*].pode_abrir') = '[true]'::jsonb
          and jsonb_array_length(current_setting('t.ag_a5')::jsonb -> 'blocos') = 3
          and pg_temp.chaves(current_setting('t.ag_a5')::jsonb -> 'blocos' -> 1) = array['fim', 'inicio', 'ocupado']
          and pg_temp.chaves(current_setting('t.ag_a5')::jsonb -> 'blocos' -> 2) = array['fim', 'inicio', 'ocupado'],
  'N2: só o próprio pedido com detalhes; o do colega e o de outra empresa só ocupado (revisão 2A, R1)');
select is(pg_temp.ids(current_setting('t.ag_a5'), '$.blocos[*].origem'), '["Origem Secreta A1"]'::jsonb,
  'N2: endereço só do próprio pedido');
select is(pg_temp.ids(current_setting('t.ag_a1'), '$.blocos[*].empresa_nome'), '["Empresa A", "Empresa A", "Empresa B"]'::jsonb,
  'ADM: todos com empresa');
select ok(pg_temp.ids(current_setting('t.ag_a2'), '$.blocos[*].numero') = pg_temp.ids(current_setting('t.ag_a1'), '$.blocos[*].numero')
          and pg_temp.ids(current_setting('t.ag_a3'), '$.blocos[*].motorista_nome')
              = '["Motorista Teste", "Motorista Teste", "Motorista Teste"]'::jsonb,
  'motorista e gestor: todos com detalhes');
select is(pg_temp.ids(current_setting('t.ag_a1'), '$.blocos[*].tipo'), '["PRE_RESERVA", "PRE_RESERVA", "PRE_RESERVA"]'::jsonb,
  'tipo do bloco');

------------------------------------------------------------------ horarios_livres
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.h120', api.horarios_livres(current_setting('t.dia')::date, 120)::text, true);
select set_config('t.h30', api.horarios_livres(current_setting('t.dia')::date, 30)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.qc', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.ic'), 'duracao_min', 1260, 'origem', 'Origem Secreta A5')) ->> 'id', true);
select set_config('t.hcheio', api.horarios_livres(current_setting('t.dia')::date + 1, 30)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.hontem', api.horarios_livres(current_setting('t.ontem')::date, 60)::text, true);
select set_config('t.hinv', jsonb_build_array(api.horarios_livres(current_setting('t.dia')::date, 20),
  api.horarios_livres(current_setting('t.dia')::date, 1441), api.horarios_livres(null, 60))::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.h120b', api.horarios_livres(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.h120adm', api.horarios_livres(current_setting('t.dia')::date, 120)::text, true);
reset role;

select is(current_setting('t.h120')::jsonb - 'horarios',
  jsonb_build_object('ok', true, 'dia', current_setting('t.dia'), 'duracao_min', 120, 'dia_cheio', false),
  'horarios_livres: resposta');
select is(current_setting('t.h120')::jsonb -> 'horarios',
  pg_temp.horarios('05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '12:00', '16:00',
                   '20:00', '20:30', '21:00', '21:30', '22:00'),
  '2 h: de 30 em 30 min, 05:00–22:00, sem colidir com os blocos (10–12, 14–16, 18–20)');
select ok(current_setting('t.h120b')::jsonb = current_setting('t.h120')::jsonb
          and current_setting('t.h120adm')::jsonb = current_setting('t.h120')::jsonb,
  'mesmos horários para outra empresa e para o ADM');
select is(jsonb_array_length(current_setting('t.h30')::jsonb -> 'horarios'), 23, '30 min: 23 inícios livres');
select ok(current_setting('t.qc') <> '', 'pedido de 21 h ocupando o dia D+1 inteiro (04:00–01:00)');
select is(current_setting('t.hcheio')::jsonb - 'dia' - 'duracao_min', '{"ok": true, "horarios": [], "dia_cheio": true}'::jsonb,
  'nenhum início livre no dia → dia cheio');
select is(current_setting('t.hontem')::jsonb - 'dia' - 'duracao_min', '{"ok": true, "horarios": [], "dia_cheio": false}'::jsonb,
  'dia passado: sem horários, mas não "cheio"');
select is(pg_temp.ids(current_setting('t.hinv'), '$[*].codigo'), '["CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS"]'::jsonb,
  'duração fora de 30–1440 ou dia nulo recusado');

-- Pré-reserva vencida (o cron ainda não passou) conta como livre; cancelado também libera.
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.q2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.h_venc', api.horarios_livres(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.ag_venc', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.canc', api.cancelar_pedido(current_setting('t.qb')::uuid, null)::text, true);
select set_config('t.h_canc', api.horarios_livres(current_setting('t.dia')::date, 120)::text, true);
select set_config('t.ag_canc', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
reset role;
select is(current_setting('t.h_venc')::jsonb -> 'horarios',
  pg_temp.horarios('05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00',
                   '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00',
                   '20:00', '20:30', '21:00', '21:30', '22:00'),
  'pré-reserva vencida conta como livre');
select is(pg_temp.ids(current_setting('t.ag_venc'), '$.blocos[*].atividade_id'), pg_temp.lista('q1', 'qb'),
  'agenda: pré-reserva vencida não aparece como ocupada');
select is(jsonb_array_length(current_setting('t.h_canc')::jsonb -> 'horarios'), 28, 'pedido cancelado libera o horário');
select is(current_setting('t.ag_canc')::jsonb -> 'blocos',
  jsonb_build_array(jsonb_build_object('inicio', pg_temp.loc('10:00'), 'fim', pg_temp.loc('12:00'), 'ocupado', true)),
  'agenda: bloco inativo não aparece');

-- sem motorista ativo
update app.perfis set ativo = false where papel = 'MOTORISTA';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.horarios_livres(current_setting('t.dia')::date, 60) ->> 'codigo', 'SEM_MOTORISTA', 'sem motorista ativo: SEM_MOTORISTA');
reset role;

select * from finish();
rollback;
