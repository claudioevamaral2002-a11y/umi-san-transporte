-- Fase 1B (Adendo A10; docs/fases/fase-1b-desenho-e-plano.md "Banco"):
--   * contrato por empresa (tabela modelo + contrato de cada empresa), versionado e imutável, só o ADM publica;
--   * retenção de fotos vira configuração global (app.configuracao);
--   * matriz de delegação removida; app.pode_fazer passa a ser só por papel/nível;
--   * cliente ganha nível (1 gestor da empresa, 2 solicitante, 3 visualizador);
--   * leituras por perfil (cliente sem preços; motorista sem limites, versão ou autor).
-- Nomes de ação gravados na auditoria são sempre constantes deste arquivo.

------------------------------------------------------------------------------------------------
-- 1. Níveis do cliente (perfis e convites). CLIENTE ⇒ nível 1..3; demais papéis ⇒ nulo.
--    Os clientes existentes foram criados pelo ADM: viram nível 1 (gestor da empresa).
------------------------------------------------------------------------------------------------
alter table app.perfis add column nivel smallint;
alter table app.convites add column nivel smallint;
update app.perfis set nivel = 1 where papel = 'CLIENTE';
update app.convites set nivel = 1 where papel = 'CLIENTE';
alter table app.perfis add constraint perfis_nivel_check check (
  case when papel = 'CLIENTE' then nivel is not null and nivel between 1 and 3 else nivel is null end
);
alter table app.convites add constraint convites_nivel_check check (
  case when papel = 'CLIENTE' then nivel is not null and nivel between 1 and 3 else nivel is null end
);

-- Convite → perfil copia o nível.
create or replace function interno.criar_perfil_do_convite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c app.convites;
begin
  select * into c from app.convites
  where email = lower(new.email) and usado_em is null
  order by criado_em desc limit 1
  for update;
  if found then
    insert into app.perfis (usuario_id, nome, papel, empresa_id, nivel, senha_pendente)
    values (new.id, trim(c.nome), c.papel, c.empresa_id, c.nivel, true);
    update app.convites set usado_em = now() where id = c.id;
  end if;
  return new;
end $$;

