-- Fase 3A, dentro dos termos do Google (decisão do dono, 2026-10-15). Google Maps Platform Service Specific Terms,
-- itens 14.3 (Places API) e 19.3 (Routes API): coordenadas só podem ficar em cache por até 30 dias seguidos; o
-- place_id pode ser guardado. A partir daqui:
--   ponto do Google: o pedido e os locais da empresa guardam só o place_id;
--   ponto marcado no mapa pela pessoa: as coordenadas dela;
--   endereço formatado e km/minutos da rota não são guardados (a rota é calculada na hora, pela função `enderecos`).
-- Corrige 20261015120000_mapas_enderecos.sql e 20261015120100_locais_empresa.sql, que já estão em produção (não são
-- editadas). Em produção não há dados do Google ainda (a chave foi criada depois do deploy); a limpeza abaixo é
-- só garantia.

------------------------------------------------------------------------------------------------
-- 1. Pedidos: sem coordenadas de ponto do Google, sem endereço formatado e sem km/minutos da rota.
------------------------------------------------------------------------------------------------
update app.atividades set origem_lat = null, origem_lng = null where origem_place_id is not null and origem_lat is not null;
update app.atividades set destino_lat = null, destino_lng = null where destino_place_id is not null and destino_lat is not null;

alter table app.atividades
  drop constraint atividades_km_est,
  drop constraint atividades_min_est,
  drop constraint atividades_enderecos,
  drop column origem_endereco,
  drop column destino_endereco,
  drop column km_estimado,
  drop column minutos_estimados,
  -- Um lado tem place_id (Google) OU coordenadas (ponto marcado no mapa), nunca os dois.
  add constraint atividades_origem_google check (origem_place_id is null or origem_lat is null),
  add constraint atividades_destino_google check (destino_place_id is null or destino_lat is null);

------------------------------------------------------------------------------------------------
-- 2. Locais da empresa: do Google, só nome e place_id; marcado no mapa, nome e coordenadas.
------------------------------------------------------------------------------------------------
update app.locais_empresa set lat = null, lng = null where place_id is not null;

alter table app.locais_empresa
  drop column endereco,
  alter column lat drop not null,
  alter column lng drop not null,
  add constraint locais_empresa_par check ((lat is null) = (lng is null)),
  add constraint locais_empresa_tipo check ((place_id is null) <> (lat is null));

drop function interno.guardar_local(uuid, text, text, numeric, numeric, text);
create function interno.guardar_local(p_empresa uuid, p_nome text, p_lat numeric, p_lng numeric, p_place text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_empresa is null or coalesce(p_nome, '') = '' or (p_place is null and (p_lat is null or p_lng is null)) then
    return;
  end if;
  insert into app.locais_empresa (empresa_id, nome, lat, lng, place_id, chave)
  values (p_empresa, left(p_nome, 200),
          case when p_place is null then p_lat end, case when p_place is null then p_lng end, p_place,
          coalesce(p_place, left(lower(p_nome), 200) || '@' || round(p_lat, 5) || ',' || round(p_lng, 5)))
  -- O primeiro registro vale: outro pedido com o mesmo place_id só soma uso (o nome vem do cliente e não pode
  -- reescrever o local que o resto da empresa usa).
  on conflict (empresa_id, chave) do update
    set usos = app.locais_empresa.usos + 1, ultimo_uso = now();
end $$;

create or replace function api.locais_da_empresa(p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  t text;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'SEM_PERMISSAO');
  end if;
  if char_length(coalesce(p_texto, '')) > 120 then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('LOCAIS_DA_EMPRESA', 600, interval '1 hour') then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'LIMITE_EXCEDIDO');
  end if;
  -- Curingas do LIKE viram texto comum.
  t := replace(replace(replace(interno.sem_acento(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_');
  return jsonb_build_object('ok', true, 'locais', coalesce((
    select jsonb_agg(jsonb_build_object('nome', l.nome, 'lat', l.lat, 'lng', l.lng, 'place_id', l.place_id)
                     order by l.usos desc, l.ultimo_uso desc, l.id)
    from (select x.* from app.locais_empresa x
          where x.empresa_id = v.empresa_id
            and (t = '' or interno.sem_acento(x.nome) like '%' || t || '%')
          order by x.usos desc, x.ultimo_uso desc, x.id
          limit 5) l), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------------------------
-- 3. Validação, criação e detalhe do pedido (corpos de 20261015120000 e 20261015120100 sem os campos removidos;
--    o detalhe diz quantos trechos o km do orçamento cobre: 2 em ida e volta).
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
                                     'destino_place_id'];
  desconhecidos text[];
  ausentes text[];
  inv text[] := '{}';
  v_carga text;
  v_pessoas boolean;
  v_equip boolean;
  v_inicio timestamptz;
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
      observacoes, prazo_orcar_ate,
      origem_lat, origem_lng, destino_lat, destino_lng, origem_place_id, destino_place_id)
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
      p ->> 'origem_place_id', p ->> 'destino_place_id')
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
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;

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
    -- O km da rota é de um trecho; com Levar e Trazer o km do orçamento é ida e volta (o dobro).
    'trechos_km', case when a.levar and a.trazer then 2 else 1 end);

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
      -- fase 2B: aprovar (dono N2 ou N1; orçamento vigente dentro da validade) e cancelar AGENDADA (cliente com multa,
      -- prestador sem custo). O banco confere tudo de novo nas RPCs; aqui só orienta a tela.
      'aprovar', a.status = 'ORCADA' and not v_vencido and o.id is not null and o.status = 'PENDENTE'
                 and o.valido_ate > now() and interno.pode_decidir(v, a),
      'cancelar_agendado', a.status = 'AGENDADA' and (interno.pode_decidir(v, a) or interno.pode_orcar(v, a))));
end $$;

------------------------------------------------------------------------------------------------
-- 4. Privilégios (create or replace mantém os existentes; a função nova nasce fechada).
------------------------------------------------------------------------------------------------
revoke execute on function interno.guardar_local(uuid, text, numeric, numeric, text) from public, anon, authenticated;
