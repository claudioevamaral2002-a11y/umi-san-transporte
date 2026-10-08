-- Gestão de acesso (fase 1, Task 5): RPCs de usuários/matriz/empresas, leituras e RPCs de sistema.
-- Ver docs/fases/fase-1-desenho.md §2–§3.
--
-- Decisão sobre leituras: `auth.users` e `auth.mfa_factors` não são legíveis por `authenticated`, então
-- uma view security_invoker não consegue juntar e-mail/2FA. Por isso:
--   * api.meu_perfil()        função SECURITY DEFINER (próprio perfil + empresa + tem_2fa), mesmo com senha pendente/aal1
--   * api.listar_usuarios()   função SECURITY DEFINER, só quem tem GERIR_USUARIOS (e-mail vem de auth.users)
--   * api.listar_auditoria()  função SECURITY DEFINER com filtros e teto de 500 linhas, só VER_AUDITORIA
--   * api.empresas e api.permissoes ficam como views security_invoker (a RLS das tabelas decide).
-- Nomes de ação gravados na auditoria são sempre constantes deste arquivo, nunca texto do chamador.

------------------------------------------------------------------------------------------------
-- Gap da Task 4: nome de quem publicou a versão de parâmetros (gravado na publicação).
------------------------------------------------------------------------------------------------
alter table app.parametros_versoes add column publicado_por_nome text;

create or replace function api.publicar_parametros(p jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inteiros constant text[] := array[
    'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent', 'retorno_trecho_unico_bp',
    'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent', 'prazo_orcar_horas',
    'validade_orcamento_horas', 'limiar_urgente_horas', 'limite_saldo_negativo_cent',
    'alerta_saldo_baixo_cent', 'retencao_fotos_dias'];
  conhecidos constant text[] := inteiros || array['faixas_cancelamento'];
  desconhecidos text[];
  ausentes text[];
  invalidos text[] := '{}';
  k text;
  v bigint;
  nova int;
begin
  if not (select app.pode_fazer('EDITAR_PARAMETROS')) then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'SEM_PERMISSAO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'VIGENCIA_NO_PASSADO');
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('p')));
  end if;

  select coalesce(array_agg(c order by c), '{}') into desconhecidos
    from jsonb_object_keys(p) c where c <> all (conhecidos);
  select coalesce(array_agg(c order by c), '{}') into ausentes
    from unnest(conhecidos) c where not (p ? c);

  foreach k in array inteiros loop
    if p ? k and not (
      jsonb_typeof(p -> k) = 'number'
      and (p ->> k) ~ '^[0-9]{1,16}$'
    ) then
      invalidos := array_append(invalidos, k);
    end if;
  end loop;
  if p ? 'faixas_cancelamento' and not interno.faixas_validas(p -> 'faixas_cancelamento') then
    invalidos := array_append(invalidos, 'faixas_cancelamento');
  end if;

  -- limites de valor (iguais aos CHECKs da tabela; aqui viram CAMPOS_INVALIDOS em vez de erro)
  foreach k in array inteiros loop
    if p ? k and k <> all (invalidos) then
      v := (p ->> k)::bigint;
      if (k = 'retorno_trecho_unico_bp' and v > 10000)
         or (k in ('prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas', 'retencao_fotos_dias')
             and (v < 1 or v > 2147483647))
      then
        invalidos := array_append(invalidos, k);
      end if;
    end if;
  end loop;

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(invalidos) > 0 then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                         'invalidos', to_jsonb(invalidos)));
  end if;

  insert into app.parametros_versoes (
    vigente_desde, publicado_por, publicado_por_nome,
    km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
    hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
    limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (
    p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())),
    (p ->> 'km_sem_reboque_cent')::bigint, (p ->> 'km_com_reboque_cent')::bigint,
    (p ->> 'taxa_fixa_reboque_cent')::bigint, (p ->> 'retorno_trecho_unico_bp')::int,
    (p ->> 'hora_espera_cent')::bigint, (p ->> 'hospedagem_diaria_cent')::bigint,
    (p ->> 'diaria_motorista_cent')::bigint, p -> 'faixas_cancelamento',
    (p ->> 'prazo_orcar_horas')::int, (p ->> 'validade_orcamento_horas')::int,
    (p ->> 'limiar_urgente_horas')::int, (p ->> 'limite_saldo_negativo_cent')::bigint,
    (p ->> 'alerta_saldo_baixo_cent')::bigint, (p ->> 'retencao_fotos_dias')::int)
  returning versao into nova;

  perform interno.auditar('PUBLICAR_PARAMETROS', 'parametros:' || nova, 'OK', null,
    jsonb_build_object('versao', nova, 'vigente_desde', p_vigente_desde));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

