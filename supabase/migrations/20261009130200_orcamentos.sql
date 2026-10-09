-- Fase 2A, Task 2 (docs/fases/fase-2a-desenho-e-plano.md "Banco"; especificação §4.2, §6; Adendos A2, A10):
-- orçamento calculado só no servidor a partir do contrato vigente da empresa (preço unitário NUNCA vem da
-- entrada: a entrada traz só quantidades e "Outros"), snapshot completo do contrato e hash do conteúdo.
--   * cada linha arredondada em centavos (meio para cima); total = soma das linhas; percentuais sobre centavos;
--   * calcular_orcamento (prévia sem gravar), enviar_orcamento, pedir_revisao, reprovar_orcamento;
--   * interno.transicionar passa a fechar o orçamento PENDENTE conforme o destino da atividade.
-- Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Orçamentos (imutáveis exceto o status, que só sai de PENDENTE).
------------------------------------------------------------------------------------------------
create table app.orcamentos (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid not null references app.atividades (id) on delete restrict,
  versao int not null check (versao > 0),
  modalidade app.modalidade not null,
  entrada jsonb not null,                 -- quantidades informadas pelo motorista (memória do cálculo)
  linhas jsonb not null check (jsonb_typeof(linhas) = 'array'),
  total_cent bigint not null check (total_cent >= 0),
  contrato_versao int not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),  -- cópia de TODO o contrato vigente
  valido_ate timestamptz not null,
  horario_sugerido timestamptz,
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'APROVADO', 'REPROVADO', 'EXPIRADO', 'SUBSTITUIDO', 'CANCELADO')),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  enviado_por uuid not null,              -- uuid solto (como auditoria.usuario_id)
  enviado_em timestamptz not null default now(),
  unique (atividade_id, versao)
);
create unique index orcamentos_um_pendente on app.orcamentos (atividade_id) where status = 'PENDENTE';
alter table app.orcamentos enable row level security;
-- Sem GRANT a authenticated: leituras por funções SECURITY DEFINER com checagem (Task 3).

create function interno.orcamento_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'orçamentos são imutáveis' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'orçamentos são imutáveis (só o status muda)' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'PENDENTE' and new.status in ('APROVADO', 'REPROVADO', 'EXPIRADO', 'SUBSTITUIDO', 'CANCELADO')) then
    raise exception 'status de orçamento % → % não permitido', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger orcamentos_imutaveis before update or delete on app.orcamentos
  for each row execute function interno.orcamento_imutavel();
create trigger orcamentos_sem_truncate before truncate on app.orcamentos
  for each statement execute function interno.orcamento_imutavel();

------------------------------------------------------------------------------------------------
-- 2. Auxiliares de cálculo.
------------------------------------------------------------------------------------------------

-- Meio para cima, em centavos (§6).
create function interno.arred(x numeric) returns bigint
language sql immutable set search_path = '' as $$
  select floor(x + 0.5)::bigint
$$;

