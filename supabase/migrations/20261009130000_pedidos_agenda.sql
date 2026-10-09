-- Fase 2A, Task 1 (docs/fases/fase-2a-desenho-e-plano.md "Banco"; especificação §4, §4.1, §4.6, §5; Adendo A2):
--   * atividades (pedidos) com transições validadas por tabela e histórico de cada mudança;
--   * agenda por motorista com conflito impedido no banco (exclusion constraint só sobre blocos ativos);
--   * criar_pedido (com expiração, na mesma transação, de pré-reservas vencidas que colidem), recusar_pedido,
--     cancelar_pedido (sem custo: SOLICITADA/ORCADA) e interno.expirar_vencidos (cron em migration própria).
-- Prazos são sempre checados com now() (sem depender do cron). Nomes de ação da auditoria são constantes.

create extension if not exists btree_gist with schema extensions;

------------------------------------------------------------------------------------------------
-- 1. Tipos.
------------------------------------------------------------------------------------------------
create type app.status_atividade as enum (
  'SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA');
create type app.tipo_carga as enum ('PESSOAS', 'EQUIPAMENTO', 'AMBOS');
create type app.modalidade as enum ('VEICULO_PROPRIO', 'VEICULO_CLIENTE');
create type app.reboque as enum ('SIM', 'NAO', 'NAO_SEI');

------------------------------------------------------------------------------------------------
-- 2. Atividades (pedidos).
------------------------------------------------------------------------------------------------
create table app.atividades (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  empresa_id uuid not null references app.empresas (id) on delete restrict,
  solicitante_id uuid not null references app.perfis (usuario_id) on delete restrict,
  motorista_id uuid not null references app.perfis (usuario_id) on delete restrict,
  status app.status_atividade not null default 'SOLICITADA',
  inicio timestamptz not null,
  duracao_min int not null check (duracao_min between 30 and 1440),
  origem text not null check (length(btrim(origem)) between 3 and 200),
  destino text not null check (length(btrim(destino)) between 3 and 200),
  levar boolean not null,
  trazer boolean not null,
  carga app.tipo_carga not null,
  pessoas_qtd int,
  equipamento_desc text,
  peso_kg numeric(10, 2),
  dimensoes text,
  modalidade app.modalidade not null,
  reboque app.reboque not null,
  contato_nome text check (contato_nome is null or length(btrim(contato_nome)) between 2 and 120),
  contato_telefone text check (contato_telefone is null or contato_telefone ~ '^[0-9+() .-]{8,25}$'),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  prazo_orcar_ate timestamptz not null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint atividades_trajeto check (levar or trazer),
  constraint atividades_pessoas check (
    case when carga in ('PESSOAS', 'AMBOS') then pessoas_qtd is not null and pessoas_qtd between 1 and 99
         else pessoas_qtd is null end),
  constraint atividades_equipamento check (
    case when carga in ('EQUIPAMENTO', 'AMBOS')
         then equipamento_desc is not null and length(btrim(equipamento_desc)) between 3 and 500
              and (peso_kg is null or (peso_kg > 0 and peso_kg <= 100000))
              and (dimensoes is null or length(btrim(dimensoes)) between 1 and 120)
         else equipamento_desc is null and peso_kg is null and dimensoes is null end),
  constraint atividades_prazo check (prazo_orcar_ate <= inicio)
);
create index atividades_empresa on app.atividades (empresa_id, inicio desc);
create index atividades_solicitante on app.atividades (solicitante_id, inicio desc);
create index atividades_motorista on app.atividades (motorista_id, inicio desc);
create index atividades_status on app.atividades (status);
-- No máximo 1 atividade EM_ANDAMENTO por motorista (especificação §4; usada na fase 3).
create unique index atividades_uma_em_andamento on app.atividades (motorista_id) where status = 'EM_ANDAMENTO';

alter table app.atividades enable row level security;
-- Sem GRANT a authenticated: leituras por funções SECURITY DEFINER com checagem (Task 3), escrita só pelas RPCs.

-- Setas da §4 (+ ORCADA→SOLICITADA, revisão pedida).
create table app.transicoes_permitidas (
  de app.status_atividade not null,
  para app.status_atividade not null,
  primary key (de, para)
);
insert into app.transicoes_permitidas (de, para) values
  ('SOLICITADA', 'ORCADA'), ('SOLICITADA', 'RECUSADA'), ('SOLICITADA', 'EXPIRADA'), ('SOLICITADA', 'CANCELADA'),
  ('ORCADA', 'AGENDADA'), ('ORCADA', 'REPROVADA'), ('ORCADA', 'SOLICITADA'), ('ORCADA', 'EXPIRADA'),
  ('ORCADA', 'CANCELADA'),
  ('AGENDADA', 'EM_ANDAMENTO'), ('AGENDADA', 'CANCELADA'),
  ('EM_ANDAMENTO', 'CONCLUIDA');
alter table app.transicoes_permitidas enable row level security;

