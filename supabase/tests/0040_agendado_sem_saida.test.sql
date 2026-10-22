-- Migration 20261019120000_cancelar_agendado_sem_saida.sql: pedido AGENDADO que passou do fim do horário reservado
-- (início + duração, mínimo 1 h; a partir do atraso do serviço anterior, se houver) sem o motorista sair é cancelado
-- sozinho, sem multa, com a reserva devolvida; espera enquanto o motorista tem outra viagem em andamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
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
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a5']) u;

-- Pedidos aprovados em horários futuros e distintos; depois o teste "volta o relógio" do início de cada um.
--   vencido: começou há 3 h, 30 min de duração          → prazo há 2 h (mínimo de 1 h): cancela
--   cedo:    começou há 30 min, 30 min de duração       → prazo daqui a 30 min (mínimo de 1 h): espera
--   longo:   começou há 3 h, 240 min de duração         → prazo daqui a 1 h: espera
--   atraso:  começou há 3 h, 30 min, anterior atrasou até há 10 min → prazo daqui a 50 min: espera
--   viagem:  daqui a 10 min (vai sair e ficar EM_ANDAMENTO)
--   preso:   começou há 3 h, 30 min → vencido, mas espera enquanto "viagem" estiver em andamento
create temp table casos (nome text primary key, futuro interval, duracao int, total bigint) on commit drop;
insert into casos values
  ('vencido', '20 hours', 30, 11000), ('cedo', '21 hours', 30, 3000), ('longo', '22 hours', 240, 4000),
  ('atraso', '27 hours', 30, 5000), ('viagem', '10 minutes', 30, 6000), ('preso', '28 hours', 30, 7000);