------------------------------------------------------------------------------------------------
-- 2. Acesso: GESTOR_FROTA exige aal2 (como ADM e MOTORISTA); só o CLIENTE dispensa o segundo fator.
------------------------------------------------------------------------------------------------
create or replace function app.pode_acessar() returns app.perfis
language sql stable security definer set search_path = '' as $$
  select p.*
  from app.perfis p
  where p.usuario_id = (select auth.uid())
    and p.ativo
    and not p.senha_pendente
    and (p.papel = 'CLIENTE' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

-- Única fonte de "quem pode o quê", só por papel/nível (a matriz de delegação deixou de existir).
create or replace function app.pode_fazer(acao text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or acao is null then return false; end if;
  case acao
    when 'GERIR_USUARIOS', 'GERIR_EMPRESAS', 'VER_AUDITORIA', 'GERIR_CONTRATOS', 'LANCAR_SALDO', 'GERIR_CONFIGURACAO' then
      return v.papel = 'ADM';
    when 'GERIR_EQUIPE_EMPRESA' then
      return v.papel = 'CLIENTE' and v.nivel = 1 and v.empresa_id is not null;
    when 'VER_AGENDA_FROTA' then
      return v.papel in ('ADM', 'GESTOR_FROTA');
    else
      return false;
  end case;
end $$;

-- Equipe do prestador (ADM, gestor de frota, motorista) lê todas as empresas; cliente só a própria.
drop policy empresas_ler on app.empresas;
create policy empresas_ler on app.empresas for select to authenticated using (
  (select (app.pode_acessar()).papel) in ('ADM', 'GESTOR_FROTA', 'MOTORISTA')
  or id = (select (app.pode_acessar()).empresa_id)
);

drop policy logos_ler on storage.objects;
create policy logos_ler on storage.objects for select to authenticated
using (
  bucket_id = 'logos'
  and (select (app.pode_acessar()).usuario_id) is not null
  and (
    (select (app.pode_acessar()).papel) in ('ADM', 'GESTOR_FROTA', 'MOTORISTA')
    or (storage.foldername(name))[1] = (select (app.pode_acessar()).empresa_id)::text
  )
);

------------------------------------------------------------------------------------------------
-- 3. Matriz de delegação removida.
------------------------------------------------------------------------------------------------
drop function api.definir_permissao(text, boolean, text);
drop view api.permissoes;
drop table app.permissoes_delegadas;

------------------------------------------------------------------------------------------------
-- 4. Configuração global (linha única): retenção de fotos (só ADM altera).
------------------------------------------------------------------------------------------------
create table app.configuracao (
  id boolean primary key default true check (id),
  retencao_fotos_dias int not null default 30 check (retencao_fotos_dias > 0),
  alterado_por uuid,
  alterado_em timestamptz not null default now()
);
alter table app.configuracao enable row level security;
-- Sem GRANT a authenticated: leitura por api.ler_configuracao(), escrita por api.definir_retencao_fotos().

------------------------------------------------------------------------------------------------
-- 5. Contratos: tabela modelo (empresa_id nulo) e contrato por empresa. Versão numerada por empresa.
--    Dinheiro em centavos, percentuais em pontos-base, prazos em horas.
------------------------------------------------------------------------------------------------
create table app.contratos_versoes (
  id bigint generated always as identity primary key,
  empresa_id uuid references app.empresas (id) on delete restrict,
  versao int not null check (versao > 0),
  vigente_desde timestamptz not null,
  publicado_por uuid,  -- uuid solto (como auditoria.usuario_id): apagar quem publicou não toca a tabela imutável
  publicado_por_nome text not null check (length(btrim(publicado_por_nome)) > 0),
  publicado_em timestamptz not null default now(),
  -- veículo próprio
  km_sem_reboque_cent bigint not null check (km_sem_reboque_cent >= 0),
  km_com_reboque_cent bigint not null check (km_com_reboque_cent >= 0),
  taxa_fixa_reboque_cent bigint not null check (taxa_fixa_reboque_cent >= 0),
  retorno_trecho_unico_bp int not null check (retorno_trecho_unico_bp between 0 and 10000),
  hora_espera_cent bigint not null check (hora_espera_cent >= 0),
  hospedagem_diaria_cent bigint not null check (hospedagem_diaria_cent >= 0),
  -- veículo do cliente
  diaria_motorista_cent bigint not null check (diaria_motorista_cent >= 0),
  -- comuns
  faixas_cancelamento jsonb not null check (interno.faixas_validas(faixas_cancelamento)),
  prazo_orcar_horas int not null check (prazo_orcar_horas > 0),
  validade_orcamento_horas int not null check (validade_orcamento_horas > 0),
  limiar_urgente_horas int not null check (limiar_urgente_horas > 0),
  -- crédito da empresa
  limite_saldo_negativo_cent bigint not null check (limite_saldo_negativo_cent >= 0),
  alerta_saldo_baixo_cent bigint not null check (alerta_saldo_baixo_cent >= 0)
);
create unique index contratos_versao_por_empresa
  on app.contratos_versoes (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), versao);
create index contratos_vigencia on app.contratos_versoes (empresa_id, vigente_desde desc, versao desc);

alter table app.contratos_versoes enable row level security;
-- Sem GRANT a authenticated: toda leitura passa por funções SECURITY DEFINER que filtram por perfil.

create function interno.contratos_imutaveis() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'versões de contrato são imutáveis' using errcode = '42501';
end $$;
create trigger contratos_sem_update before update or delete on app.contratos_versoes
  for each row execute function interno.contratos_imutaveis();
create trigger contratos_sem_truncate before truncate on app.contratos_versoes
  for each statement execute function interno.contratos_imutaveis();

-- Valida o jsonb de um contrato (exatamente os 13 campos). null = válido; senão o detalhe da recusa
-- (no máximo 20 chaves desconhecidas, cada uma com até 60 caracteres: o chamador controla o texto).
create function interno.validar_contrato(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  inteiros constant text[] := array[
    'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent', 'retorno_trecho_unico_bp',
    'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent', 'prazo_orcar_horas',
    'validade_orcamento_horas', 'limiar_urgente_horas', 'limite_saldo_negativo_cent', 'alerta_saldo_baixo_cent'];
  conhecidos constant text[] := inteiros || array['faixas_cancelamento'];
  desconhecidos text[];
  ausentes text[];
  invalidos text[] := '{}';
  k text;
  v bigint;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('invalidos', jsonb_build_array('p'));
  end if;

  select coalesce(array_agg(left(c, 60) order by c), '{}') into desconhecidos
    from (select c from jsonb_object_keys(p) c where c <> all (conhecidos) order by c limit 20) x;
  select coalesce(array_agg(c order by c), '{}') into ausentes
    from unnest(conhecidos) c where not (p ? c);

  foreach k in array inteiros loop
    if p ? k and not (jsonb_typeof(p -> k) = 'number' and (p ->> k) ~ '^[0-9]{1,16}$') then
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
         or (k in ('prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas') and (v < 1 or v > 2147483647))
      then
        invalidos := array_append(invalidos, k);
      end if;
    end if;
  end loop;

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(invalidos) > 0 then
    return jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                              'invalidos', to_jsonb(invalidos));
  end if;
  return null;
end $$;

-- Grava uma versão (p já validado). Numeração por empresa (modelo = empresa nula), serializada por lock.
create function interno.inserir_contrato(p_empresa uuid, p jsonb, p_vigente_desde timestamptz,
                                         p_publicado_por uuid, p_publicado_por_nome text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  nova int;
begin
  perform pg_advisory_xact_lock(hashtext('contrato:' || coalesce(p_empresa::text, 'modelo')));
  select coalesce(max(c.versao), 0) + 1 into nova
    from app.contratos_versoes c
   where (p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa;

  insert into app.contratos_versoes (
    empresa_id, versao, vigente_desde, publicado_por, publicado_por_nome,
    km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
    hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
    limite_saldo_negativo_cent, alerta_saldo_baixo_cent)
  values (
    p_empresa, nova, p_vigente_desde, p_publicado_por, p_publicado_por_nome,
    (p ->> 'km_sem_reboque_cent')::bigint, (p ->> 'km_com_reboque_cent')::bigint,
    (p ->> 'taxa_fixa_reboque_cent')::bigint, (p ->> 'retorno_trecho_unico_bp')::int,
    (p ->> 'hora_espera_cent')::bigint, (p ->> 'hospedagem_diaria_cent')::bigint,
    (p ->> 'diaria_motorista_cent')::bigint, p -> 'faixas_cancelamento',
    (p ->> 'prazo_orcar_horas')::int, (p ->> 'validade_orcamento_horas')::int,
    (p ->> 'limiar_urgente_horas')::int, (p ->> 'limite_saldo_negativo_cent')::bigint,
    (p ->> 'alerta_saldo_baixo_cent')::bigint);
  return nova;
end $$;

-- Contrato vigente (maior vigente_desde <= agora; empate pela maior versão). Empresa nula = modelo.
create function interno.contrato_vigente(p_empresa uuid) returns setof app.contratos_versoes
language sql stable security definer set search_path = '' as $$
  select c.*
  from app.contratos_versoes c
  where ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
    and c.vigente_desde <= now()
  order by c.vigente_desde desc, c.versao desc
  limit 1
$$;

-- Migração da tabela única da fase 1: a versão publicada vira modelo v1 e contrato da Umi San v1
-- (mesmos valores, vigentes desde agora); a retenção de fotos vai para app.configuracao.
-- Também usada pelo pgTAP para provar que os valores são preservados.
create function interno.migrar_parametros(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_umi uuid;
  v_nome text := coalesce(nullif(btrim(p ->> 'publicado_por_nome'), ''), 'Migração');
  v_por uuid := case when p ->> 'publicado_por' ~ '^[0-9a-f-]{36}$' then (p ->> 'publicado_por')::uuid end;
  v_contrato jsonb := p - array['versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome',
                                'publicado_em', 'retencao_fotos_dias'];
begin
  if interno.validar_contrato(v_contrato) is not null then
    raise exception 'versão de parâmetros inválida para migração: %', interno.validar_contrato(v_contrato);
  end if;
  insert into app.configuracao (id, retencao_fotos_dias, alterado_por)
  values (true, coalesce((p ->> 'retencao_fotos_dias')::int, 30), v_por)
  on conflict (id) do update set retencao_fotos_dias = excluded.retencao_fotos_dias,
                                 alterado_por = excluded.alterado_por, alterado_em = now();
  perform interno.inserir_contrato(null, v_contrato, now(), v_por, v_nome);
  select e.id into v_umi from app.empresas e where e.nome = 'Umi San' order by e.criada_em, e.id limit 1;
  if v_umi is not null then
    perform interno.inserir_contrato(v_umi, v_contrato, now(), v_por, v_nome);
  end if;
end $$;

do $$
declare
  v jsonb;
begin
  -- a vigente; sem vigente, a última publicada
  select to_jsonb(pv) into v from app.parametros_versoes pv
   where pv.vigente_desde <= now() order by pv.vigente_desde desc, pv.versao desc limit 1;
  if v is null then
    select to_jsonb(pv) into v from app.parametros_versoes pv order by pv.versao desc limit 1;
  end if;
  if v is null then
    insert into app.configuracao (id, retencao_fotos_dias) values (true, 30);
  else
    perform interno.migrar_parametros(v);
  end if;
end $$;

-- Tabela única da fase 1 removida (nenhum orçamento a referencia).
drop view api.parametros_historico;
drop view api.parametros_vigentes;
drop function api.publicar_parametros(jsonb, timestamptz);
drop table app.parametros_versoes;
drop function interno.parametros_imutaveis();

revoke execute on function
  interno.contratos_imutaveis(),
  interno.validar_contrato(jsonb),
  interno.inserir_contrato(uuid, jsonb, timestamptz, uuid, text),
  interno.contrato_vigente(uuid),
  interno.migrar_parametros(jsonb)
from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 6. RPCs de contrato e configuração (só ADM).
------------------------------------------------------------------------------------------------

-- p_empresa nulo publica a tabela modelo. p traz exatamente os 13 campos do contrato.
create function api.publicar_contrato(p_empresa uuid, p jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  nova int;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'SEM_PERMISSAO');
  end if;
  if p_empresa is not null and not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'NAO_ENCONTRADO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'VIGENCIA_NO_PASSADO');
  end if;
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  v_detalhe := interno.validar_contrato(p);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;

  nova := interno.inserir_contrato(p_empresa, p, p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())));

  perform interno.auditar('PUBLICAR_CONTRATO', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

create function api.definir_retencao_fotos(p_dias int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  anterior int;
begin
  if not (select app.pode_fazer('GERIR_CONFIGURACAO')) then
    return interno.negar('DEFINIR_RETENCAO_FOTOS', 'configuracao', 'SEM_PERMISSAO');
  end if;
  if p_dias is null or p_dias not between 1 and 3650 then
    return interno.negar('DEFINIR_RETENCAO_FOTOS', 'configuracao', 'CAMPOS_INVALIDOS');
  end if;
  select c.retencao_fotos_dias into anterior from app.configuracao c where c.id for update;
  insert into app.configuracao (id, retencao_fotos_dias, alterado_por)
  values (true, p_dias, (select auth.uid()))
  on conflict (id) do update set retencao_fotos_dias = excluded.retencao_fotos_dias,
                                 alterado_por = excluded.alterado_por, alterado_em = now();
  perform interno.auditar('DEFINIR_RETENCAO_FOTOS', 'configuracao', 'OK', null,
    jsonb_build_object('anterior', anterior, 'novo', p_dias));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 7. Leituras por perfil (SECURITY DEFINER com checagem explícita; as tabelas não têm GRANT).
------------------------------------------------------------------------------------------------

-- ADM: configuração global.
create function api.ler_configuracao()
returns table (retencao_fotos_dias int, alterado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.retencao_fotos_dias, c.alterado_em
  from app.configuracao c
  where (select app.pode_fazer('GERIR_CONFIGURACAO'))
$$;

-- ADM: a tabela modelo (empresa nula, primeira linha) e cada empresa, com o contrato vigente (campos nulos
-- se não houver) e a próxima vigência agendada.
create function api.listar_contratos()
returns table (empresa_id uuid, empresa_nome text, versao int, vigente_desde timestamptz, publicado_em timestamptz,
               publicado_por_nome text, km_sem_reboque_cent bigint, km_com_reboque_cent bigint,
               taxa_fixa_reboque_cent bigint, retorno_trecho_unico_bp int, hora_espera_cent bigint,
               hospedagem_diaria_cent bigint, diaria_motorista_cent bigint, faixas_cancelamento jsonb,
               prazo_orcar_horas int, validade_orcamento_horas int, limiar_urgente_horas int,
               limite_saldo_negativo_cent bigint, alerta_saldo_baixo_cent bigint, proxima_vigencia timestamptz)
language sql stable security definer set search_path = '' as $$
  with alvos as (
    select null::uuid as id, null::text as nome, 0 as ordem
    union all
    select e.id, e.nome, 1 from app.empresas e
  )
  select a.id, a.nome, c.versao, c.vigente_desde, c.publicado_em, c.publicado_por_nome,
         c.km_sem_reboque_cent, c.km_com_reboque_cent, c.taxa_fixa_reboque_cent, c.retorno_trecho_unico_bp,
         c.hora_espera_cent, c.hospedagem_diaria_cent, c.diaria_motorista_cent, c.faixas_cancelamento,
         c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas,
         c.limite_saldo_negativo_cent, c.alerta_saldo_baixo_cent,
         (select min(f.vigente_desde) from app.contratos_versoes f
           where ((a.id is null and f.empresa_id is null) or f.empresa_id = a.id) and f.vigente_desde > now())
  from alvos a
  left join lateral interno.contrato_vigente(a.id) c on true
  where (select app.pode_fazer('GERIR_CONTRATOS'))
  order by a.ordem, a.nome, a.id
$$;

-- ADM: todas as versões de uma empresa (nulo = modelo), da vigência mais nova para a mais antiga.
create function api.historico_contrato(p_empresa uuid)
returns table (versao int, vigente_desde timestamptz, publicado_em timestamptz, publicado_por_nome text,
               km_sem_reboque_cent bigint, km_com_reboque_cent bigint, taxa_fixa_reboque_cent bigint,
               retorno_trecho_unico_bp int, hora_espera_cent bigint, hospedagem_diaria_cent bigint,
               diaria_motorista_cent bigint, faixas_cancelamento jsonb, prazo_orcar_horas int,
               validade_orcamento_horas int, limiar_urgente_horas int, limite_saldo_negativo_cent bigint,
               alerta_saldo_baixo_cent bigint)
language sql stable security definer set search_path = '' as $$
  select c.versao, c.vigente_desde, c.publicado_em, c.publicado_por_nome,
         c.km_sem_reboque_cent, c.km_com_reboque_cent, c.taxa_fixa_reboque_cent, c.retorno_trecho_unico_bp,
         c.hora_espera_cent, c.hospedagem_diaria_cent, c.diaria_motorista_cent, c.faixas_cancelamento,
         c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas,
         c.limite_saldo_negativo_cent, c.alerta_saldo_baixo_cent
  from app.contratos_versoes c
  where (select app.pode_fazer('GERIR_CONTRATOS'))
    and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
  order by c.vigente_desde desc, c.versao desc
  limit 200
$$;

-- Cliente: só as regras do contrato vigente da própria empresa (sem preços, limites, versão ou autor).
create function api.regras_do_servico()
returns table (faixas_cancelamento jsonb, prazo_orcar_horas int, validade_orcamento_horas int,
               limiar_urgente_horas int)
language sql stable security definer set search_path = '' as $$
  select c.faixas_cancelamento, c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas
  from interno.contrato_vigente((select (app.pode_acessar()).empresa_id)) c
  where (select (app.pode_acessar()).papel) = 'CLIENTE'
    and (select (app.pode_acessar()).empresa_id) is not null
$$;

-- Motorista (e ADM): preços unitários e prazos do contrato vigente da empresa do pedido
-- (sem limites de saldo, versão ou autor). Gestor de frota não vê preço (Adendo A10).
create function api.precos_para_orcar(p_empresa uuid)
returns table (km_sem_reboque_cent bigint, km_com_reboque_cent bigint, taxa_fixa_reboque_cent bigint,
               retorno_trecho_unico_bp int, hora_espera_cent bigint, hospedagem_diaria_cent bigint,
               diaria_motorista_cent bigint, prazo_orcar_horas int, validade_orcamento_horas int,
               limiar_urgente_horas int)
language sql stable security definer set search_path = '' as $$
  select c.km_sem_reboque_cent, c.km_com_reboque_cent, c.taxa_fixa_reboque_cent, c.retorno_trecho_unico_bp,
         c.hora_espera_cent, c.hospedagem_diaria_cent, c.diaria_motorista_cent,
         c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas
  from interno.contrato_vigente(p_empresa) c
  where p_empresa is not null
    and (select (app.pode_acessar()).papel) in ('ADM', 'MOTORISTA')
$$;

------------------------------------------------------------------------------------------------
-- 8. Gestão de usuários: ADM (tudo) e CLIENTE nível 1 (só colegas CLIENTE da própria empresa, nunca a si).
------------------------------------------------------------------------------------------------

-- p_nivel: obrigatório para CLIENTE convidado pelo gestor da empresa; para o ADM, nulo = nível 1
-- (compatível com a Edge Function `convidar` atual). Nulo para os demais papéis.
drop function api.preparar_convite(text, text, app.papel, uuid);
create function api.preparar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid,
                                     p_nivel smallint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_dom jsonb := jsonb_build_object('email_dominio', left(split_part(lower(trim(coalesce(p_email, ''))), '@', 2), 100));
  v_adm boolean := (select app.pode_fazer('GERIR_USUARIOS'));
  v_n1 boolean := (select app.pode_fazer('GERIR_EQUIPE_EMPRESA'));
  v_empresa uuid := p_empresa;
  v_nivel smallint := p_nivel;
  cod text;
  novo uuid;
  antigo uuid;
begin
  if not v_adm and not v_n1 then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO', v_dom);
  end if;
  if not v_adm then
    -- gestor da empresa: só CLIENTE, só a própria empresa (forçada pelo servidor)
    if p_papel is distinct from 'CLIENTE'
       or (p_empresa is not null and p_empresa is distinct from (select (app.pode_acessar()).empresa_id)) then
      return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO', v_dom);
    end if;
    v_empresa := (select (app.pode_acessar()).empresa_id);
  end if;
  if not interno.checar_limite('CONVIDAR', 10, interval '1 day') then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'LIMITE_EXCEDIDO', v_dom);
  end if;

  if v_adm and p_papel = 'CLIENTE' and v_nivel is null then
    v_nivel := 1;
  end if;
  if (p_papel = 'CLIENTE' and (v_nivel is null or v_nivel not between 1 and 3))
     or (p_papel is distinct from 'CLIENTE' and v_nivel is not null) then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'CAMPOS_INVALIDOS', v_dom);
  end if;
  cod := interno.checar_convite(v_email, p_nome, p_papel, v_empresa);
  if cod is not null then
    return interno.negar('PREPARAR_CONVITE', 'convite', cod, v_dom);
  end if;

  perform pg_advisory_xact_lock(hashtext('convite:' || v_email));
  delete from app.convites where email = v_email and usado_em is null returning id into antigo;
  insert into app.convites (email, nome, papel, empresa_id, nivel, criado_por)
  values (v_email, trim(p_nome), p_papel, v_empresa, v_nivel, (select auth.uid()))
  returning id into novo;

  perform interno.auditar('PREPARAR_CONVITE', 'convite:' || novo, 'OK', null,
    jsonb_build_object('papel', p_papel, 'empresa_id', v_empresa, 'nivel', v_nivel, 'substituiu', antigo,
                       'gestor_empresa', not v_adm));
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

-- Só ADM. p_nivel: para CLIENTE, nulo mantém o nível atual (ou 1 se virar cliente agora).
drop function api.alterar_perfil(uuid, text, app.papel, uuid);
create function api.alterar_perfil(p_usuario uuid, p_nome text, p_papel app.papel, p_empresa uuid,
                                   p_nivel smallint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  v_nivel smallint;
  alvo app.perfis;
begin
  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo order by pf.usuario_id for update;

  if not (select app.pode_fazer('GERIR_USUARIOS')) then
    return interno.negar('ALTERAR_PERFIL', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or length(v_nome) not between 2 and 120 or p_papel is null
     or (p_papel = 'CLIENTE') <> (p_empresa is not null)
     or (p_empresa is not null and not exists (select 1 from app.empresas em where em.id = p_empresa))
     or (p_nivel is not null and (p_papel <> 'CLIENTE' or p_nivel not between 1 and 3))
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

  v_nivel := case when p_papel = 'CLIENTE' then coalesce(p_nivel, alvo.nivel, 1) end;
  update app.perfis set nome = v_nome, papel = p_papel, empresa_id = p_empresa, nivel = v_nivel
   where usuario_id = p_usuario;
  perform interno.auditar('ALTERAR_PERFIL', 'perfil:' || p_usuario, 'OK', null,
    jsonb_build_object('papel_anterior', alvo.papel, 'papel_novo', p_papel,
                       'empresa_anterior', alvo.empresa_id, 'empresa_nova', p_empresa,
                       'nivel_anterior', alvo.nivel, 'nivel_novo', v_nivel));
  return jsonb_build_object('ok', true);
end $$;

-- Gestor da empresa sobre colega: alvo inexistente, de outra empresa ou não-cliente → SEM_PERMISSAO
-- (não revela se o usuário existe); sobre si → PROPRIO_USUARIO.
create or replace function api.definir_ativo(p_usuario uuid, p_ativo boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  v_adm boolean;
  v_n1 boolean;
  alvo app.perfis;
begin
  perform 1 from app.perfis pf where pf.papel = 'ADM' and pf.ativo order by pf.usuario_id for update;

  v_adm := (select app.pode_fazer('GERIR_USUARIOS'));
  v_n1 := not v_adm and (select app.pode_fazer('GERIR_EQUIPE_EMPRESA'));
  if not v_adm and not v_n1 then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'SEM_PERMISSAO');
  end if;
  if p_usuario is null or p_ativo is null then
    return interno.negar('DEFINIR_ATIVO', 'perfil', 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'MOTIVO_OBRIGATORIO');
  end if;

  select * into alvo from app.perfis pf where pf.usuario_id = p_usuario;
  if v_n1 then
    if p_usuario = (select auth.uid()) then
      return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'PROPRIO_USUARIO');
    end if;
    if alvo.usuario_id is null or alvo.papel <> 'CLIENTE'
       or alvo.empresa_id is distinct from (select (app.pode_acessar()).empresa_id) then
      return interno.negar('DEFINIR_ATIVO', 'perfil:' || p_usuario, 'SEM_PERMISSAO');
    end if;
  elsif alvo.usuario_id is null then
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
    jsonb_build_object('ativo', p_ativo, 'motivo', v_motivo, 'gestor_empresa', v_n1));
  return jsonb_build_object('ok', true);
end $$;

-- Gestor da empresa: só GERAR_LINK, só para colega CLIENTE da própria empresa (nunca a si).
create or replace function api.autorizar_operacao_usuario(p_usuario uuid, p_acao text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm boolean := (select app.pode_fazer('GERIR_USUARIOS'));
  v_n1 boolean := (select app.pode_fazer('GERIR_EQUIPE_EMPRESA'));
  v_email text;
  alvo app.perfis;
begin
  if not v_adm and not v_n1 then
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
  select * into alvo from app.perfis pf where pf.usuario_id = p_usuario;
  if not v_adm then
    if p_acao <> 'GERAR_LINK' or alvo.usuario_id is null or alvo.papel <> 'CLIENTE'
       or alvo.empresa_id is distinct from (select (app.pode_acessar()).empresa_id) then
      return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'SEM_PERMISSAO');
    end if;
  end if;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_usuario;
  if v_email is null then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'NAO_ENCONTRADO');
  end if;
  if alvo.papel = 'ADM' then
    return interno.negar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'ALVO_ADM');
  end if;

  perform interno.auditar('AUTORIZAR_OPERACAO_USUARIO', 'usuario:' || p_usuario, 'OK', null,
    jsonb_build_object('operacao', p_acao, 'gestor_empresa', not v_adm));
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- ADM: todos; gestor da empresa: os perfis da própria empresa.
drop function api.listar_usuarios();
create function api.listar_usuarios()
returns table (usuario_id uuid, nome text, email text, telefone text, papel app.papel, nivel smallint,
               empresa_id uuid, empresa_nome text, ativo boolean, senha_pendente boolean, tem_2fa boolean,
               criado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select pf.usuario_id, pf.nome, lower(trim(u.email))::text, pf.telefone, pf.papel, pf.nivel, pf.empresa_id, e.nome,
         pf.ativo, pf.senha_pendente,
         exists (select 1 from auth.mfa_factors f
                 where f.user_id = pf.usuario_id and f.factor_type::text = 'totp' and f.status::text = 'verified'),
         pf.criado_em
  from app.perfis pf
  join auth.users u on u.id = pf.usuario_id
  left join app.empresas e on e.id = pf.empresa_id
  where (select app.pode_fazer('GERIR_USUARIOS'))
     or ((select app.pode_fazer('GERIR_EQUIPE_EMPRESA'))
         and pf.papel = 'CLIENTE'
         and pf.empresa_id = (select (app.pode_acessar()).empresa_id))
  order by pf.nome, pf.usuario_id
$$;

-- Próprio perfil (mesmo com senha pendente/aal1) + nível + se a empresa do cliente tem contrato vigente.
drop function api.meu_perfil();
create function api.meu_perfil()
returns table (nome text, papel app.papel, nivel smallint, empresa_id uuid, empresa_nome text,
               empresa_logo_caminho text, empresa_tem_contrato boolean, ativo boolean, senha_pendente boolean,
               tem_2fa boolean)
language sql stable security definer set search_path = '' as $$
  select pf.nome, pf.papel, pf.nivel, pf.empresa_id, e.nome, e.logo_caminho,
         case when pf.empresa_id is not null
              then exists (select 1 from interno.contrato_vigente(pf.empresa_id)) end,
         pf.ativo, pf.senha_pendente,
         exists (select 1 from auth.mfa_factors f
                 where f.user_id = pf.usuario_id and f.factor_type::text = 'totp' and f.status::text = 'verified')
  from app.perfis pf
  left join app.empresas e on e.id = pf.empresa_id
  where pf.usuario_id = (select auth.uid())
$$;

------------------------------------------------------------------------------------------------
-- 9. Privilégios.
------------------------------------------------------------------------------------------------
revoke all on function
  api.publicar_contrato(uuid, jsonb, timestamptz),
  api.definir_retencao_fotos(int),
  api.ler_configuracao(),
  api.listar_contratos(),
  api.historico_contrato(uuid),
  api.regras_do_servico(),
  api.precos_para_orcar(uuid),
  api.preparar_convite(text, text, app.papel, uuid, smallint),
  api.alterar_perfil(uuid, text, app.papel, uuid, smallint),
  api.listar_usuarios(),
  api.meu_perfil()
from public, anon, authenticated, service_role;

grant execute on function
  api.publicar_contrato(uuid, jsonb, timestamptz),
  api.definir_retencao_fotos(int),
  api.ler_configuracao(),
  api.listar_contratos(),
  api.historico_contrato(uuid),
  api.regras_do_servico(),
  api.precos_para_orcar(uuid),
  api.preparar_convite(text, text, app.papel, uuid, smallint),
  api.alterar_perfil(uuid, text, app.papel, uuid, smallint),
  api.listar_usuarios(),
  api.meu_perfil()
to authenticated;
