-- Contratos por empresa (fase 1B, Adendo A10): migração, publicação só pelo ADM, validação, vigência,
-- imutabilidade, leituras por perfil (cliente sem preços; motorista sem limites, versão ou autor) e retenção.
begin;
create extension if not exists pgtap with schema extensions;
select plan(130);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('clia@teste.local', 'Cliente A',       'CLIENTE',      '00000000-0000-0000-0000-0000000000e1', 1),
  ('clib@teste.local', 'Cliente B',       'CLIENTE',      '00000000-0000-0000-0000-0000000000e2', 3);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clia@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clib@teste.local');
update app.perfis set senha_pendente = false;

-- Contrato-base válido (os 13 campos), lido via current_setting para valer em qualquer papel.
select set_config('t.base', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [
    {"antecedencia_min_horas": 24, "multa_bp": 0},
    {"antecedencia_min_horas": 6, "multa_bp": 5000},
    {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000
}', true);
select set_config('t.e1', '00000000-0000-0000-0000-0000000000e1', true);
select set_config('t.umi', (select id::text from app.empresas where nome = 'Umi San' order by criada_em limit 1), true);

------------------------------------------------------------------ estrutura e migração
select hasnt_table('app', 'parametros_versoes', 'tabela única da fase 1 removida');
select hasnt_view('api', 'parametros_vigentes', 'api.parametros_vigentes removida');
select hasnt_view('api', 'parametros_historico', 'api.parametros_historico removida');
select hasnt_function('api', 'publicar_parametros', 'api.publicar_parametros removida');
select is((select count(*)::int from app.configuracao), 1, 'configuracao: linha única');
select is((select retencao_fotos_dias from app.configuracao), 30, 'configuracao: retenção padrão de 30 dias (sem versão anterior)');
select is((select count(*)::int from app.contratos_versoes), 0, 'sem versão anterior: nenhum contrato semeado');
select throws_ok($$ insert into app.configuracao (id, retencao_fotos_dias) values (false, 10) $$, '23514', null,
  'configuracao: só existe a linha única');

-- A mesma função usada pela migration, com uma versão no formato antigo (14 campos + metadados).
select interno.migrar_parametros(current_setting('t.base')::jsonb || '{
  "versao": 7, "vigente_desde": "2026-01-01T00:00:00Z", "publicado_em": "2026-01-01T00:00:00Z",
  "publicado_por": "00000000-0000-0000-0000-0000000000a1", "publicado_por_nome": "Ana Migração",
  "retencao_fotos_dias": 45}'::jsonb);
select is(
  (select to_jsonb(c) - array['id', 'empresa_id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em']
   from app.contratos_versoes c where c.empresa_id is null),
  current_setting('t.base')::jsonb, 'migração: modelo v1 tem exatamente os valores da versão antiga');
select is(
  (select to_jsonb(c) - array['id', 'empresa_id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em']
   from app.contratos_versoes c where c.empresa_id = current_setting('t.umi')::uuid),
  current_setting('t.base')::jsonb, 'migração: contrato Umi San v1 = modelo v1 = versão antiga');
select ok(
  (select count(*) = 2 and bool_and(versao = 1 and vigente_desde <= now() and publicado_por_nome = 'Ana Migração'
                                    and publicado_por = '00000000-0000-0000-0000-0000000000a1')
   from app.contratos_versoes),
  'migração: ambos v1, vigentes desde agora, com o autor da versão antiga');
select is((select retencao_fotos_dias from app.configuracao), 45, 'migração: retenção de fotos vai para a configuração global');

------------------------------------------------------------------ só ADM publica
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'motorista não publica contrato');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'gestor de frota não publica contrato');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'cliente gestor da empresa (N1) não publica contrato');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'cliente não publica a tabela modelo');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'SEM_PERMISSAO', 'ADM sem aal2 não publica');

reset role;
select is((select count(distinct usuario_id)::int from app.auditoria
           where acao = 'PUBLICAR_CONTRATO' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'), 4,
  'negações de motorista, gestor, cliente e ADM aal1 auditadas');
select is((select count(*)::int from app.contratos_versoes), 2, 'negações não criam versão');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'versao',
  '1', 'ADM publica o contrato da Empresa A (v1 da empresa)');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 260}', now() + interval '1 hour') ->> 'versao',
  '2', 'ADM publica a tabela modelo (v2: a numeração é por empresa)');
select is(api.publicar_contrato('00000000-0000-0000-0000-00000000dead', current_setting('t.base')::jsonb, now() + interval '1 hour') ->> 'codigo',
  'NAO_ENCONTRADO', 'empresa inexistente recusada');
