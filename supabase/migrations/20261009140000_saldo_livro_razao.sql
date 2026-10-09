-- Fase 2B, Task 1 (docs/fases/fase-2b-desenho-e-plano.md "Banco"; especificação §6, §9; Adendos A2, A10):
-- núcleo de dinheiro. Livro-razão imutável por empresa, conta com saldo contábil e reservado (mantida por trigger a
-- cada lançamento e conferida pela reconciliação), reservas, registro de aprovações, idempotência por empresa,
-- recarga/ajuste/estorno (só ADM), leituras (saldo, extrato, painel do ADM) e reconciliação diária (pg_cron).
--
-- CONVENÇÃO DE SINAIS (valor_cent em app.lancamentos):
--   * tipos FINANCEIROS mudam só o saldo contábil, com o próprio sinal (crédito +, débito −):
--       RECARGA > 0; AJUSTE ≠ 0; ESTORNO = −(valor do lançamento estornado);
--       DEBITO < 0, MULTA < 0, ADITIVO < 0 (cobranças).
--   * tipos de RESERVA têm efeito ZERO no contábil e guardam o VALOR RESERVADO (sempre ≥ 0):
--       RESERVA: reservado += valor_cent; LIBERACAO_RESERVA: reservado −= valor_cent.
--   * contábil = Σ efeito_contabil; reservado = Σ reservas ativas = Σ efeito_reservado; disponível = contábil − reservado.
--   interno.efeito_contabil / interno.efeito_reservado são a única tradução tipo+valor → efeito (trigger da conta,
--   reconciliação e extrato usam as duas).
--
-- CONCORRÊNCIA: toda operação de saldo trava a linha de app.contas (FOR UPDATE) antes de ler o saldo ou a chave de
-- idempotência. Ordem fixa de travas em todo o sistema: atividade → conta (sem deadlock).
-- IDEMPOTÊNCIA: app.idempotencia (empresa, chave) guarda o resultado de cada operação bem-sucedida; a mesma chave
-- devolve o resultado original sem novo efeito; chave reaproveitada para outra ação/alvo/valores → CHAVE_REUTILIZADA.
-- Chaves diferentes para a mesma ação de negócio esbarram nas unicidades (1 reserva ativa por atividade, 1 DEBITO e
-- 1 MULTA por atividade, 1 ESTORNO por lançamento) → JA_PROCESSADO (unique_violation capturada num subbloco; A2).
-- Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Tipos, contas, reservas, livro-razão, aprovações, idempotência e reconciliações.
------------------------------------------------------------------------------------------------
create type app.tipo_lancamento as enum (
  'RECARGA', 'DEBITO', 'MULTA', 'ADITIVO', 'AJUSTE', 'ESTORNO', 'RESERVA', 'LIBERACAO_RESERVA');

-- Teto de qualquer valor (R$ 1 bilhão), igual ao do cálculo do orçamento.
create function interno.teto_cent() returns bigint
language sql immutable set search_path = '' as $$ select 100000000000::bigint $$;

create function interno.efeito_contabil(p_tipo app.tipo_lancamento, p_valor bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_tipo in ('RESERVA', 'LIBERACAO_RESERVA') then 0::bigint else p_valor end
$$;
create function interno.efeito_reservado(p_tipo app.tipo_lancamento, p_valor bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case p_tipo when 'RESERVA' then p_valor when 'LIBERACAO_RESERVA' then -p_valor else 0::bigint end
$$;

-- Uma conta por empresa (criada para as existentes aqui e por trigger para as novas).
create table app.contas (
  empresa_id uuid primary key references app.empresas (id) on delete restrict,
  saldo_contabil_cent bigint not null default 0,
  reservado_cent bigint not null default 0 check (reservado_cent >= 0),
  atualizado_em timestamptz not null default now()
);
alter table app.contas enable row level security;
insert into app.contas (empresa_id) select e.id from app.empresas e on conflict (empresa_id) do nothing;

create function interno.empresa_criar_conta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.contas (empresa_id) values (new.id) on conflict (empresa_id) do nothing;
  return null;
end $$;
create trigger empresas_criar_conta after insert on app.empresas
  for each row execute function interno.empresa_criar_conta();

-- Reserva do valor aprovado (1 ativa por atividade). Só muda de ativa para liberada, uma vez.
create table app.reservas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references app.empresas (id) on delete restrict,
  atividade_id uuid not null references app.atividades (id) on delete restrict,
  orcamento_id uuid not null references app.orcamentos (id) on delete restrict,
  valor_cent bigint not null check (valor_cent >= 0 and valor_cent <= 100000000000),
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  liberada_em timestamptz,
  constraint reservas_liberacao check (ativa = (liberada_em is null))
);
create unique index reservas_uma_ativa on app.reservas (atividade_id) where ativa;
create index reservas_empresa on app.reservas (empresa_id, criada_em desc);
alter table app.reservas enable row level security;

create function interno.reserva_validar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'reservas são imutáveis' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'ativa' - 'liberada_em') is distinct from (to_jsonb(old) - 'ativa' - 'liberada_em')
     or not (old.ativa and not new.ativa and new.liberada_em is not null) then
    raise exception 'reserva só passa de ativa para liberada' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reservas_validar before update or delete on app.reservas
  for each row execute function interno.reserva_validar();
