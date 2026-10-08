-- Correções de segurança da gestão (revisão da Task 5): locks, auditoria de sistema, alvos ADM.

-- M3: o convite é travado ao virar perfil (evita uso concorrente do mesmo convite).
create or replace function interno.criar_perfil_do_convite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c app.convites;
begin
  select * into c from app.convites
  where email = lower(new.email) and usado_em is null
  order by criado_em desc limit 1
  for update;
  if found then
    insert into app.perfis (usuario_id, nome, papel, empresa_id, senha_pendente)
    values (new.id, trim(c.nome), c.papel, c.empresa_id, true);
    update app.convites set usado_em = now() where id = c.id;
  end if;
  return new;
end $$;

-- I1: o lock nas linhas dos ADMs ativos é a PRIMEIRA instrução (antes de pode_fazer), serializando
-- mudanças concorrentes que poderiam deixar o sistema sem ADM (TOCTOU). Ordem fixa evita deadlock.
-- (Concorrência não é simulável em pgTAP; os testes funcionais cobrem os caminhos.)
create or replace function api.alterar_perfil(p_usuario uuid, p_nome text, p_papel app.papel, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  alvo app.perfis;
begin
  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo order by pf.usuario_id for update;

  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('ALTERAR_PERFIL', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or length(v_nome) not between 2 and 120 or p_papel is null
     or (p_papel = 'CLIENTE') <> (p_empresa is not null)
     or (p_empresa is not null and not exists (select 1 from app.empresas em where em.id = p_empresa))
  then
    return interno.negar('ALTERAR_PERFIL', 'perfil:' || coalesce(p_usuario::text, '-'), 'CAMPOS_INVALIDOS');
  end if;

  select * into alvo from app.perfis pf where pf.usuario_id = p_usuario;
  if not found then
    return interno.negar('ALTERAR_PERFIL', 'perfil:' || p_usuario, 'NAO_ENCONTRADO');
  end if;

  if alvo.papel = 'ADM' and alvo.ativo and p_papel <> 'ADM' and not interno.ha_outro_adm_ativo(p_usuario) then
    return interno.negar('ALTERAR_PERFIL', 'perfil:' || p_usuario, 'ULTIMO_ADM');
  end if;
  if p_usuario = (select auth.uid()) and p_papel <> alvo.papel then
    return interno.negar('ALTERAR_PERFIL', 'perfil:' || p_usuario, 'PROPRIO_PAPEL');
  end if;

  update app.perfis set nome = v_nome, papel = p_papel, empresa_id = p_empresa where usuario_id = p_usuario;
  perform interno.auditar('ALTERAR_PERFIL', 'perfil:' || p_usuario, 'OK', null,
    jsonb_build_object('papel_anterior', alvo.papel, 'papel_novo', p_papel,
                       'empresa_anterior', alvo.empresa_id, 'empresa_nova', p_empresa));
  return jsonb_build_object('ok', true);
end $$;

create or replace function api.definir_ativo(p_usuario uuid, p_ativo boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  alvo app.perfis;
begin
  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo order by pf.usuario_id for update;

  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or p_ativo is null then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'MOTIVO_OBRIGATORIO');
  end if;

  select * into alvo from app.perfis pf where pf.usuario_id = p_usuario;
  if not found then
    return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'NAO_ENCONTRADO');
  end if;

  if not p_ativo then
    if alvo.papel = 'ADM' and alvo.ativo and not interno.ha_outro_adm_ativo(p_usuario) then
      return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'ULTIMO_ADM');
    end if;
    if p_usuario = (select auth.uid()) then
      return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'PROPRIO_USUARIO');
    end if;
  end if;

  update app.perfis set ativo = p_ativo where usuario_id = p_usuario;
  perform interno.auditar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'OK', null,
    jsonb_build_object('ativo', p_ativo, 'motivo', v_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- M2 + M4: lock por e-mail; detalhe com papel/substituiu no sucesso e só o domínio nas negações.
create or replace function api.preparar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_dom jsonb := jsonb_build_object('email_dominio', left(split_part(lower(trim(coalesce(p_email, ''))), '@', 2), 100));
  cod text;
  novo uuid;
  antigo uuid;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO', v_dom);
  end if;
  if not interno.checar_limite('CONVIDAR', 10, interval '1 day') then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'LIMITE_EXCEDIDO', v_dom);
  end if;
  cod := interno.checar_convite(v_email, p_nome, p_papel, p_empresa);
  if cod is not null then
    return interno.negar('PREPARAR_CONVITE', 'convite', cod, v_dom);
  end if;

  perform pg_advisory_xact_lock(hashtext('convite:' || v_email));
  delete from app.convites where email = v_email and usado_em is null returning id into antigo;
  insert into app.convites (email, nome, papel, empresa_id, criado_por)
  values (v_email, trim(p_nome), p_papel, p_empresa, (select auth.uid()))
  returning id into novo;

  perform interno.auditar('PREPARAR_CONVITE', 'convite:' || novo, 'OK', null,
    jsonb_build_object('papel', p_papel, 'empresa_id', p_empresa, 'substituiu', antigo));
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