reset role;
select ok(
  exists (select 1 from app.contratos_versoes
          where empresa_id = current_setting('t.e1')::uuid and versao = 1 and km_sem_reboque_cent = 250
            and limite_saldo_negativo_cent = 50000 and jsonb_array_length(faixas_cancelamento) = 3
            and publicado_por = '00000000-0000-0000-0000-0000000000a1' and publicado_por_nome = 'Admin Teste'),
  'contrato gravado com valores, faixas, crédito da empresa e autor');
select ok(
  exists (select 1 from app.auditoria
          where acao = 'PUBLICAR_CONTRATO' and resultado = 'OK' and alvo = 'contrato:' || current_setting('t.e1')
            and (detalhe ->> 'versao')::int = 1 and detalhe ->> 'empresa_id' = current_setting('t.e1')),
  'publicação auditada como OK com empresa e versão');
select ok(exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and resultado = 'OK' and alvo = 'contrato:modelo'),
  'publicação do modelo auditada com alvo contrato:modelo');
select ok(exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and resultado = 'NEGADO' and codigo = 'NAO_ENCONTRADO'),
  'empresa inexistente auditada');

------------------------------------------------------------------ validação
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"faixas_cancelamento": []}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'faixas vazia recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 24, "multa_bp": 5000}, {"antecedencia_min_horas": 0, "multa_bp": 10000}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'faixas não decrescentes recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10001}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'multa > 10000 recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb ||
  '{"faixas_cancelamento": [{"antecedencia_min_horas": 24, "multa_bp": 0}, {"antecedencia_min_horas": 6, "multa_bp": 5000}]}',
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', 'último item com antecedência ≠ 0 recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"extra": 1}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo desconhecido recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"retencao_fotos_dias": 30}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'retenção de fotos não faz parte do contrato');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb - 'prazo_orcar_horas', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'campo ausente recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb - 'limite_saldo_negativo_cent', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'limite de saldo é obrigatório no contrato');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": -1}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor negativo recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": "5000"}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'número como texto recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": 50.5}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'número fracionário recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"retorno_trecho_unico_bp": 10001}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'retorno_trecho_unico_bp > 10000 recusado');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"prazo_orcar_horas": 0}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'prazo 0 recusado');
select is(api.publicar_contrato(null, '[]'::jsonb, now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'entrada que não é objeto recusada');
select is(api.publicar_contrato(null, null, now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'entrada nula recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": null}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: null JSON');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": true}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: booleano');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": 1.0}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: 1.0');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": 99999999999999999999}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: 20 dígitos');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"hora_espera_cent": 1e400}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: 1e400');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"prazo_orcar_horas": 2147483648}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: prazo 2147483648');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || '{"retorno_trecho_unico_bp": 99999}', now() + interval '1 hour') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'valor recusado: bp 99999');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb || (select jsonb_object_agg(repeat('x', 100) || g, 1) from generate_series(1, 25) g),
  now() + interval '1 hour') ->> 'codigo', 'CAMPOS_INVALIDOS', '25 campos desconhecidos longos: recusado');

-- Vigência: tolerância de 1 minuto no passado, no máximo 1 ano à frente.
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb, now() - interval '2 minutes') ->> 'codigo',
  'VIGENCIA_NO_PASSADO', 'vigência no passado negada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb, now() + interval '2 years') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'vigência a mais de 1 ano recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb, 'infinity'::timestamptz) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'vigência infinita recusada');
select is(api.publicar_contrato(null, current_setting('t.base')::jsonb, null) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'vigência nula recusada');
reset role;
select is((select count(*)::int from app.contratos_versoes), 4, 'recusas não criam versão');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and detalhe = '{"desconhecidos":["extra"],"ausentes":[],"invalidos":[]}'::jsonb),
  'auditoria lista o campo desconhecido no detalhe');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and detalhe = '{"desconhecidos":["retencao_fotos_dias"],"ausentes":[],"invalidos":[]}'::jsonb),
  'auditoria lista a retenção como campo desconhecido');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and detalhe = '{"desconhecidos":[],"ausentes":["prazo_orcar_horas"],"invalidos":[]}'::jsonb),
  'auditoria lista o campo ausente no detalhe');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and detalhe = '{"desconhecidos":[],"ausentes":[],"invalidos":["faixas_cancelamento"]}'::jsonb),
  'auditoria lista as faixas inválidas no detalhe');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and jsonb_array_length(detalhe -> 'desconhecidos') = 20
          and (select max(length(e)) from jsonb_array_elements_text(detalhe -> 'desconhecidos') e) = 60),
  'detalhe da auditoria limita a 20 chaves de até 60 caracteres');
