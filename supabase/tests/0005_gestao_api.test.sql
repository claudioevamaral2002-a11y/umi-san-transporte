-- Gestão de acesso (fase 1, Task 5): RPCs de usuários/matriz/empresas, leituras e RPCs de sistema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(170);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'), ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id) values
  ('adm@teste.local',  'Admin Teste',     'ADM',       null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA', null),
  ('clia@teste.local', 'Cliente A',       'CLIENTE',   '00000000-0000-0000-0000-0000000000e1'),
  ('clib@teste.local', 'Cliente B',       'CLIENTE',   '00000000-0000-0000-0000-0000000000e2'),
  ('adm2@teste.local', 'Admin Dois',      'ADM',       null),
  ('adm3@teste.local', 'Admin Tres',      'ADM',       null),
  ('pend@teste.local', 'Pendente Teste',  'CLIENTE',   '00000000-0000-0000-0000-0000000000e1');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clia@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clib@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm3@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pend@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'semperfil@teste.local');
update app.perfis set senha_pendente = false where usuario_id <> '00000000-0000-0000-0000-0000000000a7';
-- A1 tem TOTP verificado; A2 tem um fator ainda não verificado.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'totp-a1', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', 'totp-a2', 'totp', 'unverified', now(), now());

------------------------------------------------------------------ preparar_convite
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite(' Novo@Teste.Local ', '  Novo Usuario  ', 'MOTORISTA', null) ->> 'ok', 'true',
  'preparar_convite: ADM cria convite');
select is(api.preparar_convite(' Novo@Teste.Local ', 'Novo Segundo', 'MOTORISTA', null) ->> 'email', 'novo@teste.local',
  'preparar_convite: reenvio substitui o pendente e devolve o e-mail normalizado');