-- Instante canônico (UTC, microssegundos), independente do TimeZone da sessão.
create function interno.utc_iso(t timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- Cópia de TODO o contrato (inclusive faixas), com instantes canônicos.
create function interno.snapshot_contrato(c app.contratos_versoes) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(c) || jsonb_build_object('vigente_desde', interno.utc_iso(c.vigente_desde),
                                           'publicado_em', interno.utc_iso(c.publicado_em))
$$;

-- Quem orça (motorista atribuído ou ADM) e quem decide pelo cliente (dono N2 ou N1 da empresa).
create function interno.pode_orcar(v app.perfis, a app.atividades) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(v.usuario_id is not null and a.id is not null
                  and (v.papel = 'ADM' or (v.papel = 'MOTORISTA' and a.motorista_id = v.usuario_id)), false)
$$;
create function interno.pode_decidir(v app.perfis, a app.atividades) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(v.usuario_id is not null and a.id is not null and v.papel = 'CLIENTE' and v.empresa_id = a.empresa_id
                  and (v.nivel = 1 or (v.nivel = 2 and a.solicitante_id = v.usuario_id)), false)
$$;

-- Linha do memorial.
create function interno.linha_orcamento(p_codigo text, p_descricao text, p_quantidade numeric, p_unitario_cent bigint,
                                        p_percentual_bp int, p_base_cent bigint, p_valor_cent bigint)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('codigo', p_codigo, 'descricao', p_descricao, 'quantidade', p_quantidade,
                            'unitario_cent', p_unitario_cent, 'percentual_bp', p_percentual_bp, 'base_cent', p_base_cent,
                            'valor_cent', p_valor_cent)
$$;

-- Cálculo (só no servidor). Preços SEMPRE de c; a entrada traz só quantidades:
--   veículo próprio: km (1 casa), usa_reboque, espera_horas (0,5 em 0,5); veículo do cliente: diarias;
--   comuns: pedagio_cent, hospedagem_diarias, outros [{descricao 3–120, valor_cent > 0}] (até 5); modalidade (opcional,
--   o motorista pode trocar). Campo da outra modalidade → CAMPOS_INCOMPATIVEIS; desconhecido (inclusive qualquer
--   preço) → CAMPOS_INVALIDOS. Km: Levar+Trazer = ida e volta; trecho único → linha "Retorno (x%)" sobre a linha de km.
-- Devolve {ok:true, modalidade, linhas, total_cent} ou {ok:false, codigo, detalhe}.
create function interno.calcular_linhas(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                        p_modalidade app.modalidade, e jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  so_proprio constant text[] := array['km', 'usa_reboque', 'espera_horas'];
  so_cliente constant text[] := array['diarias'];
  comuns constant text[] := array['modalidade', 'pedagio_cent', 'hospedagem_diarias', 'outros'];
  v_mod app.modalidade := p_modalidade;
  desconhecidos text[];
  incompat text[];
  inv text[] := '{}';
  v_km numeric := 0;
  v_reboque boolean := false;
  v_espera numeric := 0;
  v_pedagio bigint := 0;
  v_hosp int := 0;
  v_diarias int := 0;
  v_unit bigint;
  v_km_cent bigint;
  linhas jsonb := '[]';
  o jsonb;
begin
  if c.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'SEM_CONTRATO');
  end if;
  if e is null or jsonb_typeof(e) <> 'object' then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('invalidos', jsonb_build_array('p')));
  end if;

  select coalesce(array_agg(left(k, 60) order by k), '{}') into desconhecidos
    from (select k from jsonb_object_keys(e) k where k <> all (so_proprio || so_cliente || comuns) order by k limit 20) x;
  if cardinality(desconhecidos) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('desconhecidos', to_jsonb(desconhecidos)));
  end if;

  if coalesce(jsonb_typeof(e -> 'modalidade'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'modalidade') = 'string' and (e ->> 'modalidade') in ('VEICULO_PROPRIO', 'VEICULO_CLIENTE') then
      v_mod := (e ->> 'modalidade')::app.modalidade;
    else
      return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                                jsonb_build_object('invalidos', jsonb_build_array('modalidade')));
    end if;
  end if;

  select coalesce(array_agg(k order by k), '{}') into incompat
    from jsonb_object_keys(e) k
   where k = any (case when v_mod = 'VEICULO_PROPRIO' then so_cliente else so_proprio end);
  if cardinality(incompat) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INCOMPATIVEIS', 'detalhe',
                              jsonb_build_object('incompativeis', to_jsonb(incompat)));
  end if;

  -- quantidades (ausente/nulo = 0)
  if coalesce(jsonb_typeof(e -> 'km'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'km') = 'number' and (e ->> 'km') ~ '^[0-9]{1,6}(\.[0-9]{1,6})?$'
       and (e ->> 'km')::numeric * 10 = trunc((e ->> 'km')::numeric * 10) and (e ->> 'km')::numeric <= 100000 then
      v_km := (e ->> 'km')::numeric;
    else
      inv := array_append(inv, 'km');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'usa_reboque'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'usa_reboque') = 'boolean' then
      v_reboque := (e ->> 'usa_reboque')::boolean;
    else
      inv := array_append(inv, 'usa_reboque');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'espera_horas'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'espera_horas') = 'number' and (e ->> 'espera_horas') ~ '^[0-9]{1,3}(\.[0-9]{1,6})?$'
       and (e ->> 'espera_horas')::numeric * 2 = trunc((e ->> 'espera_horas')::numeric * 2)
       and (e ->> 'espera_horas')::numeric <= 240 then
      v_espera := (e ->> 'espera_horas')::numeric;
    else
      inv := array_append(inv, 'espera_horas');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'pedagio_cent'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'pedagio_cent') = 'number' and (e ->> 'pedagio_cent') ~ '^[0-9]{1,9}$' then
      v_pedagio := (e ->> 'pedagio_cent')::bigint;
    else
      inv := array_append(inv, 'pedagio_cent');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'hospedagem_diarias'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'hospedagem_diarias') = 'number' and (e ->> 'hospedagem_diarias') ~ '^[0-9]{1,2}$'
       and (e ->> 'hospedagem_diarias')::int <= 60 then
      v_hosp := (e ->> 'hospedagem_diarias')::int;
    else
      inv := array_append(inv, 'hospedagem_diarias');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'diarias'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'diarias') = 'number' and (e ->> 'diarias') ~ '^[0-9]{1,2}$' and (e ->> 'diarias')::int <= 60 then
      v_diarias := (e ->> 'diarias')::int;
    else
      inv := array_append(inv, 'diarias');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'outros'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'outros') <> 'array' or jsonb_array_length(e -> 'outros') > 5
       or exists (
         select 1 from jsonb_array_elements(e -> 'outros') x
          where not coalesce(
                  jsonb_typeof(x) = 'object'
                  and (select count(*) from jsonb_object_keys(x) k where k not in ('descricao', 'valor_cent')) = 0
                  and jsonb_typeof(x -> 'descricao') = 'string' and length(btrim(x ->> 'descricao')) between 3 and 120
                  and jsonb_typeof(x -> 'valor_cent') = 'number' and (x ->> 'valor_cent') ~ '^[0-9]{1,9}$'
                  and (x ->> 'valor_cent')::bigint > 0, false)) then
      inv := array_append(inv, 'outros');
    end if;
  end if;
  if cardinality(inv) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('invalidos', to_jsonb(inv)));
  end if;

  -- linhas (cada uma arredondada; quantidade zero não gera linha)
  if v_mod = 'VEICULO_PROPRIO' then
    if v_km > 0 then
      v_unit := case when v_reboque then c.km_com_reboque_cent else c.km_sem_reboque_cent end;
      v_km_cent := interno.arred(v_km * v_unit);
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        case when v_reboque then 'KM_COM_REBOQUE' else 'KM' end,
        case when p_levar and p_trazer then 'Km rodados (ida e volta)' else 'Km rodados (trecho único)' end
          || case when v_reboque then ', com reboque' else '' end,
        v_km, v_unit, null, null, v_km_cent));
      if not (p_levar and p_trazer) and c.retorno_trecho_unico_bp > 0 then
        linhas := linhas || jsonb_build_array(interno.linha_orcamento(
          'RETORNO', 'Retorno (' || replace(trim_scale(c.retorno_trecho_unico_bp / 100.0)::text, '.', ',') || '%)',
          null, null, c.retorno_trecho_unico_bp, v_km_cent,
          interno.arred(v_km_cent * c.retorno_trecho_unico_bp / 10000.0)));
      end if;
    end if;
    if v_reboque and c.taxa_fixa_reboque_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'REBOQUE', 'Taxa fixa de reboque', 1, c.taxa_fixa_reboque_cent, null, null, c.taxa_fixa_reboque_cent));
    end if;
    if v_espera > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'ESPERA', 'Espera (horas)', v_espera, c.hora_espera_cent, null, null, interno.arred(v_espera * c.hora_espera_cent)));
    end if;
  else
    if v_diarias > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'DIARIA_MOTORISTA', 'Diárias do motorista', v_diarias, c.diaria_motorista_cent, null, null,
        v_diarias * c.diaria_motorista_cent));
    end if;
  end if;
  if v_pedagio > 0 then
    linhas := linhas || jsonb_build_array(interno.linha_orcamento(
      'PEDAGIO', 'Pedágio/balsa (estimado)', 1, v_pedagio, null, null, v_pedagio));
  end if;
  if v_hosp > 0 then
    linhas := linhas || jsonb_build_array(interno.linha_orcamento(
      'HOSPEDAGEM', 'Hospedagem (diárias)', v_hosp, c.hospedagem_diaria_cent, null, null, v_hosp * c.hospedagem_diaria_cent));
  end if;
  for o in select x from jsonb_array_elements(coalesce(e -> 'outros', '[]')) x loop
    linhas := linhas || jsonb_build_array(interno.linha_orcamento(
      'OUTROS', 'Outros: ' || btrim(o ->> 'descricao'), 1, (o ->> 'valor_cent')::bigint, null, null,
      (o ->> 'valor_cent')::bigint));
  end loop;

  return jsonb_build_object('ok', true, 'modalidade', v_mod, 'linhas', linhas,
    'total_cent', (select coalesce(sum((l ->> 'valor_cent')::bigint), 0) from jsonb_array_elements(linhas) l));
