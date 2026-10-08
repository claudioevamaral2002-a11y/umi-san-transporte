-- Núcleo de acesso (fase 1): perfis, convites, pode_acessar/pode_fazer, auditoria imutável, limites e RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
  ('pend@teste.local',  'Pendente Teste',  'CLIENTE',   '00000000-0000-0000-0000-0000000000e1'),
  ('pend2@teste.local', 'Pendente Dois',   'CLIENTE',   '00000000-0000-0000-0000-0000000000e1'),
  ('caso@teste.local',  'Caso Teste',      'CLIENTE',   '00000000-0000-0000-0000-0000000000e1');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inat@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clia@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clib@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pend@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'semconvite@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Caso@Teste.Local');

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

-- 3. atualizações de login não recolocam senha_pendente
update auth.users set last_sign_in_at = now() where id = '00000000-0000-0000-0000-0000000000a4';
select ok(
  not (select senha_pendente from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a4'),
  'update de last_sign_in_at não recoloca senha_pendente'
);
update auth.users set encrypted_password = encrypted_password where id = '00000000-0000-0000-0000-0000000000a4';
select ok(
  not (select senha_pendente from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a4'),
  'encrypted_password = encrypted_password não recoloca senha_pendente'
);

-- 3b. trocar o e-mail de usuário sem perfil para o de um convite pendente não cria perfil
update auth.users set email = 'pend2@teste.local' where id = '00000000-0000-0000-0000-0000000000a7';
select ok(
  not exists (select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a7')
  and (select usado_em is null from app.convites where email = 'pend2@teste.local'),
  'update de e-mail não cria perfil e o convite segue pendente'
);

-- 3c. e-mail casa com o convite sem diferenciar maiúsculas
select ok(
  exists (select 1 from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000a8' and nome = 'Caso Teste'),
  'e-mail com caixa diferente casa com o convite e gera perfil'
);

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

-- 7b. limite é por usuário; sem usuário nega sem erro
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(interno.checar_limite('X', 2, '1 hour'), true, 'limite: outro usuário tem contagem própria');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(interno.checar_limite('X', 2, '1 hour'), false, 'limite: sem usuário retorna false sem erro');

-- 6b. os dois gatilhos de imutabilidade existem e estão habilitados
select is(
  (select count(*)::int from pg_trigger
   where tgrelid = 'app.auditoria'::regclass and not tgisinternal and tgenabled = 'O'
     and tgname in ('auditoria_sem_update', 'auditoria_sem_truncate')),
  2,
  'gatilhos de imutabilidade da auditoria existem e estão habilitados'
);

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

-- 3d. ADM sem claim aal
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select ok((app.pode_acessar()).usuario_id is null, 'pode_acessar nulo: ADM sem claim aal');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

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

-- 5b. MOTORISTA aal2: ações de ADM, ação desconhecida e nula
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is(app.pode_fazer('GERIR_USUARIOS'), false, 'GERIR_USUARIOS: MOTORISTA não pode');
select is(app.pode_fazer('VER_AUDITORIA'), false, 'VER_AUDITORIA: MOTORISTA não pode');
select is(app.pode_fazer('ACAO_QUE_NAO_EXISTE'), false, 'ação desconhecida: false');
select is(app.pode_fazer(null), false, 'ação nula: false');

-- 5c. authenticated não alcança internos nem escreve/lê tabelas fechadas
select throws_ok($$ select interno.auditar('X', 'y', 'OK', null, null) $$, '42501', null, 'authenticated não executa interno.auditar');
select throws_ok($$ select * from app.convites $$, '42501', null, 'authenticated não lê app.convites');
select throws_ok($$ insert into app.auditoria (acao, resultado) values ('X', 'OK') $$, '42501', null, 'authenticated não insere em app.auditoria');

-- 8. RLS (cliente A, aal1)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from app.perfis), 1, 'RLS: cliente lê só o próprio perfil');
select is((select count(*)::int from app.empresas where id = '00000000-0000-0000-0000-0000000000e2'), 0, 'RLS: cliente da empresa A não lê empresa B');
select is((select count(*)::int from app.empresas where id = '00000000-0000-0000-0000-0000000000e1'), 1, 'RLS: cliente lê a própria empresa');
select is((select count(*)::int from app.auditoria), 0, 'RLS: cliente não lê auditoria');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.auditoria), 0, 'RLS: motorista não lê auditoria');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.perfis), 7, 'RLS: ADM lê todos os perfis');
select ok((select count(*) from app.auditoria) > 0, 'RLS: ADM lê a auditoria');

-- 8b. matriz de delegação legível por quem tem acesso
select is((select count(*)::int from app.permissoes_delegadas), 3, 'matriz legível: ADM aal2');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.permissoes_delegadas), 3, 'matriz legível: MOTORISTA aal2');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is((select count(*)::int from app.permissoes_delegadas), 3, 'matriz legível: CLIENTE aal1');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from app.permissoes_delegadas), 0, 'matriz ilegível: sem perfil');

select * from finish();
rollback;