select is(api.preparar_convite('sem-arroba', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'preparar_convite: e-mail inválido');
select is(api.preparar_convite('x1@teste.local', 'F', 'MOTORISTA', null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'preparar_convite: nome curto demais');
select is(api.preparar_convite('x2@teste.local', 'Fulano Teste', 'CLIENTE', null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'preparar_convite: CLIENTE sem empresa');
select is(api.preparar_convite('x3@teste.local', 'Fulano Teste', 'MOTORISTA', '00000000-0000-0000-0000-0000000000e1') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'preparar_convite: MOTORISTA com empresa');
select is(api.preparar_convite('x4@teste.local', 'Fulano Teste', 'CLIENTE', '00000000-0000-0000-0000-00000000dead') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'preparar_convite: empresa inexistente');
select is(api.preparar_convite('CLIA@teste.local', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'JA_CADASTRADO',
  'preparar_convite: e-mail de usuário com perfil');
select is(api.preparar_convite('semperfil@teste.local', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'EMAIL_EM_USO',
  'preparar_convite: e-mail de usuário do Auth sem perfil');
select is(api.preparar_convite('cli.novo@teste.local', 'Cliente Novo', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'ok', 'true',
  'preparar_convite: convite de CLIENTE com empresa');
-- Depende da ordem: este é o 11º convite de A1 no dia (os 10 anteriores contam, inclusive as recusas de validação).
select is(api.preparar_convite('onze@teste.local', 'Onze Teste', 'MOTORISTA', null) ->> 'codigo', 'LIMITE_EXCEDIDO',
  'preparar_convite: 11º convite do dia negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite('adm.novo@teste.local', 'Admin Novo', 'ADM', null) ->> 'ok', 'true',
  'preparar_convite: ADM convida ADM');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite('y1@teste.local', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'preparar_convite: motorista negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('y2@teste.local', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'preparar_convite: cliente negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('y3@teste.local', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'preparar_convite: ADM sem aal2 negado');
reset role;
select ok(
  (select count(*) = 1 and bool_and(nome = 'Novo Segundo' and papel = 'MOTORISTA' and criado_por = '00000000-0000-0000-0000-0000000000a1')
   from app.convites where email = 'novo@teste.local' and usado_em is null),
  'preparar_convite: um único convite pendente por e-mail, normalizado, com o autor');
select ok(exists (select 1 from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'OK' and usuario_id = '00000000-0000-0000-0000-0000000000a1'),
  'preparar_convite: sucesso auditado');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO' and usuario_id = '00000000-0000-0000-0000-0000000000a1'
     and codigo in ('CAMPOS_INVALIDOS', 'JA_CADASTRADO', 'EMAIL_EM_USO', 'LIMITE_EXCEDIDO')) = 4,
  'preparar_convite: recusas de validação e limite auditadas');
select ok(
  (select count(distinct usuario_id) from app.auditoria
   where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'
     and usuario_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')) = 3,
  'preparar_convite: SEM_PERMISSAO de motorista, cliente e ADM aal1 auditado');
select is_empty($$ select 1 from app.convites where usado_em is null and email in ('clia@teste.local', 'semperfil@teste.local', 'x1@teste.local', 'x2@teste.local', 'x3@teste.local', 'x4@teste.local', 'onze@teste.local', 'y1@teste.local', 'y2@teste.local', 'y3@teste.local') $$,
  'preparar_convite: recusas não criam convite');
select ok(exists (select 1 from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'OK' and detalhe ->> 'substituiu' is not null),
  'preparar_convite: auditoria registra o convite substituído');
select ok(exists (select 1 from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO' and detalhe ->> 'email_dominio' = 'teste.local')
          and not exists (select 1 from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO' and detalhe::text like '%@%'),
  'preparar_convite: negações guardam só o domínio do e-mail');

------------------------------------------------------------------ alterar_perfil
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a4', 'Cliente B', 'MOTORISTA', null) ->> 'ok', 'true',
  'alterar_perfil: CLIENTE vira MOTORISTA (empresa nula)');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a4', '  Cliente B Novo ', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'ok', 'true',
  'alterar_perfil: volta a CLIENTE com empresa e nome novo');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a4', 'Cliente B Novo', 'ADM', null) ->> 'ok', 'true',
  'alterar_perfil: CLIENTE promovido a ADM');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a4', 'Cliente B Novo', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'ok', 'true',
  'alterar_perfil: ADM rebaixado por outro ADM (havendo outros ADMs)');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a1', 'Admin Teste', 'ADM', null) ->> 'ok', 'true',
  'alterar_perfil: ADM edita o próprio nome mantendo o papel');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a1', 'Admin Teste', 'MOTORISTA', null) ->> 'codigo', 'PROPRIO_PAPEL',
  'alterar_perfil: PROPRIO_PAPEL');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a3', 'x', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'alterar_perfil: nome inválido');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a3', 'Cliente A', 'CLIENTE', null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'alterar_perfil: CLIENTE sem empresa');
select is(api.alterar_perfil('00000000-0000-0000-0000-00000000dead', 'Fulano Teste', 'MOTORISTA', null) ->> 'codigo', 'NAO_ENCONTRADO',
  'alterar_perfil: usuário inexistente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a3', 'Cliente A', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'codigo', 'SEM_PERMISSAO',
  'alterar_perfil: motorista negado');
reset role;
select ok(exists (select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a4' and nome = 'Cliente B Novo' and papel = 'CLIENTE' and empresa_id = '00000000-0000-0000-0000-0000000000e1'),
  'alterar_perfil: perfil gravado com nome aparado');
select ok(exists (select 1 from app.auditoria where acao = 'ALTERAR_PERFIL' and resultado = 'OK'
                  and detalhe ->> 'papel_anterior' = 'MOTORISTA' and detalhe ->> 'papel_novo' = 'CLIENTE'),
  'alterar_perfil: sucesso auditado com papel anterior/novo');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'ALTERAR_PERFIL' and resultado = 'NEGADO'
     and codigo in ('PROPRIO_PAPEL', 'CAMPOS_INVALIDOS', 'NAO_ENCONTRADO', 'SEM_PERMISSAO')) = 4,
  'alterar_perfil: recusas auditadas');
select is((select papel::text from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a1'), 'ADM', 'alterar_perfil: PROPRIO_PAPEL não mudou nada');

------------------------------------------------------------------ definir_ativo
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', false, 'Saiu da empresa') ->> 'ok', 'true', 'definir_ativo: ADM desativa cliente');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', true, '  ') ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'definir_ativo: motivo em branco');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a1', false, 'Quero sair') ->> 'codigo', 'PROPRIO_USUARIO', 'definir_ativo: não desativa a si mesmo');
select is(api.definir_ativo('00000000-0000-0000-0000-00000000dead', false, 'Motivo teste') ->> 'codigo', 'NAO_ENCONTRADO',
  'definir_ativo: usuário inexistente');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', null, 'Motivo teste') ->> 'codigo', 'CAMPOS_INVALIDOS', 'definir_ativo: ativo nulo');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a5', false, 'Rodízio de ADM') ->> 'ok', 'true', 'definir_ativo: desativa outro ADM havendo ADM ativo');
