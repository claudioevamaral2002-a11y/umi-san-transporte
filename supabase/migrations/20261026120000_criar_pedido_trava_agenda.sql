-- Pedidos ao mesmo tempo para o mesmo motorista: um de cada vez.
--
-- A trava da agenda é a restrição de exclusão de app.agenda_blocos. Com três ou mais pedidos simultâneos no mesmo
-- horário, cada transação grava o seu bloco antes de checar os outros. Assim duas delas podem esperar uma pela outra
-- (deadlock). O Postgres derruba uma com erro 500, em vez de responder HORARIO_OCUPADO. O teste "dois clientes
-- (quatro requisições) no mesmo horário" pegava isso no CI.
--
-- Correção: api.criar_pedido pega uma trava de transação por motorista (pg_advisory_xact_lock) antes de mexer na agenda.
-- Assim os pedidos do mesmo motorista entram em fila, e o resto da função fica igual ao de 20261023120300.
-- A trava vem depois de checar_limite e contrato_vigente: a ordem das travas é sempre a mesma.

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
  v_categoria text;
  v_agora boolean;
  v_cat app.categorias;
  v_tarifa app.tarifas_categoria;
  v_paradas int;
  v_volta boolean;
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
  -- Sem crédito nenhum: nem saldo disponível nem limite para ficar negativo. v2.1: só no CREDITO (no FATURADO o
  -- pedido não exige saldo; a corrida entra na fatura da quinzena).
  if c.forma_cobranca <> 'FATURADO' then
    v_saldo := interno.saldos(v.empresa_id);
    if (v_saldo ->> 'disponivel_cent')::bigint + (v_saldo ->> 'limite_cent')::bigint <= 0 then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_CREDITO',
        jsonb_build_object('disponivel_cent', (v_saldo ->> 'disponivel_cent')::bigint,
                           'limite_cent', (v_saldo ->> 'limite_cent')::bigint));
    end if;
  end if;
  v_detalhe := interno.validar_pedido(p);
  if v_detalhe is not null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  -- v2.1: a volta à origem tira o RETORNO do preço, então não se confia no aparelho: só vale quando o Para é o mesmo
  -- lugar do De pelo que o pedido grava (a regra de `voltaAOrigem` da tela): mesmo place_id, ou os dois pontos com
  -- coordenadas a menos de 300 m (haversine, raio médio da Terra). Fora disso grava false, sem recusa (compatível com
  -- o que já se envia). Ponto do Google de um lado e marcado no mapa do outro não dá para comparar: false.
  v_volta := coalesce((p ->> 'volta_a_origem')::boolean, false)
             and (coalesce(nullif(p ->> 'origem_place_id', '') = p ->> 'destino_place_id', false)
                  or coalesce(jsonb_typeof(p -> 'origem_lat') = 'number' and jsonb_typeof(p -> 'destino_lat') = 'number'
                              and 2 * 6371000 * asin(least(1, sqrt(
                                    sin(radians((p ->> 'destino_lat')::float8 - (p ->> 'origem_lat')::float8) / 2) ^ 2
                                    + cos(radians((p ->> 'origem_lat')::float8)) * cos(radians((p ->> 'destino_lat')::float8))
                                      * sin(radians((p ->> 'destino_lng')::float8 - (p ->> 'origem_lng')::float8) / 2) ^ 2)))
                                  < 300, false));
  v_motorista := interno.motorista_padrao();
  if v_motorista is null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_MOTORISTA');
  end if;
  -- fase 4: categoria inativa ou sem veículo ATIVO do motorista que a atenda (a tela mostra "Indisponível no momento").
  -- 4.1: a mesma regra de api.categorias_disponiveis: a de veículo do cliente (IVO Motorista) só precisa do motorista
  -- ativo; e a versão vigente precisa ter tarifa da categoria, salvo as três de antes da 4.1 (preço de hoje). Uma
  -- categoria criada depois da última publicação fica indisponível.
  v_categoria := p ->> 'categoria';
  v_agora := coalesce((p ->> 'agora')::boolean, false);
  if v_categoria is not null then
    select * into v_cat from app.categorias x where x.codigo = v_categoria;
    select * into v_tarifa from app.tarifas_categoria t where t.contrato_id = c.id and t.categoria = v_categoria;
    if not coalesce(v_cat.ativa, false)
       or not (v_cat.veiculo_cliente or interno.veiculo_atende(v_motorista, v_categoria) is not null)
       or not (v_tarifa.contrato_id is not null or v_categoria in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA')) then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'CATEGORIA_INDISPONIVEL', jsonb_build_object('categoria', v_categoria));
    end if;
    -- 4.1: tarifa com valor por hora exige as horas estimadas.
    if coalesce(v_tarifa.hora_cent > 0, false) and coalesce(jsonb_typeof(p -> 'horas_estimadas'), 'null') = 'null' then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'CAMPOS_INVALIDOS',
        jsonb_build_object('desconhecidos', '[]'::jsonb, 'ausentes', '[]'::jsonb,
                           'invalidos', jsonb_build_array('horas_estimadas')));
    end if;
  end if;
  -- 4.1: com categoria, carga e reboque gravados são os da categoria (não os que o aparelho mandou); na de veículo do
  -- cliente, a modalidade é VEICULO_CLIENTE.

  v_inicio := (p ->> 'inicio')::timestamptz;
  v_periodo := tstzrange(v_inicio, v_inicio + make_interval(mins => (p ->> 'duracao_min')::int), '[)');
  -- fase 4: no "Agora", o Ivo tem 15 min para responder.
  v_prazo := case when v_agora then least(now() + interval '15 minutes', v_inicio)
                  else least(now() + make_interval(hours => c.prazo_orcar_horas), v_inicio) end;

  -- Um pedido por vez para o mesmo motorista (sem deadlock na restrição de exclusão da agenda).
  perform pg_advisory_xact_lock(hashtext('agenda:' || v_motorista::text));

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
      observacoes, prazo_orcar_ate,
      origem_lat, origem_lng, destino_lat, destino_lng, origem_place_id, destino_place_id,
      categoria, agora, horas_estimadas, centro_custo,
      diarias_estimadas, outros_custos, volta_a_origem)
    values (
      v.empresa_id, v.usuario_id, v_motorista, v_inicio, (p ->> 'duracao_min')::int,
      btrim(p ->> 'origem'), btrim(p ->> 'destino'), (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean,
      coalesce(v_cat.carga, (p ->> 'carga')::app.tipo_carga),
      (p ->> 'pessoas_qtd')::int, nullif(btrim(p ->> 'equipamento_desc'), ''), (p ->> 'peso_kg')::numeric,
      nullif(btrim(p ->> 'dimensoes'), ''),
      case when v_cat.veiculo_cliente then 'VEICULO_CLIENTE'::app.modalidade else (p ->> 'modalidade')::app.modalidade end,
      coalesce(v_cat.reboque, (p ->> 'reboque')::app.reboque),
      nullif(btrim(p ->> 'contato_nome'), ''), nullif(btrim(p ->> 'contato_telefone'), ''),
      nullif(p ->> 'observacoes', ''), v_prazo,
      (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric,
      (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric,
      p ->> 'origem_place_id', p ->> 'destino_place_id',
      v_categoria, v_agora, (p ->> 'horas_estimadas')::numeric, nullif(btrim(p ->> 'centro_custo'), ''),
      -- v2.1
      (p ->> 'diarias_estimadas')::smallint, nullif(btrim(p ->> 'outros_custos'), ''),
      v_volta)
    returning id, numero into v_id, v_numero;
    -- 4.1: as paradas, na ordem (do Google só o place_id; de um ponto marcado, as coordenadas).
    insert into app.atividades_paradas (atividade_id, ordem, texto, place_id, lat, lng)
    select v_id, x.o, btrim(x.e ->> 'texto'), x.e ->> 'place_id', (x.e ->> 'lat')::numeric, (x.e ->> 'lng')::numeric
      from jsonb_array_elements(case when jsonb_typeof(p -> 'paradas') = 'array' then p -> 'paradas' else '[]'::jsonb end)
           with ordinality x(e, o);
    get diagnostics v_paradas = row_count;
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
                       'expiradas', v_expiradas, 'categoria', v_categoria, 'agora', v_agora,
                       'paradas', v_paradas, 'horas_estimadas', (p ->> 'horas_estimadas')::numeric,
                       'centro_custo', nullif(btrim(p ->> 'centro_custo'), ''),
                       'forma_cobranca', c.forma_cobranca,
                       'diarias_estimadas', (p ->> 'diarias_estimadas')::int,
                       'outros_custos', nullif(btrim(p ->> 'outros_custos'), ''),
                       'volta_a_origem', v_volta));
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;
