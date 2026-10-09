-- Confere as migrações das fases 1B, 2A e 2B aplicadas sobre o estado de antes.sql (CI). Qualquer divergência aborta.
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
  -- fase 2B: toda empresa existente ganhou conta zerada; livro-razão vazio e reconciliação limpa
  if exists (select 1 from app.empresas e left join app.contas c on c.empresa_id = e.id
              where c.empresa_id is null or c.saldo_contabil_cent <> 0 or c.reservado_cent <> 0) then
    raise exception 'empresa sem conta zerada após a migração da fase 2B';
  end if;
  if exists (select 1 from app.lancamentos) then raise exception 'livro-razão deveria nascer vazio'; end if;
  if not (interno.reconciliar() ->> 'ok')::boolean then raise exception 'reconciliação divergente após a migração'; end if;
  if not exists (select 1 from cron.job where jobname = 'reconciliar-saldos' and schedule = '0 6 * * *') then
    raise exception 'job reconciliar-saldos ausente';
  end if;
  -- fase 1B: valor GESTOR_FROTA do enum (arquivo próprio, transação separada do uso)
  if not exists (select 1 from pg_enum where enumtypid = 'app.papel'::regtype and enumlabel = 'GESTOR_FROTA') then
    raise exception 'papel GESTOR_FROTA ausente';
  end if;

  -- fase 2A: extensões, tabelas, exclusão da agenda, tempo real e job de expiração
  if not exists (select 1 from pg_extension where extname = 'btree_gist' and extnamespace = 'extensions'::regnamespace) then
    raise exception 'btree_gist ausente no schema extensions';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise exception 'pg_cron ausente'; end if;
  if to_regclass('app.atividades') is null or to_regclass('app.atividade_historico') is null
     or to_regclass('app.agenda_blocos') is null or to_regclass('app.orcamentos') is null
     or to_regclass('app.transicoes_permitidas') is null then
    raise exception 'tabela da fase 2A ausente';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agenda_blocos_sem_conflito' and contype = 'x') then
    raise exception 'exclusão anti-conflito da agenda ausente';
  end if;
  if not exists (select 1 from app.transicoes_permitidas) then raise exception 'transições não semeadas'; end if;
  if exists (select 1 from app.atividades) or exists (select 1 from app.orcamentos)
     or exists (select 1 from app.agenda_blocos) then
    raise exception 'pedidos/orçamentos/agenda deveriam nascer vazios';
  end if;
  if to_regclass('app.prova_canal') is not null
     or exists (select 1 from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'prova_assinar') then
    raise exception 'prova de tempo real da fase 0 ainda existe';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'pedidos_assinar') then
    raise exception 'política pedidos_assinar ausente';
  end if;
  if not exists (select 1 from cron.job where jobname = 'expirar-vencidos' and schedule = '*/15 * * * *' and active) then
    raise exception 'job expirar-vencidos ausente';
  end if;

  -- fase 2B: tabelas do dinheiro vazias (salvo a reconciliação acima) e jobs ativos
  if to_regclass('app.reservas') is null or to_regclass('app.aprovacoes') is null
     or to_regclass('app.idempotencia') is null or to_regclass('app.reconciliacoes') is null then
    raise exception 'tabela da fase 2B ausente';
  end if;
  if exists (select 1 from app.reservas) or exists (select 1 from app.aprovacoes) then
    raise exception 'reservas/aprovações deveriam nascer vazias';
  end if;
  if (select count(*) from cron.job where jobname in ('expirar-vencidos', 'reconciliar-saldos') and active) <> 2 then
    raise exception 'jobs agendados inativos ou duplicados';
  end if;
  raise notice 'migração das fases 1B, 2A e 2B conferida sobre dados de produção';
end $$;