select is((select ativo from api.meu_perfil()), true, 'meu_perfil: ADM ativo');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is((select ativo from api.meu_perfil()), false, 'meu_perfil: usuário desativado vê ativo = false');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', true, 'Motivo teste') ->> 'codigo', 'SEM_PERMISSAO', 'definir_ativo: cliente negado');
reset role;
select ok((select not ativo from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a4') and (select not ativo from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a5'),
  'definir_ativo: perfis desativados');
select ok(exists (select 1 from app.auditoria where acao = 'DEFINIR_ATIVO' and resultado = 'OK'
                  and alvo = 'perfil:00000000-0000-0000-0000-0000000000a4' and detalhe ->> 'motivo' = 'Saiu da empresa'),
  'definir_ativo: sucesso auditado com motivo');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'DEFINIR_ATIVO' and resultado = 'NEGADO'
     and codigo in ('MOTIVO_OBRIGATORIO', 'PROPRIO_USUARIO', 'NAO_ENCONTRADO', 'CAMPOS_INVALIDOS', 'SEM_PERMISSAO')) = 5,
  'definir_ativo: recusas auditadas');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', true, 'Voltou à empresa') ->> 'ok', 'true', 'definir_ativo: reativa cliente');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a5', true, 'Fim do rodízio') ->> 'ok', 'true', 'definir_ativo: reativa ADM');

------------------------------------------------------------------ definir_permissao
select is(api.definir_permissao('MOTORISTA_EDITA_PARAMETROS', true, 'Teste de delegação') ->> 'ok', 'true',
  'definir_permissao: ADM liga a delegação');
select is(api.definir_permissao('MOTORISTA_EDITA_PARAMETROS', false, ' ') ->> 'codigo', 'MOTIVO_OBRIGATORIO',
  'definir_permissao: motivo em branco');
select is(api.definir_permissao('NAO_EXISTE', true, 'Teste de chave') ->> 'codigo', 'CHAVE_INVALIDA', 'definir_permissao: chave inválida');
select is(api.definir_permissao('MOTORISTA_EDITA_PARAMETROS', null, 'Teste de nulo') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'definir_permissao: ativo nulo');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_permissao('MOTORISTA_LANCA_RECARGA', true, 'ADM sem aal2') ->> 'codigo', 'SEM_PERMISSAO',
  'definir_permissao: ADM sem aal2 negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_permissao('MOTORISTA_LANCA_RECARGA', true, 'Motorista tentando') ->> 'codigo', 'SEM_PERMISSAO',
  'definir_permissao: motorista negado');
reset role;
select ok(exists (select 1 from app.permissoes_delegadas where chave = 'MOTORISTA_EDITA_PARAMETROS' and ativo
                  and alterado_por = '00000000-0000-0000-0000-0000000000a1' and alterado_em is not null),
  'definir_permissao: gravada com autor e data');
select ok(not (select ativo from app.permissoes_delegadas where chave = 'MOTORISTA_LANCA_RECARGA'), 'definir_permissao: negada não alterou');
select ok(exists (select 1 from app.auditoria where acao = 'DEFINIR_PERMISSAO' and resultado = 'OK'
                  and alvo = 'permissao:MOTORISTA_EDITA_PARAMETROS' and detalhe ->> 'motivo' = 'Teste de delegação'),
  'definir_permissao: sucesso auditado');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'DEFINIR_PERMISSAO' and resultado = 'NEGADO'
     and codigo in ('MOTIVO_OBRIGATORIO', 'CHAVE_INVALIDA', 'CAMPOS_INVALIDOS', 'SEM_PERMISSAO')) = 4,
  'definir_permissao: recusas auditadas');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_permissao('MOTORISTA_EDITA_PARAMETROS', false, 'Fim do teste') ->> 'ok', 'true', 'definir_permissao: ADM desliga a delegação');

