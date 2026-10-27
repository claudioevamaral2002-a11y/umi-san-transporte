-- v2.2, Tarefa 1 (docs/fases/v2-2-correcoes-auditoria-desenho.md §4.2 a §4.6 e §6): leituras e ações pequenas.
--   * api.agenda ganha `concluidas`: as atividades EM_ANDAMENTO ou CONCLUIDA com início no período pedido, que quem
--     chama pode ver (interno.pode_ver_atividade: o motorista as dele, o N2 as próprias, o N1/N3 as da empresa, a
--     equipe todas). Os blocos continuam como antes;
--   * locais da empresa: api.locais_empresa_todos() (cliente de qualquer nível), api.renomear_local e api.excluir_local
--     (só o N1 da empresa do local; o id de outra empresa → NAO_ENCONTRADO; nome repetido → JA_EXISTE). Excluir um
--     local não mexe em pedido nenhum;
--   * api.contato_ivo() (qualquer perfil ativo) e api.ajuda_cliente() (cliente; regras do contrato vigente);
--   * api.acoes_auditoria(): as ações distintas da auditoria com a contagem (só quem vê a auditoria), com índice;
--   * api.meus_pedidos: cada item ganha `multa_cent`; api.pedido ganha `cobranca` (nula para o motorista).
-- Todas as mudanças de resposta são chaves novas. Corpos copiados das últimas versões (agenda: 20261009132000;
-- meus_pedidos: 20261022120100; pedido: 20261023120300), salvo os trechos marcados com "v2.2".

------------------------------------------------------------------------------------------------
-- 1. Agenda (corpo de 20261009132000_revisao_2a.sql) + concluidas.
------------------------------------------------------------------------------------------------
create or replace function api.agenda(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_equipe boolean;
  v_motorista uuid;
  blocos jsonb;
  v_concluidas jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('VER_AGENDA', 'agenda', 'SEM_PERMISSAO');
  end if;
  if p_de is null or p_ate is null or p_ate <= p_de or p_ate - p_de > interval '62 days' then
    return interno.negar('VER_AGENDA', 'agenda', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('periodo')));
  end if;
  v_equipe := v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA');
  v_motorista := interno.motorista_padrao();

  select coalesce(jsonb_agg(x.item order by x.ini, x.id), '[]') into blocos
  from (
    select lower(b.periodo) as ini, b.id,
      case when v_equipe or interno.pode_ver_atividade(v, a) then
        jsonb_build_object(
          'inicio', lower(b.periodo), 'fim', upper(b.periodo), 'ocupado', true, 'tipo', b.tipo,
          'expira_em', case when b.tipo = 'PRE_RESERVA' then b.expira_em end,
          'atividade_id', a.id, 'numero', a.numero, 'status', a.status, 'origem', a.origem, 'destino', a.destino,
          'propria_empresa', a.empresa_id is not distinct from v.empresa_id,
          'pode_abrir', interno.pode_ver_atividade(v, a))
        || case when v_equipe then jsonb_build_object(
             'empresa_id', a.empresa_id, 'empresa_nome', e.nome, 'motorista_id', b.motorista_id,
             'motorista_nome', pf.nome)
           else '{}'::jsonb end
      else
        jsonb_build_object('inicio', lower(b.periodo), 'fim', upper(b.periodo), 'ocupado', true)
      end as item
    from app.agenda_blocos b
    join app.atividades a on a.id = b.atividade_id
    join app.empresas e on e.id = a.empresa_id
    left join app.perfis pf on pf.usuario_id = b.motorista_id
    where interno.bloco_ocupa(b)
      and b.periodo && tstzrange(p_de, p_ate, '[)')
      and (v_equipe or a.empresa_id = v.empresa_id or b.motorista_id = v_motorista)
    order by lower(b.periodo), b.id
    limit 2000
  ) x;
  -- v2.2: as corridas em andamento e concluídas que começam no período (o bloco delas já não ocupa a agenda), só as
  -- que quem chama pode ver.
  select coalesce(jsonb_agg(x.item order by x.inicio, x.numero), '[]') into v_concluidas
  from (
    select a.inicio, a.numero,
      jsonb_build_object('id', a.id, 'numero', a.numero, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
                         'origem', a.origem, 'destino', a.destino, 'categoria_nome', k.nome, 'status', a.status) as item
    from app.atividades a
    left join app.categorias k on k.codigo = a.categoria
    where a.status in ('EM_ANDAMENTO', 'CONCLUIDA')
      and a.inicio >= p_de and a.inicio < p_ate
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
    order by a.inicio, a.numero
    limit 500
  ) x;
  return jsonb_build_object('ok', true, 'blocos', blocos, 'concluidas', v_concluidas);
