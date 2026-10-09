-- Fase 2A, Task 3 (docs/fases/fase-2a-desenho-e-plano.md "Leituras" e "Tempo real"; especificação §5, §12.3;
-- Adendo A10):
--   * leituras por perfil, todas SECURITY DEFINER com checagem e lista explícita de campos (nada de select *):
--     meus_pedidos, pedido (detalhe + histórico + orçamento vigente com o snapshot filtrado por perfil), agenda
--     (cliente vê os blocos de outras empresas só como "ocupado"), horarios_livres e pendencias;
--   * tempo real: atividades publicam {id, status, em} em atividade:<id> e empresa:<empresa_id> (canais privados),
--     autorizados por app.pode_ver_topico; a prova da fase 0 (app.prova_canal e política prova_assinar) sai.
-- Ocupado = bloco ativo e (RESERVA ou pré-reserva ainda não vencida): pré-reserva vencida conta como livre mesmo
-- antes do cron. Leituras devolvem {ok:true, ...} ou {ok:false, codigo} (negação auditada, como nas escritas).
-- Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Quem vê o quê.
------------------------------------------------------------------------------------------------

-- Pedido visível: ADM e gestor de frota veem todos; motorista, os atribuídos; cliente N1/N3, os da empresa;
-- cliente N2, só os que criou.
create function interno.pode_ver_atividade(v app.perfis, a app.atividades) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(v.usuario_id is not null and a.id is not null
                  and (v.papel in ('ADM', 'GESTOR_FROTA')
                       or (v.papel = 'MOTORISTA' and a.motorista_id = v.usuario_id)
                       or (v.papel = 'CLIENTE' and v.empresa_id = a.empresa_id
                           and (v.nivel in (1, 3) or (v.nivel = 2 and a.solicitante_id = v.usuario_id)))), false)
$$;

-- Bloco que ocupa a agenda agora (pré-reserva vencida = livre, mesmo antes do cron).
create function interno.bloco_ocupa(b app.agenda_blocos) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(b.ativo and (b.tipo = 'RESERVA' or b.expira_em > now()), false)
$$;

-- Orçamento vigente: a versão mais recente PENDENTE ou APROVADA (nula se não houver).
create function interno.orcamento_vigente(p_atividade uuid) returns app.orcamentos
language sql stable security definer set search_path = '' as $$
  select o.* from app.orcamentos o
  where o.atividade_id = p_atividade and o.status in ('PENDENTE', 'APROVADO')
  order by o.versao desc
  limit 1
$$;

-- Limiar de urgência (horas): do snapshot do orçamento vigente; sem orçamento, do contrato vigente da empresa;
-- sem contrato, do último orçamento enviado.
create function interno.limiar_urgente(a app.atividades) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (o.snapshot ->> 'limiar_urgente_horas')::int from interno.orcamento_vigente(a.id) o),
    (select c.limiar_urgente_horas from interno.contrato_vigente(a.empresa_id) c),
    (select (o.snapshot ->> 'limiar_urgente_horas')::int from app.orcamentos o
      where o.atividade_id = a.id order by o.versao desc limit 1))
$$;