------------------------------------------------------------------ salvar_empresa
select ok(set_config('t.emp', api.salvar_empresa(null, '  Empresa C ') ->> 'id', true) is not null, 'salvar_empresa: cria e devolve o id');
select is(api.salvar_empresa(current_setting('t.emp')::uuid, 'Empresa C2') ->> 'ok', 'true', 'salvar_empresa: renomeia');
select is(api.salvar_empresa('00000000-0000-0000-0000-00000000dead', 'Empresa Z') ->> 'codigo', 'NAO_ENCONTRADO', 'salvar_empresa: id inexistente');
select is(api.salvar_empresa(null, 'x') ->> 'codigo', 'CAMPOS_INVALIDOS', 'salvar_empresa: nome inválido');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is(api.salvar_empresa(null, 'Empresa Sem Aal2') ->> 'codigo', 'SEM_PERMISSAO', 'salvar_empresa: ADM sem aal2 negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.salvar_empresa(null, 'Empresa Motorista') ->> 'codigo', 'SEM_PERMISSAO', 'salvar_empresa: motorista negado');
reset role;
select ok(exists (select 1 from app.empresas where id = current_setting('t.emp')::uuid and nome = 'Empresa C2'), 'salvar_empresa: nome gravado');
select is_empty($$ select 1 from app.empresas where nome in ('Empresa Z', 'Empresa Motorista', 'Empresa Sem Aal2', 'x') $$, 'salvar_empresa: recusas não criam empresa');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'SALVAR_EMPRESA' and resultado = 'NEGADO' and codigo in ('NAO_ENCONTRADO', 'CAMPOS_INVALIDOS', 'SEM_PERMISSAO')) = 3
  and exists (select 1 from app.auditoria where acao = 'SALVAR_EMPRESA' and resultado = 'OK'),
  'salvar_empresa: sucesso e recusas auditados');

------------------------------------------------------------------ definir_logo_empresa
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/logo.png') ->> 'ok', 'true', 'definir_logo_empresa: png');
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/logo.webp') ->> 'ok', 'true', 'definir_logo_empresa: webp');
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2/logo.png') ->> 'codigo', 'CAMINHO_INVALIDO', 'definir_logo_empresa: caminho de outra empresa');
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/logo.svg') ->> 'codigo', 'CAMINHO_INVALIDO', 'definir_logo_empresa: extensão inválida');
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/../logo.png') ->> 'codigo', 'CAMINHO_INVALIDO', 'definir_logo_empresa: caminho com ..');
select is(api.definir_logo_empresa('00000000-0000-0000-0000-00000000dead', 'x/logo.png') ->> 'codigo', 'NAO_ENCONTRADO',
  'definir_logo_empresa: empresa inexistente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_logo_empresa('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/logo.png') ->> 'codigo', 'SEM_PERMISSAO', 'definir_logo_empresa: cliente negado');
reset role;
select is((select logo_caminho from app.empresas where id = '00000000-0000-0000-0000-0000000000e1'), '00000000-0000-0000-0000-0000000000e1/logo.webp', 'definir_logo_empresa: último caminho válido gravado');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'DEFINIR_LOGO_EMPRESA' and resultado = 'NEGADO' and codigo in ('CAMINHO_INVALIDO', 'NAO_ENCONTRADO', 'SEM_PERMISSAO')) = 3
  and exists (select 1 from app.auditoria where acao = 'DEFINIR_LOGO_EMPRESA' and resultado = 'OK'),
  'definir_logo_empresa: sucesso e recusas auditados');

------------------------------------------------------------------ autorizar_operacao_usuario
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'GERAR_LINK') ->> 'email', 'clia@teste.local', 'autorizar_operacao_usuario: GERAR_LINK devolve o e-mail normalizado');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'RESETAR_2FA') ->> 'ok', 'true', 'autorizar_operacao_usuario: RESETAR_2FA');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'APAGAR_TUDO') ->> 'codigo', 'CAMPOS_INVALIDOS', 'autorizar_operacao_usuario: ação fora da lista');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-00000000dead', 'GERAR_LINK') ->> 'codigo', 'NAO_ENCONTRADO',
  'autorizar_operacao_usuario: usuário inexistente');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a1', 'GERAR_LINK') ->> 'codigo', 'PROPRIO_USUARIO', 'autorizar_operacao_usuario: não opera sobre si mesmo');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a5', 'RESETAR_2FA') ->> 'codigo', 'ALVO_ADM', 'autorizar_operacao_usuario: alvo ADM recusado');
