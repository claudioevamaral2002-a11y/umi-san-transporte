-- api.autorizar_definir_senha: link recente, reautenticação recente, aal2 com fator, inativo e limite.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('mot@teste.local', 'Motorista Teste', 'MOTORISTA', null, null),
  ('cli@teste.local', 'Cliente Teste', 'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('ina@teste.local', 'Inativo Teste', 'MOTORISTA', null, null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli@teste.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina@teste.local');
update app.perfis set senha_pendente = false;
update app.perfis set ativo = false where usuario_id = '00000000-0000-0000-0000-0000000000a9';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', 'totp-a2', 'totp', 'verified', now(), now());

create function public.t_claims(p_sub text, p_aal text, p_metodo text, p_idade_s int) returns text language sql as $$
  select jsonb_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal,
    'amr', jsonb_build_array(jsonb_build_object('method', p_metodo,
      'timestamp', floor(extract(epoch from now()))::bigint - p_idade_s)))::text
$$;
grant execute on function public.t_claims(text, text, text, int) to authenticated;

set local role authenticated;

-- cliente (sem fator)
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'invite', 60), true);
select is(api.autorizar_definir_senha() ->> 'ok', 'true', 'convite recente: liberado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'recovery', 3600), true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'recuperação de 1 h: negado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'recovery', 600), true);
select is(api.autorizar_definir_senha() ->> 'ok', 'true', 'recuperação de 10 min: liberado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'password', 60), true);
select is(api.autorizar_definir_senha() ->> 'ok', 'true', 'senha de 1 min, sem fator: liberado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'password', 400), true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'senha de 6 min: negado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'token_refresh', 10), true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'método desconhecido: negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1","amr":"lixo"}', true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'amr malformado: negado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":"abc"},7]}', true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'amr com lixo: negado sem erro');

-- motorista com fator verificado
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a2', 'aal1', 'password', 30), true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'REAUTENTICACAO_NECESSARIA', 'fator verificado, senha recente em aal1: negado');
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a2', 'aal2', 'password', 30), true);
select is(api.autorizar_definir_senha() ->> 'ok', 'true', 'fator verificado, senha recente em aal2: liberado');

-- inativo
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a9', 'aal2', 'invite', 30), true);
select is(api.autorizar_definir_senha() ->> 'codigo', 'SEM_PERMISSAO', 'inativo: negado');

-- limite: 10 por hora (o cliente já usou 8 chamadas acima)
select set_config('request.jwt.claims', public.t_claims('00000000-0000-0000-0000-0000000000a3', 'aal1', 'invite', 60), true);
select api.autorizar_definir_senha();
select api.autorizar_definir_senha();
select is(api.autorizar_definir_senha() ->> 'codigo', 'LIMITE_EXCEDIDO', 'mais de 10 por hora: LIMITE_EXCEDIDO');

reset role;
select is_empty($$ select 1 from app.auditoria where acao = 'AUTORIZAR_DEFINIR_SENHA' and usuario_id is null $$,
  'auditado sempre com o usuário');

select * from finish();
rollback;