end $$;

-- sha256 do conteúdo canônico (linhas, total, snapshot, horário, endereços, trajeto, validade).
create function interno.hash_orcamento(o app.orcamentos, a app.atividades) returns text
language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'atividade_id', o.atividade_id, 'versao', o.versao, 'modalidade', o.modalidade,
    'linhas', o.linhas, 'total_cent', o.total_cent, 'contrato_versao', o.contrato_versao, 'snapshot', o.snapshot,
    'valido_ate', interno.utc_iso(o.valido_ate), 'horario_sugerido', interno.utc_iso(o.horario_sugerido),
    'inicio', interno.utc_iso(a.inicio), 'duracao_min', a.duracao_min, 'origem', a.origem, 'destino', a.destino,
    'levar', a.levar, 'trazer', a.trazer)::text, 'UTF8')), 'hex')
$$;

------------------------------------------------------------------------------------------------
-- 3. Transição fecha o orçamento PENDENTE conforme o destino (revisão → SUBSTITUIDO, etc.).
------------------------------------------------------------------------------------------------
create or replace function interno.transicionar(p_atividade uuid, p_para app.status_atividade, p_observacao text)
returns app.status_atividade
language plpgsql security definer set search_path = '' as $$
declare
  v_de app.status_atividade;
begin
  select a.status into v_de from app.atividades a where a.id = p_atividade for update;
  if not found then
    raise exception 'atividade % inexistente', p_atividade using errcode = 'P0002';
  end if;
  if not exists (select 1 from app.transicoes_permitidas t where t.de = v_de and t.para = p_para) then
    raise exception 'transição % → % não permitida', v_de, p_para using errcode = '23514';
  end if;
  update app.atividades set status = p_para, atualizada_em = now() where id = p_atividade;
  insert into app.atividade_historico (atividade_id, de, para, por, observacao)
  values (p_atividade, v_de, p_para, (select auth.uid()), nullif(btrim(coalesce(p_observacao, '')), ''));
  if p_para in ('RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA', 'CONCLUIDA') then
    update app.agenda_blocos set ativo = false where atividade_id = p_atividade and ativo;
  end if;
  if p_para in ('SOLICITADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA', 'AGENDADA') then
    update app.orcamentos
       set status = case p_para when 'SOLICITADA' then 'SUBSTITUIDO' when 'REPROVADA' then 'REPROVADO'
                                when 'EXPIRADA' then 'EXPIRADO' when 'CANCELADA' then 'CANCELADO'
                                else 'APROVADO' end
     where atividade_id = p_atividade and status = 'PENDENTE';
  end if;
  return v_de;
