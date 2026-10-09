-- Papéis do prestador e níveis do cliente (fase 1B, Adendo A10): GESTOR_FROTA, nível 1..3 do cliente,
-- pode_fazer por papel/nível e gestão da própria equipe pelo cliente N1 (só colegas CLIENTE da própria empresa).
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local', 'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n1a@teste.local', 'Gestora A',       'CLIENTE',      '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE',      '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Visualizador A',  'CLIENTE',      '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local', 'Gestora B',       'CLIENTE',      '00000000-0000-0000-0000-0000000000e2', 1),
  ('n2b@teste.local', 'Solicitante B',   'CLIENTE',      '00000000-0000-0000-0000-0000000000e2', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2b@teste.local');
update app.perfis set senha_pendente = false;

------------------------------------------------------------------ estrutura
select ok('GESTOR_FROTA' = any (enum_range(null::app.papel)::text[]), 'app.papel tem GESTOR_FROTA');
select is((select nivel from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a5'), 2::smallint,
  'convite → perfil copia o nível');
select ok((select nivel is null from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a3'),
  'gestor de frota sem nível');
select throws_ok($$ insert into app.convites (email, nome, papel, empresa_id) values ('x1@teste.local', 'Fulano Teste', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null, 'convite de CLIENTE sem nível recusado');
select throws_ok($$ insert into app.convites (email, nome, papel, empresa_id, nivel) values ('x2@teste.local', 'Fulano Teste', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 4) $$,
  '23514', null, 'convite com nível 4 recusado');
select throws_ok($$ insert into app.convites (email, nome, papel, empresa_id, nivel) values ('x3@teste.local', 'Fulano Teste', 'MOTORISTA', null, 1) $$,
  '23514', null, 'convite de MOTORISTA com nível recusado');
select throws_ok($$ update app.perfis set nivel = null where usuario_id = '00000000-0000-0000-0000-0000000000a4' $$,
  '23514', null, 'perfil CLIENTE sem nível recusado');
select throws_ok($$ update app.perfis set nivel = 1 where usuario_id = '00000000-0000-0000-0000-0000000000a3' $$,
  '23514', null, 'perfil não-cliente com nível recusado');

------------------------------------------------------------------ acesso e pode_fazer
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'GESTOR_FROTA aal1: recusado');
select is(app.pode_fazer('VER_AGENDA_FROTA'), false, 'GESTOR_FROTA aal1: nenhuma ação');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'GESTOR_FROTA sem claim aal: recusado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select ok((app.pode_acessar()).usuario_id is not null, 'GESTOR_FROTA aal2: liberado');
select is(app.pode_fazer('VER_AGENDA_FROTA'), true, 'VER_AGENDA_FROTA: gestor de frota pode');
select is(app.pode_fazer('GERIR_CONTRATOS'), false, 'GERIR_CONTRATOS: gestor de frota não pode');
select is(app.pode_fazer('LANCAR_SALDO'), false, 'LANCAR_SALDO: gestor de frota não pode');
select is(app.pode_fazer('GERIR_USUARIOS'), false, 'GERIR_USUARIOS: gestor de frota não pode');
select is(app.pode_fazer('GERIR_EQUIPE_EMPRESA'), false, 'GERIR_EQUIPE_EMPRESA: gestor de frota não pode');
select is((select count(*)::int from api.empresas where id = '00000000-0000-0000-0000-0000000000e2'), 1, 'gestor de frota lê empresa de cliente');
select ok((select count(*) from api.empresas) >= 3, 'gestor de frota lê todas as empresas');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select ok(app.pode_fazer('GERIR_CONTRATOS') and app.pode_fazer('LANCAR_SALDO') and app.pode_fazer('GERIR_EMPRESAS')
          and app.pode_fazer('VER_AUDITORIA') and app.pode_fazer('GERIR_USUARIOS') and app.pode_fazer('GERIR_CONFIGURACAO'),
  'ADM: todas as ações de ADM');
select is(app.pode_fazer('VER_AGENDA_FROTA'), true, 'VER_AGENDA_FROTA: ADM pode');
select is(app.pode_fazer('GERIR_EQUIPE_EMPRESA'), false, 'GERIR_EQUIPE_EMPRESA: só cliente N1 (ADM usa GERIR_USUARIOS)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(app.pode_fazer('VER_AGENDA_FROTA'), false, 'VER_AGENDA_FROTA: motorista não pode');
select is(app.pode_fazer('LANCAR_SALDO'), false, 'LANCAR_SALDO: motorista não pode (sem delegação)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(app.pode_fazer('GERIR_EQUIPE_EMPRESA'), true, 'GERIR_EQUIPE_EMPRESA: cliente N1 pode (sem 2FA)');
select ok(not app.pode_fazer('GERIR_USUARIOS') and not app.pode_fazer('LANCAR_SALDO') and not app.pode_fazer('VER_AGENDA_FROTA')
          and not app.pode_fazer('GERIR_CONTRATOS'),
  'cliente N1: nenhuma ação do prestador');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is(app.pode_fazer('GERIR_EQUIPE_EMPRESA'), false, 'GERIR_EQUIPE_EMPRESA: cliente N2 não pode');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated","aal":"aal1"}', true);
select is(app.pode_fazer('GERIR_EQUIPE_EMPRESA'), false, 'GERIR_EQUIPE_EMPRESA: cliente N3 não pode');

------------------------------------------------------------------ preparar_convite pelo cliente N1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('colega1@teste.local', 'Colega Um', 'CLIENTE', null, 2::smallint) ->> 'ok', 'true',
  'N1 convida colega (empresa forçada pelo servidor)');
select is(api.preparar_convite('colega2@teste.local', 'Colega Dois', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1::smallint) ->> 'ok', 'true',
  'N1 convida colega N1 da própria empresa');
select is(api.preparar_convite('outra@teste.local', 'Outra Empresa', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2::smallint) ->> 'codigo',
  'SEM_PERMISSAO', 'N1 não convida para outra empresa');
select is(api.preparar_convite('mot2@teste.local', 'Motorista Dois', 'MOTORISTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não convida motorista');
select is(api.preparar_convite('adm9@teste.local', 'Admin Nove', 'ADM', null) ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não convida ADM');
select is(api.preparar_convite('ges2@teste.local', 'Gestor Dois', 'GESTOR_FROTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não convida gestor de frota');
select is(api.preparar_convite('semnivel@teste.local', 'Sem Nivel', 'CLIENTE', null) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'N1 precisa informar o nível');
select is(api.preparar_convite('nivel4@teste.local', 'Nivel Quatro', 'CLIENTE', null, 4::smallint) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'nível 4 recusado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('n2conv@teste.local', 'Convite De N2', 'CLIENTE', null, 3::smallint) ->> 'codigo', 'SEM_PERMISSAO',
  'N2 não convida');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('n3conv@teste.local', 'Convite De N3', 'CLIENTE', null, 3::smallint) ->> 'codigo', 'SEM_PERMISSAO',
  'N3 não convida');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite('gesconv@teste.local', 'Convite De Gestor', 'MOTORISTA', null) ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não convida');

-- ADM: qualquer papel; CLIENTE sem nível = nível 1 (compatível com a Edge Function atual).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite('ges.novo@teste.local', 'Gestor Novo', 'GESTOR_FROTA', null) ->> 'ok', 'true', 'ADM convida gestor de frota');
select is(api.preparar_convite('cli.padrao@teste.local', 'Cliente Padrao', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2') ->> 'ok', 'true',
  'ADM convida cliente sem nível');
select is(api.preparar_convite('cli.n3@teste.local', 'Cliente Tres', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 3::smallint) ->> 'ok', 'true',
  'ADM convida cliente N3');
select is(api.preparar_convite('mot.nivel@teste.local', 'Motorista Nivel', 'MOTORISTA', null, 2::smallint) ->> 'codigo', 'CAMPOS_INVALIDOS',
  'ADM: nível em papel não-cliente recusado');
reset role;
select ok(
  (select bool_and(empresa_id = '00000000-0000-0000-0000-0000000000e1' and papel = 'CLIENTE'
                   and criado_por = '00000000-0000-0000-0000-0000000000a4')
     and count(*) = 2
   from app.convites where email in ('colega1@teste.local', 'colega2@teste.local') and usado_em is null),
  'convites do N1: CLIENTE da própria empresa, com o autor');
select is((select nivel from app.convites where email = 'colega1@teste.local'), 2::smallint, 'convite do N1 com o nível pedido');
select is((select nivel from app.convites where email = 'cli.padrao@teste.local'), 1::smallint, 'convite do ADM sem nível: nível 1');
select ok((select nivel is null and papel = 'GESTOR_FROTA' from app.convites where email = 'ges.novo@teste.local'), 'convite de gestor de frota sem nível');
select is_empty($$ select 1 from app.convites where usado_em is null
  and email in ('outra@teste.local', 'mot2@teste.local', 'adm9@teste.local', 'ges2@teste.local', 'semnivel@teste.local',
                'nivel4@teste.local', 'n2conv@teste.local', 'n3conv@teste.local', 'gesconv@teste.local', 'mot.nivel@teste.local') $$,
  'recusas não criam convite');
select ok(exists (select 1 from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'OK'
                  and usuario_id = '00000000-0000-0000-0000-0000000000a4' and (detalhe ->> 'gestor_empresa')::boolean
                  and (detalhe ->> 'nivel')::int = 2),
  'convite do N1 auditado com nível e origem gestor da empresa');
select is((select count(*)::int from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO' and codigo = 'SEM_PERMISSAO'
           and usuario_id = '00000000-0000-0000-0000-0000000000a4'), 4, 'recusas do N1 auditadas');

------------------------------------------------------------------ definir_ativo pelo cliente N1
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a5', false, 'Saiu da equipe') ->> 'ok', 'true', 'N1 desativa colega N2');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a5', true, 'Voltou à equipe') ->> 'ok', 'true', 'N1 reativa colega');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a4', false, 'Quero sair') ->> 'codigo', 'PROPRIO_USUARIO', 'N1 não desativa a si');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a8', false, 'Outra empresa') ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não desativa cliente de outra empresa');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a2', false, 'Motorista') ->> 'codigo', 'SEM_PERMISSAO', 'N1 não desativa motorista');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a1', false, 'Administrador') ->> 'codigo', 'SEM_PERMISSAO', 'N1 não desativa ADM');
select is(api.definir_ativo('00000000-0000-0000-0000-00000000dead', false, 'Inexistente') ->> 'codigo', 'SEM_PERMISSAO',
  'N1: alvo inexistente não é revelado');
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a6', false, ' ') ->> 'codigo', 'MOTIVO_OBRIGATORIO', 'N1: motivo obrigatório');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a6', false, 'Tentativa N2') ->> 'codigo', 'SEM_PERMISSAO', 'N2 não desativa');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated","aal":"aal1"}', true);
select is(api.definir_ativo('00000000-0000-0000-0000-0000000000a5', false, 'Tentativa N3') ->> 'codigo', 'SEM_PERMISSAO', 'N3 não age');
reset role;
select ok((select bool_and(ativo) from app.perfis), 'nenhum perfil ficou desativado');
select ok(exists (select 1 from app.auditoria where acao = 'DEFINIR_ATIVO' and resultado = 'OK'
                  and usuario_id = '00000000-0000-0000-0000-0000000000a4' and (detalhe ->> 'gestor_empresa')::boolean),
  'desativação pelo N1 auditada');

