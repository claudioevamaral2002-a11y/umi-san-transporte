-- Fase 2A, Task 3 (complemento; migration 20261009131100_dias_do_mes.sql): calendário do mês numa consulta —
-- coerente com horarios_livres, contagens por escopo de perfil, sem detalhes de outras empresas; pode_abrir da
-- agenda com a mesma checagem de api.pedido (N1/N3 abrem pedidos de colegas, N2 só os próprios).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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

-- Dia D = dia 10 de um mês inteiramente no futuro (D+1..D+3 no mesmo mês).
select set_config('t.dia', (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date + 40)::date + 9)::text, true);
select set_config('t.hoje', ((now() at time zone 'America/Sao_Paulo')::date)::text, true);
create function pg_temp.loc(p_h text, p_dias int default 0) returns timestamptz language sql stable as $$
  select ((current_setting('t.dia')::date + p_dias) + p_h::time) at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.iso(t timestamptz) returns text language sql stable as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
-- dia (D + n) na resposta de dias_do_mes guardada em t.<nome>
create function pg_temp.d(nome text, n int default 0) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(current_setting('t.' || nome)::jsonb -> 'dias') x
   where x ->> 'dia' = (current_setting('t.dia')::date + n)::text
$$;
create function pg_temp.campo(campo text, n int, variadic nomes text[]) returns jsonb language sql stable as $$
  select jsonb_agg(pg_temp.d(nm, n) -> campo order by o) from unnest(nomes) with ordinality x(nm, o)
$$;
create function pg_temp.chaves(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k
$$;

select set_config('t.ped', '{"duracao_min": 120, "destino": "Base Navegantes", "levar": true, "trazer": false,
  "carga": "PESSOAS", "pessoas_qtd": 3, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.i1', pg_temp.iso(pg_temp.loc('10:00')), true);
select set_config('t.i2', pg_temp.iso(pg_temp.loc('14:00')), true);
select set_config('t.ib', pg_temp.iso(pg_temp.loc('18:00')), true);
select set_config('t.ic', pg_temp.iso(pg_temp.loc('04:00', 1)), true);
select set_config('t.de', pg_temp.loc('00:00')::text, true);
select set_config('t.ate', pg_temp.loc('00:00', 1)::text, true);
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) u;

------------------------------------------------------------------ cenário (dia D): q1 10–12 (A, N2 a5, ORCADA), q2 14–16
------------------------------------------------------------------ (A, N2 a8), qB 18–20 (B); D+1: qc 04:00–01:00 (A, N1 a4)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.q1', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i1'), 'origem', 'Origem Secreta A1')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.q2', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i2'), 'origem', 'Origem Secreta A2')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.qb', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.ib'), 'origem', 'Origem B')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.qc', api.criar_pedido(current_setting('t.ped')::jsonb
  || jsonb_build_object('inicio', current_setting('t.ic'), 'duracao_min', 1260, 'origem', 'Origem Secreta A5')) ->> 'id', true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.envio', api.enviar_orcamento(current_setting('t.q1')::uuid, '{"km": 100}', null)::text, true);
reset role;
select ok(current_setting('t.q1') <> '' and current_setting('t.q2') <> '' and current_setting('t.qb') <> ''
          and current_setting('t.qc') <> '' and (current_setting('t.envio')::jsonb ->> 'ok')::boolean,
  'cenário: 4 pedidos criados e q1 orçado');

------------------------------------------------------------------ agenda: pode_abrir = mesma checagem de api.pedido
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.ag_a4', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ag_a5', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.ag_a6', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.ag_a8', api.agenda(current_setting('t.de')::timestamptz, current_setting('t.ate')::timestamptz)::text, true);
reset role;
select is(jsonb_path_query_array(current_setting('t.ag_a4')::jsonb, '$.blocos[*].pode_abrir'), '[true, true]'::jsonb,
  'N1 abre o próprio pedido da empresa e o do colega (o de outra empresa é só ocupado)');