end $$;

------------------------------------------------------------------------------------------------
-- 4. RPCs.
------------------------------------------------------------------------------------------------

-- Prévia (calculadora ao vivo): nada é gravado além do contador do limite. Motorista atribuído ou ADM.
create function api.calcular_orcamento(p_atividade uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contratos_versoes;
  r jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade;
  if a.id is null then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if not interno.pode_orcar(v, a) then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CALCULAR_ORCAMENTO', 600, interval '1 hour') then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if a.status <> 'SOLICITADA' then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.prazo_vencido(a.id) then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  select * into c from interno.contrato_vigente(a.empresa_id);
  r := interno.calcular_linhas(c, a.levar, a.trazer, a.modalidade, p);
  if not (r ->> 'ok')::boolean then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  return r || jsonb_build_object('valido_ate', least(now() + make_interval(hours => c.validade_orcamento_horas), a.inicio));
end $$;

-- Motorista atribuído ou ADM: SOLICITADA (dentro do prazo, checado com now()) → ORCADA com orçamento PENDENTE
-- (snapshot do contrato vigente + hash); a pré-reserva passa a vencer junto com o orçamento.
create function api.enviar_orcamento(p_atividade uuid, p jsonb, p_horario_sugerido timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contratos_versoes;
  o app.orcamentos;
  r jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
  if a.id is null then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if not interno.pode_orcar(v, a) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if a.status <> 'SOLICITADA' then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  select * into c from interno.contrato_vigente(a.empresa_id);
  r := interno.calcular_linhas(c, a.levar, a.trazer, a.modalidade, p);
  if not (r ->> 'ok')::boolean then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  if p_horario_sugerido is not null
     and (p_horario_sugerido <= now() or p_horario_sugerido > now() + interval '366 days') then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('horario_sugerido')));
  end if;

  -- defensivo: nunca dois PENDENTES (a revisão já marcou o anterior como SUBSTITUIDO)
  update app.orcamentos set status = 'SUBSTITUIDO' where atividade_id = a.id and status = 'PENDENTE';

  o.id := gen_random_uuid();
  o.atividade_id := a.id;
  o.versao := coalesce((select max(x.versao) from app.orcamentos x where x.atividade_id = a.id), 0) + 1;
  o.modalidade := (r ->> 'modalidade')::app.modalidade;
  o.entrada := p;
  o.linhas := r -> 'linhas';
  o.total_cent := (r ->> 'total_cent')::bigint;
  o.contrato_versao := c.versao;
  o.snapshot := interno.snapshot_contrato(c);
  o.valido_ate := least(now() + make_interval(hours => c.validade_orcamento_horas), a.inicio);
  o.horario_sugerido := p_horario_sugerido;
  o.status := 'PENDENTE';
  o.enviado_por := v.usuario_id;
  o.enviado_em := now();
  o.hash := interno.hash_orcamento(o, a);
  insert into app.orcamentos select o.*;

  perform interno.transicionar(a.id, 'ORCADA', null);
  update app.agenda_blocos set expira_em = o.valido_ate where atividade_id = a.id and ativo;

  perform interno.auditar('ENVIAR_ORCAMENTO', v_alvo, 'OK', null,
    jsonb_build_object('orcamento_id', o.id, 'versao', o.versao, 'modalidade', o.modalidade, 'total_cent', o.total_cent,
                       'contrato_versao', o.contrato_versao, 'valido_ate', o.valido_ate, 'hash', o.hash));
  return jsonb_build_object('ok', true, 'orcamento_id', o.id, 'versao', o.versao, 'total_cent', o.total_cent,
                            'valido_ate', o.valido_ate);