------------------------------------------------------------------ autorizar_operacao_usuario pelo cliente N1
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a6', 'GERAR_LINK') ->> 'email', 'n3a@teste.local',
  'N1 gera link para colega');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a6', 'RESETAR_2FA') ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não reseta 2FA');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a8', 'GERAR_LINK') ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não gera link para outra empresa');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a2', 'GERAR_LINK') ->> 'codigo', 'SEM_PERMISSAO',
  'N1 não gera link para motorista');
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a4', 'GERAR_LINK') ->> 'codigo', 'PROPRIO_USUARIO',
  'N1 não gera link para si');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a6', 'GERAR_LINK') ->> 'codigo', 'SEM_PERMISSAO', 'N2 não gera link');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is(api.autorizar_operacao_usuario('00000000-0000-0000-0000-0000000000a6', 'GERAR_LINK') ->> 'codigo', 'SEM_PERMISSAO',
  'gestor de frota não gera link');

------------------------------------------------------------------ listar_usuarios e meu_perfil
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from api.listar_usuarios()), 3, 'listar_usuarios: N1 vê os colegas da própria empresa');
select ok((select bool_and(empresa_id = '00000000-0000-0000-0000-0000000000e1' and papel = 'CLIENTE') from api.listar_usuarios()),
  'listar_usuarios: N1 nunca vê outra empresa nem o prestador');
