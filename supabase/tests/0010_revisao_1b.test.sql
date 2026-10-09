-- Revisão de segurança da fase 1B (migração 20261009120200_revisao_1b.sql).
-- R1: o cliente N1 não substitui convite pendente que não seja CLIENTE da própria empresa; o ADM substitui.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste', 'ADM',     null, null),
  ('n1a@teste.local', 'Gestora A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local');
update app.perfis set senha_pendente = false;

-- convites pendentes feitos pelo ADM (ainda sem conta no Auth)
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('pend.mot@teste.local', 'Motorista Pendente', 'MOTORISTA',    null, null),
  ('pend.ges@teste.local', 'Gestor Pendente',    'GESTOR_FROTA', null, null),
  ('pend.b@teste.local',   'Cliente B Pendente', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2),
  ('pend.a@teste.local',   'Cliente A Pendente', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated","aal":"aal1"}', true);
select is(api.preparar_convite('pend.mot@teste.local', 'Sequestro Motorista', 'CLIENTE', null, 1::smallint) ->> 'codigo',
  'EMAIL_EM_USO', 'N1 não substitui convite pendente de motorista');
select is(api.preparar_convite('pend.ges@teste.local', 'Sequestro Gestor', 'CLIENTE', null, 1::smallint) ->> 'codigo',
  'EMAIL_EM_USO', 'N1 não substitui convite pendente de gestor de frota');
select is(api.preparar_convite('pend.b@teste.local', 'Sequestro Cliente B', 'CLIENTE', null, 1::smallint) ->> 'codigo',
  'EMAIL_EM_USO', 'N1 não substitui convite pendente de cliente de outra empresa');
select is(api.preparar_convite('pend.a@teste.local', 'Cliente A Refeito', 'CLIENTE', null, 2::smallint) ->> 'ok',
  'true', 'N1 substitui convite pendente da própria empresa');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is(api.preparar_convite('pend.mot@teste.local', 'Motorista Refeito', 'MOTORISTA', null) ->> 'ok',
  'true', 'ADM segue substituindo convite pendente de qualquer papel');
reset role;

select ok((select papel = 'GESTOR_FROTA' and nome = 'Gestor Pendente' from app.convites
           where email = 'pend.ges@teste.local' and usado_em is null), 'convite de gestor de frota intacto');
select ok((select empresa_id = '00000000-0000-0000-0000-0000000000e2' and nivel = 2 from app.convites
           where email = 'pend.b@teste.local' and usado_em is null), 'convite da outra empresa intacto');
select ok((select nivel = 2 and criado_por = '00000000-0000-0000-0000-0000000000a4' from app.convites
           where email = 'pend.a@teste.local' and usado_em is null), 'convite da própria empresa refeito pelo N1');
select is((select count(*)::int from app.auditoria where acao = 'PREPARAR_CONVITE' and resultado = 'NEGADO'
           and codigo = 'EMAIL_EM_USO' and usuario_id = '00000000-0000-0000-0000-0000000000a4'), 3,
  'recusas do N1 auditadas');

select * from finish();
rollback;
