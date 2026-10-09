-- Fase 2B, Task 3 (migration 20261009140200_acoes_dinheiro.sql): api.pedido → acoes.aprovar e acoes.cancelar_agendado
-- por perfil e estado (ORCADA: só o dono N2 e a N1 aprovam; AGENDADA: cliente que decide e prestador cancelam; N3,
-- colega N2, outra empresa e gestor de frota nunca). As RPCs conferem tudo de novo (0017).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local');
update app.perfis set senha_pendente = false;

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a8']) u;

-- Pedido do N2 (a5), orçado pelo motorista (a2), com R$ 100,00 de recarga lançada pelo ADM.
do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  v_id := (api.criar_pedido(jsonb_build_object(
    'duracao_min', 120, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
    'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
    'inicio', to_char((now() + interval '5 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ->> 'id')::uuid;
  perform set_config('t.p', v_id::text, true);
  perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
  perform api.enviar_orcamento(v_id, jsonb_build_object('pedagio_cent', 5000), null);
  perform set_config('request.jwt.claims', current_setting('t.ca1'), true);
  perform api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 10000, 'Pix inicial', null, gen_random_uuid());
end $$;

-- acoes vistas por quem (u) no estado atual
create function pg_temp.acoes(u text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', current_setting('t.c' || u), true);
  return api.pedido(current_setting('t.p')::uuid) -> 'acoes';
end $$;

------------------------------------------------------------------ ORCADA
select is(pg_temp.acoes('a5') -> 'aprovar', 'true'::jsonb, 'ORCADA: o dono (N2) pode aprovar');
select is(pg_temp.acoes('a4') -> 'aprovar', 'true'::jsonb, 'ORCADA: a N1 pode aprovar pela empresa');
select is(pg_temp.acoes('a6') -> 'aprovar', 'false'::jsonb, 'ORCADA: N3 não aprova');
select is(pg_temp.acoes('a8'), null::jsonb, 'ORCADA: colega N2 nem vê o pedido do colega (sem ações)');
select is(pg_temp.acoes('a2') -> 'aprovar', 'false'::jsonb, 'ORCADA: motorista não aprova');
select is(pg_temp.acoes('a1') -> 'aprovar', 'false'::jsonb, 'ORCADA: ADM não aprova pelo cliente');
select is(pg_temp.acoes('a5') -> 'cancelar_agendado', 'false'::jsonb, 'ORCADA: ainda não há agendamento para cancelar');

------------------------------------------------------------------ AGENDADA
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.aprovar_orcamento(current_setting('t.p')::uuid, 1,
            (select hash from app.orcamentos where atividade_id = current_setting('t.p')::uuid and status = 'PENDENTE'),
            gen_random_uuid(), 'pgTAP') ->> 'ok', 'true', 'dono aprova');
select ok(pg_temp.acoes('a5') @> '{"aprovar": false, "cancelar_agendado": true, "cancelar": false}',
  'AGENDADA: o dono cancela o agendamento (não aprova de novo)');
select is(pg_temp.acoes('a4') -> 'cancelar_agendado', 'true'::jsonb, 'AGENDADA: a N1 cancela');
select is(pg_temp.acoes('a2') -> 'cancelar_agendado', 'true'::jsonb, 'AGENDADA: o motorista atribuído cancela (sem custo)');
select is(pg_temp.acoes('a1') -> 'cancelar_agendado', 'true'::jsonb, 'AGENDADA: o ADM cancela (sem custo)');
select is(pg_temp.acoes('a6') -> 'cancelar_agendado', 'false'::jsonb, 'AGENDADA: N3 não cancela');
select is(pg_temp.acoes('a8'), null::jsonb, 'AGENDADA: colega N2 nem vê o pedido do colega (sem ações)');
select is(pg_temp.acoes('a3') -> 'cancelar_agendado', 'false'::jsonb, 'AGENDADA: gestor de frota não cancela');

------------------------------------------------------------------ CANCELADA
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select api.cancelar_agendado(current_setting('t.p')::uuid, null, gen_random_uuid(), 0);
select ok(pg_temp.acoes('a5') @> '{"aprovar": false, "cancelar_agendado": false}', 'CANCELADA: nada mais a fazer');

select * from finish();
rollback;
