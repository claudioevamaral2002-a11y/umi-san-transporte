begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'prova_assinar'),
  'política prova_assinar existe em realtime.messages'
);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@teste.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@teste.local');

insert into app.prova_canal (id, dono)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select ok(app.pode_ver_prova('prova:00000000-0000-0000-0000-0000000000c1'), 'dono pode assinar o canal');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select ok(not app.pode_ver_prova('prova:00000000-0000-0000-0000-0000000000c1'), 'outro usuário não pode assinar');

select throws_ok(
  $$ insert into app.prova_canal (dono) values ('00000000-0000-0000-0000-0000000000b1') $$,
  '42501', null, 'authenticated não insere direto em app'
);

select * from finish();
rollback;
