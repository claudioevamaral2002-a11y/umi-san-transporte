-- Núcleo de acesso (fase 1): perfis, convites, pode_acessar/pode_fazer, auditoria imutável, limites e RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Empresas e convites (convite ANTES do usuário: o trigger cria o perfil no insert em auth.users).
insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');

insert into app.convites (email, nome, papel, empresa_id) values
  ('adm@teste.local',   'Admin Teste',     'ADM',       null),
  ('mot@teste.local',   'Motorista Teste', 'MOTORISTA', null),
  ('inat@teste.local',  'Inativo Teste',   'MOTORISTA', null),
  ('clia@teste.local',  'Cliente A',       'CLIENTE',   '00000000-0000-0000-0000-0000000000e1'),
  ('clib@teste.local',  'Cliente B',       'CLIENTE',   '00000000-0000-0000-0000-0000000000e2'),
  ('pend@teste.local',  'Pendente Teste',  'CLIENTE',   '00000000-0000-0000-0000-0000000000e1');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inat@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clia@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clib@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pend@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'semconvite@teste.local');

-- 1. sem convite → sem perfil
select is_empty(
  $$ select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a7' $$,
  'usuário sem convite não ganha perfil'
);

-- 2. convite → perfil com papel/empresa do convite, senha pendente, convite usado
select ok(
  exists (select 1 from app.perfis
          where usuario_id = '00000000-0000-0000-0000-0000000000a6'
            and papel = 'CLIENTE'
            and empresa_id = '00000000-0000-0000-0000-0000000000e1'
            and nome = 'Pendente Teste'
            and senha_pendente),
  'convite gera perfil com papel/empresa do convite e senha_pendente = true'
);
select ok(
  (select usado_em is not null from app.convites where email = 'pend@teste.local'),
  'convite marcado como usado'
);

-- Libera os perfis de teste (exceto pend, que segue com senha pendente).
update app.perfis set senha_pendente = false
  where usuario_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
                       '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4',
                       '00000000-0000-0000-0000-0000000000a5');
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a3';

-- 4. troca de senha volta senha_pendente para true
update auth.users set encrypted_password = 'outra-senha-qualquer' where id = '00000000-0000-0000-0000-0000000000a5';
select ok(
  (select senha_pendente from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a5'),
  'troca de encrypted_password recoloca senha_pendente = true'
);
update app.perfis set senha_pendente = false where usuario_id = '00000000-0000-0000-0000-0000000000a5';

-- 6. auditoria imutável (inclusive como postgres)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select interno.auditar('TESTE', 'alvo', 'OK', null, null);
select is((select count(*)::int from app.auditoria where acao = 'TESTE'), 1, 'interno.auditar grava na auditoria');
select throws_ok($$ update app.auditoria set acao = 'X' $$, '42501', null, 'update na auditoria recusado mesmo como postgres');
select throws_ok($$ delete from app.auditoria $$, '42501', null, 'delete na auditoria recusado mesmo como postgres');
select throws_ok($$ truncate app.auditoria $$, '42501', null, 'truncate na auditoria recusado');

-- 7. limite por janela
select is(interno.checar_limite('X', 2, '1 hour'), true, 'limite: 1ª tentativa dentro');
select is(interno.checar_limite('X', 2, '1 hour'), true, 'limite: 2ª tentativa dentro');
select is(interno.checar_limite('X', 2, '1 hour'), false, 'limite: 3ª tentativa acima');

-- 3. pode_acessar() (sessão authenticated)
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated","aal":"aal2"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: sem perfil');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: inativo');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated","aal":"aal1"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: senha pendente');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: ADM aal1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: MOTORISTA aal1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select ok((app.pode_acessar()).usuario_id is not null, 'pode_acessar presente: CLIENTE aal1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select ok((app.pode_acessar()).usuario_id is not null, 'pode_acessar presente: ADM aal2');

-- 5. pode_fazer('EDITAR_PARAMETROS')
select is(app.pode_fazer('EDITAR_PARAMETROS'), true, 'EDITAR_PARAMETROS: ADM pode');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(app.pode_fazer('EDITAR_PARAMETROS'), false, 'EDITAR_PARAMETROS: MOTORISTA não pode sem delegação');

reset role;
update app.permissoes_delegadas set ativo = true where chave = 'MOTORISTA_EDITA_PARAMETROS';
set local role authenticated;
select is(app.pode_fazer('EDITAR_PARAMETROS'), true, 'EDITAR_PARAMETROS: MOTORISTA pode com delegação ativa');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(app.pode_fazer('EDITAR_PARAMETROS'), false, 'EDITAR_PARAMETROS: CLIENTE não pode');

-- 8. RLS (cliente A, aal1)
select is((select count(*)::int from app.perfis), 1, 'RLS: cliente lê só o próprio perfil');
select is((select count(*)::int from app.empresas where id = '00000000-0000-0000-0000-0000000000e2'), 0, 'RLS: cliente da empresa A não lê empresa B');
select is((select count(*)::int from app.empresas where id = '00000000-0000-0000-0000-0000000000e1'), 1, 'RLS: cliente lê a própria empresa');
select is((select count(*)::int from app.auditoria), 0, 'RLS: cliente não lê auditoria');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.auditoria), 0, 'RLS: motorista não lê auditoria');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.perfis), 6, 'RLS: ADM lê todos os perfis');
select ok((select count(*) from app.auditoria) > 0, 'RLS: ADM lê a auditoria');

select * from finish();
rollback;