end $$;

------------------------------------------------------------------------------------------------
-- 2. Lista de pedidos (corpo de 20261022120100_paradas_pedido.sql) + multa_cent.
------------------------------------------------------------------------------------------------
create or replace function api.meus_pedidos(p_filtro jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  f jsonb := coalesce(p_filtro, '{}');
  inv text[] := '{}';
  v_status app.status_atividade[];
  v_de timestamptz;
  v_ate timestamptz;
  v_limite int := 100;
  v_equipe boolean;
  v_precos boolean;
  itens jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('LISTAR_PEDIDOS', 'pedidos', 'SEM_PERMISSAO');
  end if;
  if jsonb_typeof(f) <> 'object' then
    inv := array_append(inv, 'p_filtro');
  else
    if exists (select 1 from jsonb_object_keys(f) k where k not in ('status', 'de', 'ate', 'limite')) then
      inv := array_append(inv, 'p_filtro');
    end if;
    if coalesce(jsonb_typeof(f -> 'status'), 'null') <> 'null' then
      if jsonb_typeof(f -> 'status') = 'array' and jsonb_array_length(f -> 'status') between 1 and 9
         and not exists (select 1 from jsonb_array_elements(f -> 'status') x
                          where jsonb_typeof(x) <> 'string'
                             or not ((x #>> '{}') = any (enum_range(null::app.status_atividade)::text[]))) then
        select array_agg(distinct (x #>> '{}')::app.status_atividade) into v_status
          from jsonb_array_elements(f -> 'status') x;
      else
        inv := array_append(inv, 'status');
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
    return interno.negar('LISTAR_PEDIDOS', 'pedidos', 'CAMPOS_INVALIDOS', jsonb_build_object('invalidos', to_jsonb(inv)));
  end if;

  v_equipe := v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA');
  v_precos := v.papel in ('ADM', 'MOTORISTA', 'CLIENTE');
  select coalesce(jsonb_agg(x.item order by x.inicio desc, x.numero desc), '[]') into itens
  from (
    select a.inicio, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino, 'levar', a.levar, 'trazer', a.trazer, 'modalidade', a.modalidade,
             'total_cent', case when v_precos then o.total_cent end,
             'prazo_orcar_ate', case when a.status = 'SOLICITADA' then a.prazo_orcar_ate end,
             'valido_ate', case when a.status = 'ORCADA' then o.valido_ate end,
             'prazo_vencido', interno.prazo_vencido(a.id),
             'empresa_nome', case when v_equipe then e.nome end,
             -- 4.1
             'paradas', interno.paradas_textos(a.id),
             -- v2.2: a multa cobrada (positiva), ou nula; só para quem vê valores do cliente (ADM e cliente)
             'multa_cent', case when v.papel in ('ADM', 'CLIENTE') then
                             (select nullif(sum(-l.valor_cent), 0) from app.lancamentos l
                               where l.atividade_id = a.id and l.tipo = 'MULTA') end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    left join lateral interno.orcamento_vigente(a.id) o on true
    where (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
      and (v_status is null or a.status = any (v_status))
      and (v_de is null or a.inicio >= v_de)
      and (v_ate is null or a.inicio < v_ate)
    order by a.inicio desc, a.numero desc
    limit v_limite
  ) x;
  return jsonb_build_object('ok', true, 'itens', itens);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Detalhe do pedido (corpo de 20261023120300_pedido_diarias_categorias.sql) + cobranca.
------------------------------------------------------------------------------------------------
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
                          order by x.em desc, x.id desc limit 1) end) || jsonb_build_object(
    -- fase 4, T10
    -- R18: em CONCLUIDA, só nas 24 h depois da conclusão (minimização LGPD)
    'motorista_telefone', case when a.status in ('AGENDADA', 'EM_ANDAMENTO')
                                 or (a.status = 'CONCLUIDA' and a.concluiu_em > now() - interval '24 hours') then
                            (select nullif(btrim(pf.telefone), '') from app.perfis pf
                              where pf.usuario_id = a.motorista_id) end) || jsonb_build_object(
    -- 4.1
    'paradas', coalesce((select jsonb_agg(jsonb_build_object('texto', x.texto, 'place_id', x.place_id,
                                                             'lat', x.lat, 'lng', x.lng) order by x.ordem)
                           from app.atividades_paradas x where x.atividade_id = a.id), '[]'::jsonb),
    'horas_estimadas', a.horas_estimadas) || jsonb_build_object(
    -- v2.1
    'diarias_estimadas', a.diarias_estimadas, 'outros_custos', a.outros_custos, 'volta_a_origem', a.volta_a_origem,
    -- a forma de cobrança é da empresa: o motorista não a recebe
    'forma_cobranca', case when v.papel <> 'MOTORISTA' then interno.forma_cobranca(a.empresa_id) end);

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
    -- v2.2: o que foi cobrado e devolvido (somas positivas; nulo quando zero). Só o ADM e o cliente (nula para o
    -- motorista e o gestor de frota, que não veem valores do cliente).
    'cobranca', case when v.papel in ('ADM', 'CLIENTE') then
                  (select jsonb_build_object(
                            'debito_cent', nullif(coalesce(sum(-l.valor_cent) filter (where l.tipo = 'DEBITO'), 0), 0),
                            'multa_cent', nullif(coalesce(sum(-l.valor_cent) filter (where l.tipo = 'MULTA'), 0), 0),
                            'liberado_cent', nullif(coalesce(sum(l.valor_cent) filter (where l.tipo = 'LIBERACAO_RESERVA'), 0), 0))
                     from app.lancamentos l
                    where l.atividade_id = a.id and l.tipo in ('DEBITO', 'MULTA', 'LIBERACAO_RESERVA')) end,
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


------------------------------------------------------------------------------------------------
-- 4. Locais salvos da empresa (app.locais_empresa, de 20261015120100 e 20261015140000).
------------------------------------------------------------------------------------------------

-- Todos os locais da empresa de quem chama (cliente de qualquer nível), os mais usados primeiro, até 200.
-- {ok, locais: [{id, nome, usos, ultimo_uso, place_id, lat, lng}]}
create function api.locais_empresa_todos()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null then
    return interno.negar('LOCAIS_EMPRESA_TODOS', 'locais', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LOCAIS_EMPRESA_TODOS', 300, interval '1 hour') then
    return interno.negar('LOCAIS_EMPRESA_TODOS', 'locais', 'LIMITE_EXCEDIDO');
  end if;
  return jsonb_build_object('ok', true, 'locais', coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'usos', l.usos, 'ultimo_uso', l.ultimo_uso,
                                        'place_id', l.place_id, 'lat', l.lat, 'lng', l.lng)
                     order by l.usos desc, l.ultimo_uso desc, l.id)
    from (select x.* from app.locais_empresa x
          where x.empresa_id = v.empresa_id
          order by x.usos desc, x.ultimo_uso desc, x.id
          limit 200) l), '[]'::jsonb));
end $$;

-- Só o N1 da empresa do local. A chave segue a regra de interno.guardar_local: do Google, o place_id (não muda com o
-- nome); marcado no mapa, nome em minúsculas + lat/lng com 5 casas (muda com o nome; se colidir → JA_EXISTE).
-- Recusas: SEM_PERMISSAO, LIMITE_EXCEDIDO, CAMPOS_INVALIDOS, NAO_ENCONTRADO (também o local de outra empresa),
-- JA_EXISTE. {ok}
create function api.renomear_local(p_id bigint, p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  l app.locais_empresa;
  v_alvo text := 'local:' || coalesce(p_id::text, '-');
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null or v.nivel <> 1 then
    return interno.negar('RENOMEAR_LOCAL', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('GERIR_LOCAIS', 60, interval '1 hour') then
    return interno.negar('RENOMEAR_LOCAL', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_id is null or char_length(v_nome) not between 2 and 80 then
    return interno.negar('RENOMEAR_LOCAL', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array(case when p_id is null then 'id' else 'nome' end)));
  end if;
  select * into l from app.locais_empresa x where x.id = p_id and x.empresa_id = v.empresa_id for update;
  if l.id is null then
    return interno.negar('RENOMEAR_LOCAL', v_alvo, 'NAO_ENCONTRADO');
  end if;
  begin
    update app.locais_empresa
       set nome = v_nome,
           chave = coalesce(l.place_id, left(lower(v_nome), 200) || '@' || round(l.lat, 5) || ',' || round(l.lng, 5))
     where id = l.id;
  exception when unique_violation then
    return interno.negar('RENOMEAR_LOCAL', v_alvo, 'JA_EXISTE', jsonb_build_object('nome', v_nome));
  end;
  perform interno.auditar('RENOMEAR_LOCAL', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', l.empresa_id, 'anterior', l.nome, 'nome', v_nome));
  return jsonb_build_object('ok', true);
end $$;

-- Só o N1 da empresa do local. Apaga o local (os pedidos guardam o próprio texto e não mudam).
-- Recusas: SEM_PERMISSAO, LIMITE_EXCEDIDO, CAMPOS_INVALIDOS, NAO_ENCONTRADO. {ok}
create function api.excluir_local(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  l app.locais_empresa;
  v_alvo text := 'local:' || coalesce(p_id::text, '-');
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null or v.nivel <> 1 then
    return interno.negar('EXCLUIR_LOCAL', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('GERIR_LOCAIS', 60, interval '1 hour') then
    return interno.negar('EXCLUIR_LOCAL', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_id is null then
    return interno.negar('EXCLUIR_LOCAL', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  delete from app.locais_empresa x where x.id = p_id and x.empresa_id = v.empresa_id returning * into l;
  if l.id is null then
    return interno.negar('EXCLUIR_LOCAL', v_alvo, 'NAO_ENCONTRADO');
  end if;
  perform interno.auditar('EXCLUIR_LOCAL', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', l.empresa_id, 'anterior', to_jsonb(l)));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 5. Contato da IVO e Ajuda do cliente.
------------------------------------------------------------------------------------------------

-- O contato da IVO (app.configuracao.contato_recarga) para qualquer perfil ativo. {ok, contato (nulo se vazio)}
create function api.contato_ivo()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null then
    return interno.negar('CONTATO_IVO', 'configuracao', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CONTATO_IVO', 300, interval '1 hour') then
    return interno.negar('CONTATO_IVO', 'configuracao', 'LIMITE_EXCEDIDO');
  end if;
  return jsonb_build_object('ok', true,
    'contato', (select c.contato_recarga from app.configuracao c where c.id));
end $$;

-- As regras do contrato vigente da empresa de quem chama (o que api.regras_do_servico já mostra ao cliente, mais a
-- forma de cobrança do painel). Só cliente. Recusas: SEM_PERMISSAO, LIMITE_EXCEDIDO, SEM_CONTRATO.
-- {ok, faixas_cancelamento (como no contrato), prazo_orcar_horas, validade_orcamento_horas, forma_cobranca}
create function api.ajuda_cliente()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null then
    return interno.negar('AJUDA_CLIENTE', 'contrato', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('AJUDA_CLIENTE', 300, interval '1 hour') then
    return interno.negar('AJUDA_CLIENTE', 'contrato', 'LIMITE_EXCEDIDO');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('AJUDA_CLIENTE', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  return jsonb_build_object('ok', true, 'faixas_cancelamento', c.faixas_cancelamento,
    'prazo_orcar_horas', c.prazo_orcar_horas, 'validade_orcamento_horas', c.validade_orcamento_horas,
    'forma_cobranca', c.forma_cobranca);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Ações da auditoria (para o filtro da tela Auditoria).
------------------------------------------------------------------------------------------------
create index if not exists auditoria_acao on app.auditoria (acao);

-- As ações distintas de app.auditoria com a contagem, por nome. Só quem vê a auditoria (o mesmo teste de
-- api.listar_auditoria). {ok, acoes: [{acao, total}]}
create function api.acoes_auditoria()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (select app.pode_fazer('VER_AUDITORIA')) then
    return interno.negar('ACOES_AUDITORIA', 'auditoria', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('ACOES_AUDITORIA', 120, interval '1 hour') then
    return interno.negar('ACOES_AUDITORIA', 'auditoria', 'LIMITE_EXCEDIDO');
  end if;
  return jsonb_build_object('ok', true, 'acoes', coalesce((
    select jsonb_agg(jsonb_build_object('acao', x.acao, 'total', x.total) order by x.acao)
      from (select a.acao, count(*) as total from app.auditoria a group by a.acao) x), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------------------------
-- 7. Privilégios: as substituídas ("create or replace") mantêm os seus; as novas nascem fechadas.
------------------------------------------------------------------------------------------------
revoke all on function api.locais_empresa_todos(), api.renomear_local(bigint, text), api.excluir_local(bigint),
  api.contato_ivo(), api.ajuda_cliente(), api.acoes_auditoria()
from public, anon, authenticated, service_role;
grant execute on function api.locais_empresa_todos(), api.renomear_local(bigint, text), api.excluir_local(bigint),
  api.contato_ivo(), api.ajuda_cliente(), api.acoes_auditoria()
to authenticated;