select ok(
  exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'CAMPOS_INVALIDOS'
          and detalhe = '{"invalidos":["vigente_desde"]}'::jsonb)
  and exists (select 1 from app.auditoria where acao = 'PUBLICAR_CONTRATO' and codigo = 'VIGENCIA_NO_PASSADO'),
  'vigência recusada auditada');

------------------------------------------------------------------ vigência
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.publicar_contrato(current_setting('t.e1')::uuid, current_setting('t.base')::jsonb || '{"km_sem_reboque_cent": 400}', now()) ->> 'versao',
  '2', 'vigência = agora é aceita (v2 da Empresa A)');
reset role;
-- Uma versão de vigência mais antiga com número maior e outra futura: nenhuma deve virar a vigente.
insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent, km_com_reboque_cent,
  taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent,
  faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
values
  (current_setting('t.e1')::uuid, 5, now() - interval '2 days', 'Teste', 111, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0),
  (current_setting('t.e1')::uuid, 6, now() + interval '1 day', 'Teste', 999, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select km_sem_reboque_cent from api.listar_contratos() where empresa_id = current_setting('t.e1')::uuid), 400::bigint,
  'listar_contratos: vigente ignora a futura e a de vigência mais antiga (mesmo com versão maior)');
select is((select proxima_vigencia from api.listar_contratos() where empresa_id = current_setting('t.e1')::uuid), now() + interval '1 hour',
  'listar_contratos: traz a próxima vigência agendada');
select is((select count(*)::int from api.listar_contratos()), (select count(*)::int + 1 from app.empresas),
  'listar_contratos: modelo + uma linha por empresa');
select ok((select empresa_id is null and versao = 1 from api.listar_contratos() limit 1),
  'listar_contratos: a tabela modelo vem primeiro (vigente v1; a v2 está agendada)');
select ok((select versao is null and km_sem_reboque_cent is null from api.listar_contratos()
           where empresa_id = '00000000-0000-0000-0000-0000000000e2'),
  'listar_contratos: empresa sem contrato aparece sem valores');
select is((select publicado_por_nome from api.listar_contratos() where empresa_id = current_setting('t.umi')::uuid), 'Ana Migração',
  'listar_contratos: ADM vê o autor');
select is(array(select versao from api.historico_contrato(current_setting('t.e1')::uuid)), array[6, 1, 2, 5],
  'historico_contrato: todas as versões, da vigência mais nova para a mais antiga');
select is((select count(*)::int from api.historico_contrato(null)), 2, 'historico_contrato: nulo = tabela modelo');
select is((select count(*)::int from api.historico_contrato('00000000-0000-0000-0000-0000000000e2')), 0,
  'historico_contrato: empresa sem contrato vazia');

-- Só o ADM lê contratos completos e histórico.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_contratos() $$, 'listar_contratos: vazio para ADM sem aal2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_contratos() $$, 'listar_contratos: vazio para motorista');
select is_empty($$ select 1 from api.historico_contrato('00000000-0000-0000-0000-0000000000e1') $$, 'historico_contrato: vazio para motorista');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_contratos() $$, 'listar_contratos: vazio para gestor de frota');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_contratos() $$, 'listar_contratos: vazio para cliente');
select is_empty($$ select 1 from api.historico_contrato('00000000-0000-0000-0000-0000000000e1') $$, 'historico_contrato: vazio para cliente da própria empresa');

------------------------------------------------------------------ cliente: regras do serviço
select is((select count(*)::int from api.regras_do_servico()), 1, 'regras_do_servico: cliente lê o contrato vigente da própria empresa');
select is((select prazo_orcar_horas from api.regras_do_servico()), 12, 'regras_do_servico: prazo para orçar');
select is((select faixas_cancelamento from api.regras_do_servico()), current_setting('t.base')::jsonb -> 'faixas_cancelamento',
  'regras_do_servico: faixas de cancelamento');
select is_empty($$ select 1 from api.precos_para_orcar('00000000-0000-0000-0000-0000000000e1') $$,
  'precos_para_orcar: cliente não lê preços nem pela RPC do motorista');