create trigger reservas_sem_truncate before truncate on app.reservas
  for each statement execute function interno.imutavel();

-- Livro-razão (imutável). Ver a convenção de sinais no topo.
create table app.lancamentos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references app.empresas (id) on delete restrict,
  tipo app.tipo_lancamento not null,
  valor_cent bigint not null check (abs(valor_cent) <= 100000000000),
  atividade_id uuid references app.atividades (id) on delete restrict,
  orcamento_id uuid references app.orcamentos (id) on delete restrict,
  reserva_id bigint references app.reservas (id) on delete restrict,
  estorna_id bigint unique references app.lancamentos (id) on delete restrict,  -- 1 ESTORNO por lançamento
  motivo text check (motivo is null or length(btrim(motivo)) between 3 and 500),
  comprovante text check (comprovante is null or length(comprovante) between 1 and 200),
  chave_idempotencia uuid not null,
  criado_por uuid,  -- uuid solto (como auditoria.usuario_id)
  criado_em timestamptz not null default now(),
  constraint lancamentos_sinal check (case tipo
    when 'RECARGA' then valor_cent > 0
    when 'AJUSTE' then valor_cent <> 0
    when 'ESTORNO' then valor_cent <> 0
    when 'DEBITO' then valor_cent < 0
    when 'MULTA' then valor_cent < 0
    when 'ADITIVO' then valor_cent < 0
    else valor_cent >= 0 end),                                   -- RESERVA / LIBERACAO_RESERVA: valor reservado
  constraint lancamentos_estorno check ((tipo = 'ESTORNO') = (estorna_id is not null)),
  constraint lancamentos_reserva check ((tipo in ('RESERVA', 'LIBERACAO_RESERVA')) = (reserva_id is not null)),
  constraint lancamentos_atividade check (
    tipo not in ('DEBITO', 'MULTA', 'ADITIVO', 'RESERVA', 'LIBERACAO_RESERVA') or atividade_id is not null),
  constraint lancamentos_manual_com_motivo check (tipo not in ('RECARGA', 'AJUSTE', 'ESTORNO') or motivo is not null),
  -- uma operação (chave) gera no máximo um lançamento de cada tipo
  constraint lancamentos_chave_tipo unique (empresa_id, chave_idempotencia, tipo)
);
create unique index lancamentos_um_debito on app.lancamentos (atividade_id) where tipo = 'DEBITO';
create unique index lancamentos_uma_multa on app.lancamentos (atividade_id) where tipo = 'MULTA';
create unique index lancamentos_uma_reserva on app.lancamentos (reserva_id) where tipo = 'RESERVA';
create unique index lancamentos_uma_liberacao on app.lancamentos (reserva_id) where tipo = 'LIBERACAO_RESERVA';
create index lancamentos_extrato on app.lancamentos (empresa_id, criado_em desc, id desc);
create index lancamentos_atividade on app.lancamentos (atividade_id) where atividade_id is not null;
alter table app.lancamentos enable row level security;