-- M5: ADMs não são alvo (usam o workflow manual); nem o próprio; limite diário.
create or replace function api.autorizar_operacao_usuario(p_usuario uuid, p_acao text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_papel app.papel;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('GERIR_USUARIO_AUTH', 20, interval '1 day') then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario', 'LIMITE_EXCEDIDO');
  end if;
  if p_usuario is null or p_acao is null or p_acao <> all (array['GERAR_LINK', 'RESETAR_2FA']) then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario', 'CAMPOS_INVALIDOS');
  end if;
  if p_usuario = (select auth.uid()) then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'PROPRIO_USUARIO');
  end if;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_usuario;
  if v_email is null then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'NAO_ENCONTRADO');
  end if;
  select pf.papel into v_papel from app.perfis pf where pf.usuario_id = p_usuario;
  if v_papel = 'ADM' then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'ALVO_ADM');
  end if;

  perform interno.auditar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'OK', null,
    jsonb_build_object('operacao', p_acao));
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- I2: toda linha de auditoria de sistema carrega origem = sistema.
create or replace function api.sistema_confirmar_senha(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update app.perfis set senha_pendente = false where usuario_id = p_usuario;
  if not found then
    perform interno.auditar_como(p_usuario, 'CONFIRMAR_SENHA', 'perfil:' || coalesce(p_usuario::text, '-'),
      'NEGADO', 'NAO_ENCONTRADO', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'NAO_ENCONTRADO');
  end if;
  perform interno.auditar_como(p_usuario, 'CONFIRMAR_SENHA', 'perfil:' || p_usuario, 'OK', null, '{"origem":"sistema"}');
  return jsonb_build_object('ok', true);
end $$;

-- M1: só um convite de ADM pendente por vez.
create or replace function api.sistema_convite_primeiro_adm(p_email text, p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  cod text;
  novo uuid;
begin
  perform pg_advisory_xact_lock(hashtext('primeiro_adm'));
  if exists (select 1 from app.perfis pf where pf.papel = 'ADM') then
    perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite', 'NEGADO', 'JA_EXISTE_ADM', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'JA_EXISTE_ADM');
  end if;
  cod := interno.checar_convite(v_email, p_nome, 'ADM', null);
  if cod is not null then
    perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite', 'NEGADO', cod, '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', cod);
  end if;

  delete from app.convites where papel = 'ADM' and usado_em is null;
  insert into app.convites (email, nome, papel, empresa_id, criado_por)
  values (v_email, trim(p_nome), 'ADM', null, null)
  returning id into novo;
  perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite:' || novo, 'OK', null, '{"origem":"sistema"}');
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

-- Recuperação do primeiro ADM: só se o e-mail é de um ADM que ainda não definiu a senha.
create function api.sistema_link_primeiro_adm(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email <> '' and exists (
    select 1 from app.perfis pf join auth.users u on u.id = pf.usuario_id
    where lower(trim(u.email)) = v_email and pf.papel = 'ADM' and pf.senha_pendente
  ) then
    perform interno.auditar_como(null, 'LINK_PRIMEIRO_ADM', 'usuario', 'OK', null, '{"origem":"sistema"}');
    return jsonb_build_object('ok', true, 'email', v_email);
  end if;
  perform interno.auditar_como(null, 'LINK_PRIMEIRO_ADM', 'usuario', 'NEGADO', 'NAO_PERMITIDO', '{"origem":"sistema"}');
  return jsonb_build_object('ok', false, 'codigo', 'NAO_PERMITIDO');
end $$;

-- Allowlist de ações; qualquer outra vira SISTEMA_REGISTRAR_INVALIDO.
create or replace function api.sistema_registrar(p_usuario uuid, p_acao text, p_alvo text, p_resultado text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_acao is null
     or p_acao <> all (array['CONVIDAR_LINK', 'GERAR_LINK', 'DESATIVAR_AUTH', 'REATIVAR_AUTH', 'RESETAR_2FA', 'DEFINIR_SENHA'])
     or p_resultado is null or p_resultado not in ('OK', 'NEGADO', 'ERRO')
     or (p_codigo is not null and p_codigo !~ '^[A-Z][A-Z0-9_]{1,59}$')
  then
    perform interno.auditar_como(p_usuario, 'SISTEMA_REGISTRAR_INVALIDO', null, 'NEGADO', 'CAMPOS_INVALIDOS', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS');
  end if;
  perform interno.auditar_como(p_usuario, p_acao, left(p_alvo, 200), p_resultado, p_codigo, '{"origem":"sistema"}');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function api.sistema_link_primeiro_adm(text) from public, anon, authenticated;
grant execute on function api.sistema_link_primeiro_adm(text) to service_role;