-- Subconjuntos do snapshot (lista explícita: limites de saldo, versão e autor nunca saem daqui).
create function interno.snapshot_regras(s jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('faixas_cancelamento', s -> 'faixas_cancelamento',
                            'prazo_orcar_horas', s -> 'prazo_orcar_horas',
                            'validade_orcamento_horas', s -> 'validade_orcamento_horas',
                            'limiar_urgente_horas', s -> 'limiar_urgente_horas')
$$;
create function interno.snapshot_precos(s jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('km_sem_reboque_cent', s -> 'km_sem_reboque_cent',
                            'km_com_reboque_cent', s -> 'km_com_reboque_cent',
                            'taxa_fixa_reboque_cent', s -> 'taxa_fixa_reboque_cent',
                            'retorno_trecho_unico_bp', s -> 'retorno_trecho_unico_bp',
                            'hora_espera_cent', s -> 'hora_espera_cent',
                            'hospedagem_diaria_cent', s -> 'hospedagem_diaria_cent',
                            'diaria_motorista_cent', s -> 'diaria_motorista_cent')
$$;

-- Orçamento como cada perfil o vê.
--   CLIENTE: memorial (linhas), total, validade, hash e regras do snapshot (faixas, prazos);
--   MOTORISTA: + entrada e preços unitários do snapshot (nunca limites, versão ou autor);
--   ADM: tudo (snapshot completo, versão do contrato, autor);
--   GESTOR_FROTA: só metadados (não vê preço — Adendo A10).
create function interno.orcamento_para(v app.perfis, o app.orcamentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when o.id is null or v.usuario_id is null then null else
    jsonb_build_object('id', o.id, 'versao', o.versao, 'status', o.status, 'modalidade', o.modalidade,
                       'valido_ate', o.valido_ate, 'horario_sugerido', o.horario_sugerido, 'enviado_em', o.enviado_em)
    || case v.papel
         when 'CLIENTE' then jsonb_build_object(
           'linhas', o.linhas, 'total_cent', o.total_cent, 'hash', o.hash, 'regras', interno.snapshot_regras(o.snapshot))
         when 'MOTORISTA' then jsonb_build_object(
           'linhas', o.linhas, 'total_cent', o.total_cent, 'entrada', o.entrada,
           'precos', interno.snapshot_precos(o.snapshot), 'regras', interno.snapshot_regras(o.snapshot))
         when 'ADM' then jsonb_build_object(
           'linhas', o.linhas, 'total_cent', o.total_cent, 'entrada', o.entrada, 'hash', o.hash,
           'contrato_versao', o.contrato_versao, 'snapshot', o.snapshot, 'enviado_por', o.enviado_por,
           'enviado_por_nome', (select pf.nome from app.perfis pf where pf.usuario_id = o.enviado_por))
         else '{}'::jsonb
       end
  end
$$;

------------------------------------------------------------------------------------------------
-- 2. Leituras.
------------------------------------------------------------------------------------------------

-- Lista (só campos de lista). p_filtro: {status?: [status...], de?: ISO, ate?: ISO (sobre o início), limite?: 1..500}.
-- Cliente N2: os próprios; N1/N3: os da empresa; motorista: os atribuídos; ADM/gestor: todos.
create function api.meus_pedidos(p_filtro jsonb default '{}')
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
             'empresa_nome', case when v_equipe then e.nome end) as item
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

-- Detalhe + histórico + orçamento vigente (filtrado por perfil) + ações possíveis agora.
-- Quem não pode ver (inclusive outra empresa) recebe NAO_ENCONTRADO, igual a um id inexistente.
create function api.pedido(p_id uuid)
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
    'criada_em', a.criada_em, 'atualizada_em', a.atualizada_em);

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
    'acoes', jsonb_build_object(
      'orcar', a.status = 'SOLICITADA' and not v_vencido and interno.pode_orcar(v, a),
      'recusar', a.status = 'SOLICITADA' and not v_vencido and interno.pode_orcar(v, a),
      'pedir_revisao', a.status = 'ORCADA' and not v_vencido and interno.pode_decidir(v, a),
      'reprovar', a.status = 'ORCADA' and not v_vencido and interno.pode_decidir(v, a),
      'cancelar', v_aberto and (interno.pode_decidir(v, a) or interno.pode_orcar(v, a))));
end $$;

-- Blocos que ocupam a agenda em [p_de, p_ate) (no máximo 62 dias).
-- Equipe (ADM, gestor, motorista): todos, com detalhes. Cliente: os da própria empresa com detalhes e, do motorista
-- que atende pedidos novos, os de outras empresas só como {inicio, fim, ocupado}.
create function api.agenda(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_equipe boolean;
  v_motorista uuid;
  blocos jsonb;
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
      case when v_equipe or a.empresa_id = v.empresa_id then
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
  return jsonb_build_object('ok', true, 'blocos', blocos);
end $$;

-- Inícios possíveis (de 30 em 30 min, 05:00–22:00 em America/Sao_Paulo) no dia, para o motorista que atende
-- pedidos novos: no futuro, até 366 dias, sem colidir com blocos que ocupam a agenda (pré-reserva vencida = livre).
-- dia_cheio: ainda havia início possível no futuro, mas nenhum livre para essa duração.
create function api.horarios_livres(p_dia date, p_duracao_min int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_motorista uuid;
  v_futuros int;
  v_livres jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('HORARIOS_LIVRES', 'agenda', 'SEM_PERMISSAO');
  end if;
  if p_dia is null or p_duracao_min is null or p_duracao_min not between 30 and 1440 then
    return interno.negar('HORARIOS_LIVRES', 'agenda', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array(case when p_dia is null then 'p_dia' else 'p_duracao_min' end)));
  end if;
  v_motorista := interno.motorista_padrao();
  if v_motorista is null then
    return interno.negar('HORARIOS_LIVRES', 'agenda', 'SEM_MOTORISTA');
  end if;

  with candidatos as (
    select ((p_dia + time '05:00') + make_interval(mins => 30 * i)) at time zone 'America/Sao_Paulo' as ini
    from generate_series(0, 34) i
  ), futuros as (
    select c.ini from candidatos c where c.ini > now() and c.ini <= now() + interval '366 days'
  )
  select (select count(*) from futuros),
         coalesce(jsonb_agg(to_jsonb(f.ini) order by f.ini), '[]')
    into v_futuros, v_livres
    from futuros f
   where not exists (
     select 1 from app.agenda_blocos b
      where b.motorista_id = v_motorista and interno.bloco_ocupa(b)
        and b.periodo && tstzrange(f.ini, f.ini + make_interval(mins => p_duracao_min), '[)'));

  return jsonb_build_object('ok', true, 'dia', p_dia, 'duracao_min', p_duracao_min, 'horarios', v_livres,
                            'dia_cheio', v_futuros > 0 and jsonb_array_length(v_livres) = 0);
end $$;

-- Pendências do perfil, com prazo e urgência (faltam ≤ limiar_urgente_horas do contrato/snapshot).
--   aguardando_orcamento (SOLICITADA no prazo): motorista, os atribuídos; cliente, os visíveis; ADM/gestor, todos.
--     revisao = já teve orçamento e o cliente pediu revisão.
--   aguardando_aprovacao (ORCADA com orçamento no prazo): cliente, os que pode decidir (dono N2 ou N1);
--     ADM/gestor, todos; motorista, nenhum (a ação é do cliente).
--   proximos (AGENDADA/EM_ANDAMENTO, fase 2B/3): os visíveis, por início.
-- Gestor de frota não vê valores (Adendo A10).
create function api.pendencias()
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
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
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
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    join app.orcamentos o on o.atividade_id = a.id and o.status = 'PENDENTE'
    where a.status = 'ORCADA'
      and v.papel <> 'MOTORISTA'
      and (v_equipe or a.empresa_id = v.empresa_id)
      and (v.papel in ('ADM', 'GESTOR_FROTA') or interno.pode_decidir(v, a))
      and not interno.prazo_vencido(a.id)
    order by o.valido_ate, a.numero
    limit 200
  ) x;

  select coalesce(jsonb_agg(x.item order by x.inicio, x.numero), '[]') into r_proximos
  from (
    select a.inicio, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino,
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    where a.status in ('AGENDADA', 'EM_ANDAMENTO')
      and a.inicio + make_interval(mins => a.duracao_min) > now()
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
    order by a.inicio, a.numero
    limit 50
  ) x;

  return jsonb_build_object('ok', true, 'aguardando_orcamento', r_orcar, 'aguardando_aprovacao', r_aprovar,
                            'proximos', r_proximos);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Tempo real: substitui a prova da fase 0.
