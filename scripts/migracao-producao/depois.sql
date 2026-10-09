-- Confere a migração da fase 1B aplicada sobre o estado de antes.sql (CI). Qualquer divergência aborta.
do $$
declare
  esperado jsonb := '{"km_sem_reboque_cent":350,"km_com_reboque_cent":480,"taxa_fixa_reboque_cent":15000,
    "retorno_trecho_unico_bp":5000,"hora_espera_cent":4500,"hospedagem_diaria_cent":22000,"diaria_motorista_cent":30000,
    "faixas_cancelamento":[{"antecedencia_min_horas":24,"multa_bp":0},{"antecedencia_min_horas":0,"multa_bp":5000}],
    "prazo_orcar_horas":2,"validade_orcamento_horas":48,"limiar_urgente_horas":12,
    "limite_saldo_negativo_cent":100000,"alerta_saldo_baixo_cent":20000}';
  campos constant text[] := array['km_sem_reboque_cent','km_com_reboque_cent','taxa_fixa_reboque_cent',
    'retorno_trecho_unico_bp','hora_espera_cent','hospedagem_diaria_cent','diaria_motorista_cent','faixas_cancelamento',
    'prazo_orcar_horas','validade_orcamento_horas','limiar_urgente_horas','limite_saldo_negativo_cent',
    'alerta_saldo_baixo_cent'];
  umi uuid := (select id from app.empresas where nome = 'Umi San');
  r jsonb;
  n int;
begin
  -- modelo v1 e Umi San v1, vigentes, com os mesmos valores e o mesmo autor
  for r in select to_jsonb(c) from app.contratos_versoes c where c.empresa_id is null or c.empresa_id = umi loop
    if (select jsonb_object_agg(k, r -> k) from unnest(campos) k) <> esperado then
      raise exception 'valores divergentes: %', r;
    end if;
    if (r ->> 'versao')::int <> 1 or (r ->> 'publicado_por_nome') <> 'Admin Prod'
       or (r ->> 'publicado_por') <> '00000000-0000-0000-0000-0000000000f1'
       or (r ->> 'vigente_desde')::timestamptz > now() then
      raise exception 'versão/autor/vigência divergentes: %', r;
    end if;
  end loop;
  select count(*) into n from app.contratos_versoes;
  if n <> 2 then raise exception 'esperava 2 versões (modelo + Umi San), há %', n; end if;
  if not exists (select 1 from app.contratos_versoes where empresa_id is null) then raise exception 'sem modelo'; end if;
  if not exists (select 1 from app.contratos_versoes where empresa_id = umi) then raise exception 'sem contrato Umi San'; end if;
  if exists (select 1 from interno.contrato_vigente('00000000-0000-0000-0000-00000000e0b2')) then
    raise exception 'outra empresa não deveria ter contrato';
  end if;

  -- retenção de fotos preservada na configuração global
  if (select retencao_fotos_dias from app.configuracao) is distinct from 5 then
    raise exception 'retenção divergente: %', (select retencao_fotos_dias from app.configuracao);
  end if;

  -- níveis: cliente existente e convite pendente viram N1; demais papéis sem nível
  if (select nivel from app.perfis where usuario_id = '00000000-0000-0000-0000-0000000000f2') is distinct from 1 then
    raise exception 'cliente existente não virou N1';
  end if;
  if (select nivel from app.convites where email = 'pendente@prod.local' and usado_em is null) is distinct from 1 then
    raise exception 'convite pendente de cliente não virou N1';
  end if;
  if exists (select 1 from app.perfis where papel <> 'CLIENTE' and nivel is not null) then
    raise exception 'papel não-cliente com nível';
  end if;

  -- estruturas antigas removidas
  if to_regclass('app.parametros_versoes') is not null or to_regclass('app.permissoes_delegadas') is not null
     or to_regclass('api.parametros_vigentes') is not null or to_regclass('api.permissoes') is not null then
    raise exception 'estrutura antiga ainda existe';
  end if;
  raise notice 'migração da fase 1B conferida sobre dados de produção';
end $$;