create table app.atividade_historico (
  id bigint generated always as identity primary key,
  atividade_id uuid not null references app.atividades (id) on delete restrict,
  de app.status_atividade,  -- nulo = criação
  para app.status_atividade not null,
  por uuid,                 -- uuid solto (como auditoria.usuario_id); nulo = sistema (cron)
  em timestamptz not null default now(),
  observacao text check (observacao is null or length(observacao) <= 500)
);
create index atividade_historico_atividade on app.atividade_historico (atividade_id, id);
alter table app.atividade_historico enable row level security;

-- Histórico e tabela de transições são imutáveis.
create function interno.imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% é imutável', tg_table_name using errcode = '42501';
end $$;
create trigger historico_sem_update before update or delete on app.atividade_historico
  for each row execute function interno.imutavel();
create trigger historico_sem_truncate before truncate on app.atividade_historico
  for each statement execute function interno.imutavel();
create trigger transicoes_sem_escrita before insert or update or delete on app.transicoes_permitidas
  for each row execute function interno.imutavel();
create trigger transicoes_sem_truncate before truncate on app.transicoes_permitidas
  for each statement execute function interno.imutavel();

-- Defesa em profundidade: nasce SOLICITADA; status só muda por uma seta da tabela.
create function interno.atividade_validar_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'SOLICITADA' then
      raise exception 'atividade nasce SOLICITADA' using errcode = '23514';
    end if;
  elsif new.status is distinct from old.status
        and not exists (select 1 from app.transicoes_permitidas t where t.de = old.status and t.para = new.status) then
    raise exception 'transição % → % não permitida', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger atividades_status before insert or update of status on app.atividades
  for each row execute function interno.atividade_validar_status();

------------------------------------------------------------------------------------------------
-- 3. Agenda: blocos por motorista. Período = [inicio, inicio + duração). Conflito só entre blocos ativos.
--    PRE_RESERVA (SOLICITADA/ORCADA) expira em expira_em; RESERVA (AGENDADA/EM_ANDAMENTO, fase 2B) não expira.
------------------------------------------------------------------------------------------------
create table app.agenda_blocos (
  id bigint generated always as identity primary key,
  atividade_id uuid not null unique references app.atividades (id) on delete restrict,
  motorista_id uuid not null references app.perfis (usuario_id) on delete restrict,
  periodo tstzrange not null check (not isempty(periodo) and lower_inc(periodo) and not upper_inc(periodo)),
  tipo text not null check (tipo in ('PRE_RESERVA', 'RESERVA')),
  ativo boolean not null default true,
  expira_em timestamptz,
  constraint agenda_blocos_expira check (tipo = 'RESERVA' or expira_em is not null),
  constraint agenda_blocos_sem_conflito exclude using gist (motorista_id with =, periodo with &&) where (ativo)
);
create index agenda_blocos_vencimento on app.agenda_blocos (expira_em) where ativo and tipo = 'PRE_RESERVA';
alter table app.agenda_blocos enable row level security;

