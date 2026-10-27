-- v2.2.1 (migration 20261028120000_locais_ultimos.sql): com o texto vazio, api.locais_da_empresa devolve os locais
-- usados por último primeiro ("Últimos lugares" no De/Para); com texto, a ordem continua a dos mais usados. Os locais
-- de outra empresa nunca aparecem.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into app.empresas (id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', 'Empresa A'),
  ('00000000-0000-0000-0000-0000000000e2', 'Empresa B');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('n2a@teste.local', 'Solicitante A', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n2b@teste.local', 'Solicitante B', 'CLIENTE', '00000000-0000-0000-0000-0000000000e2', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2b@teste.local');
update app.perfis set senha_pendente = false;

-- A: o mais usado (Porto, 9 usos) não é o mais recente (Marina, há 1 hora); o Estaleiro fica no meio nas duas ordens.
-- B: um local mais recente que todos os de A, com o mesmo pedaço de nome.
insert into app.locais_empresa (empresa_id, nome, place_id, chave, usos, ultimo_uso) values
  ('00000000-0000-0000-0000-0000000000e1', 'Porto de Itajaí',      'ChIJporto', 'ChIJporto', 9, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000e1', 'Estaleiro Itajaí',     'ChIJestal', 'ChIJestal', 4, now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000e1', 'Marina Itajaí',        'ChIJmarin', 'ChIJmarin', 1, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000e2', 'Itajaí da Empresa B',  'ChIJoutra', 'ChIJoutra', 50, now());

select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', 'aal1')::text, true)
from unnest(array['a5', 'a8']) u;

set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);

select is((select jsonb_agg(l ->> 'nome') from jsonb_array_elements(api.locais_da_empresa('') -> 'locais') l),
  '["Marina Itajaí", "Estaleiro Itajaí", "Porto de Itajaí"]'::jsonb,
  'texto vazio: os últimos usados primeiro, não os mais usados');
select is(api.locais_da_empresa('   ') -> 'locais' -> 0 ->> 'nome', 'Marina Itajaí', 'só espaços conta como vazio');
select is((select jsonb_agg(l ->> 'nome') from jsonb_array_elements(api.locais_da_empresa('itajai') -> 'locais') l),
  '["Porto de Itajaí", "Estaleiro Itajaí", "Marina Itajaí"]'::jsonb,
  'com texto, a ordem continua a dos mais usados');
select is(api.locais_da_empresa('') -> 'locais' -> 0, '{"nome": "Marina Itajaí", "lat": null, "lng": null,
  "place_id": "ChIJmarin"}'::jsonb, 'mesma forma de resposta: nome, lat, lng e place_id');
select is(api.locais_da_empresa('') ->> 'ok', 'true', 'ok');
select ok(not (api.locais_da_empresa('') -> 'locais') @> '[{"nome": "Itajaí da Empresa B"}]'::jsonb
          and not (api.locais_da_empresa('itajai') -> 'locais') @> '[{"nome": "Itajaí da Empresa B"}]'::jsonb,
  'o local mais recente de outra empresa não aparece para A');

select set_config('request.jwt.claims', current_setting('t.ca8'), true);
select is((select jsonb_agg(l ->> 'nome') from jsonb_array_elements(api.locais_da_empresa('') -> 'locais') l),
  '["Itajaí da Empresa B"]'::jsonb, 'B só vê o próprio local');
select is((select jsonb_agg(l ->> 'nome') from jsonb_array_elements(api.locais_da_empresa('porto') -> 'locais') l),
  null, 'B não acha os locais de A pelo nome');

select * from finish();
rollback;