end $$;

-- Dono (N2) ou N1 da empresa: ORCADA → SOLICITADA (orçamento SUBSTITUIDO), novo prazo de orçar. Limite 10/h.
create function api.pedir_revisao(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_horas int;
  v_prazo timestamptz;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'ORCADA' then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if not interno.checar_limite('PEDIR_REVISAO', 10, interval '1 hour') then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'PRAZO_VENCIDO');
  end if;

  -- prazo do contrato vigente; sem vigente, o do snapshot do orçamento revisado
  v_horas := coalesce(
    (select c.prazo_orcar_horas from interno.contrato_vigente(a.empresa_id) c),
    (select (x.snapshot ->> 'prazo_orcar_horas')::int from app.orcamentos x
      where x.atividade_id = a.id and x.status = 'PENDENTE'));
  v_prazo := least(now() + make_interval(hours => v_horas), a.inicio);

  perform interno.transicionar(a.id, 'SOLICITADA', v_motivo);
  update app.atividades set prazo_orcar_ate = v_prazo where id = a.id;
  update app.agenda_blocos set expira_em = v_prazo where atividade_id = a.id and ativo;

  perform interno.auditar('PEDIR_REVISAO', v_alvo, 'OK', null,
    jsonb_build_object('motivo', v_motivo, 'prazo_orcar_ate', v_prazo));
  return jsonb_build_object('ok', true, 'prazo_orcar_ate', v_prazo);
end $$;

-- Dono (N2) ou N1 da empresa: ORCADA → REPROVADA (orçamento REPROVADO); libera a agenda. Motivo opcional.
create function api.reprovar_orcamento(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) > 500 then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'ORCADA' then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'REPROVADA', nullif(v_motivo, ''));
  perform interno.auditar('REPROVAR_ORCAMENTO', v_alvo, 'OK', null, jsonb_build_object('motivo', nullif(v_motivo, '')));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 5. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.orcamento_imutavel(),
  interno.arred(numeric),
  interno.utc_iso(timestamptz),
  interno.snapshot_contrato(app.contratos_versoes),
  interno.pode_orcar(app.perfis, app.atividades),
  interno.pode_decidir(app.perfis, app.atividades),
  interno.linha_orcamento(text, text, numeric, bigint, int, bigint, bigint),
  interno.calcular_linhas(app.contratos_versoes, boolean, boolean, app.modalidade, jsonb),
  interno.hash_orcamento(app.orcamentos, app.atividades),
  interno.transicionar(uuid, app.status_atividade, text)
from public, anon, authenticated;

revoke all on function
  api.calcular_orcamento(uuid, jsonb),
  api.enviar_orcamento(uuid, jsonb, timestamptz),
  api.pedir_revisao(uuid, text),
  api.reprovar_orcamento(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  api.calcular_orcamento(uuid, jsonb),
  api.enviar_orcamento(uuid, jsonb, timestamptz),
  api.pedir_revisao(uuid, text),
  api.reprovar_orcamento(uuid, text)
to authenticated;