select is(jsonb_path_query_array(current_setting('t.ag_a6')::jsonb, '$.blocos[*].pode_abrir'), '[true, true]'::jsonb,
  'N3 abre os pedidos da empresa');
select is(jsonb_path_query_array(current_setting('t.ag_a5')::jsonb, '$.blocos[*].pode_abrir'), '[true]'::jsonb,
  'N2 abre só o próprio (o do colega vem só como ocupado)');
select is(jsonb_path_query_array(current_setting('t.ag_a8')::jsonb, '$.blocos[*].pode_abrir'), '[true]'::jsonb,
  'o outro N2 também só o próprio');

------------------------------------------------------------------ dias_do_mes
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000dead", "role": "authenticated"}', true);
select set_config('t.anon', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.dm_a1', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.dm_a2', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select set_config('t.dm_a3', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.dm_a4', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.dm_a5', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.dm_a6', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.dm_a7', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.dm_a8', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select set_config('t.dm_a9', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.inv', jsonb_build_array(api.dias_do_mes(current_setting('t.dia')::date, 20),
  api.dias_do_mes(current_setting('t.dia')::date, 1441), api.dias_do_mes(null, 120))::text, true);
select set_config('t.atual', api.dias_do_mes(current_setting('t.hoje')::date, 120)::text, true);
select set_config('t.coerente', (
  select jsonb_build_object('n', count(*), 'ok', bool_and(
           (x ->> 'livre')::boolean = (jsonb_array_length(l.h -> 'horarios') > 0)
           and (x ->> 'dia_cheio')::boolean = (l.h ->> 'dia_cheio')::boolean))
  from jsonb_array_elements(current_setting('t.dm_a5')::jsonb -> 'dias') x
  cross join lateral (select api.horarios_livres((x ->> 'dia')::date, 120) as h) l)::text, true);
select set_config('t.coerente_atual', (
  select jsonb_build_object('n', count(*), 'ok', bool_and(
           (x ->> 'livre')::boolean = (jsonb_array_length(l.h -> 'horarios') > 0)
           and (x ->> 'dia_cheio')::boolean = (l.h ->> 'dia_cheio')::boolean))
  from jsonb_array_elements(current_setting('t.atual')::jsonb -> 'dias') x
  cross join lateral (select api.horarios_livres((x ->> 'dia')::date, 120) as h) l)::text, true);
reset role;

select is(current_setting('t.anon')::jsonb, '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'sem perfil: recusado');
select is(jsonb_path_query_array(current_setting('t.inv')::jsonb, '$[*].codigo'),
  '["CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS", "CAMPOS_INVALIDOS"]'::jsonb, 'duração fora de 30–1440 ou mês nulo recusado');
select is((select count(*)::int from app.auditoria where acao = 'DIAS_DO_MES' and resultado = 'NEGADO'), 4, 'negações auditadas');
select is(current_setting('t.dm_a5')::jsonb - 'dias',
  jsonb_build_object('ok', true, 'mes', date_trunc('month', current_setting('t.dia')::date)::date, 'duracao_min', 120),
  'resposta: mês (primeiro dia) e duração');
select is(jsonb_array_length(current_setting('t.dm_a5')::jsonb -> 'dias'),
  extract(day from date_trunc('month', current_setting('t.dia')::date) + interval '1 month - 1 day')::int,
  'um item por dia do mês');
select is(pg_temp.chaves(pg_temp.d('dm_a7')), array['aguardando_voce', 'dia', 'dia_cheio', 'livre', 'meus', 'ocupado'],
  'item do dia: só contagens e indicadores');
select is(pg_temp.d('dm_a5'),
  jsonb_build_object('dia', current_setting('t.dia'), 'livre', true, 'dia_cheio', false, 'meus', 1, 'aguardando_voce', 1,
                     'ocupado', true),
  'D (N2 dono de q1, ORCADA): livre, 1 pedido, 1 aguardando você, ocupado');
select is(pg_temp.d('dm_a5', 1) - 'dia', '{"livre": false, "dia_cheio": true, "meus": 0, "aguardando_voce": 0, "ocupado": true}'::jsonb,
  'D+1 (pedido de 21 h de um colega): dia cheio e ocupado, nada do N2');
select is(pg_temp.d('dm_a5', 3) - 'dia', '{"livre": true, "dia_cheio": false, "meus": 0, "aguardando_voce": 0, "ocupado": false}'::jsonb,
  'D+3: livre e desocupado (o pedido de 21 h termina 01:00 de D+2)');
select is(pg_temp.campo('meus', 0, 'dm_a1', 'dm_a2', 'dm_a3', 'dm_a4', 'dm_a5', 'dm_a6', 'dm_a7', 'dm_a8', 'dm_a9'),
  '[3, 3, 3, 2, 1, 2, 1, 1, 0]'::jsonb,
  'meus em D por perfil (ADM, motorista, gestor, N1, N2, N3, outra empresa, outro N2, outro motorista)');
select is(pg_temp.campo('aguardando_voce', 0, 'dm_a1', 'dm_a2', 'dm_a3', 'dm_a4', 'dm_a5', 'dm_a6', 'dm_a7', 'dm_a8', 'dm_a9'),
  '[3, 2, 0, 1, 1, 0, 0, 0, 0]'::jsonb,
  'aguardando você em D: ADM (orçar + aprovar), motorista (orçar), N1/N2 dono (decidir); demais nada');
select is(pg_temp.campo('meus', 1, 'dm_a2', 'dm_a4', 'dm_a5', 'dm_a6', 'dm_a7'), '[1, 1, 0, 1, 0]'::jsonb, 'meus em D+1');
select is(pg_temp.campo('aguardando_voce', 1, 'dm_a1', 'dm_a2', 'dm_a4'), '[1, 1, 0]'::jsonb,
  'aguardando você em D+1: SOLICITADA é do motorista/ADM, não do cliente');
select is(pg_temp.campo('ocupado', 0, 'dm_a7', 'dm_a9', 'dm_a3'), '[true, true, true]'::jsonb, 'ocupado em D para todos');
select ok(current_setting('t.dm_a7') not like '%Secreta%' and current_setting('t.dm_a7') not like '%Empresa A%'
          and current_setting('t.dm_a7') not like '%' || current_setting('t.q1') || '%'
          and current_setting('t.dm_a7') not like '%' || current_setting('t.qc') || '%'
          and pg_temp.d('dm_a7') -> 'meus' = '1'::jsonb and pg_temp.d('dm_a7', 1) -> 'meus' = '0'::jsonb,
  'outra empresa: só as próprias contagens, nada de endereços, ids ou empresa alheia');
select is(current_setting('t.coerente')::jsonb ->> 'ok', 'true', 'livre/dia_cheio coerentes com horarios_livres em todos os dias do mês');
select is(current_setting('t.coerente_atual')::jsonb ->> 'ok', 'true', 'idem no mês corrente (dias passados e futuros)');
select ok(coalesce((select bool_and(not (x ->> 'livre')::boolean and not (x ->> 'dia_cheio')::boolean)
                    from jsonb_array_elements(current_setting('t.atual')::jsonb -> 'dias') x
                    where (x ->> 'dia')::date < current_setting('t.hoje')::date), true),
  'dias passados: nem livre nem cheio');

-- Pré-reserva vencida (cron ainda não passou): sai da contagem, e o horário volta a ser livre.
update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = current_setting('t.q2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.v8', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.v2', api.dias_do_mes(current_setting('t.dia')::date, 120)::text, true);
reset role;
select is(pg_temp.campo('meus', 0, 'v8', 'v2'), '[0, 2]'::jsonb, 'pedido vencido não conta');
select is(pg_temp.d('v2') -> 'aguardando_voce', '1'::jsonb, 'nem como pendência do motorista');

update app.perfis set ativo = false where papel = 'MOTORISTA';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.dias_do_mes(current_setting('t.dia')::date, 120) ->> 'codigo', 'SEM_MOTORISTA', 'sem motorista ativo: SEM_MOTORISTA');
reset role;

select * from finish();
rollback;
