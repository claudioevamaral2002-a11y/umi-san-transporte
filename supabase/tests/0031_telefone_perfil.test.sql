-- Fase 4, Tarefa 11 (migration 20261020120250_telefone_perfil.sql, Ruling R15): api.salvar_meu_telefone e
-- api.meu_telefone. Qualquer usuário ativo grava só o próprio telefone, no formato brasileiro (DDD + número: 10 ou 11
-- dígitos), guardado só com os dígitos; vazio ou nulo apaga. Recusas auditadas; o "Ligar" (api.pedido) passa a ver o
-- telefone gravado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local', 'Admin Teste',     'ADM',       null, null),
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('n2a@teste.local', 'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local', 'Passageiro A',    'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('ina@teste.local', 'Inativo A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a8';
update app.perfis set telefone = '(48) 3333-0000' where usuario_id = '00000000-0000-0000-0000-0000000000a5';

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a5', 'a6', 'a8']) u;

create function pg_temp.tel(u text) returns text language sql stable as $$
  select telefone from app.perfis where usuario_id = ('00000000-0000-0000-0000-0000000000' || u)::uuid
$$;

------------------------------------------------------------------ privilégios
select ok(has_function_privilege('authenticated', 'api.salvar_meu_telefone(text)', 'EXECUTE'), 'authenticated executa salvar_meu_telefone');
select ok(not has_function_privilege('anon', 'api.salvar_meu_telefone(text)', 'EXECUTE'), 'anon não executa salvar_meu_telefone');
select ok(has_function_privilege('authenticated', 'api.meu_telefone()', 'EXECUTE'), 'authenticated executa meu_telefone');
select ok(not has_function_privilege('anon', 'api.meu_telefone()', 'EXECUTE'), 'anon não executa meu_telefone');

------------------------------------------------------------------ gravar: só dígitos, celular e fixo
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.r1', api.salvar_meu_telefone('(47) 99999-1234')::text, true);
select set_config('t.l1', api.meu_telefone()::text, true);
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.r2', api.salvar_meu_telefone(' 47 3344-5566 ')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.r3', api.salvar_meu_telefone('47.98888.7777')::text, true);
reset role;
select is(current_setting('t.r1')::jsonb, '{"ok": true, "telefone": "47999991234"}'::jsonb, 'motorista grava o celular (só dígitos)');
select is(pg_temp.tel('a2'), '47999991234', 'gravado no próprio perfil, normalizado');
select is(current_setting('t.l1')::jsonb, '{"ok": true, "telefone": "47999991234"}'::jsonb, 'meu_telefone devolve o gravado');
select is(pg_temp.tel('a6'), '4733445566', 'N3 grava um fixo de 10 dígitos');
select is(pg_temp.tel('a1'), '47988887777', 'ADM grava o próprio');
select is(pg_temp.tel('a5'), '(48) 3333-0000', 'os outros perfis não mudam');

------------------------------------------------------------------ formato inválido: TELEFONE_INVALIDO, nada muda, auditado
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select set_config('t.i1', api.salvar_meu_telefone('4799999')::text, true);              -- curto
select set_config('t.i2', api.salvar_meu_telefone('479999912345')::text, true);         -- 12 dígitos
select set_config('t.i3', api.salvar_meu_telefone('(07) 99999-1234')::text, true);      -- DDD com zero
select set_config('t.i4', api.salvar_meu_telefone('47 9999a-1234')::text, true);        -- letra
select set_config('t.i5', api.salvar_meu_telefone('47 8999-91234')::text, true);        -- 11 dígitos sem o 9
select set_config('t.i6', api.salvar_meu_telefone(repeat('4', 40))::text, true);        -- longo demais
reset role;
select ok(current_setting('t.i1')::jsonb = '{"ok": false, "codigo": "TELEFONE_INVALIDO"}'::jsonb
      and current_setting('t.i2')::jsonb = '{"ok": false, "codigo": "TELEFONE_INVALIDO"}'::jsonb, 'menos de 10 ou mais de 11 dígitos: recusado');
select is(current_setting('t.i3')::jsonb ->> 'codigo', 'TELEFONE_INVALIDO', 'DDD começando com 0: recusado');
select is(current_setting('t.i4')::jsonb ->> 'codigo', 'TELEFONE_INVALIDO', 'letras: recusado');
select is(current_setting('t.i5')::jsonb ->> 'codigo', 'TELEFONE_INVALIDO', 'celular de 11 dígitos sem o 9: recusado');
select is(current_setting('t.i6')::jsonb ->> 'codigo', 'TELEFONE_INVALIDO', 'texto longo: recusado');
select is(pg_temp.tel('a2'), '47999991234', 'recusa não muda o telefone');
select ok((select count(*) from app.auditoria
            where acao = 'SALVAR_TELEFONE' and resultado = 'NEGADO' and codigo = 'TELEFONE_INVALIDO'
              and usuario_id = '00000000-0000-0000-0000-0000000000a2') = 6, 'as 6 recusas ficam na auditoria');
select ok(exists (select 1 from app.auditoria
                   where acao = 'SALVAR_TELEFONE' and resultado = 'OK' and alvo = 'usuario:00000000-0000-0000-0000-0000000000a2'),
  'a gravação fica na auditoria');

------------------------------------------------------------------ vazio ou nulo apaga
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select set_config('t.v1', api.salvar_meu_telefone('   ')::text, true);
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select set_config('t.v2', api.salvar_meu_telefone(null)::text, true);
select set_config('t.l2', api.meu_telefone()::text, true);
reset role;
select ok(current_setting('t.v1')::jsonb = '{"ok": true, "telefone": null}'::jsonb and pg_temp.tel('a6') is null, 'só espaços apaga');
select ok(current_setting('t.v2')::jsonb = '{"ok": true, "telefone": null}'::jsonb and pg_temp.tel('a1') is null, 'nulo apaga');
select is(current_setting('t.l2')::jsonb, '{"ok": true, "telefone": null}'::jsonb, 'meu_telefone sem telefone: nulo');

------------------------------------------------------------------ inativo e sem sessão: SEM_PERMISSAO
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select set_config('t.n1', api.salvar_meu_telefone('47999991234')::text, true);
select set_config('t.n2', api.meu_telefone()::text, true);
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select set_config('t.n3', api.salvar_meu_telefone('47999991234')::text, true);
reset role;
select ok(current_setting('t.n1')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb
      and current_setting('t.n2')::jsonb = '{"ok": false, "codigo": "SEM_PERMISSAO"}'::jsonb, 'inativo: SEM_PERMISSAO');
select is(pg_temp.tel('a8'), null, 'inativo não grava');
select is(current_setting('t.n3')::jsonb ->> 'codigo', 'SEM_PERMISSAO', 'sem usuário: SEM_PERMISSAO');

select * from finish();
rollback;
