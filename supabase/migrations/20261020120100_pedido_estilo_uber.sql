-- Fase 4, Tarefa 2 (docs/fases/fase-4-ivo-estilo-uber-desenho.md §5.2, §5.4, §5.5, §6.1 "Agora", §6.4, §6.5): o pedido
-- no estilo Uber, no mesmo banco do app atual.
--   * app.atividades ganha categoria, veículo, "Agora", centro de custo e avaliação (todas anuláveis ou com padrão);
--   * criar_pedido aceita `categoria` (formato e coerência em validar_pedido; disponibilidade aqui: CATEGORIA_INDISPONIVEL)
--     e `agora` (início entre +55 min e +36 h; 15 min para o Ivo responder);
--   * enviar_orcamento aceita `veiculo_id`, `ajuste_cent` e `ajuste_motivo` (retirados antes do cálculo). Com categoria,
--     o preço é o da categoria e o veículo é obrigatório. O ajuste vira a linha AJUSTE_MOTORISTA, de −50% a +100% da
--     tabela, ANTES do hash (a aprovação confere o mesmo hash). Com "Agora", o cliente tem 15 min para confirmar;
--   * calcular_orcamento (prévia do Orçar) usa o mesmo preço da categoria e ignora as chaves da corrida;
--   * api.confirmar_corrida (aprovação + centro de custo) e api.avaliar (1 a 5, uma vez, só concluída);
--   * atraso automático: enviar_posicao com `eta` marca o próximo pedido do motorista (interno.marcar_atraso, também
--     usada por informar_previsao, que continua para o ADM);
--   * api.pedido, api.pendencias e api.extrato devolvem os campos novos.
-- Compatibilidade: o app atual chama criar_pedido, enviar_orcamento, aprovar_orcamento, pedido, pendencias e extrato
-- como hoje (sem chaves novas) e o resultado é o mesmo. Corpos iguais aos das migrations anteriores salvo o marcado
-- com "fase 4". Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Colunas.
------------------------------------------------------------------------------------------------
alter table app.atividades
  add column categoria text references app.categorias (codigo),
  add column veiculo_id uuid references app.veiculos (id),
  add column agora boolean not null default false,
  add column centro_custo text check (char_length(centro_custo) <= 80),
  add column avaliacao smallint check (avaliacao between 1 and 5),
  add column avaliacao_comentario text check (char_length(avaliacao_comentario) <= 500),
  add column avaliado_em timestamptz;

