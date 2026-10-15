-- Fase 3A (docs/fases/fase-3a-desenho-enderecos-previa.md §5): os locais já usados pela empresa aparecem primeiro na
-- busca de endereços, sem custo de Google. Grava só o api.criar_pedido; lê só o api.locais_da_empresa (cliente N1, N2
-- e N3 da própria empresa). A equipe da IVO não usa essa busca.

create extension if not exists unaccent with schema extensions;

------------------------------------------------------------------------------------------------
-- 1. Tabela.
------------------------------------------------------------------------------------------------
create table app.locais_empresa (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references app.empresas (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 200),
  -- Local do Google: só o place_id (termos do Google). Ponto marcado no mapa: as coordenadas da própria pessoa.
  lat numeric(9,6) check (lat between -90 and 90),
  lng numeric(9,6) check (lng between -180 and 180),
  place_id text check ((place_id ~ '^[A-Za-z0-9_-]+$' and char_length(place_id) <= 300)),
  -- place_id; sem ele (ponto marcado no mapa), nome em minúsculas + lat/lng com 5 casas.
  chave text not null check (char_length(chave) <= 400),
  usos int not null default 1 check (usos > 0),
  ultimo_uso timestamptz not null default now(),
  unique (empresa_id, chave),
  check ((lat is null) = (lng is null)),
  check ((place_id is null) <> (lat is null))
);
create index locais_empresa_uso on app.locais_empresa (empresa_id, usos desc, ultimo_uso desc);
alter table app.locais_empresa enable row level security;
-- Sem GRANT a authenticated: leitura por api.locais_da_empresa, escrita só por api.criar_pedido.

------------------------------------------------------------------------------------------------
-- 2. Gravação (chamada pelo criar_pedido) e busca.
------------------------------------------------------------------------------------------------
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

-- Sem acento e sem caixa. O dicionário vai explícito porque, com search_path vazio, unaccent(text) não o acha.
create function interno.sem_acento(t text) returns text
language sql stable set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

create function api.locais_da_empresa(p_texto text)
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
-- 3. criar_pedido (corpo de 20261015120000_mapas_enderecos.sql, guardando os dois locais).
------------------------------------------------------------------------------------------------
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

------------------------------------------------------------------------------------------------
-- 4. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.guardar_local(uuid, text, numeric, numeric, text),
  interno.sem_acento(text)
from public, anon, authenticated;
revoke all on function api.locais_da_empresa(text) from public, anon, authenticated, service_role;
grant execute on function api.locais_da_empresa(text) to authenticated;