select is((select count(*)::int from generate_series(1, 14) g where api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'GERAR_LINK') ->> 'ok' = 'true'), 14,
  'autorizar_operacao_usuario: até 20 chamadas por dia');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'GERAR_LINK') ->> 'codigo', 'LIMITE_EXCEDIDO', 'autorizar_operacao_usuario: 21ª chamada negada');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a3', 'GERAR_LINK') ->> 'codigo', 'SEM_PERMISSAO', 'autorizar_operacao_usuario: motorista negado');
reset role;
select ok(exists (select 1 from app.auditoria where acao = 'AUTORIZAR_OPERACAO_USUARIO' and resultado = 'OK' and detalhe ->> 'operacao' = 'GERAR_LINK')
          and exists (select 1 from app.auditoria where acao = 'AUTORIZAR_OPERACAO_USUARIO' and resultado = 'OK' and detalhe ->> 'operacao' = 'RESETAR_2FA'),
  'autorizar_operacao_usuario: sucessos auditados com a operação no detalhe');
select ok(
  (select count(distinct codigo) from app.auditoria
   where acao = 'AUTORIZAR_OPERACAO_USUARIO' and resultado = 'NEGADO' and codigo in ('CAMPOS_INVALIDOS', 'NAO_ENCONTRADO', 'SEM_PERMISSAO', 'PROPRIO_USUARIO', 'ALVO_ADM', 'LIMITE_EXCEDIDO')) = 6,
  'autorizar_operacao_usuario: recusas auditadas');

------------------------------------------------------------------ leituras
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select papel::text from api.meu_perfil()), 'ADM', 'meu_perfil: papel');
select is((select tem_2fa from api.meu_perfil()), true, 'meu_perfil: tem_2fa com TOTP verificado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select tem_2fa from api.meu_perfil()), false, 'meu_perfil: fator não verificado não conta como 2FA');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is((select empresa_nome from api.meu_perfil()), 'Empresa A', 'meu_perfil: nome da empresa do cliente');
select is((select count(*)::int from api.meu_perfil()), 1, 'meu_perfil: só o próprio perfil');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated","aal":"aal1"}', true);
select is((select senha_pendente from api.meu_perfil()), true, 'meu_perfil: devolve o perfil mesmo com senha pendente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.meu_perfil() $$, 'meu_perfil: vazio para usuário do Auth sem perfil');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.listar_usuarios()), 7, 'listar_usuarios: ADM vê todos os perfis');
select is((select email from api.listar_usuarios() where usuario_id = '00000000-0000-0000-0000-0000000000a3'), 'clia@teste.local', 'listar_usuarios: traz o e-mail');
select is((select tem_2fa from api.listar_usuarios() where usuario_id = '00000000-0000-0000-0000-0000000000a1'), true, 'listar_usuarios: tem_2fa');
select is((select empresa_nome from api.listar_usuarios() where usuario_id = '00000000-0000-0000-0000-0000000000a3'), 'Empresa A', 'listar_usuarios: traz a empresa');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio para ADM sem aal2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio para motorista');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio para cliente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio sem perfil');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.empresas), 4, 'empresas: ADM vê todas');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.empresas), 4, 'empresas: motorista vê todas');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from api.empresas), 1, 'empresas: cliente vê só a própria');
select is((select nome from api.empresas), 'Empresa A', 'empresas: a do cliente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.empresas $$, 'empresas: vazia sem perfil');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from api.permissoes), 3, 'permissoes: cliente lê as 3 chaves');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.permissoes $$, 'permissoes: vazia para ADM sem aal2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.permissoes $$, 'permissoes: vazia sem perfil');
reset role;
-- 520 linhas de volume para provar o teto de 500 (ação constante de teste).
insert into app.auditoria (usuario_id, acao, resultado) select '00000000-0000-0000-0000-0000000000a2', 'TESTE_VOLUME', 'OK' from generate_series(1, 520);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select ok((select count(*) from api.listar_auditoria()) > 0, 'listar_auditoria: ADM lê');
select is((select count(*)::int from api.listar_auditoria(p_limite => 1)), 1, 'listar_auditoria: respeita o limite pedido');
select is((select count(*)::int from api.listar_auditoria(p_limite => 100000)), 500, 'listar_auditoria: teto de 500 linhas');
select is((select count(*)::int from api.listar_auditoria(p_limite => 0)), 1, 'listar_auditoria: limite mínimo 1');
select ok((select count(*) from api.listar_auditoria(p_acao => 'DEFINIR_ATIVO')) > 0
          and not exists (select 1 from api.listar_auditoria(p_acao => 'DEFINIR_ATIVO') where acao <> 'DEFINIR_ATIVO'),
  'listar_auditoria: filtro por ação');
