-- Parâmetros versionados (fase 1): publicação, validação de faixas, imutabilidade, vigência e acesso.
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id) values
  ('adm@teste.local',  'Admin Teste',     'ADM',       null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA', null),
  ('clia@teste.local', 'Cliente A',       'CLIENTE',   '00000000-0000-0000-0000-0000000000e1');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clia@teste.local');
update app.perfis set senha_pendente = false;

-- Parâmetros-base válidos (lidos via current_setting para valer em qualquer papel).
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [
    {"antecedencia_min_horas": 24, "multa_bp": 0},
    {"antecedencia_min_horas": 6, "multa_bp": 5000},
    {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000, "retencao_fotos_dias": 30
}', true);

-- Nada semeado.
select is((select count(*)::int from app.parametros_versoes), 0, 'nenhuma versão semeada');

set local role authenticated;

-- Motorista sem delegação: negado e auditado.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(
  api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'motorista sem delegação: SEM_PERMISSAO');

-- Cliente: negado.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(
  api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'cliente: SEM_PERMISSAO');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select ok(
  exists (select 1 from app.auditoria
          where acao = 'PUBLICAR_PARAMETROS' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'
            and usuario_id = '00000000-0000-0000-0000-0000000000a2'),
  'negação do motorista auditada (NEGADO/SEM_PERMISSAO)');
select is((select count(*)::int from app.parametros_versoes), 0, 'negações não criam versão');
select is_empty($$ select 1 from api.parametros_vigentes $$, 'sem versão publicada: parametros_vigentes vazia');

-- ADM publica a v1 (vigência futura).
select is(
  api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'ok',
  'true', 'ADM publica a 1ª versão');
select ok(
  exists (select 1 from app.parametros_versoes
          where km_sem_reboque_cent = 250 and retorno_trecho_unico_bp = 5000 and retencao_fotos_dias = 30
            and publicado_por = '00000000-0000-0000-0000-0000000000a1'
            and jsonb_array_length(faixas_cancelamento) = 3),
  'versão gravada com os valores, as faixas e o autor');
select ok(
  exists (select 1 from app.auditoria
          where acao = 'PUBLICAR_PARAMETROS' and resultado = 'OK'
            and alvo = 'parametros:' || (select min(versao) from app.parametros_versoes)
            and (detalhe ->> 'versao')::int = (select min(versao) from app.parametros_versoes)),
  'publicação auditada como OK com a versão');
select is_empty($$ select 1 from api.parametros_vigentes $$, 'só versões futuras: parametros_vigentes segue vazia');

-- v2: nova versão; a anterior fica intacta.
select is(
  api.publicar_parametros(current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 300}', now() + interval '2 hours') ->> 'ok',
  'true', 'ADM publica a 2ª versão');
select is((select count(*)::int from app.parametros_versoes), 2, 'publicar cria linha nova (2 versões)');
select is(
  api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '3 hours') ->> 'ok',
  'true', 'ADM publica a 3ª versão');
select is((select count(*)::int from app.parametros_versoes), 3, 'cada publicação soma uma linha (3 versões)');
select is(
  (select km_sem_reboque_cent from app.parametros_versoes order by versao limit 1), 250::bigint,
  'a versão anterior permanece intacta');

-- Faixas inválidas.
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"faixas_cancelamento": []}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'faixas vazia recusada');
select is(api.publicar_parametros(current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 24, "multa_bp": 5000}, {"antecedencia_min_horas": 0, "multa_bp": 10000}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'faixas não decrescentes recusada');
select is(api.publicar_parametros(current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10001}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'multa > 10000 recusada');
select is(api.publicar_parametros(current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 6, "multa_bp": 5000}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'último item com antecedência ≠ 0 recusado');

