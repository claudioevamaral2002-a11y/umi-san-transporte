-- Fase 3B, Tarefa 2 (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.4, §2.6, §4, §5):
--   * app.posicoes (sem acesso direto) e api.enviar_posicao: só o motorista do pedido EM_ANDAMENTO; repassa a posição
--     no tópico privado rastreio:<atividade> (realtime.send) e grava a cada ~30 s ou ~200 m (para o km rodados);
--   * api.registrar_eta: no máximo 12 cálculos de chegada (Routes) por viagem;
--   * app.pode_ver_topico: rastreio:<id> para o solicitante, o N1 da empresa, o ADM, o gestor de frota e o motorista;
--   * api.concluir: grava o km rodados (soma das posições) e apaga as posições na mesma transação;
--   * fotos: bucket privado `fotos` (5 MB, JPEG/PNG/WebP), app.fotos, api.autorizar_foto / api.confirmar_foto (usadas
--     pela Edge Function enviar-foto, que confere os bytes e grava com a service role), api.fotos_do_pedido e leitura
--     por URL assinada só para quem vê o pedido. Nenhuma foto é apagada nesta fase (especificação §8: só na fase 5);
--   * api.pedido: campos da execução e as ações sair, informar_previsao, concluir e enviar_fotos;
--   * cron limpar-posicoes: posições com mais de 48 h (viagem esquecida em andamento).
-- Só acrescenta: o app aberto durante o deploy continua funcionando. Nomes de ação são constantes.

------------------------------------------------------------------------------------------------
-- 1. Posições.
------------------------------------------------------------------------------------------------
create table app.posicoes (
  id bigint generated always as identity primary key,
  atividade_id uuid not null references app.atividades (id),
  em timestamptz not null default now(),
  lat numeric(9, 6) not null check (lat between -90 and 90),
  lng numeric(9, 6) not null check (lng between -180 and 180),
  precisao numeric(6, 1) check (precisao >= 0),
  seq int
);
create index posicoes_atividade on app.posicoes (atividade_id, em);
alter table app.posicoes enable row level security;
-- Sem GRANT a authenticated: só as funções leem e escrevem.

-- Distância em metros entre dois pontos (haversine).
create function interno.distancia_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable set search_path = '' as $$
  select (2 * 6371000 * asin(sqrt(
            power(sin(radians((lat2 - lat1)::float8) / 2), 2)
            + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
          )))::numeric
$$;