select ok((select count(*) from api.listar_auditoria(p_resultado => 'NEGADO')) > 0
          and not exists (select 1 from api.listar_auditoria(p_resultado => 'NEGADO', p_limite => 500) where resultado <> 'NEGADO'),
  'listar_auditoria: filtro por resultado');
select ok((select count(*) from api.listar_auditoria(p_usuario => '00000000-0000-0000-0000-0000000000a2')) > 0
          and not exists (select 1 from api.listar_auditoria(p_usuario => '00000000-0000-0000-0000-0000000000a2', p_limite => 500) where usuario_id <> '00000000-0000-0000-0000-0000000000a2'),
  'listar_auditoria: filtro por usuário');
select is((select count(*)::int from api.listar_auditoria(p_de => now() + interval '1 day')), 0, 'listar_auditoria: filtro por data (de)');
select is((select count(*)::int from api.listar_auditoria(p_ate => now() - interval '1 day')), 0, 'listar_auditoria: filtro por data (até)');
select is((select usuario_nome from api.listar_auditoria(p_acao => 'PREPARAR_CONVITE', p_limite => 1)), 'Admin Teste',
  'listar_auditoria: traz o nome de quem agiu');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_auditoria() $$, 'listar_auditoria: vazia para ADM sem aal2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_auditoria() $$, 'listar_auditoria: vazia para motorista');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_auditoria() $$, 'listar_auditoria: vazia para cliente');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_auditoria() $$, 'listar_auditoria: vazia sem perfil');

------------------------------------------------------------------ privilégios
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select api.sistema_confirmar_senha('00000000-0000-0000-0000-0000000000a7') $$, '42501', null, 'authenticated não executa sistema_confirmar_senha');
select throws_ok($$ select api.sistema_convite_primeiro_adm('a@b.co', 'Fulano Teste') $$, '42501', null, 'authenticated não executa sistema_convite_primeiro_adm');
select throws_ok($$ select api.sistema_registrar(null, 'ABC', null, 'OK', null) $$, '42501', null, 'authenticated não executa sistema_registrar');
select throws_ok($$ select interno.auditar_como(null, 'ABC', null, 'OK', null, null) $$, '42501', null, 'authenticated não executa interno.auditar_como');
reset role;
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname like 'sistema\_%'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not has_function_privilege('service_role', p.oid, 'EXECUTE'))
$$, 'sistema_*: EXECUTE só para service_role');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api'
             and p.proname in ('sistema_confirmar_senha', 'sistema_convite_primeiro_adm', 'sistema_registrar', 'sistema_link_primeiro_adm', 'sistema_papel_por_email')), 5,
  'existem as 5 funções sistema_* esperadas');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('preparar_convite', 'alterar_perfil', 'definir_ativo', 'definir_permissao',
    'salvar_empresa', 'definir_logo_empresa', 'autorizar_operacao_usuario', 'meu_perfil', 'listar_usuarios', 'listar_auditoria')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
$$, 'RPCs de gestão e leituras: service_role não executa');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('preparar_convite', 'alterar_perfil', 'definir_ativo', 'definir_permissao',
    'salvar_empresa', 'definir_logo_empresa', 'autorizar_operacao_usuario', 'meu_perfil', 'listar_usuarios', 'listar_auditoria')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or not p.prosecdef)
$$, 'RPCs de gestão e leituras: authenticated sim, anon não, todas SECURITY DEFINER');
select columns_are('api', 'empresas', array['id', 'nome', 'logo_caminho'], 'api.empresas: colunas explícitas');
select columns_are('api', 'permissoes', array['chave', 'ativo', 'alterado_em'], 'api.permissoes: colunas explícitas');

