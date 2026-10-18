-- Fase 3B, Tarefa 1 (migration 20261018120000_execucao.sql): saída (permissão, janela de 60 min, uma viagem por
-- motorista, reserva → débito do valor aprovado, idempotência, cancelamento depois da saída recusado), nova previsão
-- (estende o bloco sem passar do próximo, marca e desmarca o atraso do próximo, validação), conclusão (não cobra,
-- desativa o bloco), pendências (em andamento atrasado continua aparecendo) e reconciliação limpa.
-- Concorrência real (10 saídas simultâneas; saída × cancelamento): tests/integracao/execucao.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local', 'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local');
update app.perfis set senha_pendente = false;

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5']) u;

-- s1 [+10 min, +40 min) e s3 [+40 min, +70 min) dentro da janela; s2 em +3 h (fora da janela). Todos aprovados.
create temp table casos (nome text primary key, atraso interval, total bigint) on commit drop;
insert into casos values ('s1', '10 minutes', 12345), ('s2', '3 hours', 5000), ('s3', '40 minutes', 7000);
do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select * from casos order by nome loop
    perform set_config('t.' || x.nome, api.criar_pedido(jsonb_build_object(
      'duracao_min', 30, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
      'carga', 'PESSOAS', 'pessoas_qtd', 1, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
      'inicio', to_char((now() + x.atraso) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ->> 'id', true);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
  for x in select * from casos order by nome loop
    perform api.enviar_orcamento(current_setting('t.' || x.nome)::uuid, jsonb_build_object('pedagio_cent', x.total), null);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca1'), true);
  perform api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 100000, 'Pix inicial', null, gen_random_uuid());
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select c.nome, o.versao, o.hash from casos c
             join app.orcamentos o on o.atividade_id = current_setting('t.' || c.nome)::uuid and o.status = 'PENDENTE'
            order by c.nome loop
    perform api.aprovar_orcamento(current_setting('t.' || x.nome)::uuid, x.versao, x.hash, gen_random_uuid(), null);
  end loop;
end $$;
select is((select count(*)::int from app.atividades a join casos c on a.id = current_setting('t.' || c.nome)::uuid
            where a.status = 'AGENDADA'), 3, '3 pedidos AGENDADA');
select set_config('t.k1', gen_random_uuid()::text, true);
select set_config('t.contabil0', (select saldo_contabil_cent::text from app.contas
                                   where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.reservado0', (select reservado_cent::text from app.contas
                                    where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);

------------------------------------------------------------------ 1. quem pode sair
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.registrar_saida(current_setting('t.s1')::uuid, gen_random_uuid()) ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não registra saída');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select is(api.registrar_saida(current_setting('t.s1')::uuid, gen_random_uuid()) ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não registra saída');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_saida(current_setting('t.s1')::uuid, null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'sem chave: recusada');
select is(api.registrar_saida(current_setting('t.s2')::uuid, gen_random_uuid()) ->> 'codigo', 'FORA_DA_JANELA',
  'mais de 60 min antes do início: FORA_DA_JANELA');
select ok((api.registrar_saida(current_setting('t.s2')::uuid, gen_random_uuid()) ->> 'libera_em') is not null,
  'FORA_DA_JANELA diz quando libera');

------------------------------------------------------------------ 2. saída: reserva → débito
select set_config('t.sai1', api.registrar_saida(current_setting('t.s1')::uuid, current_setting('t.k1')::uuid)::text, true);
select set_config('t.sai1b', api.registrar_saida(current_setting('t.s1')::uuid, current_setting('t.k1')::uuid)::text, true);
select set_config('t.sai1c', api.registrar_saida(current_setting('t.s1')::uuid, gen_random_uuid())::text, true);
select set_config('t.sai3', api.registrar_saida(current_setting('t.s3')::uuid, gen_random_uuid())::text, true);
reset role;

select is((current_setting('t.sai1')::jsonb - 'saiu_em'),
  jsonb_build_object('ok', true, 'atividade_id', current_setting('t.s1'), 'debitado_cent', 12345),
  'saída: {ok, atividade_id, debitado_cent} (sem saldo para o motorista)');
select ok(current_setting('t.sai1')::jsonb ? 'saiu_em', 'saída devolve saiu_em');
select is(current_setting('t.sai1b')::jsonb, current_setting('t.sai1')::jsonb, 'mesma chave: o resultado original');
select is(current_setting('t.sai1c')::jsonb ->> 'codigo', 'STATUS_INVALIDO', 'outra chave depois da saída: STATUS_INVALIDO');
select is(current_setting('t.sai3')::jsonb ->> 'codigo', 'OUTRA_EM_ANDAMENTO', 'segunda viagem do motorista: OUTRA_EM_ANDAMENTO');
select is((select status::text from app.atividades where id = current_setting('t.s1')::uuid), 'EM_ANDAMENTO', 'pedido EM_ANDAMENTO');
select ok((select saiu_em is not null from app.atividades where id = current_setting('t.s1')::uuid), 'saiu_em gravado');
select is((select count(*)::int from app.lancamentos where atividade_id = current_setting('t.s1')::uuid and tipo = 'DEBITO'
             and valor_cent = -12345), 1, 'um DEBITO do valor aprovado');
select ok((select l.orcamento_id = r.orcamento_id from app.lancamentos l
             join app.reservas r on r.atividade_id = l.atividade_id
            where l.atividade_id = current_setting('t.s1')::uuid and l.tipo = 'DEBITO'),
  'o DEBITO aponta para o orçamento da reserva');
select is((select count(*)::int from app.reservas where atividade_id = current_setting('t.s1')::uuid and ativa), 0,
  'reserva liberada');
select is((select count(*)::int from app.lancamentos where atividade_id = current_setting('t.s1')::uuid
             and tipo = 'LIBERACAO_RESERVA'), 1, 'um LIBERACAO_RESERVA');
select is((select saldo_contabil_cent from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('t.contabil0')::bigint - 12345, 'contábil cai o valor aprovado');
select is((select reservado_cent from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('t.reservado0')::bigint - 12345, 'reservado cai o mesmo valor (disponível igual)');
select ok((select ativo and tipo = 'RESERVA' from app.agenda_blocos where atividade_id = current_setting('t.s1')::uuid),
  'bloco da agenda segue ativo durante a viagem');
select is((select count(*)::int from app.auditoria where acao = 'REGISTRAR_SAIDA' and resultado = 'OK'
             and alvo = 'atividade:' || current_setting('t.s1')), 2, 'saída auditada (original e repetição)');

-- cancelamento depois da saída: não existe
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.cancelar_agendado(current_setting('t.s1')::uuid, null, gen_random_uuid(), 0) ->> 'codigo', 'STATUS_INVALIDO',
  'cancelar depois da saída: STATUS_INVALIDO');

------------------------------------------------------------------ 3. nova previsão
select is(api.informar_previsao(current_setting('t.s1')::uuid, now() + interval '60 minutes', null) ->> 'codigo',
  'SEM_PERMISSAO', 'cliente não informa previsão');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.informar_previsao(current_setting('t.s3')::uuid, now() + interval '60 minutes', null) ->> 'codigo',
  'STATUS_INVALIDO', 'previsão de pedido que não saiu: STATUS_INVALIDO');
select is(api.informar_previsao(current_setting('t.s1')::uuid, clock_timestamp() - interval '1 minute', null) ->> 'codigo',
  'PREVISAO_INVALIDA', 'previsão no passado: PREVISAO_INVALIDA');
select is(api.informar_previsao(current_setting('t.s1')::uuid, now() + interval '25 hours', null) ->> 'codigo',
  'PREVISAO_INVALIDA', 'previsão acima de 24 h: PREVISAO_INVALIDA');
select set_config('t.pv1', api.informar_previsao(current_setting('t.s1')::uuid, now() + interval '60 minutes',
  'Espera na balsa')::text, true);
reset role;
select ok((current_setting('t.pv1')::jsonb ->> 'conflito')::boolean
          and current_setting('t.pv1')::jsonb ->> 'proximo_id' = current_setting('t.s3'),
  'previsão que passa do início do próximo: conflito com s3');
select is((select upper(periodo) from app.agenda_blocos where atividade_id = current_setting('t.s1')::uuid),
  (select lower(periodo) from app.agenda_blocos where atividade_id = current_setting('t.s3')::uuid),
  'bloco de s1 vai só até o início de s3');
select is((select atraso_anterior_ate from app.atividades where id = current_setting('t.s3')::uuid),
  now() + interval '60 minutes', 's3 marcado com o atraso do anterior');
select is((select fim_previsto from app.atividades where id = current_setting('t.s1')::uuid),
  now() + interval '60 minutes', 'fim_previsto gravado');

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.pv2', api.informar_previsao(current_setting('t.s1')::uuid, now() + interval '35 minutes', null)::text, true);
reset role;
select ok(not (current_setting('t.pv2')::jsonb ->> 'conflito')::boolean, 'previsão menor: sem conflito');
select is((select upper(periodo) from app.agenda_blocos where atividade_id = current_setting('t.s1')::uuid),
  now() + interval '35 minutes', 'bloco de s1 até a nova previsão');
select ok((select atraso_anterior_ate is null from app.atividades where id = current_setting('t.s3')::uuid),
  'atraso de s3 desmarcado');

------------------------------------------------------------------ 4. pendências
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is((api.pendencias() -> 'proximos' -> 0 ->> 'id'), current_setting('t.s1'),
  'pendências: o pedido em andamento vem primeiro');
reset role;
update app.atividades set fim_previsto = now() - interval '5 minutes' where id = current_setting('t.s1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select ok((api.pendencias() -> 'proximos' -> 0 ->> 'atrasado')::boolean, 'em andamento depois da previsão: atrasado (não some)');

------------------------------------------------------------------ 5. conclusão
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.concluir(current_setting('t.s1')::uuid, null) ->> 'codigo', 'SEM_PERMISSAO', 'cliente não conclui');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.concluir(current_setting('t.s1')::uuid, repeat('x', 1001)) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'observação acima de 1000: recusada');
reset role;
select set_config('t.lanc_antes', (select count(*)::text from app.lancamentos), true);
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.concluir(current_setting('t.s1')::uuid, '  Entregue no galpão 2  ') ->> 'ok', 'true', 'motorista conclui');
select is(api.concluir(current_setting('t.s1')::uuid, null) ->> 'codigo', 'STATUS_INVALIDO', 'concluir de novo: STATUS_INVALIDO');
reset role;
select ok((select status = 'CONCLUIDA' and concluiu_em is not null and observacao_conclusao = 'Entregue no galpão 2'
             from app.atividades where id = current_setting('t.s1')::uuid), 'CONCLUIDA com hora e observação aparada');
select is((select count(*)::text from app.lancamentos), current_setting('t.lanc_antes'), 'conclusão não lança nada');
select ok((select not ativo from app.agenda_blocos where atividade_id = current_setting('t.s1')::uuid), 'bloco desativado');

-- com s1 concluída, s3 pode sair
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_saida(current_setting('t.s3')::uuid, gen_random_uuid()) ->> 'ok', 'true',
  'depois de concluir, a próxima viagem sai');
reset role;

------------------------------------------------------------------ 6. reconciliação
select is(interno.reconciliar() -> 'divergencias', '[]'::jsonb, 'reconciliação sem divergências depois de saídas e conclusão');

select * from finish();
rollback;