-- Campos: desconhecido, ausente, tipo/valor inválido.
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"extra": 1}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo desconhecido recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb - 'prazo_orcar_horas', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo ausente recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"hora_espera_cent": -1}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor negativo recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"hora_espera_cent": "5000"}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'número como texto recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"hora_espera_cent": 50.5}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'número fracionário recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"retorno_trecho_unico_bp": 10001}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'retorno_trecho_unico_bp > 10000 recusado');
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"prazo_orcar_horas": 0}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'prazo 0 recusado');
select is(api.publicar_parametros('[]'::jsonb, now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'entrada que não é objeto recusada');
select is((select count(*)::int from app.parametros_versoes), 3, 'recusas por campos não criam versão');

select ok(
  exists (select 1 from app.auditoria where codigo = 'CAMPOS_INVALIDOS' and resultado = 'NEGADO'
          and detalhe -> 'desconhecidos' ? 'extra'),
  'auditoria lista o campo desconhecido no detalhe');
select ok(
  exists (select 1 from app.auditoria where codigo = 'CAMPOS_INVALIDOS' and resultado = 'NEGADO'
          and detalhe -> 'ausentes' ? 'prazo_orcar_horas'),
  'auditoria lista o campo ausente no detalhe');
select ok(
  exists (select 1 from app.auditoria where codigo = 'CAMPOS_INVALIDOS' and resultado = 'NEGADO'
          and detalhe -> 'invalidos' ? 'faixas_cancelamento'),
  'auditoria lista as faixas inválidas no detalhe');
select ok(
  exists (select 1 from app.auditoria where codigo = 'CAMPOS_INVALIDOS' and resultado = 'NEGADO'
          and detalhe -> 'invalidos' ? 'hora_espera_cent'),
  'auditoria lista o valor inválido no detalhe');

-- Vigência no passado: negada e auditada (tolerância de 1 minuto).
select is(api.publicar_parametros(current_setting('t.base')::jsonb, now() - interval '2 minutes') ->> 'codigo',
  'VIGENCIA_NO_PASSADO', 'vigência no passado negada');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_PARAMETROS' and resultado = 'NEGADO' and codigo = 'VIGENCIA_NO_PASSADO'),
  'vigência no passado auditada');
select is(api.publicar_parametros(current_setting('t.base')::jsonb, null) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'vigência nula recusada');
select is((select count(*)::int from app.parametros_versoes), 3, 'vigência recusada não cria versão');

-- Motorista com delegação publica.
reset role;
update app.permissoes_delegadas set ativo = true where chave = 'MOTORISTA_EDITA_PARAMETROS';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '4 hours') ->> 'ok',
  'true', 'motorista com delegação publica');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
select is(api.publicar_parametros(current_setting('t.base')::jsonb, now() + interval '4 hours') ->> 'codigo',
  'SEM_PERMISSAO', 'motorista com delegação mas sem aal2: negado');

-- Vigente = maior vigente_desde <= agora.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_parametros(current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 400}', now()) ->> 'ok',
  'true', 'vigência = agora é aceita');
select is((select km_sem_reboque_cent from api.parametros_vigentes), 400::bigint, 'vigente: a versão com vigência já chegada');

reset role;
insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
  retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
  prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
  alerta_saldo_baixo_cent, retencao_fotos_dias)
select now() - interval '2 days', 111, 1, 1, 0, 1, 1, 1, faixas_cancelamento, 1, 1, 1, 0, 0, 1
from app.parametros_versoes limit 1;
insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
  retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
  prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
  alerta_saldo_baixo_cent, retencao_fotos_dias)
select now() + interval '1 day', 999, 1, 1, 0, 1, 1, 1, faixas_cancelamento, 1, 1, 1, 0, 0, 1
from app.parametros_versoes limit 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select km_sem_reboque_cent from api.parametros_vigentes), 400::bigint,
  'vigente ignora a futura e a de vigência mais antiga (mesmo com versão maior)');
select is((select count(*)::int from api.parametros_vigentes), 1, 'parametros_vigentes tem 1 linha');
select is((select array_agg(versao) from api.parametros_historico),
  array(select versao from app.parametros_versoes order by vigente_desde desc, versao desc),
  'histórico em ordem decrescente de vigência');
select is((select count(*)::int from api.parametros_historico), 7, 'histórico traz todas as versões');