select is((select nivel from api.listar_usuarios() where usuario_id = '00000000-0000-0000-0000-0000000000a6'), 3::smallint,
  'listar_usuarios: traz o nível');
select is((select nivel from api.meu_perfil()), 1::smallint, 'meu_perfil: traz o nível');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated","aal":"aal1"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio para N2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is_empty($$ select 1 from api.listar_usuarios() $$, 'listar_usuarios: vazio para gestor de frota');
select ok((select papel = 'GESTOR_FROTA' and nivel is null from api.meu_perfil()), 'meu_perfil: gestor de frota sem nível');

------------------------------------------------------------------ alterar_perfil com nível (só ADM)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a6', 'Visualizador A', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1::smallint) ->> 'codigo',
  'SEM_PERMISSAO', 'N1 não muda o nível de colegas');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from api.listar_usuarios() where nivel is not null), 5, 'listar_usuarios: ADM vê o nível de todos os clientes');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a6', 'Visualizador A', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2::smallint) ->> 'ok',
  'true', 'ADM muda o nível do cliente');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a6', 'Visualizador Renomeado', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1') ->> 'ok',
  'true', 'ADM renomeia sem informar o nível');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a2', 'Motorista Teste', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2') ->> 'ok',
  'true', 'ADM transforma motorista em cliente sem nível');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a8', 'Solicitante B', 'GESTOR_FROTA', null) ->> 'ok',
  'true', 'ADM transforma cliente em gestor de frota');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a7', 'Gestora B', 'MOTORISTA', null, 1::smallint) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'nível em papel não-cliente recusado');
select is(api.alterar_perfil('00000000-0000-0000-0000-0000000000a7', 'Gestora B', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 0::smallint) ->> 'codigo',
  'CAMPOS_INVALIDOS', 'nível 0 recusado');
reset role;
select is((select nivel from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a6'), 2::smallint,
  'nível alterado e mantido ao renomear');
select is((select nivel from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a2'), 1::smallint,
  'quem vira cliente sem nível informado recebe nível 1');
select ok((select nivel is null and papel = 'GESTOR_FROTA' from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a8'),
  'quem deixa de ser cliente perde o nível');
select ok(exists (select 1 from app.auditoria where acao = 'ALTERAR_PERFIL' and resultado = 'OK'
                  and (detalhe ->> 'nivel_anterior')::int = 3 and (detalhe ->> 'nivel_novo')::int = 2),
  'mudança de nível auditada');

------------------------------------------------------------------ nomes de ação constantes
select is_empty($$
  select distinct acao from app.auditoria
  where acao not in ('PREPARAR_CONVITE', 'DEFINIR_ATIVO', 'AUTORIZAR_OPERACAO_USUARIO', 'ALTERAR_PERFIL')
$$, 'auditoria: só nomes de ação constantes');

select * from finish();
rollback;
