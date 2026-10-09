-- Realtime Broadcast em canal privado (especificação 1.2; fase 2A "Tempo real"): a prova da fase 0 saiu; as
-- atividades publicam {id, status, em} em atividade:<id> e empresa:<empresa_id>, autorizados por app.pode_ver_topico.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select ok(
  exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'pedidos_assinar'
          and cmd = 'SELECT' and roles = '{authenticated}'),
  'política pedidos_assinar (SELECT, authenticated) existe em realtime.messages'
);
select ok(
  not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'prova_assinar'),
  'política da prova (prova_assinar) removida'
);
select ok(to_regclass('app.prova_canal') is null and to_regprocedure('app.pode_ver_prova(text)') is null
          and to_regprocedure('app.prova_canal_publicar()') is null,
  'prova da fase 0 removida (tabela e funções)');
select has_trigger('app', 'atividades', 'atividades_publicar', 'atividades publicam o status');

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n2a@teste.local',  'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n1b@teste.local',  'Gestora B',       'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 1),
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('mot2@teste.local', 'Motorista Dois',  'MOTORISTA',    null, null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1b@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot2@teste.local');
update app.perfis set senha_pendente = false;

-- Pedido da Empresa A, criado pelo N2 a5, atribuído ao motorista a2 (direto no banco: cenário de teste).
insert into app.atividades (id, empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer,
                            carga, pessoas_qtd, modalidade, reboque, prazo_orcar_ate)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a5',
        '00000000-0000-0000-0000-0000000000a2', now() + interval '3 days', 60, 'Origem A', 'Destino A', true, false,
        'PESSOAS', 1, 'VEICULO_PROPRIO', 'NAO', now() + interval '12 hours');

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3', 'a9') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a5', 'a6', 'a7', 'a8', 'a9']) u;
select set_config('t.ta', 'atividade:00000000-0000-0000-0000-0000000000c1', true);
select set_config('t.tea', 'empresa:00000000-0000-0000-0000-0000000000e1', true);

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select ok(app.pode_ver_topico(current_setting('t.ta')), 'dono (N2) assina o canal do pedido');
select ok(app.pode_ver_topico(current_setting('t.tea')), 'cliente assina o canal da própria empresa');
select ok(not app.pode_ver_topico('empresa:00000000-0000-0000-0000-0000000000e2'), 'cliente não assina o canal de outra empresa');
select ok(not app.pode_ver_topico('prova:00000000-0000-0000-0000-0000000000c1'), 'tópico desconhecido é recusado');
select ok(not app.pode_ver_topico('atividade:nao-e-uuid') and not coalesce(app.pode_ver_topico(null), false)
          and not app.pode_ver_topico('atividade:00000000-0000-0000-0000-0000000000c1x'),
  'tópico malformado é recusado (sem erro)');

select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select ok(app.pode_ver_topico(current_setting('t.ta')), 'N3 da mesma empresa assina o canal do pedido');

select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select ok(not app.pode_ver_topico(current_setting('t.ta')), 'outro N2 da mesma empresa não assina o pedido alheio');
select ok(app.pode_ver_topico(current_setting('t.tea')), 'outro N2 da mesma empresa assina o canal da empresa');

select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select ok(not app.pode_ver_topico(current_setting('t.ta')), 'cliente de outra empresa não assina o pedido');
select ok(not app.pode_ver_topico(current_setting('t.tea')), 'cliente de outra empresa não assina o canal da empresa');

select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select ok(app.pode_ver_topico(current_setting('t.ta')) and app.pode_ver_topico(current_setting('t.tea')),
  'motorista atribuído assina o pedido e a empresa');
select set_config('request.jwt.claims', current_setting('t.ca9'), true);
select ok(not app.pode_ver_topico(current_setting('t.ta')), 'motorista não atribuído não assina o pedido');
select ok(app.pode_ver_topico(current_setting('t.tea')), 'motorista assina o canal de qualquer empresa');
select ok(not app.pode_ver_topico('empresa:00000000-0000-0000-0000-0000000000ff'), 'empresa inexistente é recusada');

select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select ok(app.pode_ver_topico(current_setting('t.ta')) and app.pode_ver_topico(current_setting('t.tea')),
  'ADM assina pedido e empresa');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select ok(app.pode_ver_topico(current_setting('t.ta')) and app.pode_ver_topico(current_setting('t.tea')),
  'gestor de frota assina pedido e empresa');

-- equipe sem aal2 não assina nada
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
                                                          'aal', 'aal1')::text, true);
select ok(not app.pode_ver_topico(current_setting('t.ta')) and not app.pode_ver_topico(current_setting('t.tea')),
  'ADM em aal1 não assina');

select throws_ok(
  $$ update app.atividades set status = 'CANCELADA' $$,
  '42501', null, 'authenticated não altera atividades direto'
);
reset role;

-- A mudança de status passa pela trigger de publicação (a entrega é provada na integração).
select lives_ok($$ select interno.transicionar('00000000-0000-0000-0000-0000000000c1', 'CANCELADA', 'teste') $$,
  'transição com publicação no Realtime não falha');
select is((select status from app.atividades where id = '00000000-0000-0000-0000-0000000000c1'), 'CANCELADA'::app.status_atividade,
  'status gravado');

select * from finish();
rollback;
