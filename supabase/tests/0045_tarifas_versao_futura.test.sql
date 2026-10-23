-- Fase 4.1, revisão final I1 (migration 20261022120400_tarifas_versao_futura.sql): publicar_tarifas recusa com
-- VERSAO_FUTURA_PENDENTE (negação auditada, nenhuma versão criada) enquanto a empresa (ou a tabela modelo, com
-- p_empresa nulo) tem uma versão com vigente_desde > now(). Sem versão futura, publicar continua funcionando; a
-- pendente de uma empresa não trava outra nem o modelo, e a do modelo não trava as empresas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste', 'ADM', null, null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local');
update app.perfis set senha_pendente = false;

select set_config('t.contrato', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}', true);
-- v1 vigente das duas empresas e do modelo.
select interno.inserir_contrato(e, current_setting('t.contrato')::jsonb, now() - interval '1 hour', null, 'Teste')
from (values ('00000000-0000-0000-0000-0000000000e1'::uuid), ('00000000-0000-0000-0000-0000000000e2'::uuid), (null::uuid)) x(e);

select set_config('t.ca1', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                                             'aal', 'aal2')::text, true);
-- Todas as categorias ativas (Passageiros, Carga Leve e IVO Motorista; Carga Pesada vem desligada).
select set_config('t.tar', '{
  "PASSAGEIROS": {"taxa_fixa_cent": 4000, "km_cent": 350, "hora_cent": 0, "hora_espera_cent": 5000, "parada_cent": 1500,
                  "retorno_bp": 2000, "reboque_cent": 0, "hospedagem_diaria_cent": 18000},
  "CARGA_LEVE":  {"taxa_fixa_cent": 0, "km_cent": 500, "hora_cent": 0, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 2500, "hospedagem_diaria_cent": 0},
  "MOTORISTA":   {"taxa_fixa_cent": 0, "km_cent": 0, "hora_cent": 9000, "hora_espera_cent": 0, "parada_cent": 0,
                  "retorno_bp": 0, "reboque_cent": 0, "hospedagem_diaria_cent": 18000}}', true);

create function pg_temp.versoes(p_empresa uuid) returns int language sql stable as $$
  select count(*)::int from app.contratos_versoes c
   where (p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa
$$;
select set_config('t.modelo_antes', pg_temp.versoes(null)::text, true);

------------------------------------------------------------------ 1. empresa com versão futura pendente
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
-- Sem versão futura: publicar para amanhã funciona (v2 agendada).
select set_config('t.f1', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb,
  now() + interval '1 day')::text, true);
-- Com a v2 pendente: publicar agora (ou para depois) é recusado.
select set_config('t.f2', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb, now())::text, true);
select set_config('t.f3', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e1', current_setting('t.tar')::jsonb,
  now() + interval '2 days')::text, true);
reset role;

select is(current_setting('t.f1')::jsonb, '{"ok": true, "versao": 2}'::jsonb, 'sem versão futura: publica a v2 para amanhã');
select is(current_setting('t.f2')::jsonb, '{"ok": false, "codigo": "VERSAO_FUTURA_PENDENTE"}'::jsonb,
  'com a v2 pendente: publicar agora é recusado');
select is(current_setting('t.f3')::jsonb ->> 'codigo', 'VERSAO_FUTURA_PENDENTE', 'com a v2 pendente: publicar para depois também');
select is((select count(*)::int from app.auditoria
            where acao = 'PUBLICAR_TARIFAS' and resultado = 'NEGADO' and codigo = 'VERSAO_FUTURA_PENDENTE'
              and alvo = 'contrato:00000000-0000-0000-0000-0000000000e1'
              and usuario_id = '00000000-0000-0000-0000-0000000000a1'), 2, 'as duas recusas auditadas');
select is(pg_temp.versoes('00000000-0000-0000-0000-0000000000e1'), 2, 'as recusas não criaram versão');
select is((select count(*)::int from app.tarifas_categoria t join app.contratos_versoes v on v.id = t.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e1' and v.versao = 2), 3,
  'a v2 pendente mantém as próprias tarifas');

------------------------------------------------------------------ 2. sem versão futura continua funcionando
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.g1', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e2', current_setting('t.tar')::jsonb, now())::text, true);
select set_config('t.m1', api.publicar_tarifas(null, current_setting('t.tar')::jsonb, now())::text, true);
reset role;

select is(current_setting('t.g1')::jsonb, '{"ok": true, "versao": 2}'::jsonb,
  'outra empresa (sem versão futura) publica agora: a pendente da Empresa A não a trava');
select is((select string_agg(t.categoria || ':' || t.km_cent, ',' order by t.categoria)
             from app.tarifas_categoria t join app.contratos_versoes v on v.id = t.contrato_id
            where v.empresa_id = '00000000-0000-0000-0000-0000000000e2' and v.versao = 2),
  'CARGA_LEVE:500,MOTORISTA:0,PASSAGEIROS:350', 'as tarifas da Empresa B gravadas');
select ok((current_setting('t.m1')::jsonb ->> 'ok')::boolean
          and pg_temp.versoes(null) = current_setting('t.modelo_antes')::int + 1,
  'o modelo (sem versão futura) publica agora');

------------------------------------------------------------------ 3. modelo com versão futura pendente
select interno.inserir_contrato(null, current_setting('t.contrato')::jsonb, now() + interval '3 days', null, 'Teste');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.m2', api.publicar_tarifas(null, current_setting('t.tar')::jsonb, now())::text, true);
select set_config('t.g2', api.publicar_tarifas('00000000-0000-0000-0000-0000000000e2', current_setting('t.tar')::jsonb, now())::text, true);
reset role;

select is(current_setting('t.m2')::jsonb, '{"ok": false, "codigo": "VERSAO_FUTURA_PENDENTE"}'::jsonb,
  'modelo com versão futura: publicar a tabela modelo é recusado');
select ok(exists (select 1 from app.auditoria
                   where acao = 'PUBLICAR_TARIFAS' and resultado = 'NEGADO' and codigo = 'VERSAO_FUTURA_PENDENTE'
                     and alvo = 'contrato:modelo'), 'a recusa do modelo auditada');
select is(current_setting('t.g2')::jsonb, '{"ok": true, "versao": 3}'::jsonb,
  'a versão futura do modelo não trava a empresa');

select * from finish();
rollback;