------------------------------------------------------------------------------------------------
-- 4. Quem pode o quê (acrescenta CRIAR_PEDIDO e ORCAR_PEDIDO; as demais ações ficam como na 1B).
--    Atuar sobre um pedido específico ainda exige a checagem da linha (dono/N1/motorista atribuído).
------------------------------------------------------------------------------------------------
create or replace function app.pode_fazer(acao text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or acao is null then return false; end if;
  case acao
    when 'GERIR_USUARIOS', 'GERIR_EMPRESAS', 'VER_AUDITORIA', 'GERIR_CONTRATOS', 'LANCAR_SALDO', 'GERIR_CONFIGURACAO' then
      return v.papel = 'ADM';
    when 'GERIR_EQUIPE_EMPRESA' then
      return v.papel = 'CLIENTE' and v.nivel = 1 and v.empresa_id is not null;
    when 'VER_AGENDA_FROTA' then
      return v.papel in ('ADM', 'GESTOR_FROTA');
    when 'CRIAR_PEDIDO' then
      return v.papel = 'CLIENTE' and v.nivel in (1, 2) and v.empresa_id is not null;
    when 'ORCAR_PEDIDO' then
      return v.papel in ('ADM', 'MOTORISTA');
    else
      return false;
  end case;
end $$;

------------------------------------------------------------------------------------------------
-- 5. Núcleo: transição, prazo vencido e expiração.
------------------------------------------------------------------------------------------------

-- Única porta de mudança de status: trava a linha, valida na tabela, grava histórico e libera a agenda
-- nos estados finais. Seta inexistente = erro de programação → RAISE (integridade).
create function interno.transicionar(p_atividade uuid, p_para app.status_atividade, p_observacao text)
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
  return v_de;
end $$;

-- Pré-reserva ativa com prazo vencido (SOLICITADA: prazo de orçar; ORCADA: validade do orçamento).
-- O prazo operacional fica em agenda_blocos.expira_em (espelha prazo_orcar_ate / valido_ate).
create function interno.prazo_vencido(p_atividade uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app.agenda_blocos b
    join app.atividades a on a.id = b.atividade_id
    where b.atividade_id = p_atividade
      and b.ativo and b.tipo = 'PRE_RESERVA' and b.expira_em <= now()
      and a.status in ('SOLICITADA', 'ORCADA')
  )
$$;

-- Expira a atividade se o prazo venceu (trava a linha; p_pular_travadas = SKIP LOCKED, para o cron).
-- true = expirou agora.
create function interno.expirar_atividade(p_atividade uuid, p_pular_travadas boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_pular_travadas then
    select a.id into v_id from app.atividades a where a.id = p_atividade for update skip locked;
  else
    select a.id into v_id from app.atividades a where a.id = p_atividade for update;
  end if;
  if v_id is null or not interno.prazo_vencido(p_atividade) then
    return false;
  end if;
  perform interno.transicionar(p_atividade, 'EXPIRADA', 'Prazo vencido');
  return true;
end $$;

-- Cron (a cada 15 min): expira o restante. Devolve quantas expirou.
create function interno.expirar_vencidos() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select b.atividade_id
    from app.agenda_blocos b
    where b.ativo and b.tipo = 'PRE_RESERVA' and b.expira_em <= now()
    order by b.atividade_id
    limit 5000
  loop
    if interno.expirar_atividade(r.atividade_id, true) then
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    perform interno.auditar('EXPIRAR_VENCIDOS', 'agenda', 'OK', null, jsonb_build_object('expiradas', n));
  end if;
  return n;
end $$;

------------------------------------------------------------------------------------------------
-- 6. Validação do pedido (jsonb da tela). null = válido; senão {desconhecidos, ausentes, invalidos}.
------------------------------------------------------------------------------------------------
create function interno.validar_pedido(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  obrigatorios constant text[] := array['inicio', 'duracao_min', 'origem', 'destino', 'levar', 'trazer', 'carga',
                                        'modalidade', 'reboque'];
  opcionais constant text[] := array['pessoas_qtd', 'equipamento_desc', 'peso_kg', 'dimensoes', 'contato_nome',
                                     'contato_telefone', 'observacoes'];
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

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(inv) > 0 then
    return jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                              'invalidos', to_jsonb(inv));
  end if;
  return null;
end $$;

-- Motorista atribuído na v1: o motorista ativo mais antigo (estrutura aceita vários; redistribuição na fase 3).
create function interno.motorista_padrao() returns uuid
language sql stable security definer set search_path = '' as $$
  select pf.usuario_id from app.perfis pf
  where pf.papel = 'MOTORISTA' and pf.ativo
  order by pf.criado_em, pf.usuario_id
  limit 1
$$;

------------------------------------------------------------------------------------------------
-- 7. RPCs.
------------------------------------------------------------------------------------------------

-- Cliente N1/N2. Cria SOLICITADA + PRE_RESERVA (expira no prazo de orçar). Conflito de agenda →
-- HORARIO_OCUPADO (a exclusion violation é capturada num subbloco e devolvida auditada; Adendo A2).
create function api.criar_pedido(p jsonb)
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

-- Motorista atribuído ou ADM: SOLICITADA → RECUSADA, motivo obrigatório; libera a agenda.
create function api.recusar_pedido(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
  if a.id is null then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if v.papel = 'MOTORISTA' and a.motorista_id <> v.usuario_id then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'SOLICITADA' then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'RECUSADA', v_motivo);
  perform interno.auditar('RECUSAR_PEDIDO', v_alvo, 'OK', null, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- Sem custo nesta fase (SOLICITADA/ORCADA). Cliente: dono (N2) ou N1 da empresa, motivo opcional.
-- Prestador: motorista atribuído ou ADM, motivo obrigatório. AGENDADA fica para a 2B/3 (STATUS_INVALIDO).
create function api.cancelar_pedido(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_prestador boolean;
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA', 'CLIENTE') then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  v_prestador := v.papel in ('ADM', 'MOTORISTA');
  select * into a from app.atividades x where x.id = p_atividade for update;
  if a.id is null then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if (v.papel = 'MOTORISTA' and a.motorista_id <> v.usuario_id)
     or (v.papel = 'CLIENTE' and not (a.empresa_id = v.empresa_id
                                       and (v.nivel = 1 or (v.nivel = 2 and a.solicitante_id = v.usuario_id)))) then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if (v_prestador and length(v_motivo) not between 3 and 500) or length(v_motivo) > 500 then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status not in ('SOLICITADA', 'ORCADA') then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'CANCELADA', nullif(v_motivo, ''));
  perform interno.auditar('CANCELAR_PEDIDO', v_alvo, 'OK', null,
    jsonb_build_object('de', a.status, 'motivo', nullif(v_motivo, ''), 'prestador', v_prestador, 'multa_cent', 0));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 8. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.imutavel(),
  interno.atividade_validar_status(),
  interno.transicionar(uuid, app.status_atividade, text),
  interno.prazo_vencido(uuid),
  interno.expirar_atividade(uuid, boolean),
  interno.expirar_vencidos(),
  interno.validar_pedido(jsonb),
  interno.motorista_padrao()
from public, anon, authenticated;

revoke all on function
  api.criar_pedido(jsonb),
  api.recusar_pedido(uuid, text),
  api.cancelar_pedido(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  api.criar_pedido(jsonb),
  api.recusar_pedido(uuid, text),
  api.cancelar_pedido(uuid, text)
to authenticated;
