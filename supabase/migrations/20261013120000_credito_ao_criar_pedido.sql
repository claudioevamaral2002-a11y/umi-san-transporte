-- Crédito na criação do pedido (decisão do dono, 2026-10-13).
--   Sem crédito nenhum (disponível + limite de saldo negativo do contrato vigente ≤ 0) → SEM_CREDITO, auditado e sem
--   abortar a transação (Adendo A2). Com crédito, mesmo abaixo do alerta de saldo baixo, o pedido é criado (a tela
--   avisa na revisão). A aprovação do orçamento continua sendo a checagem dura (SALDO_INSUFICIENTE).
-- A checagem vem depois de SEM_PERMISSAO / LIMITE_EXCEDIDO / SEM_CONTRATO (o limite vem do contrato) e antes da
-- validação dos campos. Corpo igual ao de 20261009130000_pedidos_agenda.sql fora isso.

-- Cliente N1/N2. Cria SOLICITADA + PRE_RESERVA (expira no prazo de orçar). Conflito de agenda →
-- HORARIO_OCUPADO (a exclusion violation é capturada num subbloco e devolvida auditada; Adendo A2).
create or replace function api.criar_pedido(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  v_detalhe jsonb;
  v_motorista uuid;
  v_inicio timestamptz;
  v_periodo tstzrange;
  v_prazo timestamptz;
  v_id uuid;
  v_numero bigint;
  r record;
  v_expiradas int := 0;
  v_saldo jsonb;
begin
  if not (select app.pode_fazer('CRIAR_PEDIDO')) then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CRIAR_PEDIDO', 20, interval '1 hour') then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'LIMITE_EXCEDIDO');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_CONTRATO');
  end if;
  -- Sem crédito nenhum: nem saldo disponível nem limite para ficar negativo.
  v_saldo := interno.saldos(v.empresa_id);
  if (v_saldo ->> 'disponivel_cent')::bigint + (v_saldo ->> 'limite_cent')::bigint <= 0 then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_CREDITO',
      jsonb_build_object('disponivel_cent', (v_saldo ->> 'disponivel_cent')::bigint,
                         'limite_cent', (v_saldo ->> 'limite_cent')::bigint));
  end if;
  v_detalhe := interno.validar_pedido(p);
  if v_detalhe is not null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  v_motorista := interno.motorista_padrao();
  if v_motorista is null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_MOTORISTA');
  end if;

  v_inicio := (p ->> 'inicio')::timestamptz;
  v_periodo := tstzrange(v_inicio, v_inicio + make_interval(mins => (p ->> 'duracao_min')::int), '[)');
  v_prazo := least(now() + make_interval(hours => c.prazo_orcar_horas), v_inicio);

  -- Expira, nesta transação, as pré-reservas vencidas que colidem (ordem fixa de travas: sem deadlock).
  for r in
    select b.atividade_id
    from app.agenda_blocos b
    where b.motorista_id = v_motorista and b.ativo and b.tipo = 'PRE_RESERVA'
      and b.expira_em <= now() and b.periodo && v_periodo
    order by b.atividade_id
  loop
    if interno.expirar_atividade(r.atividade_id) then
      v_expiradas := v_expiradas + 1;
    end if;
  end loop;

  begin
    insert into app.atividades (
      empresa_id, solicitante_id, motorista_id, inicio, duracao_min, origem, destino, levar, trazer, carga,
      pessoas_qtd, equipamento_desc, peso_kg, dimensoes, modalidade, reboque, contato_nome, contato_telefone,
      observacoes, prazo_orcar_ate)
    values (
      v.empresa_id, v.usuario_id, v_motorista, v_inicio, (p ->> 'duracao_min')::int,
      btrim(p ->> 'origem'), btrim(p ->> 'destino'), (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean,
      (p ->> 'carga')::app.tipo_carga,
      (p ->> 'pessoas_qtd')::int, nullif(btrim(p ->> 'equipamento_desc'), ''), (p ->> 'peso_kg')::numeric,
      nullif(btrim(p ->> 'dimensoes'), ''),
      (p ->> 'modalidade')::app.modalidade, (p ->> 'reboque')::app.reboque,
      nullif(btrim(p ->> 'contato_nome'), ''), nullif(btrim(p ->> 'contato_telefone'), ''),
      nullif(p ->> 'observacoes', ''), v_prazo)
    returning id, numero into v_id, v_numero;
    insert into app.atividade_historico (atividade_id, de, para, por, observacao)
    values (v_id, null, 'SOLICITADA', v.usuario_id, null);
    insert into app.agenda_blocos (atividade_id, motorista_id, periodo, tipo, ativo, expira_em)
    values (v_id, v_motorista, v_periodo, 'PRE_RESERVA', true, v_prazo);
  exception when exclusion_violation then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'HORARIO_OCUPADO',
      jsonb_build_object('inicio', v_inicio, 'duracao_min', (p ->> 'duracao_min')::int, 'expiradas', v_expiradas));
  end;

  perform interno.auditar('CRIAR_PEDIDO', 'atividade:' || v_id, 'OK', null,
    jsonb_build_object('numero', v_numero, 'empresa_id', v.empresa_id, 'motorista_id', v_motorista,
                       'inicio', v_inicio, 'duracao_min', (p ->> 'duracao_min')::int, 'contrato_versao', c.versao,
                       'expiradas', v_expiradas));
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;