------------------------------------------------------------------------------------------------
drop trigger prova_canal_publicar on app.prova_canal;
drop function app.prova_canal_publicar();
drop policy prova_assinar on realtime.messages;
drop function app.pode_ver_prova(text);
drop table app.prova_canal;

-- Tópicos privados: atividade:<id> para quem vê o pedido; empresa:<id> para os usuários da empresa e a equipe
-- (ADM, gestor de frota, motorista). Qualquer outro tópico é recusado.
create function app.pode_ver_topico(p_topico text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  a app.atividades;
  v_empresa uuid;
begin
  if v.usuario_id is null or p_topico is null then
    return false;
  end if;
  if p_topico ~ ('^atividade:' || uuid_re || '$') then
    select * into a from app.atividades x where x.id = substr(p_topico, 11)::uuid;
    return interno.pode_ver_atividade(v, a);
  elsif p_topico ~ ('^empresa:' || uuid_re || '$') then
    v_empresa := substr(p_topico, 9)::uuid;
    return exists (select 1 from app.empresas e where e.id = v_empresa)
       and (v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA') or (v.papel = 'CLIENTE' and v.empresa_id = v_empresa));
  end if;
  return false;
end $$;
revoke execute on function app.pode_ver_topico(text) from public, anon;
grant execute on function app.pode_ver_topico(text) to authenticated;

create policy pedidos_assinar on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select app.pode_ver_topico((select realtime.topic())))
  );

-- Payload mínimo (id, status, horário): o front relê api.pedido/api.meus_pedidos ao receber.
create function interno.atividade_publicar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  msg jsonb;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    msg := jsonb_build_object('id', new.id, 'status', new.status, 'em', now());
    perform realtime.send(msg, 'status', 'atividade:' || new.id::text, true);
    perform realtime.send(msg, 'status', 'empresa:' || new.empresa_id::text, true);
  end if;
  return null;
end $$;
create trigger atividades_publicar after insert or update of status on app.atividades
  for each row execute function interno.atividade_publicar();

------------------------------------------------------------------------------------------------
-- 4. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.pode_ver_atividade(app.perfis, app.atividades),
  interno.bloco_ocupa(app.agenda_blocos),
  interno.orcamento_vigente(uuid),
  interno.limiar_urgente(app.atividades),
  interno.snapshot_regras(jsonb),
  interno.snapshot_precos(jsonb),
  interno.orcamento_para(app.perfis, app.orcamentos),
  interno.atividade_publicar()
from public, anon, authenticated;

revoke all on function
  api.meus_pedidos(jsonb),
  api.pedido(uuid),
  api.agenda(timestamptz, timestamptz),
  api.horarios_livres(date, int),
  api.pendencias()
from public, anon, authenticated, service_role;

grant execute on function
  api.meus_pedidos(jsonb),
  api.pedido(uuid),
  api.agenda(timestamptz, timestamptz),
  api.horarios_livres(date, int),
  api.pendencias()
to authenticated;
