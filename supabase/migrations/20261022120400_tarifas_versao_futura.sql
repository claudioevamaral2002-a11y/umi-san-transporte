-- Fase 4.1, revisão final (I1): api.publicar_tarifas copia os campos comuns da versão VIGENTE. Com uma versão futura
-- já agendada (vigente_desde > now()) para a mesma empresa (ou para a tabela modelo, com p_empresa nulo), a tabela
-- publicada agora valeria só até a pendente começar; aí interno.contrato_vigente passa a escolher a pendente, que não
-- tem estas tarifas (IVO Motorista fica indisponível e os preços voltam ao de hoje).
--   * publicar_tarifas recusa com VERSAO_FUTURA_PENDENTE (negação auditada) enquanto houver versão futura da mesma
--     empresa (ou do modelo). A checagem roda depois do lock de categorias, que serializa as publicações de tarifas.
-- publicar_contrato e publicar_contrato_categorias não perdem tarifas (copiam da última versão, inclusive a futura) e
-- seguem como estão (o app atual publica contratos futuros e depois outros; ver docs/RUNBOOK.md §19).
-- Mesma assinatura ("create or replace" mantém os privilégios; reafirmados no fim). Corpo de
-- 20261022120000_categorias_tarifas.sql (as migrations seguintes não o redefiniram), salvo o trecho marcado "4.1 (revisão final)".

create or replace function api.publicar_tarifas(p_empresa uuid, p_tarifas jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  c app.contratos_versoes;
  nova int;
  v_id bigint;
  v_copiadas int;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('PUBLICAR_TARIFAS', 'contrato', 'SEM_PERMISSAO');
  end if;
  if p_empresa is not null and not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PUBLICAR_TARIFAS', 'contrato', 'NAO_ENCONTRADO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'VIGENCIA_NO_PASSADO');
  end if;
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  -- As categorias ativas não mudam no meio da publicação (mesmo lock de salvar_categoria).
  perform pg_advisory_xact_lock(hashtext('categorias'));
  -- 4.1 (revisão final): com uma versão futura pendente da mesma empresa (ou do modelo), a versão nova nasceria da
  -- vigente e a pendente, ao começar a valer, ficaria sem estas tarifas. Recusa até a pendente começar a valer.
  if exists (select 1 from app.contratos_versoes x
              where ((p_empresa is null and x.empresa_id is null) or x.empresa_id = p_empresa)
                and x.vigente_desde > now()) then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'VERSAO_FUTURA_PENDENTE');
  end if;
  v_detalhe := interno.validar_tarifas(p_tarifas);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  select * into c from interno.contrato_vigente(p_empresa);
  if c.id is null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'SEM_CONTRATO');
  end if;

  nova := interno.inserir_contrato(p_empresa,
    to_jsonb(c) - array['id', 'empresa_id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em'],
    p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())));
  select x.id into v_id from app.contratos_versoes x
   where x.versao = nova and ((p_empresa is null and x.empresa_id is null) or x.empresa_id = p_empresa);
  insert into app.tarifas_categoria (contrato_id, categoria, taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent,
                                     parada_cent, reboque_cent, hospedagem_diaria_cent, retorno_bp)
  select v_id, j.key, (j.value ->> 'taxa_fixa_cent')::bigint, (j.value ->> 'km_cent')::bigint,
         (j.value ->> 'hora_cent')::bigint, (j.value ->> 'hora_espera_cent')::bigint, (j.value ->> 'parada_cent')::bigint,
         (j.value ->> 'reboque_cent')::bigint, (j.value ->> 'hospedagem_diaria_cent')::bigint, (j.value ->> 'retorno_bp')::int
    from jsonb_each(p_tarifas) j;
  insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
  select v_id, cc.categoria, cc.km_cent, cc.taxa_fixa_cent from app.contratos_categorias cc where cc.contrato_id = c.id;
  get diagnostics v_copiadas = row_count;

  perform interno.auditar('PUBLICAR_TARIFAS', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'versao_base', c.versao, 'tarifas', p_tarifas, 'categorias_copiadas', v_copiadas));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

revoke all on function api.publicar_tarifas(uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function api.publicar_tarifas(uuid, jsonb, timestamptz) to authenticated;