------------------------------------------------------------------ sistema_* (service_role)
set local role service_role;
select is(api.sistema_confirmar_senha('00000000-0000-0000-0000-0000000000a7') ->> 'ok', 'true', 'sistema_confirmar_senha: limpa a senha pendente');
select is(api.sistema_confirmar_senha('00000000-0000-0000-0000-00000000dead') ->> 'codigo', 'NAO_ENCONTRADO', 'sistema_confirmar_senha: usuário inexistente');
select is(api.sistema_registrar('00000000-0000-0000-0000-0000000000a2', 'RESETAR_2FA', 'usuario:alvo', 'OK', null) ->> 'ok', 'true', 'sistema_registrar: registra');
select is(api.sistema_registrar('00000000-0000-0000-0000-0000000000a2', 'x; drop table app.auditoria', null, 'OK', null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'sistema_registrar: ação fora do formato');
select is(api.sistema_registrar('00000000-0000-0000-0000-0000000000a2', 'ACAO_BOA', null, 'OK', null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'sistema_registrar: ação fora da lista permitida');
select is(api.sistema_registrar('00000000-0000-0000-0000-0000000000a2', 'ACAO_BOA', null, 'TALVEZ', null) ->> 'codigo', 'CAMPOS_INVALIDOS', 'sistema_registrar: resultado inválido');
select is(api.sistema_registrar('00000000-0000-0000-0000-0000000000a2', 'ACAO_BOA', null, 'NEGADO', 'codigo ruim') ->> 'codigo', 'CAMPOS_INVALIDOS', 'sistema_registrar: código fora do formato');
select is(api.sistema_convite_primeiro_adm('primeiro@teste.local', 'Primeiro Adm') ->> 'codigo', 'JA_EXISTE_ADM', 'sistema_convite_primeiro_adm: já existe ADM');
reset role;
select ok(exists (select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a7' and not senha_pendente)
          and exists (select 1 from app.auditoria where acao = 'CONFIRMAR_SENHA' and resultado = 'OK' and usuario_id = '00000000-0000-0000-0000-0000000000a7'),
  'sistema_confirmar_senha: perfil liberado e auditado em nome do usuário');
select ok(exists (select 1 from app.auditoria where acao = 'RESETAR_2FA' and usuario_id = '00000000-0000-0000-0000-0000000000a2' and alvo = 'usuario:alvo' and resultado = 'OK'),
  'sistema_registrar: auditado em nome do usuário informado');
select is_empty($$ select 1 from app.auditoria where acao like 'x;%' or acao = 'ACAO_BOA' $$, 'sistema_registrar: texto recusado nunca vira ação da auditoria');
select ok(exists (select 1 from app.auditoria where acao = 'SISTEMA_REGISTRAR_INVALIDO' and resultado = 'NEGADO'), 'sistema_registrar: tentativa inválida auditada');
select ok(exists (select 1 from app.auditoria where acao = 'CONVITE_PRIMEIRO_ADM' and codigo = 'JA_EXISTE_ADM' and resultado = 'NEGADO'),
  'sistema_convite_primeiro_adm: recusa auditada');

------------------------------------------------------------------ ULTIMO_ADM
update app.perfis set ativo = false where papel = 'ADM' and usuario_id <> '00000000-0000-0000-0000-0000000000a1';
select is(interno.ha_outro_adm_ativo('00000000-0000-0000-0000-0000000000a1'), false, 'ha_outro_adm_ativo: falso quando só resta ele');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a1', 'Admin Teste', 'MOTORISTA', null) ->> 'codigo', 'ULTIMO_ADM', 'alterar_perfil: ULTIMO_ADM');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a1', false, 'Tentativa final') ->> 'codigo', 'ULTIMO_ADM', 'definir_ativo: ULTIMO_ADM');
reset role;
select ok(exists (select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a1' and papel = 'ADM' and ativo), 'ULTIMO_ADM: nada mudou');
select ok((select count(*) from app.auditoria where codigo = 'ULTIMO_ADM' and resultado = 'NEGADO'
           and acao in ('ALTERAR_PERFIL', 'DEFINIR_ATIVO')) = 2, 'ULTIMO_ADM: recusas auditadas');

------------------------------------------------------------------ primeiro ADM (sem nenhum perfil ADM)
update app.perfis set papel = 'MOTORISTA' where papel = 'ADM';
set local role service_role;
select is(api.sistema_convite_primeiro_adm('  Primeiro@Teste.Local ', 'Primeiro Adm') ->> 'email', 'primeiro@teste.local',
  'sistema_convite_primeiro_adm: cria convite ADM e devolve o e-mail normalizado');
select is(api.sistema_convite_primeiro_adm('inválido', 'Primeiro Adm') ->> 'codigo', 'CAMPOS_INVALIDOS', 'sistema_convite_primeiro_adm: e-mail inválido');
select is(api.sistema_convite_primeiro_adm('adm@teste.local', 'Primeiro Adm') ->> 'codigo', 'JA_CADASTRADO', 'sistema_convite_primeiro_adm: e-mail com perfil');
select is(api.sistema_convite_primeiro_adm('semperfil@teste.local', 'Primeiro Adm') ->> 'codigo', 'EMAIL_EM_USO', 'sistema_convite_primeiro_adm: e-mail do Auth sem perfil');
reset role;
select ok(exists (select 1 from app.convites where email = 'primeiro@teste.local' and papel = 'ADM' and empresa_id is null and usado_em is null),
  'sistema_convite_primeiro_adm: convite ADM pendente gravado');
set local role service_role;
select is(api.sistema_convite_primeiro_adm('segundo@teste.local', 'Segundo Adm') ->> 'ok', 'true', 'sistema_convite_primeiro_adm: segunda execução');
reset role;
select ok((select count(*) = 1 and bool_and(email = 'segundo@teste.local') from app.convites where papel = 'ADM' and usado_em is null),
  'sistema_convite_primeiro_adm: duas execuções deixam um único convite ADM pendente');
select ok(exists (select 1 from app.auditoria where acao = 'CONVITE_PRIMEIRO_ADM' and resultado = 'OK'), 'sistema_convite_primeiro_adm: sucesso auditado');

------------------------------------------------------------------ sistema_link_primeiro_adm
set local role service_role;
select is(api.sistema_link_primeiro_adm('adm3@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'sistema_link_primeiro_adm: perfil que não é ADM');
select is(api.sistema_link_primeiro_adm('ninguem@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'sistema_link_primeiro_adm: e-mail desconhecido');
reset role;
update app.perfis set papel = 'ADM', senha_pendente = true where usuario_id = '00000000-0000-0000-0000-0000000000a6';
set local role service_role;
select is(api.sistema_link_primeiro_adm(' ADM3@teste.local ') ->> 'email', 'adm3@teste.local', 'sistema_link_primeiro_adm: ADM com senha pendente devolve o e-mail normalizado');
reset role;
update app.perfis set senha_pendente = false where usuario_id = '00000000-0000-0000-0000-0000000000a6';
set local role service_role;
select is(api.sistema_link_primeiro_adm('adm3@teste.local') ->> 'codigo', 'NAO_PERMITIDO', 'sistema_link_primeiro_adm: ADM que já definiu a senha');
reset role;
select ok(exists (select 1 from app.auditoria where acao = 'LINK_PRIMEIRO_ADM' and resultado = 'OK')
          and exists (select 1 from app.auditoria where acao = 'LINK_PRIMEIRO_ADM' and resultado = 'NEGADO' and codigo = 'NAO_PERMITIDO'),
  'sistema_link_primeiro_adm: auditado');
select is_empty($$ select 1 from app.auditoria
  where acao in ('CONFIRMAR_SENHA', 'CONVITE_PRIMEIRO_ADM', 'SISTEMA_REGISTRAR_INVALIDO', 'RESETAR_2FA', 'LINK_PRIMEIRO_ADM')
    and detalhe ->> 'origem' is distinct from 'sistema' $$, 'auditoria de sistema: sempre com origem = sistema');

------------------------------------------------------------------ nomes de ação são constantes
select is_empty($$
  select distinct acao from app.auditoria
  where acao not in ('PREPARAR_CONVITE', 'ALTERAR_PERFIL', 'DEFINIR_ATIVO', 'DEFINIR_PERMISSAO', 'SALVAR_EMPRESA',
    'DEFINIR_LOGO_EMPRESA', 'AUTORIZAR_OPERACAO_USUARIO', 'CONFIRMAR_SENHA', 'CONVITE_PRIMEIRO_ADM',
    'SISTEMA_REGISTRAR_INVALIDO', 'RESETAR_2FA', 'LINK_PRIMEIRO_ADM', 'TESTE_VOLUME')
$$, 'auditoria: só nomes de ação constantes (nada de texto do chamador)');

select * from finish();
rollback;