create function interno.lancamento_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'lançamentos são imutáveis (corrija com AJUSTE ou ESTORNO)' using errcode = '42501';
end $$;
create trigger lancamentos_sem_update before update or delete on app.lancamentos
  for each row execute function interno.lancamento_imutavel();
create trigger lancamentos_sem_truncate before truncate on app.lancamentos
  for each statement execute function interno.lancamento_imutavel();

-- Cada lançamento aplica o seu efeito na conta (o chamador já travou a conta) e avisa o tópico da empresa.
create function interno.lancamento_aplicar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update app.contas
     set saldo_contabil_cent = saldo_contabil_cent + interno.efeito_contabil(new.tipo, new.valor_cent),
         reservado_cent = reservado_cent + interno.efeito_reservado(new.tipo, new.valor_cent),
         atualizado_em = now()
   where empresa_id = new.empresa_id;
  if not found then
    raise exception 'conta da empresa % inexistente', new.empresa_id using errcode = '23503';
  end if;
  perform realtime.send(jsonb_build_object('empresa_id', new.empresa_id, 'em', now()), 'saldo',
                        'empresa:' || new.empresa_id::text, true);
  return null;
end $$;
create trigger lancamentos_aplicar after insert on app.lancamentos
  for each row execute function interno.lancamento_aplicar();

-- Registro da aprovação (§4.3): usuário, data/hora, IP, dispositivo, versão e hash do orçamento. Imutável.
create table app.aprovacoes (
  id bigint generated always as identity primary key,
  atividade_id uuid not null references app.atividades (id) on delete restrict,
  orcamento_id uuid not null unique references app.orcamentos (id) on delete restrict,
  orcamento_versao int not null,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  usuario_id uuid not null,
  em timestamptz not null default now(),
  ip text check (ip is null or length(ip) <= 64),
  dispositivo text check (dispositivo is null or length(dispositivo) <= 200),
  chave_idempotencia uuid not null
);
create index aprovacoes_atividade on app.aprovacoes (atividade_id);
alter table app.aprovacoes enable row level security;
create trigger aprovacoes_sem_update before update or delete on app.aprovacoes
  for each row execute function interno.imutavel();
create trigger aprovacoes_sem_truncate before truncate on app.aprovacoes
  for each statement execute function interno.imutavel();

-- Resultado de cada operação de saldo bem-sucedida, por (empresa, chave). Imutável.
create table app.idempotencia (
  empresa_id uuid not null references app.empresas (id) on delete restrict,
  chave uuid not null,
  acao text not null,
  alvo text not null,
  parametros jsonb not null,
  resultado jsonb not null,
  usuario_id uuid,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);
alter table app.idempotencia enable row level security;
create trigger idempotencia_sem_update before update or delete on app.idempotencia
  for each row execute function interno.imutavel();
create trigger idempotencia_sem_truncate before truncate on app.idempotencia
  for each statement execute function interno.imutavel();

-- Resultado da reconciliação diária. Imutável.
create table app.reconciliacoes (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  ok boolean not null,
  empresas int not null,
  divergencias jsonb not null check (jsonb_typeof(divergencias) = 'array')
);
create index reconciliacoes_em on app.reconciliacoes (em desc);
alter table app.reconciliacoes enable row level security;
create trigger reconciliacoes_sem_update before update or delete on app.reconciliacoes
  for each row execute function interno.imutavel();
create trigger reconciliacoes_sem_truncate before truncate on app.reconciliacoes
  for each statement execute function interno.imutavel();
-- Nenhuma tabela nova tem GRANT a authenticated: tudo passa pelas RPCs abaixo.