select is((select empresa_tem_contrato from api.meu_perfil()), true, 'meu_perfil: empresa com contrato vigente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.regras_do_servico() $$, 'regras_do_servico: vazio para empresa sem contrato');
select is((select empresa_tem_contrato from api.meu_perfil()), false, 'meu_perfil: empresa sem contrato vigente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.regras_do_servico() $$, 'regras_do_servico: vazio para motorista');
select ok((select empresa_tem_contrato is null from api.meu_perfil()), 'meu_perfil: empresa_tem_contrato nulo para quem não é cliente');
select is(
  array(select unnest(proargnames) from pg_proc where oid = 'api.regras_do_servico()'::regprocedure),
  array['faixas_cancelamento', 'prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas'],
  'regras_do_servico: só regras (sem preços, limites, versão ou autor)');

------------------------------------------------------------------ motorista: preços para orçar
select is((select km_sem_reboque_cent from api.precos_para_orcar(current_setting('t.e1')::uuid)), 400::bigint,
  'precos_para_orcar: motorista lê o preço vigente da empresa do pedido');
select is((select count(*)::int from api.precos_para_orcar(current_setting('t.umi')::uuid)), 1, 'precos_para_orcar: outra empresa com contrato');
select is_empty($$ select 1 from api.precos_para_orcar('00000000-0000-0000-0000-0000000000e2') $$, 'precos_para_orcar: empresa sem contrato vazia');
select is_empty($$ select 1 from api.precos_para_orcar(null) $$, 'precos_para_orcar: empresa nula vazia');
select is(
  array(select unnest(proargnames) from pg_proc where oid = 'api.precos_para_orcar(uuid)'::regprocedure),
  array['p_empresa', 'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent', 'retorno_trecho_unico_bp',
        'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent', 'prazo_orcar_horas',
        'validade_orcamento_horas', 'limiar_urgente_horas'],
  'precos_para_orcar: só preços e prazos (sem limites de saldo, versão ou autor)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.precos_para_orcar('00000000-0000-0000-0000-0000000000e1') $$, 'precos_para_orcar: motorista sem aal2 não lê');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.precos_para_orcar('00000000-0000-0000-0000-0000000000e1') $$, 'precos_para_orcar: gestor de frota não vê preço');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.precos_para_orcar('00000000-0000-0000-0000-0000000000e1') $$, 'precos_para_orcar: sem perfil não lê');
select is_empty($$ select 1 from api.regras_do_servico() $$, 'regras_do_servico: sem perfil não lê');

-- Tabelas sem GRANT: nem leitura direta.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select * from app.contratos_versoes $$, '42501', null, 'authenticated não lê app.contratos_versoes direto');
select throws_ok($$ select * from app.configuracao $$, '42501', null, 'authenticated não lê app.configuracao direto');
select throws_ok($$ insert into app.contratos_versoes (vigente_desde) values (now()) $$, '42501', null, 'authenticated não insere contrato direto');
select throws_ok($$ select interno.validar_contrato('{}') $$, '42501', null, 'authenticated não executa interno.validar_contrato');
select throws_ok($$ select interno.migrar_parametros('{}') $$, '42501', null, 'authenticated não executa interno.migrar_parametros');

------------------------------------------------------------------ retenção de fotos (configuração global, só ADM)
select is(api.definir_retencao_fotos(90) ->> 'ok', 'true', 'definir_retencao_fotos: ADM altera');
select is((select retencao_fotos_dias from api.ler_configuracao()), 90, 'ler_configuracao: ADM lê o valor novo');
select is(api.definir_retencao_fotos(0) ->> 'codigo', 'CAMPOS_INVALIDOS', 'definir_retencao_fotos: 0 recusado');
select is(api.definir_retencao_fotos(3651) ->> 'codigo', 'CAMPOS_INVALIDOS', 'definir_retencao_fotos: acima de 3650 recusado');
select is(api.definir_retencao_fotos(null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'definir_retencao_fotos: nulo recusado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_retencao_fotos(10) ->> 'codigo', 'SEM_PERMISSAO', 'definir_retencao_fotos: motorista negado');
select is_empty($$ select 1 from api.ler_configuracao() $$, 'ler_configuracao: vazio para motorista');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_retencao_fotos(10) ->> 'codigo', 'SEM_PERMISSAO', 'definir_retencao_fotos: cliente negado');
select is_empty($$ select 1 from api.ler_configuracao() $$, 'ler_configuracao: vazio para cliente');
reset role;
select is((select retencao_fotos_dias from app.configuracao), 90, 'recusas não mudam a retenção');
select ok(
  exists (select 1 from app.auditoria where acao = 'DEFINIR_RETENCAO_FOTOS' and resultado = 'OK'
          and detalhe = '{"anterior": 45, "novo": 90}'::jsonb)
  and (select count(distinct codigo) from app.auditoria
       where acao = 'DEFINIR_RETENCAO_FOTOS' and resultado = 'NEGADO' and codigo in ('CAMPOS_INVALIDOS', 'SEM_PERMISSAO')) = 2,
  'retenção: sucesso (anterior/novo) e recusas auditados');

------------------------------------------------------------------ imutabilidade e CHECKs (como postgres)
select throws_ok($$ update app.contratos_versoes set km_sem_reboque_cent = 1 $$, '42501', null, 'UPDATE recusado mesmo como postgres');
select throws_ok($$ delete from app.contratos_versoes $$, '42501', null, 'DELETE recusado mesmo como postgres');
-- Desde a fase 4 a tabela é referenciada por app.contratos_categorias: o TRUNCATE já é recusado pelo banco (0A000) antes do gatilho.
select throws_ok($$ truncate app.contratos_versoes $$, '0A000', null, 'TRUNCATE recusado');
select is((select count(*)::int from pg_trigger
           where tgrelid = 'app.contratos_versoes'::regclass and not tgisinternal and tgenabled = 'O'
             and tgname in ('contratos_sem_update', 'contratos_sem_truncate')), 2,
  'gatilhos de imutabilidade existem e estão habilitados');
select throws_ok($$
  insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent, km_com_reboque_cent,
    taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent,
    faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
  values (null, 90, now(), 'Teste', 1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 6, "multa_bp": 0}]', 1, 1, 1, 0, 0) $$,
  '23514', null, 'CHECK da tabela recusa faixas inválidas');
select throws_ok($$
  insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent, km_com_reboque_cent,
    taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent,
    faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
  values (null, 91, now(), 'Teste', -1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0) $$,
  '23514', null, 'CHECK da tabela recusa centavos negativos');
select throws_ok($$
  insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent, km_com_reboque_cent,
    taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent,
    faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
  values (null, 92, now(), '  ', 1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0) $$,
  '23514', null, 'publicado_por_nome em branco recusado');
select throws_ok($$
  insert into app.contratos_versoes (empresa_id, versao, vigente_desde, publicado_por_nome, km_sem_reboque_cent, km_com_reboque_cent,
    taxa_fixa_reboque_cent, retorno_trecho_unico_bp, hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent,
    faixas_cancelamento, prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas, limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
  values (null, 1, now(), 'Teste', 1, 1, 1, 0, 1, 1, 1, '[{"antecedencia_min_horas": 0, "multa_bp": 0}]', 1, 1, 1, 0, 0) $$,
  '23505', null, 'número de versão único por empresa (modelo)');

------------------------------------------------------------------ privilégios
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('publicar_contrato', 'definir_retencao_fotos', 'ler_configuracao', 'listar_contratos',
    'historico_contrato', 'regras_do_servico', 'precos_para_orcar')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE') or not p.prosecdef)
$$, 'RPCs de contrato: authenticated sim, anon/service_role não, todas SECURITY DEFINER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('publicar_contrato', 'definir_retencao_fotos', 'ler_configuracao',
             'listar_contratos', 'historico_contrato', 'regras_do_servico', 'precos_para_orcar')), 7,
  'existem as 7 funções de contrato/configuração');