drop view api.parametros_historico;
drop view api.parametros_vigentes;

create view api.parametros_historico with (security_invoker = true) as
select versao, vigente_desde, publicado_em, publicado_por_nome,
       km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
       hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
       prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
       limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias
from app.parametros_versoes
order by vigente_desde desc, versao desc;

create view api.parametros_vigentes with (security_invoker = true) as
select versao, vigente_desde, publicado_em, publicado_por_nome,
       km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
       hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
       prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
       limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias
from app.parametros_versoes
where vigente_desde <= now()
order by vigente_desde desc, versao desc
limit 1;

revoke all on api.parametros_historico, api.parametros_vigentes from public, anon, authenticated;
grant select on api.parametros_historico, api.parametros_vigentes to authenticated;

------------------------------------------------------------------------------------------------
-- Auxiliares internos (sem acesso de usuário).
------------------------------------------------------------------------------------------------

-- Auditoria em nome de um usuário explícito (chamadas de service_role não têm auth.uid()).
create function interno.auditar_como(p_usuario uuid, p_acao text, p_alvo text, p_resultado text,
                                     p_codigo text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cabecalhos jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  insert into app.auditoria (usuario_id, papel, acao, alvo, resultado, codigo, detalhe, ip, dispositivo)
  values (
    p_usuario,
    (select pf.papel from app.perfis pf where pf.usuario_id = p_usuario),
    p_acao, p_alvo, p_resultado, p_codigo, p_detalhe,
    left(coalesce(cabecalhos ->> 'cf-connecting-ip', trim(split_part(cabecalhos ->> 'x-forwarded-for', ',', 1))), 64),
    left(cabecalhos ->> 'user-agent', 200)
  );
end $$;

-- Existe algum ADM ativo além de p_excluir? (base das travas ULTIMO_ADM)
create function interno.ha_outro_adm_ativo(p_excluir uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo and pf.usuario_id <> p_excluir)
$$;

-- Valida um convite (e-mail já normalizado). Devolve o código de recusa ou null.
create function interno.checar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  existente uuid;
begin
  if p_email is null or length(p_email) > 254
     or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_nome is null or length(trim(p_nome)) not between 2 and 120
     or p_papel is null
     or (p_papel = 'CLIENTE') <> (p_empresa is not null)
     or (p_empresa is not null and not exists (select 1 from app.empresas em where em.id = p_empresa))
  then
    return 'CAMPOS_INVALIDOS';
  end if;
  -- Usuário do Auth já existente nunca dispara a trigger de convite → perfil não seria criado.
  select u.id into existente from auth.users u where lower(trim(u.email)) = p_email limit 1;
  if existente is not null then
    if exists (select 1 from app.perfis pf where pf.usuario_id = existente) then
      return 'JA_CADASTRADO';
    end if;
    return 'EMAIL_EM_USO';
  end if;
  return null;
end $$;

revoke execute on function
  interno.auditar_como(uuid, text, text, text, text, jsonb),
  interno.ha_outro_adm_ativo(uuid),
  interno.checar_convite(text, text, app.papel, uuid)
from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- RPCs de gestão (authenticated; cada uma decide por app.pode_fazer e audita).
------------------------------------------------------------------------------------------------

create function api.preparar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  cod text;
  novo uuid;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CONVIDAR', 10, interval '1 day') then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'LIMITE_EXCEDIDO');
  end if;
  cod := interno.checar_convite(v_email, p_nome, p_papel, p_empresa);
  if cod is not null then
    return interno.negar('PREPARAR_CONVITE', 'convite', cod);
  end if;

  delete from app.convites where email = v_email and usado_em is null;
  insert into app.convites (email, nome, papel, empresa_id, criado_por)
  values (v_email, trim(p_nome), p_papel, p_empresa, (select auth.uid()))
  returning id into novo;

  perform interno.auditar('PREPARAR_CONVITE', 'convite:' || novo, 'OK', null,
    jsonb_build_object('papel', p_papel, 'empresa_id', p_empresa));
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

create function api.alterar_perfil(p_usuario uuid, p_nome text, p_papel app.papel, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  alvo app.perfis;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('ALTERAR_PERFIL', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or length(v_nome) not between 2 and 120 or p_papel is null
     or (p_papel = 'CLIENTE') <> (p_empresa is not null)
     or (p_empresa is not null and not exists (select 1 from app.empresas em where em.id = p_empresa))
  then
    return interno.negar('ALTERAR_PERFIL', 'perfil:' || coalesce(p_usuario::text, '-'), 'CAMPOS_INVALIDOS');
  end if;

  -- Serializa mudanças concorrentes sobre os ADMs ativos (trava ULTIMO_ADM).
  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo for update;
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

create function api.definir_ativo(p_usuario uuid, p_ativo boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  alvo app.perfis;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or p_ativo is null then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'MOTIVO_OBRIGATORIO');
  end if;

  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo for update;
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

create function api.definir_permissao(p_chave text, p_ativo boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
begin
  if not (select app.pode_fazer('GERIR_PERMISSOES')) then
    return interno.negar('DEFINIR_PERMISSAO', 'permissao', 'SEM_PERMISSAO');
  end if;
  if p_ativo is null then
    return interno.negar('DEFINIR_PERMISSAO', 'permissao', 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('DEFINIR_PERMISSAO', 'permissao', 'MOTIVO_OBRIGATORIO');
  end if;
  if p_chave is null or not exists (select 1 from app.permissoes_delegadas d where d.chave = p_chave) then
    return interno.negar('DEFINIR_PERMISSAO', 'permissao', 'CHAVE_INVALIDA');
  end if;

  update app.permissoes_delegadas
     set ativo = p_ativo, alterado_por = (select auth.uid()), alterado_em = now()
   where chave = p_chave;
  perform interno.auditar('DEFINIR_PERMISSAO', 'permissao:' || p_chave, 'OK', null,
    jsonb_build_object('ativo', p_ativo, 'motivo', v_motivo));
  return jsonb_build_object('ok', true);
end $$;

create function api.salvar_empresa(p_id uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  v_id uuid;
begin
  if not (select app.pode_fazer('GERIR_EMPRESAS')) then
    return interno.negar('SALVAR_EMPRESA', 'empresa', 'SEM_PERMISSAO');
  end if;
  if length(v_nome) not between 2 and 120 then
    return interno.negar('SALVAR_EMPRESA', 'empresa', 'CAMPOS_INVALIDOS');
  end if;

  if p_id is null then
    insert into app.empresas (nome) values (v_nome) returning id into v_id;
  else
    update app.empresas set nome = v_nome where id = p_id returning id into v_id;
    if v_id is null then
      return interno.negar('SALVAR_EMPRESA', 'empresa:' || p_id, 'NAO_ENCONTRADO');
    end if;
  end if;
  perform interno.auditar('SALVAR_EMPRESA', 'empresa:' || v_id, 'OK', null,
    jsonb_build_object('criada', p_id is null));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function api.definir_logo_empresa(p_empresa uuid, p_caminho text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (select app.pode_fazer('GERIR_EMPRESAS')) then
    return interno.negar('DEFINIR_LOGO_EMPRESA', 'empresa', 'SEM_PERMISSAO');
  end if;
  if p_empresa is null or not exists (select 1 from app.empresas em where em.id = p_empresa) then
    return interno.negar('DEFINIR_LOGO_EMPRESA', 'empresa', 'NAO_ENCONTRADO');
  end if;
  if p_caminho is null or p_caminho not in (p_empresa::text || '/logo.png', p_empresa::text || '/logo.webp') then
    return interno.negar('DEFINIR_LOGO_EMPRESA', 'empresa:' || p_empresa, 'CAMINHO_INVALIDO');
  end if;

  update app.empresas set logo_caminho = p_caminho where id = p_empresa;
  perform interno.auditar('DEFINIR_LOGO_EMPRESA', 'empresa:' || p_empresa, 'OK', null,
    jsonb_build_object('caminho', p_caminho));
  return jsonb_build_object('ok', true);
end $$;

-- Autoriza (e audita) operações da Admin API feitas pela Edge Function `gerir-usuario` em nome do ADM.
-- Devolve o e-mail normalizado que a função deve usar.
create function api.autorizar_operacao_usuario(p_usuario uuid, p_acao text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or p_acao is null or p_acao <> all (array['GERAR_LINK', 'RESETAR_2FA']) then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario', 'CAMPOS_INVALIDOS');
  end if;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_usuario;
  if v_email is null then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'NAO_ENCONTRADO');
  end if;

  perform interno.auditar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'OK', null,
    jsonb_build_object('operacao', p_acao));
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

------------------------------------------------------------------------------------------------
-- Leituras (DEFINER com checagem de acesso; auth.users/auth.mfa_factors não são legíveis por authenticated).
------------------------------------------------------------------------------------------------

-- Próprio perfil, inclusive com senha pendente/sem aal2 (o front precisa saber em que etapa está).
create function api.meu_perfil()
returns table (nome text, papel app.papel, empresa_id uuid, empresa_nome text, empresa_logo_caminho text,
               ativo boolean, senha_pendente boolean, tem_2fa boolean)
language sql stable security definer set search_path = '' as $$
  select pf.nome, pf.papel, pf.empresa_id, e.nome, e.logo_caminho, pf.ativo, pf.senha_pendente,
         exists (select 1 from auth.mfa_factors f
                 where f.user_id = pf.usuario_id and f.factor_type::text = 'totp' and f.status::text = 'verified')
  from app.perfis pf
  left join app.empresas e on e.id = pf.empresa_id
  where pf.usuario_id = (select auth.uid())
$$;

create function api.listar_usuarios()
returns table (usuario_id uuid, nome text, email text, telefone text, papel app.papel, empresa_id uuid,
               empresa_nome text, ativo boolean, senha_pendente boolean, tem_2fa boolean, criado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select pf.usuario_id, pf.nome, lower(trim(u.email))::text, pf.telefone, pf.papel, pf.empresa_id, e.nome,
         pf.ativo, pf.senha_pendente,
         exists (select 1 from auth.mfa_factors f
                 where f.user_id = pf.usuario_id and f.factor_type::text = 'totp' and f.status::text = 'verified'),
         pf.criado_em
  from app.perfis pf
  join auth.users u on u.id = pf.usuario_id
  left join app.empresas e on e.id = pf.empresa_id
  where (select app.pode_fazer('GERIR_USUARIOS'))
  order by pf.nome, pf.usuario_id
$$;

create function api.listar_auditoria(
  p_de timestamptz default null, p_ate timestamptz default null, p_usuario uuid default null,
  p_acao text default null, p_limite int default 100, p_resultado text default null)
returns table (id bigint, em timestamptz, usuario_id uuid, usuario_nome text, papel app.papel, acao text,
               alvo text, resultado text, codigo text, detalhe jsonb, ip text, dispositivo text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.em, a.usuario_id, pf.nome, a.papel, a.acao, a.alvo, a.resultado, a.codigo, a.detalhe, a.ip, a.dispositivo
  from app.auditoria a
  left join app.perfis pf on pf.usuario_id = a.usuario_id
  where (select app.pode_fazer('VER_AUDITORIA'))
    and (p_de is null or a.em >= p_de)
    and (p_ate is null or a.em <= p_ate)
    and (p_usuario is null or a.usuario_id = p_usuario)
    and (p_acao is null or a.acao = p_acao)
    and (p_resultado is null or a.resultado = p_resultado)
  order by a.em desc, a.id desc
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$$;

-- Views simples (a RLS das tabelas decide quem vê).
create view api.empresas with (security_invoker = true) as
select id, nome, logo_caminho from app.empresas order by nome, id;

create view api.permissoes with (security_invoker = true) as
select chave, ativo, alterado_em from app.permissoes_delegadas order by chave;

revoke all on api.empresas, api.permissoes from public, anon, authenticated;
grant select on api.empresas, api.permissoes to authenticated;

------------------------------------------------------------------------------------------------
-- RPCs de sistema: só service_role (Edge Functions e workflows manuais).
------------------------------------------------------------------------------------------------

create function api.sistema_confirmar_senha(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update app.perfis set senha_pendente = false where usuario_id = p_usuario;
  if not found then
    perform interno.auditar_como(p_usuario, 'CONFIRMAR_SENHA', 'perfil:' || coalesce(p_usuario::text, '-'),
      'NEGADO', 'NAO_ENCONTRADO', null);
    return jsonb_build_object('ok', false, 'codigo', 'NAO_ENCONTRADO');
  end if;
  perform interno.auditar_como(p_usuario, 'CONFIRMAR_SENHA', 'perfil:' || p_usuario, 'OK', null, null);
  return jsonb_build_object('ok', true);
end $$;

create function api.sistema_convite_primeiro_adm(p_email text, p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  cod text;
  novo uuid;
begin
  perform pg_advisory_xact_lock(hashtext('primeiro_adm'));
  if exists (select 1 from app.perfis pf where pf.papel = 'ADM') then
    perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite', 'NEGADO', 'JA_EXISTE_ADM', null);
    return jsonb_build_object('ok', false, 'codigo', 'JA_EXISTE_ADM');
  end if;
  cod := interno.checar_convite(v_email, p_nome, 'ADM', null);
  if cod is not null then
    perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite', 'NEGADO', cod, null);
    return jsonb_build_object('ok', false, 'codigo', cod);
  end if;

  delete from app.convites where email = v_email and usado_em is null;
  insert into app.convites (email, nome, papel, empresa_id, criado_por)
  values (v_email, trim(p_nome), 'ADM', null, null)
  returning id into novo;
  perform interno.auditar_como(null, 'CONVITE_PRIMEIRO_ADM', 'convite:' || novo, 'OK', null, null);
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

-- Auditoria de operações feitas pela Admin API. p_acao/p_codigo só aceitam o formato de constante.
create function api.sistema_registrar(p_usuario uuid, p_acao text, p_alvo text, p_resultado text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_acao is null or p_acao !~ '^[A-Z][A-Z0-9_]{2,59}$'
     or p_resultado is null or p_resultado not in ('OK', 'NEGADO', 'ERRO')
     or (p_codigo is not null and p_codigo !~ '^[A-Z][A-Z0-9_]{1,59}$')
  then
    perform interno.auditar_como(p_usuario, 'SISTEMA_REGISTRAR_INVALIDO', null, 'NEGADO', 'CAMPOS_INVALIDOS', null);
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS');
  end if;
  perform interno.auditar_como(p_usuario, p_acao, left(p_alvo, 200), p_resultado, p_codigo, null);
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- Privilégios.
------------------------------------------------------------------------------------------------
revoke all on function
  api.preparar_convite(text, text, app.papel, uuid),
  api.alterar_perfil(uuid, text, app.papel, uuid),
  api.definir_ativo(uuid, boolean, text),
  api.definir_permissao(text, boolean, text),
  api.salvar_empresa(uuid, text),
  api.definir_logo_empresa(uuid, text),
  api.autorizar_operacao_usuario(uuid, text),
  api.meu_perfil(),
  api.listar_usuarios(),
  api.listar_auditoria(timestamptz, timestamptz, uuid, text, int, text),
  api.sistema_confirmar_senha(uuid),
  api.sistema_convite_primeiro_adm(text, text),
  api.sistema_registrar(uuid, text, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  api.preparar_convite(text, text, app.papel, uuid),
  api.alterar_perfil(uuid, text, app.papel, uuid),
  api.definir_ativo(uuid, boolean, text),
  api.definir_permissao(text, boolean, text),
  api.salvar_empresa(uuid, text),
  api.definir_logo_empresa(uuid, text),
  api.autorizar_operacao_usuario(uuid, text),
  api.meu_perfil(),
  api.listar_usuarios(),
  api.listar_auditoria(timestamptz, timestamptz, uuid, text, int, text)
to authenticated;

grant execute on function
  api.sistema_confirmar_senha(uuid),
  api.sistema_convite_primeiro_adm(text, text),
  api.sistema_registrar(uuid, text, text, text, text)
to service_role;