------------------------------------------------------------------------------------------------
-- 2. Quem pode o quê: LANCAR_SALDO (já existia) e VER_PAINEL_ADM, só ADM. Cliente nunca move saldo.
------------------------------------------------------------------------------------------------
create or replace function app.pode_fazer(acao text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or acao is null then return false; end if;
  case acao
    when 'GERIR_USUARIOS', 'GERIR_EMPRESAS', 'VER_AUDITORIA', 'GERIR_CONTRATOS', 'LANCAR_SALDO', 'GERIR_CONFIGURACAO',
         'VER_PAINEL_ADM' then
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
-- 3. Núcleo interno (o chamador sempre trava a conta antes).
------------------------------------------------------------------------------------------------

-- Trava (FOR UPDATE) e devolve a conta da empresa, criando-a se faltar.
create function interno.travar_conta(p_empresa uuid) returns app.contas
language plpgsql security definer set search_path = '' as $$
declare
  c app.contas;
begin
  select * into c from app.contas x where x.empresa_id = p_empresa for update;
  if c.empresa_id is null then
    insert into app.contas (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
    select * into c from app.contas x where x.empresa_id = p_empresa for update;
  end if;
  return c;
end $$;

-- Saldos da empresa + limite e alerta do contrato VIGENTE (sem contrato: 0).
create function interno.saldos(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'empresa_id', p_empresa,
    'saldo_contabil_cent', coalesce(c.saldo_contabil_cent, 0),
    'reservado_cent', coalesce(c.reservado_cent, 0),
    'disponivel_cent', coalesce(c.saldo_contabil_cent, 0) - coalesce(c.reservado_cent, 0),
    'limite_cent', coalesce(k.limite_saldo_negativo_cent, 0),
    'alerta_cent', coalesce(k.alerta_saldo_baixo_cent, 0),
    'abaixo_alerta', k.id is not null
                     and coalesce(c.saldo_contabil_cent, 0) - coalesce(c.reservado_cent, 0) < k.alerta_saldo_baixo_cent,
    'atualizado_em', c.atualizado_em)
  from (select p_empresa as id) x
  left join app.contas c on c.empresa_id = x.id
  left join lateral interno.contrato_vigente(x.id) k on true
$$;

-- null: chave nova; {confere:true, resultado}: repetição da mesma operação; {confere:false}: chave de outra operação.
create function interno.idempotencia_buscar(p_empresa uuid, p_chave uuid, p_acao text, p_alvo text, p_parametros jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when i.chave is null then null
              when i.acao = p_acao and i.alvo = p_alvo and i.parametros = p_parametros
                then jsonb_build_object('confere', true, 'resultado', i.resultado)
              else jsonb_build_object('confere', false) end
  from (select 1) x
  left join app.idempotencia i on i.empresa_id = p_empresa and i.chave = p_chave
$$;

create function interno.idempotencia_gravar(p_empresa uuid, p_chave uuid, p_acao text, p_alvo text, p_parametros jsonb,
                                            p_resultado jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into app.idempotencia (empresa_id, chave, acao, alvo, parametros, resultado, usuario_id)
  values (p_empresa, p_chave, p_acao, p_alvo, p_parametros, p_resultado, (select auth.uid()))
$$;

-- Grava um lançamento (o trigger aplica o efeito na conta). Devolve o id.
create function interno.inserir_lancamento(p_empresa uuid, p_tipo app.tipo_lancamento, p_valor bigint,
                                           p_atividade uuid, p_orcamento uuid, p_reserva bigint, p_estorna bigint,
                                           p_motivo text, p_comprovante text, p_chave uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into app.lancamentos (empresa_id, tipo, valor_cent, atividade_id, orcamento_id, reserva_id, estorna_id, motivo,
                               comprovante, chave_idempotencia, criado_por)
  values (p_empresa, p_tipo, p_valor, p_atividade, p_orcamento, p_reserva, p_estorna, p_motivo, p_comprovante, p_chave,
          (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- Lançamento manual do ADM (RECARGA, AJUSTE, ESTORNO), já validado pelo chamador: trava a conta, confere a chave,
-- grava (unicidade de regra → JA_PROCESSADO), registra a chave e audita.
create function interno.lancar_manual(p_acao text, p_tipo app.tipo_lancamento, p_empresa uuid, p_valor bigint,
                                      p_atividade uuid, p_estorna bigint, p_motivo text, p_comprovante text,
                                      p_chave uuid, p_parametros jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := case when p_estorna is not null then 'lancamento:' || p_estorna else 'empresa:' || p_empresa end;
  r jsonb;
  v_id bigint;
  v_res jsonb;
begin
  perform interno.travar_conta(p_empresa);
  r := interno.idempotencia_buscar(p_empresa, p_chave, p_acao, v_alvo, p_parametros);
  if r is not null then
    if (r ->> 'confere')::boolean then
      perform interno.auditar(p_acao, v_alvo, 'OK', null, jsonb_build_object('repeticao', true, 'chave', p_chave));
      return r -> 'resultado';
    end if;
    return interno.negar(p_acao, v_alvo, 'CHAVE_REUTILIZADA');
  end if;
  if p_estorna is not null and exists (select 1 from app.lancamentos l where l.estorna_id = p_estorna) then
    return interno.negar(p_acao, v_alvo, 'JA_PROCESSADO');
  end if;

  begin
    v_id := interno.inserir_lancamento(p_empresa, p_tipo, p_valor, p_atividade, null, null, p_estorna, p_motivo,
                                       p_comprovante, p_chave);
    v_res := jsonb_build_object('ok', true, 'lancamento_id', v_id, 'tipo', p_tipo, 'valor_cent', p_valor)
             || (select jsonb_build_object('saldo_contabil_cent', s -> 'saldo_contabil_cent',
                                           'reservado_cent', s -> 'reservado_cent',
                                           'disponivel_cent', s -> 'disponivel_cent')
                   from interno.saldos(p_empresa) s);
    perform interno.idempotencia_gravar(p_empresa, p_chave, p_acao, v_alvo, p_parametros, v_res);
  exception when unique_violation then
    return interno.negar(p_acao, v_alvo, 'JA_PROCESSADO');
  end;

  perform interno.auditar(p_acao, v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'lancamento_id', v_id, 'tipo', p_tipo, 'valor_cent', p_valor,
                       'motivo', p_motivo, 'chave', p_chave));
  return v_res;
end $$;

------------------------------------------------------------------------------------------------
-- 4. RPCs de lançamento (só ADM; motivo obrigatório; p_chave gerada pelo front a cada intenção).
------------------------------------------------------------------------------------------------

-- Recarga (Pix lançado pelo ADM): valor > 0; comprovante = ID do Pix ou observação (até 200).
-- Devolve {ok, lancamento_id, tipo, valor_cent, saldo_contabil_cent, reservado_cent, disponivel_cent}.
create function api.lancar_recarga(p_empresa uuid, p_valor_cent bigint, p_motivo text, p_comprovante text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_comprovante text := nullif(btrim(coalesce(p_comprovante, '')), '');
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null or p_chave is null or p_valor_cent is null or p_valor_cent <= 0
     or length(coalesce(v_comprovante, '')) > 200 then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if p_valor_cent > interno.teto_cent() then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'VALOR_FORA_DO_LIMITE');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  return interno.lancar_manual('LANCAR_RECARGA', 'RECARGA', p_empresa, p_valor_cent, null, null, v_motivo, v_comprovante,
                               p_chave, jsonb_build_object('valor_cent', p_valor_cent));
end $$;

-- Ajuste (correção do ADM): valor ≠ 0, crédito (+) ou débito (−). Mesmo retorno da recarga.
create function api.lancar_ajuste(p_empresa uuid, p_valor_cent bigint, p_motivo text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null or p_chave is null or p_valor_cent is null or p_valor_cent = 0 then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if abs(p_valor_cent) > interno.teto_cent() then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'VALOR_FORA_DO_LIMITE');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'NAO_ENCONTRADO');
  end if;
  return interno.lancar_manual('LANCAR_AJUSTE', 'AJUSTE', p_empresa, p_valor_cent, null, null, v_motivo, null,
                               p_chave, jsonb_build_object('valor_cent', p_valor_cent));
end $$;

-- Estorno: só de lançamento financeiro (RECARGA, AJUSTE, DEBITO, MULTA, ADITIVO), uma vez, com o valor oposto
-- (ESTORNO de ESTORNO e de reserva/liberação → NAO_ESTORNAVEL; segundo estorno → JA_PROCESSADO).
-- Retorno: o da recarga, com tipo ESTORNO.
create function api.estornar_lancamento(p_lancamento bigint, p_motivo text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'lancamento:' || coalesce(p_lancamento::text, '-');
  l app.lancamentos;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_lancamento is null or p_chave is null then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  select * into l from app.lancamentos x where x.id = p_lancamento;
  if l.id is null then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if l.tipo not in ('RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO') then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'NAO_ESTORNAVEL');
  end if;
  return interno.lancar_manual('ESTORNAR_LANCAMENTO', 'ESTORNO', l.empresa_id, -l.valor_cent, l.atividade_id, l.id,
                               v_motivo, null, p_chave, jsonb_build_object('lancamento_id', l.id));
end $$;

------------------------------------------------------------------------------------------------
-- 5. Leituras.
------------------------------------------------------------------------------------------------

-- Saldo: cliente (qualquer nível) só da própria empresa (p_empresa nulo = a própria); ADM de qualquer empresa.
-- Motorista e gestor de frota não veem saldo nem limite (Adendo A10).
-- {ok, empresa_id, saldo_contabil_cent, reservado_cent, disponivel_cent, limite_cent, alerta_cent, abaixo_alerta,
--  atualizado_em}
create function api.saldo_empresa(p_empresa uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_empresa uuid;
begin
  if v.usuario_id is null then
    return interno.negar('VER_SALDO', 'saldo', 'SEM_PERMISSAO');
  end if;
  if v.papel = 'ADM' then
    v_empresa := p_empresa;
  elsif v.papel = 'CLIENTE' and v.empresa_id is not null and (p_empresa is null or p_empresa = v.empresa_id) then
    v_empresa := v.empresa_id;
  else
    return interno.negar('VER_SALDO', 'saldo', 'SEM_PERMISSAO');
  end if;
  if v_empresa is null or not exists (select 1 from app.empresas e where e.id = v_empresa) then
    return interno.negar('VER_SALDO', 'saldo', 'NAO_ENCONTRADO');
  end if;
  return jsonb_build_object('ok', true) || interno.saldos(v_empresa);
end $$;

-- Extrato. p_filtro: {de?: ISO, ate?: ISO (sobre criado_em), tipos?: [tipo...], limite?: 1..500 (padrão 100)}.
-- Cliente (qualquer nível): a própria empresa; ADM: qualquer (p_empresa obrigatório). Todo cliente da empresa vê data,
-- tipo, valor, efeitos, nº do pedido e solicitante; atividade_id/pode_abrir só quando pode ver o pedido; motivo,
-- comprovante e autor só para o ADM.
-- {ok, empresa_id, itens: [{id, criado_em, tipo, valor_cent, efeito_contabil_cent, efeito_reservado_cent, numero,
--   solicitante_nome, pode_abrir, atividade_id, estorna_id, (ADM: motivo, comprovante, criado_por_nome)}]}
create function api.extrato(p_empresa uuid default null, p_filtro jsonb default '{}')
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
-- 6. Reconciliação diária.
------------------------------------------------------------------------------------------------

-- Recalcula e compara; grava o resultado em app.reconciliacoes e audita (divergência = ERRO). Divergências:
--   CONTA_DIVERGENTE: contábil da conta ≠ Σ efeito_contabil, ou reservado ≠ Σ reservas ativas, ou ≠ Σ efeito_reservado;
--   RESERVA_FORA_DE_AGENDADA: reserva ativa em atividade que não está AGENDADA;
--   AGENDADA_SEM_RESERVA: atividade AGENDADA sem reserva ativa;
--   COBRANCA_SEM_APROVACAO: DEBITO/MULTA em atividade sem aprovação registrada;
--   COBRANCA_DUPLICADA: mais de 1 DEBITO (ou mais de 1 MULTA) na mesma atividade.
-- Devolve {reconciliacao_id, ok, empresas, divergencias}.
create function interno.reconciliar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  n int;
  v_id bigint;
begin
  select count(*) into n from app.empresas;
  select coalesce(jsonb_agg(x.item), '[]') into d
  from (
    (select jsonb_build_object('tipo', 'CONTA_DIVERGENTE', 'empresa_id', e.id,
              'contabil_conta', coalesce(c.saldo_contabil_cent, 0), 'contabil_livro', coalesce(l.contabil, 0),
              'reservado_conta', coalesce(c.reservado_cent, 0), 'reservado_reservas', coalesce(r.reservado, 0),
              'reservado_livro', coalesce(l.reservado, 0)) as item
       from app.empresas e
       left join app.contas c on c.empresa_id = e.id
       left join lateral (select sum(interno.efeito_contabil(x.tipo, x.valor_cent)) as contabil,
                                 sum(interno.efeito_reservado(x.tipo, x.valor_cent)) as reservado
                            from app.lancamentos x where x.empresa_id = e.id) l on true
       left join lateral (select sum(x.valor_cent) as reservado
                            from app.reservas x where x.empresa_id = e.id and x.ativa) r on true
      where coalesce(c.saldo_contabil_cent, 0) <> coalesce(l.contabil, 0)
         or coalesce(c.reservado_cent, 0) <> coalesce(r.reservado, 0)
         or coalesce(c.reservado_cent, 0) <> coalesce(l.reservado, 0)
      order by e.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_FORA_DE_AGENDADA', 'empresa_id', x.empresa_id,
              'atividade_id', x.atividade_id, 'reserva_id', x.id, 'status', a.status)
       from app.reservas x join app.atividades a on a.id = x.atividade_id
      where x.ativa and a.status <> 'AGENDADA'
      order by x.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'AGENDADA_SEM_RESERVA', 'empresa_id', a.empresa_id, 'atividade_id', a.id)
       from app.atividades a
      where a.status = 'AGENDADA'
        and not exists (select 1 from app.reservas x where x.atividade_id = a.id and x.ativa)
      order by a.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'COBRANCA_SEM_APROVACAO', 'empresa_id', l.empresa_id,
              'atividade_id', l.atividade_id, 'lancamento_id', l.id, 'lancamento_tipo', l.tipo)
       from app.lancamentos l
      where l.tipo in ('DEBITO', 'MULTA')
        and not exists (select 1 from app.aprovacoes p where p.atividade_id = l.atividade_id)
      order by l.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'COBRANCA_DUPLICADA', 'empresa_id', min(l.empresa_id::text)::uuid,
              'atividade_id', l.atividade_id, 'lancamento_tipo', l.tipo, 'quantidade', count(*))
       from app.lancamentos l
      where l.tipo in ('DEBITO', 'MULTA')
      group by l.atividade_id, l.tipo
     having count(*) > 1
      order by l.atividade_id
      limit 200)
  ) x;

  insert into app.reconciliacoes (ok, empresas, divergencias)
  values (jsonb_array_length(d) = 0, n, d)
  returning id into v_id;
  if jsonb_array_length(d) = 0 then
    perform interno.auditar('RECONCILIAR_SALDOS', 'reconciliacao:' || v_id, 'OK', null,
      jsonb_build_object('empresas', n));
  else
    perform interno.auditar('RECONCILIAR_SALDOS', 'reconciliacao:' || v_id, 'ERRO', 'DIVERGENCIA_SALDO',
      jsonb_build_object('empresas', n, 'divergencias', jsonb_array_length(d)));
  end if;
  return jsonb_build_object('reconciliacao_id', v_id, 'ok', jsonb_array_length(d) = 0, 'empresas', n,
                            'divergencias', d);
end $$;

-- Diária às 03:00 de São Paulo (06:00 UTC; o pg_cron roda em UTC). Idempotente: o nome substitui o job.
select cron.schedule('reconciliar-saldos', '0 6 * * *', 'select interno.reconciliar()');

------------------------------------------------------------------------------------------------
-- 7. Painel do ADM.
------------------------------------------------------------------------------------------------

-- Período [p_de, p_ate) (padrão: do início do mês em São Paulo até agora; no máximo 366 dias).
-- {ok, periodo: {de, ate},
--  empresas: [{empresa_id, empresa_nome, tem_contrato, saldo_contabil_cent, reservado_cent, disponivel_cent,
--              limite_cent, alerta_cent, abaixo_alerta}],
--  corridas: {agendadas, em_andamento},
--  aprovado: {total_cent, quantidade}  (reservas criadas no período = valor aprovado; o realizado vem na fase 3),
--  pendencias: {aguardando_orcamento, aguardando_aprovacao, empresas_abaixo_alerta},
--  ultima_reconciliacao: {id, em, ok, empresas, divergencias_qtd, divergencias (até 50)} | null}
create function api.painel_adm(p_de timestamptz default null, p_ate timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_de timestamptz := coalesce(p_de,
    date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  v_ate timestamptz := coalesce(p_ate, now());
  v_empresas jsonb;
  v_corridas jsonb;
  v_aprovado jsonb;
  v_pend jsonb;
  v_rec jsonb;
begin
  if not (select app.pode_fazer('VER_PAINEL_ADM')) then
    return interno.negar('VER_PAINEL_ADM', 'painel', 'SEM_PERMISSAO');
  end if;
  if v_ate <= v_de or v_ate - v_de > interval '366 days' then
    return interno.negar('VER_PAINEL_ADM', 'painel', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('periodo')));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_nome', e.nome,
                                               'tem_contrato', exists (select 1 from interno.contrato_vigente(e.id)))
                            || interno.saldos(e.id) order by e.nome, e.id), '[]')
    into v_empresas
    from app.empresas e;

  select jsonb_build_object('agendadas', count(*) filter (where a.status = 'AGENDADA'),
                            'em_andamento', count(*) filter (where a.status = 'EM_ANDAMENTO'))
    into v_corridas
    from app.atividades a where a.status in ('AGENDADA', 'EM_ANDAMENTO');

  select jsonb_build_object('total_cent', coalesce(sum(r.valor_cent), 0), 'quantidade', count(*))
    into v_aprovado
    from app.reservas r where r.criada_em >= v_de and r.criada_em < v_ate;

  select jsonb_build_object(
           'aguardando_orcamento', count(*) filter (where a.status = 'SOLICITADA'),
           'aguardando_aprovacao', count(*) filter (where a.status = 'ORCADA'),
           'empresas_abaixo_alerta', (select count(*) from jsonb_array_elements(v_empresas) x
                                       where (x ->> 'abaixo_alerta')::boolean))
    into v_pend
    from app.atividades a
   where a.status in ('SOLICITADA', 'ORCADA') and not interno.prazo_vencido(a.id);

  select jsonb_build_object('id', r.id, 'em', r.em, 'ok', r.ok, 'empresas', r.empresas,
                            'divergencias_qtd', jsonb_array_length(r.divergencias),
                            'divergencias', (select coalesce(jsonb_agg(x), '[]')
                                               from (select x from jsonb_array_elements(r.divergencias) x limit 50) y))
    into v_rec
    from app.reconciliacoes r order by r.em desc, r.id desc limit 1;

  return jsonb_build_object('ok', true, 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                            'empresas', v_empresas, 'corridas', v_corridas, 'aprovado', v_aprovado,
                            'pendencias', v_pend, 'ultima_reconciliacao', v_rec);
end $$;

------------------------------------------------------------------------------------------------
-- 8. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.teto_cent(),
  interno.efeito_contabil(app.tipo_lancamento, bigint),
  interno.efeito_reservado(app.tipo_lancamento, bigint),
  interno.empresa_criar_conta(),
  interno.reserva_validar(),
  interno.lancamento_imutavel(),
  interno.lancamento_aplicar(),
  interno.travar_conta(uuid),
  interno.saldos(uuid),
  interno.idempotencia_buscar(uuid, uuid, text, text, jsonb),
  interno.idempotencia_gravar(uuid, uuid, text, text, jsonb, jsonb),
  interno.inserir_lancamento(uuid, app.tipo_lancamento, bigint, uuid, uuid, bigint, bigint, text, text, uuid),
  interno.lancar_manual(text, app.tipo_lancamento, uuid, bigint, uuid, bigint, text, text, uuid, jsonb),
  interno.reconciliar()
from public, anon, authenticated;

revoke all on function
  api.lancar_recarga(uuid, bigint, text, text, uuid),
  api.lancar_ajuste(uuid, bigint, text, uuid),
  api.estornar_lancamento(bigint, text, uuid),
  api.saldo_empresa(uuid),
  api.extrato(uuid, jsonb),
  api.painel_adm(timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  api.lancar_recarga(uuid, bigint, text, text, uuid),
  api.lancar_ajuste(uuid, bigint, text, uuid),
  api.estornar_lancamento(bigint, text, uuid),
  api.saldo_empresa(uuid),
  api.extrato(uuid, jsonb),
  api.painel_adm(timestamptz, timestamptz)
to authenticated;