-- Leitura por perfil.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from api.parametros_historico), 7, 'cliente lê o histórico');
select is((select km_sem_reboque_cent from api.parametros_vigentes), 400::bigint, 'cliente lê a vigente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.parametros_historico), 7, 'motorista lê o histórico');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from api.parametros_historico), 0, 'ADM sem aal2 não lê o histórico');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.parametros_vigentes), 0, 'usuário sem perfil não lê a vigente');

-- Escrita direta por authenticated: recusada.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ insert into app.parametros_versoes (vigente_desde) values (now()) $$, '42501', null, 'authenticated não insere direto');
select throws_ok($$ update app.parametros_versoes set km_sem_reboque_cent = 1 $$, '42501', null, 'authenticated não atualiza direto');

-- Execução e estrutura.
select ok(has_function_privilege('authenticated', 'api.publicar_parametros(jsonb, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'api.publicar_parametros(jsonb, timestamptz)', 'EXECUTE'),
  'publicar_parametros: EXECUTE só para authenticated');
select throws_ok($$ select interno.faixas_validas('[]') $$, '42501', null, 'authenticated não executa interno.faixas_validas');
select columns_are('api', 'parametros_vigentes', array[
  'versao', 'vigente_desde', 'publicado_em', 'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent',
  'retorno_trecho_unico_bp', 'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent',
  'faixas_cancelamento', 'prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas',
  'limite_saldo_negativo_cent', 'alerta_saldo_baixo_cent', 'retencao_fotos_dias'], 'parametros_vigentes: colunas explícitas');
select columns_are('api', 'parametros_historico', array[
  'versao', 'vigente_desde', 'publicado_em', 'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent',
  'retorno_trecho_unico_bp', 'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent',
  'faixas_cancelamento', 'prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas',
  'limite_saldo_negativo_cent', 'alerta_saldo_baixo_cent', 'retencao_fotos_dias'], 'parametros_historico: colunas explícitas');

reset role;

select is((select provolatile::text from pg_proc where oid = 'interno.faixas_validas(jsonb)'::regprocedure), 'i',
  'interno.faixas_validas é IMMUTABLE');
select is(interno.faixas_validas('[{"antecedencia_min_horas":6,"multa_bp":100},{"antecedencia_min_horas":0,"multa_bp":0}]'), true,
  'faixas_validas aceita faixas corretas');
select is(interno.faixas_validas(null), false, 'faixas_validas recusa nulo');

-- Imutabilidade (inclusive como postgres) e CHECKs (a função está no CHECK da tabela).
select throws_ok($$ update app.parametros_versoes set km_sem_reboque_cent = 1 $$, '42501', null, 'UPDATE recusado');
select throws_ok($$ delete from app.parametros_versoes $$, '42501', null, 'DELETE recusado');
select throws_ok($$ truncate app.parametros_versoes $$, '42501', null, 'TRUNCATE recusado');
select is((select count(*)::int from pg_trigger
           where tgrelid = 'app.parametros_versoes'::regclass and not tgisinternal and tgenabled = 'O'
             and tgname in ('parametros_sem_update', 'parametros_sem_truncate')), 2,
  'gatilhos de imutabilidade existem e estão habilitados');

select throws_ok($$
  insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
    retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
    alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (now(), 1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 6, "multa_bp": 0}]', 1, 1, 1, 0, 0, 1) $$,
  '23514', null, 'CHECK da tabela recusa faixas inválidas (função no CHECK)');
select throws_ok($$
  insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
    retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
    alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (now(), -1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0, 1) $$,
  '23514', null, 'CHECK da tabela recusa centavos negativos');
select throws_ok($$
  insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
    retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
    alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (now(), 1, 1, 1, 10001, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0, 1) $$,
  '23514', null, 'CHECK da tabela recusa retorno_trecho_unico_bp > 10000');
select throws_ok($$
  insert into app.parametros_versoes (vigente_desde, km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent,
    retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent,
    alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (now(), 1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 0, 1, 1, 0, 0, 1) $$,
  '23514', null, 'CHECK da tabela recusa prazo 0');

select * from finish();
rollback;