do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select * from casos order by nome loop
    perform set_config('t.' || x.nome, api.criar_pedido(jsonb_build_object(
      'duracao_min', x.duracao, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
      'carga', 'PESSOAS', 'pessoas_qtd', 1, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
      'inicio', to_char((now() + x.futuro) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ->> 'id', true);
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
reset role;
select is((select count(*)::int from app.atividades a join casos c on a.id = current_setting('t.' || c.nome)::uuid
            where a.status = 'AGENDADA'), 6, '6 pedidos AGENDADA');

update app.atividades set inicio = now() - interval '3 hours', prazo_orcar_ate = now() - interval '4 hours'
 where id in (current_setting('t.vencido')::uuid, current_setting('t.longo')::uuid,
              current_setting('t.atraso')::uuid, current_setting('t.preso')::uuid);
update app.atividades set inicio = now() - interval '30 minutes', prazo_orcar_ate = now() - interval '4 hours'
 where id = current_setting('t.cedo')::uuid;
update app.atividades set atraso_anterior_ate = now() - interval '10 minutes' where id = current_setting('t.atraso')::uuid;
-- "preso" só entra na segunda rodada (com a viagem em andamento)
update app.atividades set inicio = now() + interval '28 hours' where id = current_setting('t.preso')::uuid;

select set_config('t.valor', (select valor_cent::text from app.reservas
                               where atividade_id = current_setting('t.vencido')::uuid and ativa), true);
select set_config('t.contabil0', (select saldo_contabil_cent::text from app.contas
                                   where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);
select set_config('t.reservado0', (select reservado_cent::text from app.contas
                                    where empresa_id = '00000000-0000-0000-0000-0000000000e1'), true);

------------------------------------------------------------------ 1. só o vencido é cancelado
-- o cron roda sem usuário (auth.uid() nulo)
select set_config('request.jwt.claims', '', true);
select is(interno.cancelar_agendados_sem_saida(), 1, 'primeira rodada cancela 1 pedido');
select is((select status::text from app.atividades where id = current_setting('t.vencido')::uuid), 'CANCELADA',
  'vencido: CANCELADA');
select is((select status::text from app.atividades where id = current_setting('t.cedo')::uuid), 'AGENDADA',
  'começou há 30 min: espera o mínimo de 1 h');
select is((select status::text from app.atividades where id = current_setting('t.longo')::uuid), 'AGENDADA',
  'duração de 4 h: espera o fim do horário reservado');
select is((select status::text from app.atividades where id = current_setting('t.atraso')::uuid), 'AGENDADA',
  'serviço anterior atrasou: o prazo conta a partir do atraso');

------------------------------------------------------------------ 2. dinheiro: reserva devolvida, sem multa
select ok((select not ativa and liberada_em is not null from app.reservas
            where atividade_id = current_setting('t.vencido')::uuid), 'reserva do vencido liberada');
select is((select sum(valor_cent)::bigint from app.lancamentos
            where atividade_id = current_setting('t.vencido')::uuid and tipo = 'LIBERACAO_RESERVA'),
  current_setting('t.valor')::bigint,
  'liberação do valor inteiro');
select is((select count(*)::int from app.lancamentos
            where atividade_id = current_setting('t.vencido')::uuid and tipo in ('MULTA', 'DEBITO')), 0,
  'sem multa e sem débito');
select is((select reservado_cent::bigint from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('t.reservado0')::bigint - current_setting('t.valor')::bigint, 'reservado cai o valor do pedido');
select is((select saldo_contabil_cent::text from app.contas where empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('t.contabil0'), 'saldo contábil não muda');

------------------------------------------------------------------ 3. registro, agenda e saída
select ok((select observacao like 'Cancelado automaticamente: o motorista não saiu no horário%' and por is null
             from app.atividade_historico
            where atividade_id = current_setting('t.vencido')::uuid and para = 'CANCELADA'),
  'histórico com o motivo, pelo sistema');
select ok((select not ativo from app.agenda_blocos where atividade_id = current_setting('t.vencido')::uuid),
  'horário liberado na agenda');
select is((select count(*)::int from app.auditoria
            where acao = 'CANCELAR_SEM_SAIDA' and alvo = 'atividade:' || current_setting('t.vencido')), 1, 'auditado');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_saida(current_setting('t.vencido')::uuid, gen_random_uuid()) ->> 'codigo', 'STATUS_INVALIDO',
  'motorista não sai mais no cancelado');
reset role;
select set_config('request.jwt.claims', '', true);
select is(interno.cancelar_agendados_sem_saida(), 0, 'segunda rodada sem nada novo: idempotente');

------------------------------------------------------------------ 4. motorista com viagem em andamento: espera
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.registrar_saida(current_setting('t.viagem')::uuid, gen_random_uuid()) ->> 'ok', 'true',
  'motorista sai na viagem');
reset role;
update app.atividades set inicio = now() - interval '3 hours' where id = current_setting('t.preso')::uuid;
select set_config('request.jwt.claims', '', true);
select is(interno.cancelar_agendados_sem_saida(), 0, 'com viagem em andamento, nada é cancelado');
select is((select status::text from app.atividades where id = current_setting('t.preso')::uuid), 'AGENDADA',
  'vencido espera o motorista terminar a viagem');
select is((select status::text from app.atividades where id = current_setting('t.viagem')::uuid), 'EM_ANDAMENTO',
  'viagem em andamento não é tocada');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.concluir(current_setting('t.viagem')::uuid, null) ->> 'ok', 'true', 'motorista conclui a viagem');
reset role;
select set_config('request.jwt.claims', '', true);
select is(interno.cancelar_agendados_sem_saida(), 0, 'concluiu há pouco: 1 h para sair no próximo');
-- passada 1 h da conclusão: o vencido e o que tinha atraso (a conclusão apaga a marca) são cancelados
update app.atividades set concluiu_em = now() - interval '61 minutes' where id = current_setting('t.viagem')::uuid;
select is(interno.cancelar_agendados_sem_saida(), 2, '1 h depois da conclusão, os vencidos são cancelados');

------------------------------------------------------------------ 5. reconciliação
select is(interno.reconciliar() -> 'divergencias', '[]'::jsonb, 'reconciliação sem divergências');

select * from finish();
rollback;
