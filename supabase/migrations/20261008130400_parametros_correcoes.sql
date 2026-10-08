-- Correções dos parâmetros (revisão da Task 4).

-- 1. O FK com ON DELETE SET NULL faria UPDATE na tabela imutável (o gatilho recusa) e travaria a
--    exclusão de quem publicou. publicado_por vira uuid solto, como auditoria.usuario_id.
alter table app.parametros_versoes drop constraint parametros_versoes_publicado_por_fkey;

-- 2. Nome de quem publicou é obrigatório (nenhuma linha existe em produção).
alter table app.parametros_versoes alter column publicado_por_nome set not null;
alter table app.parametros_versoes add constraint parametros_publicado_por_nome_check
  check (length(btrim(publicado_por_nome)) > 0);

-- 3. publicar_parametros: detalhe de auditoria limitado e vigência no máximo 1 ano à frente.
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
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('p')));
  end if;

  -- no máximo 20 chaves desconhecidas, cada uma com até 60 caracteres (o chamador controla o texto)
  select coalesce(array_agg(left(c, 60) order by c), '{}') into desconhecidos
    from (select c from jsonb_object_keys(p) c where c <> all (conhecidos) order by c limit 20) x;
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
