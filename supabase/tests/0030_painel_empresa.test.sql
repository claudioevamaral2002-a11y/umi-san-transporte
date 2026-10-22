-- Fase 4, Tarefa 14 (migration 20261020120300_painel_empresa.sql, especificação §6.9): api.painel_empresa, a leitura do
-- "Painel da empresa" (resumo do mês, próximas corridas, corridas recentes e pessoas), e a chave nova de Configurações
-- `contato_recarga` (api.definir_contato_recarga, editada pelo ADM; lida por ler_configuracao e pelo painel).
-- O N1 vê só a própria empresa (p_empresa ignorado); o ADM informa a empresa; os outros recebem SEM_PERMISSAO, auditado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',      'ADM',       null, null),
  ('mot@teste.local',  'Motorista Teste',  'MOTORISTA', null, null),
  ('n1a@teste.local',  'Gestora A',        'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local',  'Solicitante A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local',  'Gestor B',         'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('ina@teste.local',  'Inativo A',        'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('vel@teste.local',  'Antigo A',         'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('pen@teste.local',  'Pendente A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('ven@teste.local',  'Vencido A',        'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vel@teste.local'),
  ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pen@teste.local'),
  ('00000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ven@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a8';
-- Dois convidados que ainda não criaram a senha: um com o link válido (pendente), outro com o link vencido.
update app.perfis set senha_pendente = true
 where usuario_id in ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-0000000000ac');
insert into interno.links_acesso (codigo_hash, token_hash, tipo, usuario_id, expira_em) values
  (md5('pendente') || md5('p'), 'token-pendente-123', 'invite',
   '00000000-0000-0000-0000-0000000000ab', now() + interval '20 hours'),
  (md5('vencido') || md5('v'), 'token-vencido-1234', 'invite',
   '00000000-0000-0000-0000-0000000000ac', now() - interval '1 hour');
-- Convites ainda sem usuário: um de agora (pendente) e um de 2 dias atrás (o link de 24 h venceu).
insert into app.convites (email, nome, papel, empresa_id, nivel, criado_em) values
  ('novo@teste.local',  'Novo A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2, now() - interval '1 hour'),
  ('velho@teste.local', 'Velho A', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2, now() - interval '2 days');

select interno.inserir_contrato(e, '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste')
from unnest(array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[]) e;

-- Começo do mês atual em São Paulo (o mesmo cálculo que a RPC faz com p_mes nulo).
select set_config('t.ini', ((date_trunc('month', now() at time zone 'America/Sao_Paulo'))
                             at time zone 'America/Sao_Paulo')::text, true);

-- Pedidos inseridos direto (a defesa "nasce SOLICITADA" fica desligada só nesta transação de teste).
create function pg_temp.ped(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid
$$;
create function pg_temp.ativ(n int, st app.status_atividade, inicio timestamptz,
                             sol text default 'a4', emp text default 'e1', criada timestamptz default now())
returns void language sql as $$
  insert into app.atividades (id, empresa_id, solicitante_id, motorista_id, status, inicio, duracao_min, origem, destino,
                              levar, trazer, carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate, criada_em,
                              categoria, centro_custo)
  values (pg_temp.ped(n), ('00000000-0000-0000-0000-0000000000' || emp)::uuid,
          ('00000000-0000-0000-0000-0000000000' || sol)::uuid, '00000000-0000-0000-0000-0000000000a2', st, inicio, 60,
          'Umi San · Rua Araguaia, 49', 'Porto de Itajaí · Portão 3', true, false, 'PESSOAS', 1, 'VEICULO_PROPRIO', 'NAO',
          inicio - interval '1 hour', criada, 'PASSAGEIROS', 'Operações 4.100')
$$;
create function pg_temp.orc(n int, total bigint, st text) returns uuid language sql as $$
  insert into app.orcamentos (atividade_id, versao, modalidade, entrada, linhas, total_cent, contrato_versao, snapshot,
                              valido_ate, status, hash, enviado_por)
  values (pg_temp.ped(n), 1, 'VEICULO_PROPRIO', '{}', '[]', total, 1, '{}', now() + interval '1 day', st,
          repeat('a', 64), '00000000-0000-0000-0000-0000000000a2')
  returning id
$$;

alter table app.atividades disable trigger atividades_status;
-- Próximas: 12 candidatas inseridas fora de ordem (só as 10 primeiras por início voltam).
select pg_temp.ativ(n, case n when 1 then 'AGENDADA' when 2 then 'ORCADA' else 'SOLICITADA' end::app.status_atividade,
                    now() + make_interval(days => n))
from generate_series(12, 1, -1) n;
-- Recentes (e as que ficam de fora: mais de 30 dias).
select pg_temp.ativ(20, 'EM_ANDAMENTO', now() - interval '1 hour');
select pg_temp.ativ(21, 'CONCLUIDA', now() - interval '5 days');
select pg_temp.ativ(22, 'CANCELADA', now() - interval '3 days');
select pg_temp.ativ(23, 'EXPIRADA', now() - interval '40 days');
select pg_temp.ativ(24, 'CONCLUIDA', now() - interval '35 days');
select pg_temp.ativ(26, 'RECUSADA', now() - interval '10 days');
select pg_temp.ativ(27, 'CONCLUIDA', now() - interval '100 days', 'a9', 'e1', now() - interval '100 days');
-- Empresa B.
select pg_temp.ativ(25, 'AGENDADA', now() + interval '1 day', 'a7', 'e2');
alter table app.atividades enable trigger atividades_status;

select set_config('t.o1', pg_temp.orc(1, 22000, 'APROVADO')::text, true);
select pg_temp.orc(2, 16500, 'PENDENTE');
select pg_temp.orc(20, 22000, 'APROVADO');
select pg_temp.orc(21, 22000, 'APROVADO');
select pg_temp.orc(22, 33000, 'APROVADO');

-- Livro-razão da empresa A.
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, motivo, chave_idempotencia, criado_em) values
  ('00000000-0000-0000-0000-0000000000e1', 'RECARGA', 100000, null, 'recarga antiga', gen_random_uuid(),
   current_setting('t.ini')::timestamptz - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000e1', 'DEBITO', -5000, pg_temp.ped(24), null, gen_random_uuid(),
   current_setting('t.ini')::timestamptz - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e1', 'RECARGA', 30000, null, 'recarga do mês', gen_random_uuid(), now()),
  ('00000000-0000-0000-0000-0000000000e1', 'DEBITO', -22000, pg_temp.ped(21), null, gen_random_uuid(), now()),
  ('00000000-0000-0000-0000-0000000000e1', 'MULTA', -3300, pg_temp.ped(22), null, gen_random_uuid(), now());
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, estorna_id, motivo, chave_idempotencia)
select '00000000-0000-0000-0000-0000000000e1', 'ESTORNO', 5000, pg_temp.ped(24), l.id, 'estorno do débito', gen_random_uuid()
  from app.lancamentos l where l.atividade_id = pg_temp.ped(24) and l.tipo = 'DEBITO';
insert into app.reservas (empresa_id, atividade_id, orcamento_id, valor_cent)
values ('00000000-0000-0000-0000-0000000000e1', pg_temp.ped(1), current_setting('t.o1')::uuid, 22000);
insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, chave_idempotencia)
select r.empresa_id, 'RESERVA', r.valor_cent, r.atividade_id, r.orcamento_id, r.id, gen_random_uuid()
  from app.reservas r where r.atividade_id = pg_temp.ped(1);

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4', 'a5', 'a6', 'a7']) u;

------------------------------------------------------------------ privilégios
select ok(has_function_privilege('authenticated', 'api.painel_empresa(uuid, date)', 'EXECUTE')
      and not has_function_privilege('anon', 'api.painel_empresa(uuid, date)', 'EXECUTE')
      and has_function_privilege('authenticated', 'api.definir_contato_recarga(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'api.definir_contato_recarga(text)', 'EXECUTE'), 'privilégios: só authenticated');

------------------------------------------------------------------ leituras
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.cr_ok', api.definir_contato_recarga('  (47) 99999-0000 · WhatsApp  ')::text, true);
select set_config('t.cr_longo', api.definir_contato_recarga(repeat('9', 61))::text, true);
select set_config('t.conf', (select to_jsonb(c) from api.ler_configuracao() c)::text, true);
select set_config('t.adm_sem', api.painel_empresa()::text, true);
select set_config('t.adm', api.painel_empresa('00000000-0000-0000-0000-0000000000e1')::text, true);
select set_config('t.adm_nao', api.painel_empresa('00000000-0000-0000-0000-0000000000ee')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.n1', api.painel_empresa('00000000-0000-0000-0000-0000000000e2')::text, true);
select set_config('t.n1_ant', api.painel_empresa(null, (current_setting('t.ini')::timestamptz at time zone 'America/Sao_Paulo')::date
                                                       - 1)::text, true);
select set_config('t.n1_cr', api.definir_contato_recarga('(47) 3333-0000')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.n1b', api.painel_empresa()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.n2', api.painel_empresa()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.n3', api.painel_empresa()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.mot', api.painel_empresa('00000000-0000-0000-0000-0000000000e1')::text, true);
reset role;

------------------------------------------------------------------ contato_recarga (Configurações)
select is(current_setting('t.cr_ok')::jsonb, '{"ok": true}'::jsonb, 'ADM grava o contato de recarga');
select is(current_setting('t.conf')::jsonb ->> 'contato_recarga', '(47) 99999-0000 · WhatsApp',
  'ler_configuracao devolve o contato (sem espaços nas pontas)');
select is(current_setting('t.cr_longo')::jsonb ->> 'codigo', 'CAMPOS_INVALIDOS', 'contato com mais de 60 caracteres: recusado');
select is(current_setting('t.n1_cr')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'N1 não edita o contato de recarga');

------------------------------------------------------------------ quem vê
select is(current_setting('t.adm_sem')::jsonb, '{"ok": false, "codigo": "CAMPOS_INVALIDOS"}'::jsonb,
  'ADM sem p_empresa: CAMPOS_INVALIDOS');
select is(current_setting('t.adm_nao')::jsonb, '{"ok": false, "codigo": "NAO_ENCONTRADO"}'::jsonb,
  'ADM com empresa inexistente: NAO_ENCONTRADO');
select ok(current_setting('t.n2')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb
      and current_setting('t.n3')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb
      and current_setting('t.mot')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb,
  'N2, N3 e motorista: SEM_PERMISSAO');
select ok((select count(*) from app.auditoria where acao = 'PAINEL_EMPRESA' and resultado = 'NEGADO'
             and usuario_id in ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a6')) = 2,
  'negações auditadas');
select is(current_setting('t.n1')::jsonb - 'gerado_em', current_setting('t.adm')::jsonb - 'gerado_em',
  'N1 vê só a própria empresa, mesmo passando outra em p_empresa (igual ao que o ADM vê da empresa A)');
select is((select string_agg(x ->> 'id', ',') from jsonb_array_elements(current_setting('t.n1b')::jsonb -> 'proximas') x),
  pg_temp.ped(25)::text, 'N1 da empresa B vê só o pedido da B');

------------------------------------------------------------------ resumo do mês
select is(current_setting('t.n1')::jsonb #>> '{resumo,mes}',
  to_char(current_setting('t.ini')::timestamptz at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
  'mes: o 1º dia do mês atual em São Paulo');
select is((current_setting('t.n1')::jsonb #>> '{resumo,gasto_cent}')::bigint, 20300::bigint,
  'gasto_cent = débito 220,00 + multa 33,00 − estorno 50,00 = 203,00');
select is((current_setting('t.n1')::jsonb #>> '{resumo,reservado_cent}')::bigint, 22000::bigint, 'reservado_cent = a RESERVA ativa');
select is((current_setting('t.n1')::jsonb #>> '{resumo,disponivel_cent}')::bigint, 82700::bigint,
  'disponivel_cent = saldo contábil 1.047,00 − reservado 220,00');
select is((current_setting('t.n1')::jsonb #>> '{resumo,total_mes_cent}')::bigint, 175000::bigint,
  'total_mes_cent = saldo no 1º dia 950,00 + recargas do mês 300,00 + limite 500,00');
select is(current_setting('t.n1')::jsonb #>> '{resumo,contato_recarga}', '(47) 99999-0000 · WhatsApp',
  'contato_recarga das Configurações');
select is((current_setting('t.n1_ant')::jsonb #>> '{resumo,gasto_cent}')::bigint, 5000::bigint,
  'p_mes do mês anterior: o gasto daquele mês');

------------------------------------------------------------------ próximas
select is((select string_agg(x ->> 'id', ',' order by o) from jsonb_array_elements(current_setting('t.n1')::jsonb -> 'proximas')
           with ordinality y(x, o)),
  (select string_agg(pg_temp.ped(n)::text, ',' order by n) from generate_series(1, 10) n),
  'proximas: no máximo 10, por início crescente');
select is((current_setting('t.n1')::jsonb #> '{proximas,0}') - 'numero' - 'inicio' - 'fim_previsto',
  jsonb_build_object('id', pg_temp.ped(1), 'solicitante_nome', 'Gestora A', 'origem', 'Umi San · Rua Araguaia, 49',
    'destino', 'Porto de Itajaí · Portão 3', 'categoria_nome', 'IVO Passageiros', 'centro_custo', 'Operações 4.100',
    'status', 'AGENDADA', 'valor_cent', 22000, 'estimado', false, 'paradas', '[]'::jsonb, 'horas_estimadas', null),
  'pedido agendado: os campos e o valor do orçamento aprovado');
select ok((current_setting('t.n1')::jsonb #>> '{proximas,0,numero}')::bigint > 0
      and (current_setting('t.n1')::jsonb #>> '{proximas,0,fim_previsto}')::timestamptz
          = (current_setting('t.n1')::jsonb #>> '{proximas,0,inicio}')::timestamptz + interval '60 minutes',
  'número e fim previsto (início + duração)');
select is(current_setting('t.n1')::jsonb #> '{proximas,1}' -> 'valor_cent', '16500'::jsonb,
  'pedido orçado: o valor do orçamento pendente');
select ok(current_setting('t.n1')::jsonb #> '{proximas,2}' -> 'valor_cent' = 'null'::jsonb
      and current_setting('t.n1')::jsonb #> '{proximas,2}' -> 'estimado' = 'true'::jsonb,
  'pedido sem orçamento: valor nulo e estimado');

------------------------------------------------------------------ recentes
select is((select string_agg(x ->> 'status', ',' order by o) from jsonb_array_elements(current_setting('t.n1')::jsonb -> 'recentes')
           with ordinality y(x, o)),
  'EM_ANDAMENTO,CANCELADA,CONCLUIDA,RECUSADA', 'recentes: últimos 30 dias, por início decrescente (sem os mais antigos)');
select is(current_setting('t.n1')::jsonb #> '{recentes,1}' -> 'valor_cent', '3300'::jsonb, 'cancelado com multa: valor = a multa');
select ok(current_setting('t.n1')::jsonb #> '{recentes,3}' -> 'valor_cent' = 'null'::jsonb
      and current_setting('t.n1')::jsonb #> '{recentes,3}' -> 'estimado' = 'false'::jsonb,
  'recusado: sem valor e não estimado');

------------------------------------------------------------------ do mês (CSV)
select is((select coalesce(string_agg(x ->> 'id', ',' order by o), '')
             from jsonb_array_elements(current_setting('t.n1')::jsonb -> 'do_mes') with ordinality y(x, o)),
  (select coalesce(string_agg(a.id::text, ',' order by a.inicio), '') from app.atividades a
    where a.empresa_id = '00000000-0000-0000-0000-0000000000e1' and a.status in ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')
      and a.inicio >= current_setting('t.ini')::timestamptz
      and a.inicio < (current_setting('t.ini')::timestamptz at time zone 'America/Sao_Paulo' + interval '1 month')
                     at time zone 'America/Sao_Paulo'),
  'do_mes: as corridas do mês que podem ter cobrança, por início');
select ok(position(pg_temp.ped(20)::text in current_setting('t.n1')::jsonb ->> 'do_mes') > 0
      or now() - interval '1 hour' < current_setting('t.ini')::timestamptz,
  'do_mes traz a corrida em andamento do mês');

------------------------------------------------------------------ pessoas
select is((current_setting('t.n1')::jsonb #>> '{pessoas,sem_corridas}')::int, 4,
  'sem_corridas: N1 e N2 ativos sem pedido nos últimos 90 dias (sem o N3 e o inativo)');
select is((current_setting('t.n1')::jsonb #>> '{pessoas,convites_pendentes}')::int, 2,
  'convites_pendentes: não usados e não vencidos (o vencido não conta)');

------------------------------------------------------------------ só leitura
select is((select count(*) from app.auditoria where acao = 'PAINEL_EMPRESA' and resultado <> 'NEGADO'), 0::bigint,
  'leitura bem-sucedida não grava nada');

select * from finish();
rollback;