------------------------------------------------------------------ faixas_validas (usada no CHECK)
select is((select provolatile::text from pg_proc where oid = 'interno.faixas_validas(jsonb)'::regprocedure), 'i',
  'interno.faixas_validas é IMMUTABLE');
select is(interno.faixas_validas(null), false, 'faixas_validas: nulo');
select is(interno.faixas_validas('{}'::jsonb), false, 'faixas_validas: não é array');
select is(interno.faixas_validas('[1]'::jsonb), false, 'faixas_validas: elemento não objeto');
select is(interno.faixas_validas('[{"antecedencia_min_horas":"24","multa_bp":0},{"antecedencia_min_horas":0,"multa_bp":0}]'::jsonb), false, 'faixas_validas: antecedência como texto');
select is(interno.faixas_validas('[{"antecedencia_min_horas":0,"multa_bp":0,"x":1}]'::jsonb), false, 'faixas_validas: chave extra');
select is(interno.faixas_validas((select jsonb_agg(jsonb_build_object('antecedencia_min_horas', 21 - g, 'multa_bp', 0)) from generate_series(1, 21) g)), false, 'faixas_validas: 21 elementos');
select is(interno.faixas_validas('[{"antecedencia_min_horas":0,"multa_bp":0}]'::jsonb), true, 'faixas_validas: faixa única 0/0');

------------------------------------------------------------------ nomes de ação constantes
select is_empty($$
  select distinct acao from app.auditoria where acao not in ('PUBLICAR_CONTRATO', 'DEFINIR_RETENCAO_FOTOS')
$$, 'auditoria: só nomes de ação constantes');

select * from finish();
rollback;