-- Km rodados da viagem pelas posições gravadas (1 casa).
create function interno.km_das_posicoes(p_atividade uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(coalesce(sum(d), 0) / 1000, 1)
  from (select interno.distancia_m(lag(p.lat) over w, lag(p.lng) over w, p.lat, p.lng) as d
          from app.posicoes p where p.atividade_id = p_atividade
        window w as (order by p.em, p.id)) x
$$;

-- p: {lat, lng, precisao?, rumo?, velocidade?, seq?, eta? (ISO)}. Sucesso não é auditado (roda a cada ~5 s).
create function api.enviar_posicao(p_atividade uuid, p jsonb)
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
  return jsonb_build_object('ok', true);
end $$;

-- Cada cálculo de chegada (rota no Google) gasta 1 dos 12 da viagem. {ok, restantes}
create function api.registrar_eta(p_atividade uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  n int;
begin
  if v.usuario_id is null or v.papel <> 'MOTORISTA' then
    return interno.negar('REGISTRAR_ETA', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade;
  if a.id is null or a.motorista_id <> v.usuario_id then
    return interno.negar('REGISTRAR_ETA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('REGISTRAR_ETA', v_alvo, 'STATUS_INVALIDO');
  end if;
  update app.atividades set etas_usadas = etas_usadas + 1 where id = a.id and etas_usadas < 12
  returning etas_usadas into n;
  if n is null then
    return interno.negar('REGISTRAR_ETA', v_alvo, 'LIMITE_ETA');
  end if;
  return jsonb_build_object('ok', true, 'restantes', 12 - n);
end $$;

------------------------------------------------------------------------------------------------
-- 2. Quem vê o rastreio (decisão do dono, 14/10): solicitante, N1 da empresa, ADM, gestor de frota (e o motorista
--    da viagem). N3 e os outros N2 continuam vendo só o status.
------------------------------------------------------------------------------------------------
create function interno.pode_ver_rastreio(v app.perfis, a app.atividades) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(v.usuario_id is not null and a.id is not null
                  and (v.papel in ('ADM', 'GESTOR_FROTA')
                       or (v.papel = 'MOTORISTA' and a.motorista_id = v.usuario_id)
                       or (v.papel = 'CLIENTE' and v.empresa_id = a.empresa_id
                           and (v.nivel = 1 or (v.nivel = 2 and a.solicitante_id = v.usuario_id)))), false)
$$;

-- Igual à de 20261009141000, mais rastreio:<id>.
create or replace function app.pode_ver_topico(p_topico text) returns boolean
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
  if p_topico = 'equipe' then
    return app.pode_ver_equipe();
  elsif p_topico ~ ('^atividade:' || uuid_re || '$') then
    select * into a from app.atividades x where x.id = substr(p_topico, 11)::uuid;
    return interno.pode_ver_atividade(v, a);
  elsif p_topico ~ ('^rastreio:' || uuid_re || '$') then
    select * into a from app.atividades x where x.id = substr(p_topico, 10)::uuid;
    return interno.pode_ver_rastreio(v, a);
  elsif p_topico ~ ('^empresa:' || uuid_re || '$') then
    v_empresa := substr(p_topico, 9)::uuid;
    return exists (select 1 from app.empresas e where e.id = v_empresa)
       and (v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA') or (v.papel = 'CLIENTE' and v.empresa_id = v_empresa));
  elsif p_topico ~ ('^saldo:' || uuid_re || '$') then
    v_empresa := substr(p_topico, 7)::uuid;
    return exists (select 1 from app.empresas e where e.id = v_empresa)
       and (v.papel = 'ADM' or (v.papel = 'CLIENTE' and v.empresa_id = v_empresa));
  end if;
  return false;
end $$;

------------------------------------------------------------------------------------------------
-- 3. Conclusão com km rodados e posições apagadas (igual à de 20261018120000, mais o km e o delete).
------------------------------------------------------------------------------------------------
create or replace function api.concluir(p_atividade uuid, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  pa app.atividades;
  r record;
  v_obs text := btrim(coalesce(p_observacao, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_km numeric;
begin
  if v.usuario_id is null then
    return interno.negar('CONCLUIR', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('CONCLUIR', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('CONCLUIR', v_alvo, 'STATUS_INVALIDO');
  end if;
  if length(v_obs) > 1000 then
    return interno.negar('CONCLUIR', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('CONCLUIR', 30, interval '1 hour') then
    return interno.negar('CONCLUIR', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  v_km := interno.km_das_posicoes(a.id);
  update app.atividades
     set concluiu_em = now(), observacao_conclusao = nullif(v_obs, ''), km_rodados = v_km
   where id = a.id;
  perform interno.transicionar(a.id, 'CONCLUIDA', null);  -- desativa o bloco da agenda
  delete from app.posicoes where atividade_id = a.id;     -- o trajeto é apagado; fica só o resumo
  for r in
    select x.id from app.atividades x
     where x.motorista_id = a.motorista_id and x.atraso_anterior_ate is not null
     order by x.id
  loop
    update app.atividades set atraso_anterior_ate = null where id = r.id returning * into pa;
    perform interno.publicar_atividade(pa, 'atraso');
  end loop;

  select * into a from app.atividades x where x.id = a.id;
  perform interno.auditar('CONCLUIR', v_alvo, 'OK', null, jsonb_build_object('km_rodados', a.km_rodados));
  return jsonb_build_object('ok', true, 'concluiu_em', a.concluiu_em, 'km_rodados', a.km_rodados);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Fotos.
------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create table app.fotos (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid not null references app.atividades (id),
  caminho text not null unique,
  tipo text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes between 1 and 5242880),
  enviada_por uuid references auth.users (id) on delete set null,
  criada_em timestamptz not null default now(),
  enviada_em timestamptz,   -- arquivo confirmado no bucket
  entregue_em timestamptz,  -- fase 5: entrega por e-mail confirmada
  apagada_em timestamptz    -- fase 5: retenção vencida e entrega confirmada
);
create index fotos_atividade on app.fotos (atividade_id, criada_em);
alter table app.fotos enable row level security;
-- Sem GRANT a authenticated: só as funções leem e escrevem.

-- Quem pode enviar foto agora: o motorista do pedido (ou o ADM), em andamento ou concluído há menos de 24 h.
create function interno.pode_enviar_foto(v app.perfis, a app.atividades) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(interno.pode_orcar(v, a)
                  and (a.status = 'EM_ANDAMENTO'
                       or (a.status = 'CONCLUIDA' and a.concluiu_em > now() - interval '24 hours')), false)
$$;

-- Reserva o caminho de uma foto (antes do upload pela Edge Function). {ok, foto_id, caminho}
create function api.autorizar_foto(p_atividade uuid, p_tipo text, p_bytes int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_id uuid := gen_random_uuid();
  v_caminho text;
begin
  if v.usuario_id is null then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if not interno.pode_enviar_foto(v, a) then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if p_tipo is null or p_tipo not in ('image/jpeg', 'image/png', 'image/webp')
     or p_bytes is null or p_bytes not between 1 and 5242880 then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, 'FOTO_INVALIDA');
  end if;
  if not interno.checar_limite('AUTORIZAR_FOTO', 30, interval '1 hour') then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  -- até 10 por pedido (as pendentes de menos de 15 min também contam)
  if (select count(*) from app.fotos f
       where f.atividade_id = a.id and (f.enviada_em is not null or f.criada_em > now() - interval '15 minutes')) >= 10 then
    return interno.negar('AUTORIZAR_FOTO', v_alvo, 'LIMITE_FOTOS');
  end if;
  v_caminho := a.id::text || '/' || v_id::text || case p_tipo when 'image/jpeg' then '.jpg' when 'image/png' then '.png'
                                                             else '.webp' end;
  insert into app.fotos (id, atividade_id, caminho, tipo, bytes, enviada_por)
  values (v_id, a.id, v_caminho, p_tipo, p_bytes, v.usuario_id);
  return jsonb_build_object('ok', true, 'foto_id', v_id, 'caminho', v_caminho);
end $$;

-- Confirma a foto depois que o arquivo está no bucket (quem autorizou). {ok}
create function api.confirmar_foto(p_foto uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  f app.fotos;
  v_alvo text := 'foto:' || coalesce(p_foto::text, '-');
begin
  if v.usuario_id is null then
    return interno.negar('CONFIRMAR_FOTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into f from app.fotos x where x.id = p_foto for update;
  if f.id is null or f.enviada_por is distinct from v.usuario_id then
    return interno.negar('CONFIRMAR_FOTO', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'fotos' and o.name = f.caminho) then
    return interno.negar('CONFIRMAR_FOTO', v_alvo, 'FOTO_INVALIDA');
  end if;
  if f.enviada_em is null then
    update app.fotos set enviada_em = now() where id = f.id;
    perform interno.auditar('ENVIAR_FOTO', 'atividade:' || f.atividade_id, 'OK', null,
      jsonb_build_object('foto_id', f.id, 'bytes', f.bytes, 'tipo', f.tipo));
    perform interno.publicar_atividade((select x from app.atividades x where x.id = f.atividade_id), 'fotos');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- {ok, fotos: [{id, caminho, enviada_em}]} para quem vê o pedido.
create function api.fotos_do_pedido(p_atividade uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if v.usuario_id is null then
    return interno.negar('VER_FOTOS', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade;
  if not interno.pode_ver_atividade(v, a) then
    return interno.negar('VER_FOTOS', v_alvo, 'NAO_ENCONTRADO');
  end if;
  return jsonb_build_object('ok', true, 'fotos', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'caminho', f.caminho, 'enviada_em', f.enviada_em)
                     order by f.enviada_em, f.id)
      from app.fotos f where f.atividade_id = a.id and f.enviada_em is not null and f.apagada_em is null), '[]'));
end $$;

-- Leitura do arquivo (URL assinada): só foto confirmada, de pedido que a pessoa vê.
create function app.pode_ver_foto(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
begin
  if v.usuario_id is null or p_nome is null then
    return false;
  end if;
  select x.* into a from app.fotos f join app.atividades x on x.id = f.atividade_id
   where f.caminho = p_nome and f.enviada_em is not null and f.apagada_em is null;
  return interno.pode_ver_atividade(v, a);
end $$;

create policy fotos_ler on storage.objects for select to authenticated
using (bucket_id = 'fotos' and (select app.pode_ver_foto(name)));
-- Sem políticas de insert/update/delete: só a Edge Function (service role) grava.

------------------------------------------------------------------------------------------------
-- 5. Detalhe do pedido com a execução (igual ao de 20261015140000, mais campos e ações da 3B).
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
                   where f.atividade_id = a.id and f.enviada_em is not null and f.apagada_em is null));

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
      'enviar_fotos', interno.pode_enviar_foto(v, a)));
end $$;

------------------------------------------------------------------------------------------------
-- 6. Limpeza de posições de viagem esquecida (a conclusão já apaga as da viagem).
------------------------------------------------------------------------------------------------
create function interno.limpar_posicoes() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from app.posicoes where em < now() - interval '48 hours';
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('limpar-posicoes', '17 * * * *', 'select interno.limpar_posicoes()');

------------------------------------------------------------------------------------------------
-- 7. Privilégios.
------------------------------------------------------------------------------------------------
revoke all on function
  interno.distancia_m(numeric, numeric, numeric, numeric),
  interno.km_das_posicoes(uuid),
  interno.pode_ver_rastreio(app.perfis, app.atividades),
  interno.pode_enviar_foto(app.perfis, app.atividades),
  interno.limpar_posicoes()
from public, anon, authenticated;
revoke all on function
  api.enviar_posicao(uuid, jsonb),
  api.registrar_eta(uuid),
  api.autorizar_foto(uuid, text, int),
  api.confirmar_foto(uuid),
  api.fotos_do_pedido(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  api.enviar_posicao(uuid, jsonb),
  api.registrar_eta(uuid),
  api.autorizar_foto(uuid, text, int),
  api.confirmar_foto(uuid),
  api.fotos_do_pedido(uuid)
to authenticated;
revoke execute on function app.pode_ver_foto(text) from public, anon;
grant execute on function app.pode_ver_foto(text) to authenticated;