------------------------------------------------------------------------------------------------
-- 2. Validação e criação do pedido (corpos de 20261015140000_termos_google.sql, mais categoria e "Agora").
------------------------------------------------------------------------------------------------
create or replace function interno.validar_pedido(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  obrigatorios constant text[] := array['inicio', 'duracao_min', 'origem', 'destino', 'levar', 'trazer', 'carga',
                                        'modalidade', 'reboque'];
  opcionais constant text[] := array['pessoas_qtd', 'equipamento_desc', 'peso_kg', 'dimensoes', 'contato_nome',
                                     'contato_telefone', 'observacoes',
                                     -- fase 3A
                                     'origem_lat', 'origem_lng', 'destino_lat', 'destino_lng', 'origem_place_id',
                                     'destino_place_id',
                                     -- fase 4
                                     'categoria', 'agora'];
  desconhecidos text[];
  ausentes text[];
  inv text[] := '{}';
  v_carga text;
  v_pessoas boolean;
  v_equip boolean;
  v_inicio timestamptz;
  k app.categorias;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('invalidos', jsonb_build_array('p'));
  end if;
  select coalesce(array_agg(left(c, 60) order by c), '{}') into desconhecidos
    from (select c from jsonb_object_keys(p) c where c <> all (obrigatorios || opcionais) order by c limit 20) x;
  select coalesce(array_agg(c order by c), '{}') into ausentes
    from unnest(obrigatorios) c where not (p ? c) or jsonb_typeof(p -> c) = 'null';

  -- início: ISO 8601 com fuso, no futuro, até 1 ano
  if p ? 'inicio' and jsonb_typeof(p -> 'inicio') <> 'null' then
    if jsonb_typeof(p -> 'inicio') <> 'string'
       or (p ->> 'inicio') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$'
       or not pg_input_is_valid(p ->> 'inicio', 'timestamptz') then
      inv := array_append(inv, 'inicio');
    else
      v_inicio := (p ->> 'inicio')::timestamptz;
      if v_inicio <= now() or v_inicio > now() + interval '366 days' then
        inv := array_append(inv, 'inicio');
      end if;
    end if;
  end if;
  if p ? 'duracao_min' and jsonb_typeof(p -> 'duracao_min') <> 'null'
     and not (jsonb_typeof(p -> 'duracao_min') = 'number' and (p ->> 'duracao_min') ~ '^[0-9]{1,4}$'
              and (p ->> 'duracao_min')::int between 30 and 1440) then
    inv := array_append(inv, 'duracao_min');
  end if;
  if p ? 'origem' and jsonb_typeof(p -> 'origem') <> 'null'
     and not (jsonb_typeof(p -> 'origem') = 'string' and length(btrim(p ->> 'origem')) between 3 and 200) then
    inv := array_append(inv, 'origem');
  end if;
  if p ? 'destino' and jsonb_typeof(p -> 'destino') <> 'null'
     and not (jsonb_typeof(p -> 'destino') = 'string' and length(btrim(p ->> 'destino')) between 3 and 200) then
    inv := array_append(inv, 'destino');
  end if;
  if p ? 'levar' and jsonb_typeof(p -> 'levar') not in ('boolean', 'null') then inv := array_append(inv, 'levar'); end if;
  if p ? 'trazer' and jsonb_typeof(p -> 'trazer') not in ('boolean', 'null') then inv := array_append(inv, 'trazer'); end if;
  if jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
     and not ((p ->> 'levar')::boolean or (p ->> 'trazer')::boolean) then
    inv := array_append(inv, 'trajeto');
  end if;
  if p ? 'modalidade' and jsonb_typeof(p -> 'modalidade') <> 'null'
     and not (jsonb_typeof(p -> 'modalidade') = 'string' and (p ->> 'modalidade') in ('VEICULO_PROPRIO', 'VEICULO_CLIENTE')) then
    inv := array_append(inv, 'modalidade');
  end if;
  if p ? 'reboque' and jsonb_typeof(p -> 'reboque') <> 'null'
     and not (jsonb_typeof(p -> 'reboque') = 'string' and (p ->> 'reboque') in ('SIM', 'NAO', 'NAO_SEI')) then
    inv := array_append(inv, 'reboque');
  end if;

  -- carga e campos coerentes com ela
  if p ? 'carga' and jsonb_typeof(p -> 'carga') <> 'null' then
    if jsonb_typeof(p -> 'carga') = 'string' and (p ->> 'carga') in ('PESSOAS', 'EQUIPAMENTO', 'AMBOS') then
      v_carga := p ->> 'carga';
    else
      inv := array_append(inv, 'carga');
    end if;
  end if;
  v_pessoas := v_carga in ('PESSOAS', 'AMBOS');
  v_equip := v_carga in ('EQUIPAMENTO', 'AMBOS');
  if v_carga is not null then
    if v_pessoas then
      if not coalesce(jsonb_typeof(p -> 'pessoas_qtd') = 'number' and (p ->> 'pessoas_qtd') ~ '^[0-9]{1,2}$'
              and (p ->> 'pessoas_qtd')::int between 1 and 99, false) then
        inv := array_append(inv, 'pessoas_qtd');
      end if;
    elsif coalesce(jsonb_typeof(p -> 'pessoas_qtd'), 'null') <> 'null' then
      inv := array_append(inv, 'pessoas_qtd');
    end if;
    if v_equip then
      if not coalesce(jsonb_typeof(p -> 'equipamento_desc') = 'string'
              and length(btrim(p ->> 'equipamento_desc')) between 3 and 500, false) then
        inv := array_append(inv, 'equipamento_desc');
      end if;
      if coalesce(jsonb_typeof(p -> 'peso_kg'), 'null') <> 'null'
         and not (jsonb_typeof(p -> 'peso_kg') = 'number' and (p ->> 'peso_kg') ~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
                  and (p ->> 'peso_kg')::numeric > 0 and (p ->> 'peso_kg')::numeric <= 100000) then
        inv := array_append(inv, 'peso_kg');
      end if;
      if coalesce(jsonb_typeof(p -> 'dimensoes'), 'null') <> 'null'
         and not (jsonb_typeof(p -> 'dimensoes') = 'string' and length(btrim(p ->> 'dimensoes')) between 1 and 120) then
        inv := array_append(inv, 'dimensoes');
      end if;
    else
      if coalesce(jsonb_typeof(p -> 'equipamento_desc'), 'null') <> 'null' then inv := array_append(inv, 'equipamento_desc'); end if;
      if coalesce(jsonb_typeof(p -> 'peso_kg'), 'null') <> 'null' then inv := array_append(inv, 'peso_kg'); end if;
      if coalesce(jsonb_typeof(p -> 'dimensoes'), 'null') <> 'null' then inv := array_append(inv, 'dimensoes'); end if;
    end if;
  end if;

  -- contato e observações (opcionais)
  if coalesce(jsonb_typeof(p -> 'contato_nome'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'contato_nome') = 'string' and length(btrim(p ->> 'contato_nome')) between 2 and 120) then
    inv := array_append(inv, 'contato_nome');
  end if;
  if coalesce(jsonb_typeof(p -> 'contato_telefone'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'contato_telefone') = 'string' and btrim(p ->> 'contato_telefone') ~ '^[0-9+() .-]{8,25}$') then
    inv := array_append(inv, 'contato_telefone');
  end if;
  if coalesce(jsonb_typeof(p -> 'observacoes'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'observacoes') = 'string' and length(p ->> 'observacoes') <= 1000) then
    inv := array_append(inv, 'observacoes');
  end if;

  -- fase 3A: coordenadas em par e nos limites; place_id só com caracteres do Google; nunca os dois no mesmo lado.
  if coalesce(jsonb_typeof(p -> 'origem_lat'), 'null') <> coalesce(jsonb_typeof(p -> 'origem_lng'), 'null')
     or (coalesce(jsonb_typeof(p -> 'origem_lat'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'origem_lat') = 'number' and jsonb_typeof(p -> 'origem_lng') = 'number'
                               then (p ->> 'origem_lat')::numeric between -90 and 90
                                    and (p ->> 'origem_lng')::numeric between -180 and 180 end, false)) then
    inv := array_append(inv, 'origem_coordenadas');
  end if;
  if coalesce(jsonb_typeof(p -> 'destino_lat'), 'null') <> coalesce(jsonb_typeof(p -> 'destino_lng'), 'null')
     or (coalesce(jsonb_typeof(p -> 'destino_lat'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'destino_lat') = 'number' and jsonb_typeof(p -> 'destino_lng') = 'number'
                               then (p ->> 'destino_lat')::numeric between -90 and 90
                                    and (p ->> 'destino_lng')::numeric between -180 and 180 end, false)) then
    inv := array_append(inv, 'destino_coordenadas');
  end if;
  if coalesce(jsonb_typeof(p -> 'origem_place_id'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'origem_place_id') = 'string' and (p ->> 'origem_place_id') ~ '^[A-Za-z0-9_-]+$'
                  and length(p ->> 'origem_place_id') <= 300) then
    inv := array_append(inv, 'origem_place_id');
  end if;
  if coalesce(jsonb_typeof(p -> 'destino_place_id'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'destino_place_id') = 'string' and (p ->> 'destino_place_id') ~ '^[A-Za-z0-9_-]+$'
                  and length(p ->> 'destino_place_id') <= 300) then
    inv := array_append(inv, 'destino_place_id');
  end if;
  if coalesce(jsonb_typeof(p -> 'origem_place_id'), 'null') <> 'null' and coalesce(jsonb_typeof(p -> 'origem_lat'), 'null') <> 'null' then
    inv := array_append(inv, 'origem_coordenadas');
  end if;
  if coalesce(jsonb_typeof(p -> 'destino_place_id'), 'null') <> 'null' and coalesce(jsonb_typeof(p -> 'destino_lat'), 'null') <> 'null' then
    inv := array_append(inv, 'destino_coordenadas');
  end if;

  -- fase 4: categoria só no veículo próprio, com a carga e o reboque dela (a disponibilidade é conferida no criar_pedido).
  if coalesce(jsonb_typeof(p -> 'categoria'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'categoria') = 'string' then
      select * into k from app.categorias x where x.codigo = p ->> 'categoria';
    end if;
    if k.codigo is null
       or coalesce(p ->> 'modalidade', '') <> 'VEICULO_PROPRIO'
       or v_carga is distinct from k.carga::text
       or coalesce(p ->> 'reboque', '') <> k.reboque::text then
      inv := array_append(inv, 'categoria');
    end if;
  end if;
  -- fase 4: "Agora" = o primeiro horário livre a partir de agora + 60 min (folga de 5 min para o relógio do aparelho),
  -- no máximo 36 h depois (o "Agora" das 23h30 cai no dia seguinte).
  if coalesce(jsonb_typeof(p -> 'agora'), 'null') not in ('boolean', 'null') then
    inv := array_append(inv, 'agora');
  elsif jsonb_typeof(p -> 'agora') = 'boolean' and (p ->> 'agora')::boolean and v_inicio is not null
        and (v_inicio < now() + interval '55 minutes' or v_inicio > now() + interval '36 hours') then
    inv := array_append(inv, 'agora');
  end if;

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(inv) > 0 then
    return jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                              'invalidos', to_jsonb(inv));
  end if;
  return null;
end $$;

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
  -- fase 4: categoria inativa ou sem veículo ATIVO do motorista que a atenda (a tela mostra "Indisponível no momento").
  v_categoria := p ->> 'categoria';
  v_agora := coalesce((p ->> 'agora')::boolean, false);
  if v_categoria is not null
     and (not exists (select 1 from app.categorias k where k.codigo = v_categoria and k.ativa)
          or interno.veiculo_atende(v_motorista, v_categoria) is null) then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'CATEGORIA_INDISPONIVEL', jsonb_build_object('categoria', v_categoria));
  end if;

  v_inicio := (p ->> 'inicio')::timestamptz;
  v_periodo := tstzrange(v_inicio, v_inicio + make_interval(mins => (p ->> 'duracao_min')::int), '[)');
  -- fase 4: no "Agora", o Ivo tem 15 min para responder.
  v_prazo := case when v_agora then least(now() + interval '15 minutes', v_inicio)
                  else least(now() + make_interval(hours => c.prazo_orcar_horas), v_inicio) end;

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
      categoria, agora)
    values (
      v.empresa_id, v.usuario_id, v_motorista, v_inicio, (p ->> 'duracao_min')::int,
      btrim(p ->> 'origem'), btrim(p ->> 'destino'), (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean,
      (p ->> 'carga')::app.tipo_carga,
      (p ->> 'pessoas_qtd')::int, nullif(btrim(p ->> 'equipamento_desc'), ''), (p ->> 'peso_kg')::numeric,
      nullif(btrim(p ->> 'dimensoes'), ''),
      (p ->> 'modalidade')::app.modalidade, (p ->> 'reboque')::app.reboque,
      nullif(btrim(p ->> 'contato_nome'), ''), nullif(btrim(p ->> 'contato_telefone'), ''),
      nullif(p ->> 'observacoes', ''), v_prazo,
      (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric,
      (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric,
      p ->> 'origem_place_id', p ->> 'destino_place_id',
      v_categoria, v_agora)
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
                       'expiradas', v_expiradas, 'categoria', v_categoria, 'agora', v_agora));
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Orçamento: preço da categoria, veículo, ajuste do motorista e validade do "Agora".
------------------------------------------------------------------------------------------------

-- Linhas da tabela do pedido: com categoria, o preço da categoria (fallback: os campos atuais do contrato); sem
-- categoria, o cálculo de hoje. `e` já vem sem as chaves da corrida.
create function interno.linhas_do_pedido(c app.contratos_versoes, a app.atividades, e jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when a.categoria is not null
              then interno.linhas_da_categoria(c, a.levar, a.trazer, a.categoria, e)
              else interno.calcular_linhas(c, a.levar, a.trazer, a.modalidade, e) end
$$;

-- Entrada sem as chaves da corrida (veiculo_id, ajuste_cent, ajuste_motivo), que não entram no cálculo.
create function interno.entrada_sem_corrida(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'object' then p - 'veiculo_id' - 'ajuste_cent' - 'ajuste_motivo' else p end
$$;

-- Validade do orçamento: no "Agora", 15 min para o cliente confirmar; senão, a do contrato. Nunca passa do início.
create function interno.validade_orcamento(c app.contratos_versoes, a app.atividades) returns timestamptz
language sql stable set search_path = '' as $$
  select case when a.agora then least(now() + interval '15 minutes', a.inicio)
              else least(now() + make_interval(hours => c.validade_orcamento_horas), a.inicio) end
$$;

-- Prévia (corpo de 20261009130200_orcamentos.sql). fase 4: mesmo cálculo do envio (categoria) e mesma validade.
create or replace function api.calcular_orcamento(p_atividade uuid, p jsonb)
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
  r := interno.linhas_do_pedido(c, a, interno.entrada_sem_corrida(p));
  if not (r ->> 'ok')::boolean then
    return interno.negar('CALCULAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  return r || jsonb_build_object('valido_ate', interno.validade_orcamento(c, a));
end $$;

-- Corpo de 20261009141000_endurecimento_saldo.sql. fase 4: chaves da corrida em p (opcionais):
--   veiculo_id: obrigatório no pedido com categoria (ATIVO, do motorista do pedido e da categoria); opcional sem
--     categoria (se vier, ATIVO e do motorista). Gravado em atividades.veiculo_id;
--   ajuste_cent (texto inteiro com sinal) e ajuste_motivo (3 a 200): a linha AJUSTE_MOTORISTA, de −metade (arredondada
--     meio para cima, como as linhas) a +100% do total da tabela, entra nas linhas e no total ANTES do hash.
-- p é guardado inteiro em orcamentos.entrada (memória do que o motorista mandou).
create or replace function api.enviar_orcamento(p_atividade uuid, p jsonb, p_horario_sugerido timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  teto_cent constant bigint := 100000000000;  -- R$ 1 bilhão, o mesmo de interno.calcular_linhas
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contratos_versoes;
  o app.orcamentos;
  r jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_veiculo uuid;
  v_ajuste bigint := 0;
  v_motivo text;
  v_tabela bigint;
  v_min bigint;
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
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

  -- fase 4: ajuste e motivo
  if coalesce(jsonb_typeof(p -> 'ajuste_cent'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'ajuste_cent') in ('string', 'number') and (p ->> 'ajuste_cent') ~ '^[+-]?[0-9]{1,12}$' then
      v_ajuste := (p ->> 'ajuste_cent')::bigint;
    else
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
        jsonb_build_object('invalidos', jsonb_build_array('ajuste_cent')));
    end if;
  end if;
  if v_ajuste <> 0 then
    if coalesce(jsonb_typeof(p -> 'ajuste_motivo'), 'null') <> 'string'
       or char_length(btrim(p ->> 'ajuste_motivo')) not between 3 and 200 then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'MOTIVO_INVALIDO');
    end if;
    v_motivo := btrim(p ->> 'ajuste_motivo');
  end if;
  -- fase 4: veículo
  if coalesce(jsonb_typeof(p -> 'veiculo_id'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'veiculo_id') <> 'string'
       or (p ->> 'veiculo_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VEICULO_INVALIDO');
    end if;
    v_veiculo := (p ->> 'veiculo_id')::uuid;
  end if;
  if (a.categoria is not null and v_veiculo is null)
     or (v_veiculo is not null
         and not exists (select 1 from app.veiculos x
                          where x.id = v_veiculo and x.situacao = 'ATIVO' and x.motorista_id = a.motorista_id
                            and (a.categoria is null or a.categoria = any (x.categorias)))) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VEICULO_INVALIDO',
      jsonb_build_object('veiculo_id', v_veiculo, 'categoria', a.categoria));
  end if;

  select * into c from interno.contrato_vigente(a.empresa_id);
  r := interno.linhas_do_pedido(c, a, interno.entrada_sem_corrida(p));
  if not (r ->> 'ok')::boolean then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  if p_horario_sugerido is not null
     and (p_horario_sugerido <= now() or p_horario_sugerido > now() + interval '366 days') then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('horario_sugerido')));
  end if;

  -- fase 4: o ajuste entra nas linhas e no total (antes do hash).
  v_tabela := (r ->> 'total_cent')::bigint;
  if v_ajuste <> 0 then
    v_min := -interno.arred(v_tabela / 2.0);
    if v_ajuste < v_min or v_ajuste > v_tabela then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'AJUSTE_FORA_DO_LIMITE',
        jsonb_build_object('ajuste_cent', v_ajuste, 'tabela_cent', v_tabela, 'min_cent', v_min, 'max_cent', v_tabela));
    end if;
    if v_tabela + v_ajuste > teto_cent then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VALOR_FORA_DO_LIMITE');
    end if;
    r := jsonb_set(jsonb_set(r, '{linhas}', (r -> 'linhas') || jsonb_build_array(interno.linha_orcamento(
           'AJUSTE_MOTORISTA', v_motivo, 1, v_ajuste, null, null, v_ajuste))),
         '{total_cent}', to_jsonb(v_tabela + v_ajuste));
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
  o.valido_ate := interno.validade_orcamento(c, a);
  o.horario_sugerido := p_horario_sugerido;
  o.status := 'PENDENTE';
  o.enviado_por := v.usuario_id;
  o.enviado_em := now();
  o.hash := interno.hash_orcamento(o, a);
  insert into app.orcamentos select o.*;

  update app.atividades set veiculo_id = v_veiculo where id = a.id and veiculo_id is distinct from v_veiculo;
  perform interno.transicionar(a.id, 'ORCADA', null);
  update app.agenda_blocos set expira_em = o.valido_ate where atividade_id = a.id and ativo;

  perform interno.auditar('ENVIAR_ORCAMENTO', v_alvo, 'OK', null,
    jsonb_build_object('orcamento_id', o.id, 'versao', o.versao, 'modalidade', o.modalidade, 'total_cent', o.total_cent,
                       'contrato_versao', o.contrato_versao, 'valido_ate', o.valido_ate, 'hash', o.hash,
                       'categoria', a.categoria, 'veiculo_id', v_veiculo, 'tabela_cent', v_tabela,
                       'ajuste_cent', v_ajuste, 'ajuste_motivo', v_motivo));
  return jsonb_build_object('ok', true, 'orcamento_id', o.id, 'versao', o.versao, 'total_cent', o.total_cent,
                            'valido_ate', o.valido_ate);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Confirmação com centro de custo e avaliação.
------------------------------------------------------------------------------------------------

-- A aprovação de hoje (api.aprovar_orcamento: reserva, idempotência, travas) mais o centro de custo (texto livre, até
-- 80 caracteres, vazio = nulo), gravado só quando a aprovação dá certo. Repetição com a mesma chave devolve o resultado
-- original e não troca o centro de custo já gravado. Devolve o resultado da aprovação.
create function api.confirmar_corrida(p_atividade uuid, p_versao int, p_hash text, p_chave uuid,
                                      p_centro_custo text default null, p_dispositivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_cc text := nullif(btrim(coalesce(p_centro_custo, '')), '');
  r jsonb;
  n int;
begin
  if char_length(v_cc) > 80 then
    return interno.negar('CONFIRMAR_CORRIDA', v_alvo, 'CENTRO_CUSTO_INVALIDO');
  end if;
  r := api.aprovar_orcamento(p_atividade, p_versao, p_hash, p_chave, p_dispositivo);
  if coalesce((r ->> 'ok')::boolean, false) and v_cc is not null then
    update app.atividades set centro_custo = v_cc
     where id = p_atividade and status = 'AGENDADA' and centro_custo is null;
    get diagnostics n = row_count;
    if n > 0 then
      perform interno.auditar('CONFIRMAR_CORRIDA', v_alvo, 'OK', null,
        jsonb_build_object('centro_custo', v_cc, 'chave', p_chave));
    end if;
  end if;
  return r;
end $$;

-- Nota de 1 a 5 (e comentário opcional, até 500), uma vez só, no pedido concluído. Quem: o N1 ou o N2 dono. {ok}
create function api.avaliar(p_atividade uuid, p_nota int, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_com text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('AVALIAR', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('AVALIAR', v_alvo, 'SEM_PERMISSAO');
  end if;
  if p_nota is null or p_nota not between 1 and 5 then
    return interno.negar('AVALIAR', v_alvo, 'NOTA_INVALIDA');
  end if;
  if char_length(v_com) > 500 then
    return interno.negar('AVALIAR', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('AVALIAR', 30, interval '1 hour') then
    return interno.negar('AVALIAR', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if a.status <> 'CONCLUIDA' then
    return interno.negar('AVALIAR', v_alvo, 'STATUS_INVALIDO');
  end if;
  if a.avaliacao is not null then
    return interno.negar('AVALIAR', v_alvo, 'JA_AVALIADO');
  end if;
  update app.atividades set avaliacao = p_nota, avaliacao_comentario = v_com, avaliado_em = now() where id = a.id;
  perform interno.auditar('AVALIAR', v_alvo, 'OK', null, jsonb_build_object('nota', p_nota, 'comentario', v_com));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 5. Atraso do anterior (manual pelo ADM em informar_previsao; automático pela chegada prevista em enviar_posicao).
------------------------------------------------------------------------------------------------

-- A viagem `a` termina em p_fim. Se passar do início do próximo bloco que ocupa a agenda do mesmo motorista, o próximo
-- pedido fica com atraso_anterior_ate = p_fim; se voltar para antes, a marcação é limpa. Só remarca quando o valor
-- muda mais de 5 min (a posição chega a cada ~5 s). Marcação antiga em outro pedido (de uma previsão anterior) é
-- desfeita. Cada pedido alterado é avisado no tópico dele. {conflito, proximo_id}
create function interno.marcar_atraso(a app.atividades, p_fim timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ini timestamptz;
  prox app.agenda_blocos;
  pa app.atividades;
  r record;
  v_conflito boolean;
  v_atual timestamptz;
  v_novo timestamptz;
begin
  select lower(b.periodo) into v_ini from app.agenda_blocos b where b.atividade_id = a.id and b.ativo;
  v_ini := coalesce(v_ini, a.inicio);
  select * into prox from app.agenda_blocos b
   where b.motorista_id = a.motorista_id and b.ativo and b.atividade_id <> a.id
     and lower(b.periodo) >= v_ini and interno.bloco_ocupa(b)
   order by lower(b.periodo)
   limit 1;
  v_conflito := prox.id is not null and p_fim > lower(prox.periodo);

  for r in
    select x.id from app.atividades x
     where x.motorista_id = a.motorista_id and x.atraso_anterior_ate is not null
       and x.status in ('SOLICITADA', 'ORCADA', 'AGENDADA')
       and x.id <> a.id and x.id is distinct from prox.atividade_id
     order by x.id
  loop
    update app.atividades set atraso_anterior_ate = null where id = r.id returning * into pa;
    perform interno.publicar_atividade(pa, 'atraso');
  end loop;

  if prox.id is not null then
    select x.atraso_anterior_ate into v_atual from app.atividades x where x.id = prox.atividade_id;
    v_novo := case when v_conflito then p_fim end;
    if (v_novo is null and v_atual is not null)
       or (v_novo is not null and (v_atual is null or abs(extract(epoch from (v_novo - v_atual))) > 300)) then
      pa := null;
      update app.atividades set atraso_anterior_ate = v_novo
       where id = prox.atividade_id and status in ('SOLICITADA', 'ORCADA', 'AGENDADA')
      returning * into pa;
      if pa.id is not null then
        perform interno.publicar_atividade(pa, 'atraso');
      end if;
    end if;
  end if;
  return jsonb_build_object('conflito', v_conflito, 'proximo_id', prox.atividade_id);
end $$;

-- Corpo de 20261018120000_execucao.sql; a marcação do próximo passa a ser interno.marcar_atraso.
create or replace function api.informar_previsao(p_atividade uuid, p_fim timestamptz, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  meu app.agenda_blocos;
  prox app.agenda_blocos;
  r record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_agora timestamptz := clock_timestamp();
  v_fim_bloco timestamptz;
  v_marca jsonb;
  v_conflito boolean;
  v_proximo uuid;
begin
  if v.usuario_id is null then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('INFORMAR_PREVISAO', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if p_fim is null or p_fim <= v_agora or p_fim > v_agora + interval '24 hours' then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'PREVISAO_INVALIDA');
  end if;
  if length(v_motivo) > 200 then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('INFORMAR_PREVISAO', 30, interval '1 hour') then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  select * into meu from app.agenda_blocos b where b.atividade_id = a.id and b.ativo for update;
  if meu.id is null then
    raise exception 'atividade % EM_ANDAMENTO sem bloco ativo', a.id using errcode = 'XX001';
  end if;
  -- Pré-reservas vencidas que colidem com a extensão expiram agora (como no criar_pedido; ordem fixa de travas).
  for r in
    select b.atividade_id from app.agenda_blocos b
     where b.motorista_id = a.motorista_id and b.ativo and b.tipo = 'PRE_RESERVA' and b.expira_em <= now()
       and b.atividade_id <> a.id and b.periodo && tstzrange(lower(meu.periodo), p_fim, '[)')
     order by b.atividade_id
  loop
    perform interno.expirar_atividade(r.atividade_id);
  end loop;
  -- Próximo bloco ativo do motorista depois deste (o bloco desta viagem vai até ele, no máximo).
  select * into prox from app.agenda_blocos b
   where b.motorista_id = a.motorista_id and b.ativo and b.atividade_id <> a.id
     and lower(b.periodo) >= lower(meu.periodo)
   order by lower(b.periodo)
   limit 1;
  v_fim_bloco := greatest(least(p_fim, coalesce(lower(prox.periodo), 'infinity'::timestamptz)),
                          lower(meu.periodo) + interval '1 minute');

  begin
    update app.agenda_blocos set periodo = tstzrange(lower(periodo), v_fim_bloco, '[)') where id = meu.id;
  exception when exclusion_violation then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'HORARIO_OCUPADO');
  end;
  update app.atividades set fim_previsto = p_fim, atualizada_em = now() where id = a.id returning * into a;

  -- fase 4: a marcação do atraso no próximo pedido (a mesma do atraso automático).
  v_marca := interno.marcar_atraso(a, p_fim);
  v_conflito := (v_marca ->> 'conflito')::boolean;
  v_proximo := (v_marca ->> 'proximo_id')::uuid;
  perform interno.publicar_atividade(a, 'previsao');

  perform interno.auditar('INFORMAR_PREVISAO', v_alvo, 'OK', null,
    jsonb_build_object('fim_previsto', p_fim, 'fim_bloco', v_fim_bloco, 'motivo', nullif(v_motivo, ''),
                       'conflito', v_conflito, 'proximo_id', v_proximo));
  return jsonb_build_object('ok', true, 'fim_previsto', p_fim, 'conflito', v_conflito,
                            'proximo_id', case when v_conflito then v_proximo end,
                            'proximo_numero', case when v_conflito then
                              (select x.numero from app.atividades x where x.id = v_proximo) end);
end $$;

-- Corpo de 20261018120100_rastreio_fotos.sql. fase 4: com `eta` (chegada prevista ao destino), o fim previsto da
-- viagem é eta + o que resta da duração (duração − minutos desde a saída, no mínimo 0), nunca antes de uma previsão
-- informada pelo ADM; interno.marcar_atraso marca ou limpa o próximo pedido.
create or replace function api.enviar_posicao(p_atividade uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_lat numeric;
  v_lng numeric;
  v_precisao numeric;
  v_rumo numeric;
  v_vel numeric;
  v_seq int;
  v_eta timestamptz;
  v_fim timestamptz;
  ult app.posicoes;
  k text;
begin
  if v.usuario_id is null or v.papel <> 'MOTORISTA' then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade;
  if a.id is null or a.motorista_id <> v.usuario_id then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  foreach k in array array['lat', 'lng', 'precisao', 'rumo', 'velocidade'] loop
    if p ? k and jsonb_typeof(p -> k) not in ('number', 'null') then
      return interno.negar('ENVIAR_POSICAO', v_alvo, 'CAMPOS_INVALIDOS');
    end if;
  end loop;
  v_lat := (p ->> 'lat')::numeric;
  v_lng := (p ->> 'lng')::numeric;
  v_precisao := (p ->> 'precisao')::numeric;
  v_rumo := (p ->> 'rumo')::numeric;
  v_vel := (p ->> 'velocidade')::numeric;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or (v_precisao is not null and v_precisao not between 0 and 100)
     or (v_rumo is not null and v_rumo not between 0 and 360)
     or (v_vel is not null and v_vel not between 0 and 100) then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if p ? 'seq' then
    if jsonb_typeof(p -> 'seq') <> 'number' or not pg_input_is_valid(p ->> 'seq', 'integer') then
      return interno.negar('ENVIAR_POSICAO', v_alvo, 'CAMPOS_INVALIDOS');
    end if;
    v_seq := (p ->> 'seq')::int;
  end if;
  if p ? 'eta' and jsonb_typeof(p -> 'eta') <> 'null' then
    if jsonb_typeof(p -> 'eta') <> 'string' or not pg_input_is_valid(p ->> 'eta', 'timestamptz') then
      return interno.negar('ENVIAR_POSICAO', v_alvo, 'CAMPOS_INVALIDOS');
    end if;
    v_eta := (p ->> 'eta')::timestamptz;
    if v_eta < now() - interval '1 hour' or v_eta > now() + interval '24 hours' then
      v_eta := null;
    end if;
  end if;
  if not interno.checar_limite('ENVIAR_POSICAO', 20, interval '1 minute') then
    return interno.negar('ENVIAR_POSICAO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  select * into ult from app.posicoes x where x.atividade_id = a.id order by x.em desc, x.id desc limit 1;
  if ult.id is null or now() - ult.em >= interval '30 seconds'
     or interno.distancia_m(ult.lat, ult.lng, v_lat, v_lng) >= 200 then
    insert into app.posicoes (atividade_id, lat, lng, precisao, seq) values (a.id, v_lat, v_lng, v_precisao, v_seq);
  end if;
  perform realtime.send(
    jsonb_build_object('lat', v_lat, 'lng', v_lng, 'rumo', v_rumo, 'velocidade', v_vel, 'precisao', v_precisao,
                       'seq', v_seq, 'eta', v_eta, 'ts', now()),
    'posicao', 'rastreio:' || a.id::text, true);

  -- fase 4: atraso automático
  if v_eta is not null then
    v_fim := v_eta + make_interval(mins => greatest(
               a.duracao_min - floor(extract(epoch from (now() - coalesce(a.saiu_em, now()))) / 60)::int, 0));
    if a.fim_previsto is not null and a.fim_previsto > v_fim then
      v_fim := a.fim_previsto;
    end if;
    perform interno.marcar_atraso(a, v_fim);
  end if;
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Leituras.
------------------------------------------------------------------------------------------------

-- Corpo de 20261018120100_rastreio_fotos.sql. fase 4: categoria, veículo (a partir de ORCADA), centro de custo,
-- "Agora", avaliação, última posição gravada (quem vê o rastreio, em andamento) e a ação avaliar.
create or replace function api.pedido(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  o app.orcamentos;
  v_alvo text := 'atividade:' || coalesce(p_id::text, '-');
  v_vencido boolean;
  v_aberto boolean;
  v_detalhe jsonb;
  v_historico jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('VER_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_id;
  if not interno.pode_ver_atividade(v, a) then
    return interno.negar('VER_PEDIDO', v_alvo, 'NAO_ENCONTRADO');
  end if;
  o := interno.orcamento_vigente(a.id);
  v_vencido := interno.prazo_vencido(a.id);
  v_aberto := a.status in ('SOLICITADA', 'ORCADA') and not v_vencido;

  v_detalhe := jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'status', a.status, 'empresa_id', a.empresa_id,
    'empresa_nome', (select e.nome from app.empresas e where e.id = a.empresa_id),
    'solicitante_nome', (select pf.nome from app.perfis pf where pf.usuario_id = a.solicitante_id),
    'motorista_nome', (select pf.nome from app.perfis pf where pf.usuario_id = a.motorista_id),
    'inicio', a.inicio, 'duracao_min', a.duracao_min, 'origem', a.origem, 'destino', a.destino,
    'levar', a.levar, 'trazer', a.trazer, 'carga', a.carga, 'pessoas_qtd', a.pessoas_qtd,
    'equipamento_desc', a.equipamento_desc, 'peso_kg', a.peso_kg, 'dimensoes', a.dimensoes,
    'modalidade', a.modalidade, 'reboque', a.reboque, 'contato_nome', a.contato_nome,
    'contato_telefone', a.contato_telefone, 'observacoes', a.observacoes,
    'prazo_orcar_ate', a.prazo_orcar_ate, 'prazo_vencido', v_vencido,
    'criada_em', a.criada_em, 'atualizada_em', a.atualizada_em,
    -- fase 3A
    'origem_lat', a.origem_lat, 'origem_lng', a.origem_lng, 'destino_lat', a.destino_lat, 'destino_lng', a.destino_lng,
    'origem_place_id', a.origem_place_id, 'destino_place_id', a.destino_place_id,
    'trechos_km', case when a.levar and a.trazer then 2 else 1 end) || jsonb_build_object(
    -- fase 3B
    'saiu_em', a.saiu_em, 'concluiu_em', a.concluiu_em, 'fim_previsto', interno.fim_da_atividade(a),
    'previsao_informada', a.fim_previsto is not null, 'atraso_anterior_ate', a.atraso_anterior_ate,
    'km_rodados', a.km_rodados, 'observacao_conclusao', a.observacao_conclusao,
    'saida_liberada_em', a.inicio - interval '60 minutes',
    'pode_ver_rastreio', interno.pode_ver_rastreio(v, a),
    'fotos_qtd', (select count(*) from app.fotos f
                   where f.atividade_id = a.id and f.enviada_em is not null and f.apagada_em is null)) || jsonb_build_object(
    -- fase 4
    'categoria', a.categoria,
    'categoria_nome', (select k.nome from app.categorias k where k.codigo = a.categoria),
    'veiculo', case when a.status in ('ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA') then
                 (select jsonb_build_object('modelo', x.modelo, 'cor', x.cor, 'placa', x.placa)
                    from app.veiculos x where x.id = a.veiculo_id) end,
    'centro_custo', a.centro_custo, 'agora', a.agora, 'avaliacao', a.avaliacao,
    'ultima_posicao', case when a.status = 'EM_ANDAMENTO' and interno.pode_ver_rastreio(v, a) then
                        (select jsonb_build_object('lat', x.lat, 'lng', x.lng, 'em', x.em)
                           from app.posicoes x where x.atividade_id = a.id
                          order by x.em desc, x.id desc limit 1) end);

  select coalesce(jsonb_agg(jsonb_build_object('de', h.de, 'para', h.para, 'em', h.em, 'observacao', h.observacao,
                                               'por_nome', pf.nome) order by h.id), '[]')
    into v_historico
    from app.atividade_historico h
    left join app.perfis pf on pf.usuario_id = h.por
   where h.atividade_id = a.id;

  return jsonb_build_object(
    'ok', true,
    'pedido', v_detalhe,
    'historico', v_historico,
    'orcamento', interno.orcamento_para(v, o),
    'orcamento_anterior', interno.orcamento_anterior(v, a),
    'acoes', jsonb_build_object(
      'orcar', a.status = 'SOLICITADA' and not v_vencido and interno.pode_orcar(v, a),
      'recusar', a.status = 'SOLICITADA' and not v_vencido and interno.pode_orcar(v, a),
      'pedir_revisao', a.status = 'ORCADA' and not v_vencido and interno.pode_decidir(v, a),
      'reprovar', a.status = 'ORCADA' and not v_vencido and interno.pode_decidir(v, a),
      'cancelar', v_aberto and (interno.pode_decidir(v, a) or interno.pode_orcar(v, a)),
      'aprovar', a.status = 'ORCADA' and not v_vencido and o.id is not null and o.status = 'PENDENTE'
                 and o.valido_ate > now() and interno.pode_decidir(v, a),
      'cancelar_agendado', a.status = 'AGENDADA' and (interno.pode_decidir(v, a) or interno.pode_orcar(v, a)),
      -- fase 3B: o banco confere de novo (janela, outra viagem em andamento) nas RPCs
      'sair', a.status = 'AGENDADA' and interno.pode_orcar(v, a),
      'informar_previsao', a.status = 'EM_ANDAMENTO' and interno.pode_orcar(v, a),
      'concluir', a.status = 'EM_ANDAMENTO' and interno.pode_orcar(v, a),
      'enviar_fotos', interno.pode_enviar_foto(v, a),
      -- fase 4
      'avaliar', a.status = 'CONCLUIDA' and a.avaliacao is null and interno.pode_decidir(v, a)));
end $$;

-- Corpo de 20261018120000_execucao.sql. fase 4: cada item com categoria_nome e agora.
create or replace function api.pendencias()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_equipe boolean;
  v_precos boolean;
  r_orcar jsonb;
  r_aprovar jsonb;
  r_proximos jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('VER_PENDENCIAS', 'pendencias', 'SEM_PERMISSAO');
  end if;
  v_equipe := v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA');
  v_precos := v.papel in ('ADM', 'MOTORISTA', 'CLIENTE');

  select coalesce(jsonb_agg(x.item order by x.prazo, x.numero), '[]') into r_orcar
  from (
    select a.prazo_orcar_ate as prazo, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino, 'prazo', a.prazo_orcar_ate,
             'urgente', a.prazo_orcar_ate - now() <= make_interval(hours => coalesce(interno.limiar_urgente(a), 0)),
             'revisao', exists (select 1 from app.atividade_historico h
                                 where h.atividade_id = a.id and h.de = 'ORCADA' and h.para = 'SOLICITADA'),
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    left join app.categorias k on k.codigo = a.categoria
    where a.status = 'SOLICITADA'
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
      and not interno.prazo_vencido(a.id)
    order by a.prazo_orcar_ate, a.numero
    limit 200
  ) x;

  select coalesce(jsonb_agg(x.item order by x.prazo, x.numero), '[]') into r_aprovar
  from (
    select o.valido_ate as prazo, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino, 'prazo', o.valido_ate,
             'urgente', o.valido_ate - now() <= make_interval(hours => coalesce((o.snapshot ->> 'limiar_urgente_horas')::int, 0)),
             'versao', o.versao,
             'total_cent', case when v_precos then o.total_cent end,
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    join app.orcamentos o on o.atividade_id = a.id and o.status = 'PENDENTE'
    left join app.categorias k on k.codigo = a.categoria
    where a.status = 'ORCADA'
      and v.papel <> 'MOTORISTA'
      and (v_equipe or a.empresa_id = v.empresa_id)
      and (v.papel in ('ADM', 'GESTOR_FROTA') or interno.pode_decidir(v, a))
      and not interno.prazo_vencido(a.id)
    order by o.valido_ate, a.numero
    limit 200
  ) x;

  -- EM_ANDAMENTO aparece sempre (atrasado ou não); AGENDADA até o fim previsto.
  select coalesce(jsonb_agg(x.item order by x.ordem, x.inicio, x.numero), '[]') into r_proximos
  from (
    select case when a.status = 'EM_ANDAMENTO' then 0 else 1 end as ordem, a.inicio, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino,
             'saiu_em', a.saiu_em, 'fim_previsto', interno.fim_da_atividade(a),
             'atrasado', a.status = 'EM_ANDAMENTO' and interno.fim_da_atividade(a) < now(),
             'atraso_anterior_ate', a.atraso_anterior_ate,
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    left join app.categorias k on k.codigo = a.categoria
    where (a.status = 'EM_ANDAMENTO'
           or (a.status = 'AGENDADA' and interno.fim_da_atividade(a) > now()))
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
    order by case when a.status = 'EM_ANDAMENTO' then 0 else 1 end, a.inicio, a.numero
    limit 50
  ) x;

  return jsonb_build_object('ok', true, 'aguardando_orcamento', r_orcar, 'aguardando_aprovacao', r_aprovar,
                            'proximos', r_proximos);
end $$;

-- Corpo de 20261009140000_saldo_livro_razao.sql. fase 4: cada lançamento ligado a um pedido traz o centro de custo
-- dele (todo cliente da empresa vê, como o nº do pedido e o solicitante; especificação §7).
create or replace function api.extrato(p_empresa uuid default null, p_filtro jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  f jsonb := coalesce(p_filtro, '{}');
  v_adm boolean;
  v_empresa uuid;
  inv text[] := '{}';
  v_tipos app.tipo_lancamento[];
  v_de timestamptz;
  v_ate timestamptz;
  v_limite int := 100;
  itens jsonb;
begin
  if v.usuario_id is null then
    return interno.negar('VER_EXTRATO', 'extrato', 'SEM_PERMISSAO');
  end if;
  v_adm := v.papel = 'ADM';
  if v_adm then
    v_empresa := p_empresa;
  elsif v.papel = 'CLIENTE' and v.empresa_id is not null and (p_empresa is null or p_empresa = v.empresa_id) then
    v_empresa := v.empresa_id;
  else
    return interno.negar('VER_EXTRATO', 'extrato', 'SEM_PERMISSAO');
  end if;
  if v_empresa is null or not exists (select 1 from app.empresas e where e.id = v_empresa) then
    return interno.negar('VER_EXTRATO', 'extrato', 'NAO_ENCONTRADO');
  end if;

  if jsonb_typeof(f) <> 'object' then
    inv := array_append(inv, 'p_filtro');
  else
    if exists (select 1 from jsonb_object_keys(f) k where k not in ('de', 'ate', 'tipos', 'limite')) then
      inv := array_append(inv, 'p_filtro');
    end if;
    if coalesce(jsonb_typeof(f -> 'tipos'), 'null') <> 'null' then
      if jsonb_typeof(f -> 'tipos') = 'array' and jsonb_array_length(f -> 'tipos') between 1 and 8
         and not exists (select 1 from jsonb_array_elements(f -> 'tipos') x
                          where jsonb_typeof(x) <> 'string'
                             or not ((x #>> '{}') = any (enum_range(null::app.tipo_lancamento)::text[]))) then
        select array_agg(distinct (x #>> '{}')::app.tipo_lancamento) into v_tipos
          from jsonb_array_elements(f -> 'tipos') x;
      else
        inv := array_append(inv, 'tipos');
      end if;
    end if;
    if coalesce(jsonb_typeof(f -> 'de'), 'null') <> 'null' then
      if jsonb_typeof(f -> 'de') = 'string' and pg_input_is_valid(f ->> 'de', 'timestamptz') then
        v_de := (f ->> 'de')::timestamptz;
      else
        inv := array_append(inv, 'de');
      end if;
    end if;
    if coalesce(jsonb_typeof(f -> 'ate'), 'null') <> 'null' then
      if jsonb_typeof(f -> 'ate') = 'string' and pg_input_is_valid(f ->> 'ate', 'timestamptz') then
        v_ate := (f ->> 'ate')::timestamptz;
      else
        inv := array_append(inv, 'ate');
      end if;
    end if;
    if v_de is not null and v_ate is not null and v_ate <= v_de then
      inv := array_append(inv, 'periodo');
    end if;
    if coalesce(jsonb_typeof(f -> 'limite'), 'null') <> 'null' then
      if jsonb_typeof(f -> 'limite') = 'number' and (f ->> 'limite') ~ '^[0-9]{1,3}$'
         and (f ->> 'limite')::int between 1 and 500 then
        v_limite := (f ->> 'limite')::int;
      else
        inv := array_append(inv, 'limite');
      end if;
    end if;
  end if;
  if cardinality(inv) > 0 then
    return interno.negar('VER_EXTRATO', 'extrato', 'CAMPOS_INVALIDOS', jsonb_build_object('invalidos', to_jsonb(inv)));
  end if;

  select coalesce(jsonb_agg(x.item order by x.criado_em desc, x.id desc), '[]') into itens
  from (
    select l.criado_em, l.id,
      jsonb_build_object(
        'id', l.id, 'criado_em', l.criado_em, 'tipo', l.tipo, 'valor_cent', l.valor_cent,
        'efeito_contabil_cent', interno.efeito_contabil(l.tipo, l.valor_cent),
        'efeito_reservado_cent', interno.efeito_reservado(l.tipo, l.valor_cent),
        'numero', a.numero, 'solicitante_nome', ps.nome,
        'pode_abrir', interno.pode_ver_atividade(v, a),
        'atividade_id', case when interno.pode_ver_atividade(v, a) then a.id end,
        'estorna_id', l.estorna_id)
      || case when a.id is not null then jsonb_build_object('centro_custo', a.centro_custo) else '{}'::jsonb end
      || case when v_adm then jsonb_build_object('motivo', l.motivo, 'comprovante', l.comprovante,
                                                 'criado_por_nome', pc.nome)
         else '{}'::jsonb end as item
    from app.lancamentos l
    left join app.atividades a on a.id = l.atividade_id
    left join app.perfis ps on ps.usuario_id = a.solicitante_id
    left join app.perfis pc on pc.usuario_id = l.criado_por
    where l.empresa_id = v_empresa
      and (v_tipos is null or l.tipo = any (v_tipos))
      and (v_de is null or l.criado_em >= v_de)
      and (v_ate is null or l.criado_em < v_ate)
    order by l.criado_em desc, l.id desc
    limit v_limite
  ) x;
  return jsonb_build_object('ok', true, 'empresa_id', v_empresa, 'itens', itens);
end $$;

------------------------------------------------------------------------------------------------
-- 7. Privilégios (create or replace mantém os existentes; as funções novas nascem fechadas).
------------------------------------------------------------------------------------------------
revoke all on function
  interno.linhas_do_pedido(app.contratos_versoes, app.atividades, jsonb),
  interno.entrada_sem_corrida(jsonb),
  interno.validade_orcamento(app.contratos_versoes, app.atividades),
  interno.marcar_atraso(app.atividades, timestamptz)
from public, anon, authenticated;
revoke all on function
  api.confirmar_corrida(uuid, int, text, uuid, text, text),
  api.avaliar(uuid, int, text)
from public, anon, authenticated, service_role;
grant execute on function
  api.confirmar_corrida(uuid, int, text, uuid, text, text),
  api.avaliar(uuid, int, text)
to authenticated;
