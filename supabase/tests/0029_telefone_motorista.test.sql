-- Fase 4, Tarefa 10 (migration 20261020120200_telefone_motorista.sql, Ruling R14): api.pedido devolve
-- `motorista_telefone`, o telefone do perfil do motorista do pedido, para o botão "Ligar" do acompanhamento do cliente.
-- Só a partir de AGENDADA (AGENDADA, EM_ANDAMENTO e CONCLUIDA) e só para quem pode ver o pedido; nulo antes disso, no
-- cancelado e quando o perfil não tem telefone. Quem não vê o pedido continua recebendo NAO_ENCONTRADO (nada vaza).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Passageiro A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local', 'Gestor B',        'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set telefone = '(47) 99999-1234' where usuario_id = '00000000-0000-0000-0000-0000000000a2';

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a4', 'a5', 'a6', 'a7']) u;
select set_config('t.base', '{"duracao_min": 30, "origem": "Porto de Itajaí", "destino": "Base Navegantes", "levar": true,
  "trazer": false, "carga": "PESSOAS", "pessoas_qtd": 1, "modalidade": "VEICULO_PROPRIO", "reboque": "NAO"}', true);
select set_config('t.i_' || n, to_char((now() + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true)
from (values ('p1', interval '3 hours'), ('p2', interval '6 hours')) x(n, d);

-- Só o campo novo (se a chave veio e o valor) de uma leitura guardada em t.<nome>, ou o código da negação.
-- As leituras rodam como authenticated; as asserções, depois do reset role.
create function pg_temp.tel(nome text) returns jsonb language sql stable as $$
  select case when (r ->> 'ok')::boolean then jsonb_build_object('tem', (r -> 'pedido') ? 'motorista_telefone',
                                                                 'tel', r #> '{pedido,motorista_telefone}')
              else jsonb_build_object('codigo', r -> 'codigo') end
    from (select current_setting('t.' || nome)::jsonb r) x
$$;

------------------------------------------------------------------ SOLICITADA e ORCADA: a chave vem, nula
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.p1', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p1'))) ->> 'id', true);
select set_config('t.p2', api.criar_pedido(current_setting('t.base')::jsonb
  || jsonb_build_object('inicio', current_setting('t.i_p2'))) ->> 'id', true);
select set_config('t.sol', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.o1', api.enviar_orcamento(current_setting('t.p1')::uuid, '{"km": 10}', null)::text, true);
select set_config('t.o2', api.enviar_orcamento(current_setting('t.p2')::uuid, '{"km": 10}', null)::text, true);
select set_config('t.orc_mot', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.orc_n2', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select is(pg_temp.tel('sol'), '{"tem": true, "tel": null}'::jsonb, 'SOLICITADA: chave presente e nula');
select ok(current_setting('t.o1')::jsonb ->> 'ok' = 'true' and current_setting('t.o2')::jsonb ->> 'ok' = 'true',
  'p1 e p2 orçados (app atual, sem os campos novos)');
select is(pg_temp.tel('orc_n2'), '{"tem": true, "tel": null}'::jsonb, 'ORCADA: ainda nulo para o cliente');
select is(pg_temp.tel('orc_mot'), '{"tem": true, "tel": null}'::jsonb, 'ORCADA: nulo até para o motorista');

------------------------------------------------------------------ AGENDADA: quem vê o pedido vê o telefone
select interno.transicionar(current_setting('t.p1')::uuid, 'AGENDADA', 'teste');
select interno.transicionar(current_setting('t.p2')::uuid, 'AGENDADA', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.ag_n2', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select set_config('t.ag_n1', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.ag_n3', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.ag_adm', api.pedido(current_setting('t.p1')::uuid)::text, true);
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select set_config('t.ag_b', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select is(pg_temp.tel('ag_n2'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'AGENDADA: N2 dono vê o telefone');
select is(pg_temp.tel('ag_n1'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'AGENDADA: N1 da empresa vê');
select is(pg_temp.tel('ag_n3'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'AGENDADA: N3 da empresa (vê o pedido) vê');
select is(pg_temp.tel('ag_adm'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'AGENDADA: ADM vê');
select is(pg_temp.tel('ag_b'), '{"codigo": "NAO_ENCONTRADO"}'::jsonb, 'outra empresa: NAO_ENCONTRADO, sem telefone');

------------------------------------------------------------------ EM_ANDAMENTO e CONCLUIDA
select interno.transicionar(current_setting('t.p1')::uuid, 'EM_ANDAMENTO', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.and', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select is(pg_temp.tel('and'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'EM_ANDAMENTO: telefone');
select interno.transicionar(current_setting('t.p1')::uuid, 'CONCLUIDA', 'teste');
-- R18 (20261020120400): em CONCLUIDA o telefone só sai nas 24 h depois da conclusão (concluir_servico grava concluiu_em).
update app.atividades set concluiu_em = now() where id = current_setting('t.p1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.con', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select is(pg_temp.tel('con'), '{"tem": true, "tel": "(47) 99999-1234"}'::jsonb, 'CONCLUIDA: telefone');

------------------------------------------------------------------ cancelado depois de agendado: some
select interno.transicionar(current_setting('t.p2')::uuid, 'CANCELADA', 'teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.can', api.pedido(current_setting('t.p2')::uuid)::text, true);
reset role;
select is(pg_temp.tel('can'), '{"tem": true, "tel": null}'::jsonb, 'CANCELADA: nulo');

------------------------------------------------------------------ perfil sem telefone (ou só espaços): nulo
update app.perfis set telefone = '   ' where usuario_id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.branco', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
update app.perfis set telefone = null where usuario_id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.nulo', api.pedido(current_setting('t.p1')::uuid)::text, true);
reset role;
select is(pg_temp.tel('branco'), '{"tem": true, "tel": null}'::jsonb, 'telefone em branco: nulo');
select is(pg_temp.tel('nulo'), '{"tem": true, "tel": null}'::jsonb, 'sem telefone no perfil: nulo');

------------------------------------------------------------------ o resto do detalhe não muda; a função segue fechada
select ok(current_setting('t.ag_n2')::jsonb #>> '{pedido,motorista_nome}' = 'Motorista Teste'
          and current_setting('t.ag_n2')::jsonb #>> '{pedido,status}' = 'AGENDADA'
          and current_setting('t.ag_n2')::jsonb #> '{pedido,ultima_posicao}' = 'null'::jsonb
          and current_setting('t.ag_n2')::jsonb ? 'acoes',
  'o detalhe continua com os campos de antes');
select ok(not has_function_privilege('anon', 'api.pedido(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'api.pedido(uuid)', 'EXECUTE'),
  'api.pedido: authenticated executa, anon não');
select ok((select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p
            where p.oid = 'api.pedido(uuid)'::regprocedure),
  'api.pedido: security definer com search_path vazio');

select * from finish();
rollback;
