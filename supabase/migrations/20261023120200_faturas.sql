-- v2.1, Tarefa 2 (docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.3, §4.4, §6, §9): faturas quinzenais com NF.
--   * app.faturas agrupa lançamentos do livro-razão (app.faturas_itens); a fatura nunca é apagada: o cancelamento
--     guarda o motivo e desliga os itens, que voltam para o "A faturar". Um lançamento fica em uma única fatura ativa
--     (índice único parcial);
--   * entram na fatura os lançamentos DEBITO, MULTA, ADITIVO e AJUSTE criados enquanto o contrato vigente da empresa era
--     FATURADO (na prática: a partir do início da primeira versão Faturado), e o ESTORNO de um desses. Nunca RECARGA,
--     RESERVA, LIBERACAO_RESERVA nem PAGAMENTO_FATURA. Cada lançamento é da quinzena pela data local (America/Sao_Paulo)
--     do criado_em: um estorno que chega depois do fechamento cai na fatura seguinte, e a fatura já gerada não muda;
--   * o total da fatura é −Σ valor_cent dos itens (o débito é negativo; o estorno e o ajuste a favor, positivos);
--   * pagamento: lançamento PAGAMENTO_FATURA (> 0, sem atividade) igual ao total, uma vez por fatura (a chave do
--     lançamento é o id da fatura; a idempotência fica registrada). api.estornar_lancamento já recusa esse tipo
--     (NAO_ESTORNAVEL): a fatura tem cancelamento próprio, e a paga não se cancela;
--   * a NF fica no bucket privado notas-fiscais (PDF até 5 MB) em <empresa_id>/<uuid>.pdf: o ADM envia e troca; o ADM e o
--     N1 da empresa leem (link assinado). O arquivo nunca é sobrescrito: trocar o PDF é enviar outro caminho;
--   * api.painel_empresa no FATURADO traz a_faturar_cent, em_aberto_cent e vencidas_cent; interno.reconciliar ganha
--     FATURA_TOTAL_DIVERGENTE e LANCAMENTO_EM_DUAS_FATURAS.
-- Regras de sempre: security definer, search_path vazio, negações por interno.negar, trava da conta antes de ler ou
-- gravar o que é de dinheiro (ordem: conta → fatura), nenhum acesso direto às tabelas.

------------------------------------------------------------------------------------------------
-- 1. PAGAMENTO_FATURA no livro-razão: crédito (> 0) sem atividade, orçamento, reserva nem estorno. A CHECK de sinal de
--    20261009140000 já aceita o tipo (ramo "else": ≥ 0); esta exige > 0. interno.lancamento_validar não muda (não há
--    atividade/reserva a conferir), e o estorno continua restrito a RECARGA, AJUSTE, DEBITO, MULTA e ADITIVO.
------------------------------------------------------------------------------------------------
alter table app.lancamentos
  add constraint lancamentos_pagamento_fatura check (
    tipo <> 'PAGAMENTO_FATURA'
    or (valor_cent > 0 and atividade_id is null and orcamento_id is null and reserva_id is null));

------------------------------------------------------------------------------------------------
-- 2. Tabelas.
------------------------------------------------------------------------------------------------
create table app.faturas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references app.empresas (id) on delete restrict,
  numero int not null check (numero >= 1),                      -- sequencial por empresa
  inicio date not null,
  fim date not null,
  total_cent bigint not null check (total_cent > 0 and total_cent <= 100000000000),
  nf_numero text not null check (char_length(nf_numero) between 1 and 30 and nf_numero = btrim(nf_numero)),
  nf_emitida_em date not null,
  nf_pdf_caminho text not null check (char_length(nf_pdf_caminho) between 1 and 200),
  vencimento date not null,
  status text not null default 'ABERTA' check (status in ('ABERTA', 'PAGA', 'CANCELADA')),
  paga_em date,
  pagamento_lancamento_id bigint unique references app.lancamentos (id) on delete restrict,
  cancelada_motivo text check (cancelada_motivo is null or char_length(btrim(cancelada_motivo)) between 3 and 200),
  cancelada_em timestamptz,
  criada_por uuid,  -- uuid solto (como auditoria.usuario_id)
  criada_em timestamptz not null default now(),
  constraint faturas_numero unique (empresa_id, numero),
  -- quinzena: do dia 1 ao 15, ou do 16 ao último dia do mês
  constraint faturas_quinzena check (
    (extract(day from inicio) = 1 and fim = inicio + 14)
    or (extract(day from inicio) = 16 and fim = (inicio - 15 + interval '1 month')::date - 1)),
  constraint faturas_vencimento check (vencimento >= nf_emitida_em),
  constraint faturas_paga check ((status = 'PAGA') = (paga_em is not null and pagamento_lancamento_id is not null)),
  constraint faturas_cancelada check ((status = 'CANCELADA') = (cancelada_motivo is not null and cancelada_em is not null))
);
create index faturas_empresa on app.faturas (empresa_id, numero desc);
-- Uma fatura não cancelada por quinzena da empresa.
create unique index faturas_quinzena_unica on app.faturas (empresa_id, inicio) where status <> 'CANCELADA';
alter table app.faturas enable row level security;

create table app.faturas_itens (
  fatura_id uuid not null references app.faturas (id) on delete restrict,
  lancamento_id bigint not null references app.lancamentos (id) on delete restrict,
  ativa boolean not null default true,  -- a da fatura; desligada no cancelamento
  primary key (fatura_id, lancamento_id)
);
create unique index faturas_itens_um_ativo on app.faturas_itens (lancamento_id) where ativa;
create index faturas_itens_lancamento on app.faturas_itens (lancamento_id);
alter table app.faturas_itens enable row level security;
-- Sem GRANT a authenticated: só as funções leem e escrevem.

-- Fatura: nunca apagada; enquanto ABERTA, só mudam o status (para PAGA ou CANCELADA, com os campos de cada um) e o PDF;
-- depois de PAGA ou CANCELADA, não muda mais.
create function interno.fatura_validar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'faturas não são apagadas (cancele com motivo)' using errcode = '42501';
  end if;
  if old.status <> 'ABERTA'
     or (to_jsonb(new) - array['status', 'paga_em', 'pagamento_lancamento_id', 'cancelada_motivo', 'cancelada_em',
                               'nf_pdf_caminho'])
        is distinct from
        (to_jsonb(old) - array['status', 'paga_em', 'pagamento_lancamento_id', 'cancelada_motivo', 'cancelada_em',
                               'nf_pdf_caminho']) then
    raise exception 'fatura só muda enquanto aberta (paga, cancelada ou troca do PDF)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger faturas_validar before update or delete on app.faturas
  for each row execute function interno.fatura_validar();
create trigger faturas_sem_truncate before truncate on app.faturas
  for each statement execute function interno.imutavel();

-- Item: nasce ativo, com um lançamento faturável da mesma empresa da fatura; só passa de ativo para inativo, uma vez.
create function interno.fatura_item_validar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not new.ativa
       or not exists (select 1 from app.faturas f join app.lancamentos l on l.empresa_id = f.empresa_id
                       where f.id = new.fatura_id and f.status = 'ABERTA' and l.id = new.lancamento_id
                         and l.tipo in ('DEBITO', 'MULTA', 'ADITIVO', 'AJUSTE', 'ESTORNO')) then
      raise exception 'item de fatura incoerente com a fatura ou o lançamento' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op <> 'UPDATE' or new.fatura_id <> old.fatura_id or new.lancamento_id <> old.lancamento_id
     or not (old.ativa and not new.ativa) then
    raise exception 'item de fatura só passa de ativo para inativo' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger faturas_itens_validar before insert or update or delete on app.faturas_itens
  for each row execute function interno.fatura_item_validar();
create trigger faturas_itens_sem_truncate before truncate on app.faturas_itens
  for each statement execute function interno.imutavel();

------------------------------------------------------------------------------------------------
-- 3. Storage: bucket privado notas-fiscais, só PDF de até 5 MB, em <empresa_id>/<uuid>.pdf.
--    Envio: só o ADM, sempre num caminho novo (a troca do PDF envia outro arquivo; não há política de update). Leitura: o
--    ADM, ou o N1 (CLIENTE nível 1) cuja empresa é o primeiro segmento do caminho. Sem política de delete: a NF não é
--    apagada.
------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-fiscais', 'notas-fiscais', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['application/pdf'];

create policy notas_inserir on storage.objects for insert to authenticated
with check (
  bucket_id = 'notas-fiscais'
  and (select app.pode_fazer('LANCAR_SALDO'))
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  and exists (select 1 from app.empresas e where e.id::text = (storage.foldername(name))[1])
);

create policy notas_ler on storage.objects for select to authenticated
using (
  bucket_id = 'notas-fiscais'
  and (select (app.pode_acessar()).usuario_id) is not null
  and (
    (select (app.pode_acessar()).papel) = 'ADM'
    or ((select (app.pode_acessar()).papel) = 'CLIENTE'
        and (select (app.pode_acessar()).nivel) = 1
        and (storage.foldername(name))[1] = (select (app.pode_acessar()).empresa_id)::text)
  )
);

------------------------------------------------------------------------------------------------
-- 4. Núcleo interno.
------------------------------------------------------------------------------------------------

-- (1, 15) ou (16, último dia), no mesmo mês.
create function interno.quinzena_valida(p_inicio date, p_fim date) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_inicio is not null and p_fim is not null
                  and ((extract(day from p_inicio) = 1 and p_fim = p_inicio + 14)
                       or (extract(day from p_inicio) = 16
                           and p_fim = (p_inicio - 15 + interval '1 month')::date - 1)), false)
$$;

-- Hoje no horário de Brasília.
create function interno.hoje_local() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Fim (exclusivo) de um dia local: 00:00 do dia seguinte em America/Sao_Paulo.
create function interno.fim_do_dia_local(p_dia date) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo'
$$;

-- A última quinzena que já fechou (a anterior à de hoje).
create function interno.ultima_quinzena_fechada(out inicio date, out fim date)
language plpgsql stable set search_path = '' as $$
declare
  v_hoje date := interno.hoje_local();
  v_dia int := extract(day from v_hoje)::int;
begin
  if v_dia >= 16 then
    inicio := v_hoje - (v_dia - 1);
    fim := inicio + 14;
  else
    fim := v_hoje - v_dia;  -- último dia do mês anterior
    inicio := fim - (extract(day from fim)::int - 16);
  end if;
end $$;

-- Forma de cobrança do contrato da empresa em vigor no instante p_em (sem contrato: CREDITO).
create function interno.forma_em(p_empresa uuid, p_em timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.forma_cobranca from app.contratos_versoes c
                    where c.empresa_id = p_empresa and c.vigente_desde <= p_em
                    order by c.vigente_desde desc, c.versao desc limit 1), 'CREDITO')
$$;

-- Faturável: DEBITO, MULTA, ADITIVO ou AJUSTE criado no FATURADO, ou o ESTORNO de um desses.
create function interno.lancamento_faturavel(l app.lancamentos) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when l.tipo in ('DEBITO', 'MULTA', 'ADITIVO', 'AJUSTE') then interno.forma_em(l.empresa_id, l.criado_em) = 'FATURADO'
    when l.tipo = 'ESTORNO' then exists (
      select 1 from app.lancamentos o
       where o.id = l.estorna_id and o.tipo in ('DEBITO', 'MULTA', 'ADITIVO', 'AJUSTE')
         and interno.forma_em(o.empresa_id, o.criado_em) = 'FATURADO')
    else false end
$$;

-- O que ainda não está em fatura ativa, criado antes de p_ate (exclusivo), na ordem do livro-razão.
create function interno.itens_a_faturar(p_empresa uuid, p_ate timestamptz) returns setof app.lancamentos
language sql stable security definer set search_path = '' as $$
  select l.*
    from app.lancamentos l
   where l.empresa_id = p_empresa
     and l.criado_em < p_ate
     and l.tipo in ('DEBITO', 'MULTA', 'ADITIVO', 'AJUSTE', 'ESTORNO')
     -- nada de antes da primeira versão FATURADO (o estorno vem sempre depois do original)
     and l.criado_em >= (select min(c.vigente_desde) from app.contratos_versoes c
                          where c.empresa_id = p_empresa and c.forma_cobranca = 'FATURADO')
     and not exists (select 1 from app.faturas_itens i where i.lancamento_id = l.id and i.ativa)
     and interno.lancamento_faturavel(l)
   order by l.criado_em, l.id
$$;

-- Um item (da prévia, do "A faturar" ou da fatura): o lançamento e a corrida, quando houver.
create function interno.item_fatura(l app.lancamentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lancamento_id', l.id, 'criado_em', l.criado_em, 'tipo', l.tipo, 'valor_cent', l.valor_cent,
    'numero', a.numero, 'solicitante_nome', p.nome, 'origem', a.origem,
    'paradas', case when a.id is not null then
                 coalesce((select jsonb_agg(x.texto order by x.ordem) from app.atividades_paradas x
                            where x.atividade_id = a.id), '[]'::jsonb) end,
    'destino', a.destino, 'categoria_nome', k.nome, 'centro_custo', a.centro_custo)
  from (select 1) z
  left join app.atividades a on a.id = l.atividade_id
  left join app.perfis p on p.usuario_id = a.solicitante_id
  left join app.categorias k on k.codigo = a.categoria
$$;

-- Cabeçalho da fatura, com a situação calculada (VENCIDA = ABERTA com vencimento antes de hoje local).
create function interno.fatura_json(f app.faturas) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', f.id, 'numero', f.numero, 'inicio', f.inicio, 'fim', f.fim, 'total_cent', f.total_cent,
    'nf_numero', f.nf_numero, 'nf_emitida_em', f.nf_emitida_em, 'nf_pdf_caminho', f.nf_pdf_caminho,
    'vencimento', f.vencimento, 'status', f.status,
    'situacao', case when f.status = 'ABERTA' and f.vencimento < interno.hoje_local() then 'VENCIDA' else f.status end,
    'paga_em', f.paga_em)
$$;

-- Os três números do Faturado: o que ainda não foi faturado (tudo até agora), as faturas abertas e, delas, as vencidas.
create function interno.resumo_faturas(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'a_faturar_cent', coalesce((select -sum(l.valor_cent) from interno.itens_a_faturar(p_empresa, 'infinity') l), 0),
    'em_aberto_cent', coalesce((select sum(f.total_cent) from app.faturas f
                                 where f.empresa_id = p_empresa and f.status = 'ABERTA'), 0),
    'vencidas_cent', coalesce((select sum(f.total_cent) from app.faturas f
                                where f.empresa_id = p_empresa and f.status = 'ABERTA'
                                  and f.vencimento < interno.hoje_local()), 0))
$$;

-- p_caminho é um PDF da empresa no bucket: <empresa_id>/<uuid>.pdf e já enviado.
create function interno.pdf_nota_valido(p_empresa uuid, p_caminho text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_caminho ~ ('^' || p_empresa::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
    and exists (select 1 from storage.objects o where o.bucket_id = 'notas-fiscais' and o.name = p_caminho), false)
$$;

------------------------------------------------------------------------------------------------
-- 5. RPCs do ADM (escrita).
------------------------------------------------------------------------------------------------

-- O que entraria na fatura da quinzena (também a que está em andamento). Não grava nada.
-- {ok, total_cent, itens:[item]}
create function api.previa_fatura(p_empresa uuid, p_inicio date, p_fim date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
  v_itens jsonb;
  v_total bigint;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('PREVIA_FATURA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('PREVIA_FATURA', 300, interval '1 hour') then
    return interno.negar('PREVIA_FATURA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null then
    return interno.negar('PREVIA_FATURA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PREVIA_FATURA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if not exists (select 1 from app.contratos_versoes c
                  where c.empresa_id = p_empresa and c.forma_cobranca = 'FATURADO' and c.vigente_desde <= now()) then
    return interno.negar('PREVIA_FATURA', v_alvo, 'NAO_FATURADO');
  end if;
  if not interno.quinzena_valida(p_inicio, p_fim) then
    return interno.negar('PREVIA_FATURA', v_alvo, 'QUINZENA_INVALIDA');
  end if;
  select coalesce(jsonb_agg(interno.item_fatura(l) order by l.criado_em, l.id), '[]'::jsonb),
         coalesce(-sum(l.valor_cent), 0)
    into v_itens, v_total
    from interno.itens_a_faturar(p_empresa, interno.fim_do_dia_local(p_fim)) l;
  return jsonb_build_object('ok', true, 'total_cent', v_total, 'itens', v_itens);
end $$;

-- Gera a fatura da quinzena (já fechada) com a NF emitida na prefeitura: p_nf = {numero, emitida_em, pdf_caminho,
-- vencimento?}; sem vencimento, emissão + 30 dias. Leva tudo o que ainda não foi faturado até o fim da quinzena.
-- Recusas: NAO_FATURADO, QUINZENA_INVALIDA, QUINZENA_EM_ANDAMENTO (o fim ainda não passou), CAMPOS_INVALIDOS (detalhe
-- com os campos da NF), NADA_A_FATURAR (nenhum item ou total ≤ 0). {ok, fatura, numero}
create function api.gerar_fatura(p_empresa uuid, p_inicio date, p_fim date, p_nf jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
  inv text[] := '{}';
  v_numero_nf text;
  v_emitida date;
  v_vencimento date;
  v_caminho text;
  v_ids bigint[];
  v_total bigint;
  v_numero int;
  v_id uuid;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('GERAR_FATURA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('GERAR_FATURA', 60, interval '1 hour') then
    return interno.negar('GERAR_FATURA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null then
    return interno.negar('GERAR_FATURA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('GERAR_FATURA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if not exists (select 1 from app.contratos_versoes c
                  where c.empresa_id = p_empresa and c.forma_cobranca = 'FATURADO' and c.vigente_desde <= now()) then
    return interno.negar('GERAR_FATURA', v_alvo, 'NAO_FATURADO');
  end if;
  if not interno.quinzena_valida(p_inicio, p_fim) then
    return interno.negar('GERAR_FATURA', v_alvo, 'QUINZENA_INVALIDA');
  end if;
  if p_fim >= interno.hoje_local() then
    return interno.negar('GERAR_FATURA', v_alvo, 'QUINZENA_EM_ANDAMENTO');
  end if;

  -- NF
  if p_nf is null or jsonb_typeof(p_nf) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_nf) k where k not in ('numero', 'emitida_em', 'pdf_caminho', 'vencimento')) then
    inv := array_append(inv, 'p_nf');
  else
    v_numero_nf := case when jsonb_typeof(p_nf -> 'numero') = 'string' then btrim(p_nf ->> 'numero') end;
    if v_numero_nf is null or char_length(v_numero_nf) not between 1 and 30 then
      inv := array_append(inv, 'numero');
    end if;
    if jsonb_typeof(p_nf -> 'emitida_em') = 'string' and (p_nf ->> 'emitida_em') ~ '^\d{4}-\d{2}-\d{2}$'
       and pg_input_is_valid(p_nf ->> 'emitida_em', 'date') then
      v_emitida := (p_nf ->> 'emitida_em')::date;
    else
      inv := array_append(inv, 'emitida_em');
    end if;
    if coalesce(jsonb_typeof(p_nf -> 'vencimento'), 'null') = 'null' then
      v_vencimento := v_emitida + 30;
    elsif jsonb_typeof(p_nf -> 'vencimento') = 'string' and (p_nf ->> 'vencimento') ~ '^\d{4}-\d{2}-\d{2}$'
          and pg_input_is_valid(p_nf ->> 'vencimento', 'date')
          and (v_emitida is null or (p_nf ->> 'vencimento')::date >= v_emitida) then
      v_vencimento := (p_nf ->> 'vencimento')::date;
    else
      inv := array_append(inv, 'vencimento');
    end if;
    v_caminho := case when jsonb_typeof(p_nf -> 'pdf_caminho') = 'string' then p_nf ->> 'pdf_caminho' end;
    if not interno.pdf_nota_valido(p_empresa, v_caminho) then
      inv := array_append(inv, 'pdf_caminho');
    end if;
  end if;
  if cardinality(inv) > 0 then
    return interno.negar('GERAR_FATURA', v_alvo, 'CAMPOS_INVALIDOS', jsonb_build_object('invalidos', to_jsonb(inv)));
  end if;

  -- itens e total sob a trava da conta (um segundo "Gerar" espera este e não acha mais nada)
  perform interno.travar_conta(p_empresa);
  select coalesce(array_agg(l.id order by l.criado_em, l.id), '{}'), coalesce(-sum(l.valor_cent), 0)
    into v_ids, v_total
    from interno.itens_a_faturar(p_empresa, interno.fim_do_dia_local(p_fim)) l;
  if cardinality(v_ids) = 0 or v_total <= 0 then
    return interno.negar('GERAR_FATURA', v_alvo, 'NADA_A_FATURAR',
      jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'itens', cardinality(v_ids), 'total_cent', v_total));
  end if;
  -- a quinzena já tem fatura não cancelada: o que sobrou (lançamento datado nela depois do fechamento) vai na seguinte
  if exists (select 1 from app.faturas f
              where f.empresa_id = p_empresa and f.inicio = p_inicio and f.status <> 'CANCELADA') then
    return interno.negar('GERAR_FATURA', v_alvo, 'NADA_A_FATURAR',
      jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'ja_faturada', true));
  end if;
  if v_total > interno.teto_cent() then
    return interno.negar('GERAR_FATURA', v_alvo, 'VALOR_FORA_DO_LIMITE');
  end if;

  select coalesce(max(f.numero), 0) + 1 into v_numero from app.faturas f where f.empresa_id = p_empresa;
  begin
    insert into app.faturas (empresa_id, numero, inicio, fim, total_cent, nf_numero, nf_emitida_em, nf_pdf_caminho,
                             vencimento, criada_por)
    values (p_empresa, v_numero, p_inicio, p_fim, v_total, v_numero_nf, v_emitida, v_caminho, v_vencimento,
            (select auth.uid()))
    returning id into v_id;
    insert into app.faturas_itens (fatura_id, lancamento_id) select v_id, x from unnest(v_ids) x;
  exception when unique_violation then
    -- defesa: a trava da conta já serializa; um concorrente que passou na frente deixa esta sem nada a faturar
    return interno.negar('GERAR_FATURA', v_alvo, 'NADA_A_FATURAR',
      jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'ja_faturada', true));
  end;

  perform interno.auditar('GERAR_FATURA', 'fatura:' || v_id, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'numero', v_numero, 'inicio', p_inicio, 'fim', p_fim,
                       'total_cent', v_total, 'itens', cardinality(v_ids), 'nf_numero', v_numero_nf,
                       'nf_emitida_em', v_emitida, 'vencimento', v_vencimento, 'nf_pdf_caminho', v_caminho));
  return jsonb_build_object('ok', true, 'fatura', v_id, 'numero', v_numero);
end $$;

-- Marca a fatura como paga: lança PAGAMENTO_FATURA = total (uma vez: a chave do lançamento é o id da fatura).
-- Recusas: JA_PROCESSADO (já paga), FATURA_CANCELADA, CAMPOS_INVALIDOS (data vazia, no futuro ou antes da emissão da
-- NF). {ok, lancamento_id}
create function api.marcar_fatura_paga(p_fatura uuid, p_paga_em date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'fatura:' || coalesce(p_fatura::text, '-');
  f app.faturas;
  v_empresa uuid;
  v_lanc bigint;
  v_res jsonb;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_fatura is null or p_paga_em is null or p_paga_em > interno.hoje_local() then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  select x.empresa_id into v_empresa from app.faturas x where x.id = p_fatura;
  if v_empresa is null then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  perform interno.travar_conta(v_empresa);
  select * into f from app.faturas x where x.id = p_fatura for update;
  if f.status = 'PAGA' then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'JA_PROCESSADO');
  end if;
  if f.status = 'CANCELADA' then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'FATURA_CANCELADA');
  end if;
  if p_paga_em < f.nf_emitida_em then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('paga_em')));
  end if;

  begin
    v_lanc := interno.inserir_lancamento(f.empresa_id, 'PAGAMENTO_FATURA', f.total_cent, null, null, null, null,
      'Pagamento da fatura nº ' || f.numero || ' (NF ' || f.nf_numero || ')', null, f.id);
    update app.faturas set status = 'PAGA', paga_em = p_paga_em, pagamento_lancamento_id = v_lanc where id = f.id;
    v_res := jsonb_build_object('ok', true, 'lancamento_id', v_lanc);
    perform interno.idempotencia_gravar(f.empresa_id, f.id, 'MARCAR_FATURA_PAGA', v_alvo,
                                        jsonb_build_object('paga_em', p_paga_em), v_res);
  exception when unique_violation then
    return interno.negar('MARCAR_FATURA_PAGA', v_alvo, 'JA_PROCESSADO');
  end;

  perform interno.auditar('MARCAR_FATURA_PAGA', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', f.empresa_id, 'numero', f.numero, 'total_cent', f.total_cent,
                       'paga_em', p_paga_em, 'lancamento_id', v_lanc));
  return v_res;
end $$;

-- Cancela a fatura ABERTA (a NF cancelada na prefeitura): guarda o motivo (3 a 200 caracteres) e desliga os itens, que
-- voltam para o "A faturar". Recusas: FATURA_PAGA, FATURA_CANCELADA, MOTIVO_OBRIGATORIO. {ok}
create function api.cancelar_fatura(p_fatura uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'fatura:' || coalesce(p_fatura::text, '-');
  v_motivo text := btrim(coalesce(p_motivo, ''));
  f app.faturas;
  v_empresa uuid;
  v_itens int;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_fatura is null then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if char_length(v_motivo) not between 3 and 200 then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  select x.empresa_id into v_empresa from app.faturas x where x.id = p_fatura;
  if v_empresa is null then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  perform interno.travar_conta(v_empresa);
  select * into f from app.faturas x where x.id = p_fatura for update;
  if f.status = 'PAGA' then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'FATURA_PAGA');
  end if;
  if f.status = 'CANCELADA' then
    return interno.negar('CANCELAR_FATURA', v_alvo, 'FATURA_CANCELADA');
  end if;
  update app.faturas set status = 'CANCELADA', cancelada_motivo = v_motivo, cancelada_em = now() where id = f.id;
  update app.faturas_itens set ativa = false where fatura_id = f.id and ativa;
  get diagnostics v_itens = row_count;
  perform interno.auditar('CANCELAR_FATURA', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', f.empresa_id, 'numero', f.numero, 'total_cent', f.total_cent,
                       'motivo', v_motivo, 'itens', v_itens));
  return jsonb_build_object('ok', true);
end $$;

-- Troca o PDF da NF enquanto a fatura não está paga (nem cancelada). Recusas: FATURA_PAGA, FATURA_CANCELADA,
-- CAMPOS_INVALIDOS (caminho fora de <empresa_id>/<uuid>.pdf ou ainda não enviado). {ok}
create function api.trocar_pdf_fatura(p_fatura uuid, p_caminho text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'fatura:' || coalesce(p_fatura::text, '-');
  f app.faturas;
  v_empresa uuid;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_fatura is null then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  select x.empresa_id into v_empresa from app.faturas x where x.id = p_fatura;
  if v_empresa is null then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  perform interno.travar_conta(v_empresa);
  select * into f from app.faturas x where x.id = p_fatura for update;
  if f.status = 'PAGA' then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'FATURA_PAGA');
  end if;
  if f.status = 'CANCELADA' then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'FATURA_CANCELADA');
  end if;
  if not interno.pdf_nota_valido(f.empresa_id, p_caminho) then
    return interno.negar('TROCAR_PDF_FATURA', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('pdf_caminho')));
  end if;
  update app.faturas set nf_pdf_caminho = p_caminho where id = f.id;
  perform interno.auditar('TROCAR_PDF_FATURA', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', f.empresa_id, 'numero', f.numero, 'de', f.nf_pdf_caminho, 'para', p_caminho));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Leituras: o ADM (qualquer empresa) e o N1 da empresa (a própria). N2, N3, motorista e gestor: SEM_PERMISSAO.
------------------------------------------------------------------------------------------------

-- Aba Faturas do N1 (p_empresa nulo = a própria) e a empresa na tela Faturas do ADM.
-- {ok, forma_cobranca, a_faturar:{total_cent, itens}, em_aberto_cent, vencidas_cent, faturas:[fatura]}
create function api.faturas(p_empresa uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_empresa uuid;
  v_resumo jsonb;
  v_itens jsonb;
begin
  if v.usuario_id is not null and v.papel = 'CLIENTE' and v.nivel = 1 and v.empresa_id is not null
     and (p_empresa is null or p_empresa = v.empresa_id) then
    v_empresa := v.empresa_id;
  elsif v.usuario_id is not null and v.papel = 'ADM' then
    if p_empresa is null then
      return interno.negar('VER_FATURAS', 'empresa', 'CAMPOS_INVALIDOS');
    end if;
    if not exists (select 1 from app.empresas e where e.id = p_empresa) then
      return interno.negar('VER_FATURAS', 'empresa:' || p_empresa::text, 'NAO_ENCONTRADO');
    end if;
    v_empresa := p_empresa;
  else
    return interno.negar('VER_FATURAS', 'empresa:' || coalesce(p_empresa::text, '-'), 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('VER_FATURAS', 300, interval '1 hour') then
    return interno.negar('VER_FATURAS', 'empresa:' || v_empresa::text, 'LIMITE_EXCEDIDO');
  end if;

  v_resumo := interno.resumo_faturas(v_empresa);
  select coalesce(jsonb_agg(interno.item_fatura(s.l) order by (s.l).criado_em, (s.l).id), '[]'::jsonb) into v_itens
    from (select l from interno.itens_a_faturar(v_empresa, 'infinity') l order by l.criado_em, l.id limit 1000) s;
  return jsonb_build_object('ok', true,
    'forma_cobranca', interno.forma_cobranca(v_empresa),
    'a_faturar', jsonb_build_object('total_cent', (v_resumo ->> 'a_faturar_cent')::bigint, 'itens', v_itens),
    'em_aberto_cent', (v_resumo ->> 'em_aberto_cent')::bigint,
    'vencidas_cent', (v_resumo ->> 'vencidas_cent')::bigint,
    'faturas', coalesce((select jsonb_agg(interno.fatura_json(s.f) order by s.numero desc)
                           from (select f, f.numero from app.faturas f where f.empresa_id = v_empresa
                                  order by f.numero desc limit 200) s), '[]'::jsonb));
end $$;

-- Uma fatura com os itens (no formato da prévia). {ok, fatura, itens}
create function api.fatura(p_fatura uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_alvo text := 'fatura:' || coalesce(p_fatura::text, '-');
  f app.faturas;
begin
  if v.usuario_id is null or not (v.papel = 'ADM' or (v.papel = 'CLIENTE' and v.nivel = 1)) then
    return interno.negar('VER_FATURA', v_alvo, 'SEM_PERMISSAO');
  end if;
  -- o limite vem antes de dizer se a fatura existe (não vira sonda de ids)
  if not interno.checar_limite('VER_FATURAS', 300, interval '1 hour') then
    return interno.negar('VER_FATURA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  select * into f from app.faturas x where x.id = p_fatura;
  if f.id is null or (v.papel = 'CLIENTE' and f.empresa_id is distinct from v.empresa_id) then
    return interno.negar('VER_FATURA', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  return jsonb_build_object('ok', true, 'fatura', interno.fatura_json(f),
    'itens', coalesce((select jsonb_agg(interno.item_fatura(l) order by l.criado_em, l.id)
                         from app.faturas_itens i join app.lancamentos l on l.id = i.lancamento_id
                        where i.fatura_id = f.id), '[]'::jsonb));
end $$;

-- Só o ADM: uma linha por empresa cuja vigente é FATURADO e também por empresa que voltou ao Crédito mas ainda tem
-- fatura ABERTA ou algo a faturar do tempo do Faturado. quinzena_pronta = a última quinzena fechada, se ela tem o
-- que faturar (total > 0); senão null. {ok, empresas:[{empresa_id, empresa_nome, a_faturar_cent, em_aberto_cent,
-- vencidas_cent, quinzena_pronta}]}
create function api.faturas_resumo()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  q record;
  v_ate timestamptz;
begin
  if v.usuario_id is null or v.papel <> 'ADM' then
    return interno.negar('VER_FATURAS', 'faturas', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('VER_FATURAS', 300, interval '1 hour') then
    return interno.negar('VER_FATURAS', 'faturas', 'LIMITE_EXCEDIDO');
  end if;
  select * into q from interno.ultima_quinzena_fechada();
  v_ate := interno.fim_do_dia_local(q.fim);
  return jsonb_build_object('ok', true, 'empresas', coalesce((
    select jsonb_agg(jsonb_build_object('empresa_id', e.id, 'empresa_nome', e.nome)
                     || interno.resumo_faturas(e.id)
                     || jsonb_build_object('quinzena_pronta',
                          case when (select coalesce(-sum(l.valor_cent), 0) from interno.itens_a_faturar(e.id, v_ate) l) > 0
                               then jsonb_build_object('inicio', q.inicio, 'fim', q.fim) end)
                     order by e.nome, e.id)
      from app.empresas e
     where interno.forma_cobranca(e.id) = 'FATURADO'
        or exists (select 1 from app.faturas f where f.empresa_id = e.id and f.status = 'ABERTA')
        or exists (select 1 from interno.itens_a_faturar(e.id, 'infinity'))), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------------------------
-- 7. Painel da empresa (corpo de 20261023120000_forma_cobranca.sql): no FATURADO, o resumo traz também a_faturar_cent,
--    em_aberto_cent e vencidas_cent. No CREDITO, a resposta é a mesma de antes.
------------------------------------------------------------------------------------------------
create or replace function api.painel_empresa(p_empresa uuid default null, p_mes date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_empresa uuid;
  v_mes date := date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_ini timestamptz;
  v_fim timestamptz;
  v_saldos jsonb;
  v_inicial bigint;
  v_recargas bigint;
  v_gasto bigint;
  v_limite bigint;
  v_forma text;
  v_resumo jsonb;
begin
  if v.usuario_id is not null and v.papel = 'CLIENTE' and v.nivel = 1 then
    v_empresa := v.empresa_id;  -- o N1: sempre a própria empresa
  elsif v.usuario_id is not null and v.papel = 'ADM' then
    if p_empresa is null then
      return interno.negar('PAINEL_EMPRESA', 'empresa', 'CAMPOS_INVALIDOS');
    end if;
    if not exists (select 1 from app.empresas e where e.id = p_empresa) then
      return interno.negar('PAINEL_EMPRESA', 'empresa:' || p_empresa::text, 'NAO_ENCONTRADO');
    end if;
    v_empresa := p_empresa;
  else
    return interno.negar('PAINEL_EMPRESA', 'empresa:' || coalesce(p_empresa::text, '-'), 'SEM_PERMISSAO');
  end if;
  -- R18: limite de leituras por pessoa
  if not interno.checar_limite('PAINEL_EMPRESA', 120, interval '1 hour') then
    return interno.negar('PAINEL_EMPRESA', 'empresa:' || v_empresa::text, 'LIMITE_EXCEDIDO');
  end if;

  v_ini := v_mes::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  v_saldos := interno.saldos(v_empresa);

  select coalesce(sum(interno.efeito_contabil(l.tipo, l.valor_cent)), 0) into v_inicial
    from app.lancamentos l where l.empresa_id = v_empresa and l.criado_em < v_ini;
  select coalesce(sum(l.valor_cent), 0) into v_recargas
    from app.lancamentos l
   where l.empresa_id = v_empresa and l.tipo = 'RECARGA' and l.criado_em >= v_ini and l.criado_em < v_fim;
  -- Cobranças são negativas e o estorno de uma cobrança é positivo: o gasto é o oposto da soma.
  select coalesce(-sum(l.valor_cent), 0) into v_gasto
    from app.lancamentos l
    left join app.lancamentos e on e.id = l.estorna_id
   where l.empresa_id = v_empresa and l.criado_em >= v_ini and l.criado_em < v_fim
     and (l.tipo in ('DEBITO', 'MULTA', 'ADITIVO')
          or (l.tipo = 'ESTORNO' and e.tipo in ('DEBITO', 'MULTA', 'ADITIVO')));
  v_forma := v_saldos ->> 'forma_cobranca';
  -- v2.1: no FATURADO o limite de saldo negativo não se aplica.
  v_limite := case when v_forma = 'FATURADO' then 0
                   else coalesce((select k.limite_saldo_negativo_cent from interno.contrato_vigente(v_empresa) k), 0) end;
  v_resumo := jsonb_build_object(
      'mes', to_char(v_mes, 'YYYY-MM-DD'),
      'gasto_cent', v_gasto,
      'reservado_cent', (v_saldos ->> 'reservado_cent')::bigint,
      'disponivel_cent', (v_saldos ->> 'disponivel_cent')::bigint,
      'total_mes_cent', v_inicial + v_recargas + v_limite,
      'contato_recarga', (select c.contato_recarga from app.configuracao c where c.id),
      'forma_cobranca', v_forma);
  -- v2.1, Tarefa 2: os números das faturas (só no FATURADO)
  if v_forma = 'FATURADO' then
    v_resumo := v_resumo || interno.resumo_faturas(v_empresa);
  end if;

  return jsonb_build_object('ok', true,
    'resumo', v_resumo,
    'proximas', coalesce((
      select jsonb_agg(interno.painel_pedido(s.a) order by s.inicio, s.numero)
        from (select x as a, x.inicio, x.numero from app.atividades x
               where x.empresa_id = v_empresa and x.status in ('SOLICITADA', 'ORCADA', 'AGENDADA')
               order by x.inicio, x.numero limit 10) s), '[]'::jsonb),
    'recentes', coalesce((
      select jsonb_agg(interno.painel_pedido(s.a) order by s.inicio desc, s.numero desc)
        from (select x as a, x.inicio, x.numero from app.atividades x
               where x.empresa_id = v_empresa
                 and x.status in ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'RECUSADA', 'REPROVADA', 'EXPIRADA')
                 and x.inicio >= now() - interval '30 days'
               order by x.inicio desc, x.numero desc limit 10) s), '[]'::jsonb),
    'do_mes', coalesce((
      select jsonb_agg(interno.painel_pedido(s.a) order by s.inicio, s.numero)
        from (select x as a, x.inicio, x.numero from app.atividades x
               where x.empresa_id = v_empresa and x.status in ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')
                 and x.inicio >= v_ini and x.inicio < v_fim
               order by x.inicio, x.numero limit 1000) s), '[]'::jsonb),
    'pessoas', jsonb_build_object(
      'sem_corridas', (
        select count(*) from app.perfis p
         where p.empresa_id = v_empresa and p.papel = 'CLIENTE' and p.nivel in (1, 2) and p.ativo
           and not exists (select 1 from app.atividades x
                            where x.solicitante_id = p.usuario_id and x.criada_em >= now() - interval '90 days')),
      'convites_pendentes', (
        select count(*) from app.convites c
         where c.empresa_id = v_empresa and c.usado_em is null and c.criado_em > now() - interval '24 hours')
        + (select count(*) from app.perfis p
            where p.empresa_id = v_empresa and p.ativo and p.senha_pendente
              and exists (select 1 from interno.links_acesso l
                           where l.usuario_id = p.usuario_id and l.usado_em is null and l.expira_em > now()))));
end $$;

------------------------------------------------------------------------------------------------
-- 8. Reconciliação (corpo de 20261009141000_endurecimento_saldo.sql) com as duas checagens das faturas:
--   FATURA_TOTAL_DIVERGENTE: total ≠ −Σ valor dos itens; ou a paga sem PAGAMENTO_FATURA da mesma empresa e do valor do
--     total; ou item de lançamento de outra empresa;
--   LANCAMENTO_EM_DUAS_FATURAS: o mesmo lançamento em mais de uma fatura não cancelada.
------------------------------------------------------------------------------------------------
create or replace function interno.reconciliar() returns jsonb
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
    (select jsonb_build_object('tipo', 'AGENDADA_SEM_APROVACAO', 'empresa_id', a.empresa_id, 'atividade_id', a.id)
       from app.atividades a
      where a.status = 'AGENDADA'
        and not exists (select 1 from app.aprovacoes p join app.orcamentos o on o.id = p.orcamento_id
                         where p.atividade_id = a.id and o.atividade_id = a.id and o.status = 'APROVADO')
      order by a.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_SEM_PAR', 'empresa_id', x.empresa_id, 'atividade_id', x.atividade_id,
              'reserva_id', x.id, 'ativa', x.ativa, 'reservas_lancadas', q.reservas, 'liberacoes_lancadas', q.liberacoes)
       from app.reservas x
       cross join lateral (select count(*) filter (where l.tipo = 'RESERVA') as reservas,
                                  count(*) filter (where l.tipo = 'LIBERACAO_RESERVA') as liberacoes
                             from app.lancamentos l where l.reserva_id = x.id) q
      where q.reservas <> 1 or q.liberacoes <> case when x.ativa then 0 else 1 end
      order by x.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_VALOR_DIVERGENTE', 'empresa_id', l.empresa_id,
              'atividade_id', l.atividade_id, 'reserva_id', x.id, 'lancamento_id', l.id, 'lancamento_tipo', l.tipo,
              'valor_lancamento', l.valor_cent, 'valor_reserva', x.valor_cent)
       from app.lancamentos l join app.reservas x on x.id = l.reserva_id
      where l.valor_cent <> x.valor_cent
      order by l.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'EMPRESA_DIVERGENTE', 'empresa_id', y.empresa_id, 'origem', y.origem,
              'id', y.id, 'atividade_id', y.atividade_id, 'empresa_apontada', y.empresa_apontada)
       from (select 'lancamento' as origem, l.id::text as id, l.empresa_id, l.atividade_id,
                    a.empresa_id as empresa_apontada, l.id as ordem
               from app.lancamentos l join app.atividades a on a.id = l.atividade_id
              where a.empresa_id <> l.empresa_id
             union all
             select 'lancamento', l.id::text, l.empresa_id, l.atividade_id, x.empresa_id, l.id
               from app.lancamentos l join app.reservas x on x.id = l.reserva_id
              where x.empresa_id <> l.empresa_id
             union all
             select 'reserva', x.id::text, x.empresa_id, x.atividade_id, a.empresa_id, x.id
               from app.reservas x join app.atividades a on a.id = x.atividade_id
              where a.empresa_id <> x.empresa_id) y
      order by y.origem, y.ordem
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'ESTORNO_DIVERGENTE', 'empresa_id', e.empresa_id, 'lancamento_id', e.id,
              'estorna_id', o.id, 'valor_estorno', e.valor_cent, 'valor_original', o.valor_cent,
              'tipo_original', o.tipo)
       from app.lancamentos e join app.lancamentos o on o.id = e.estorna_id
      where e.valor_cent <> -o.valor_cent or e.empresa_id <> o.empresa_id
         or o.tipo not in ('RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO')
      order by e.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'COBRANCA_SEM_APROVACAO', 'empresa_id', l.empresa_id,
              'atividade_id', l.atividade_id, 'lancamento_id', l.id, 'lancamento_tipo', l.tipo,
              'orcamento_id', l.orcamento_id)
       from app.lancamentos l
      where l.tipo in ('DEBITO', 'MULTA')
        and not exists (select 1 from app.aprovacoes p
                         where p.atividade_id = l.atividade_id and p.orcamento_id = l.orcamento_id)
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
    union all
    -- v2.1
    (select jsonb_build_object('tipo', 'FATURA_TOTAL_DIVERGENTE', 'empresa_id', f.empresa_id, 'fatura_id', f.id,
              'numero', f.numero, 'status', f.status, 'total_cent', f.total_cent, 'total_itens', s.total,
              'itens_outra_empresa', s.outra_empresa, 'pagamento_cent', p.valor_cent)
       from app.faturas f
       cross join lateral (select coalesce(-sum(l.valor_cent), 0) as total,
                                  count(*) filter (where l.empresa_id <> f.empresa_id) as outra_empresa
                             from app.faturas_itens i join app.lancamentos l on l.id = i.lancamento_id
                            where i.fatura_id = f.id) s
       left join app.lancamentos p on p.id = f.pagamento_lancamento_id
      where s.total <> f.total_cent or s.outra_empresa > 0
         or (f.status = 'PAGA' and (p.id is null or p.tipo <> 'PAGAMENTO_FATURA' or p.valor_cent <> f.total_cent
                                    or p.empresa_id <> f.empresa_id))
      order by f.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'LANCAMENTO_EM_DUAS_FATURAS', 'empresa_id', min(f.empresa_id::text)::uuid,
              'lancamento_id', i.lancamento_id, 'faturas', jsonb_agg(f.id order by f.numero))
       from app.faturas_itens i join app.faturas f on f.id = i.fatura_id
      where f.status <> 'CANCELADA'
      group by i.lancamento_id
     having count(*) > 1
      order by i.lancamento_id
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

------------------------------------------------------------------------------------------------
-- 9. Privilégios: as internas nascem fechadas; as RPCs novas são só de authenticated; as substituídas
--    ("create or replace") mantêm os seus.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.fatura_validar(),
  interno.fatura_item_validar(),
  interno.quinzena_valida(date, date),
  interno.hoje_local(),
  interno.fim_do_dia_local(date),
  interno.ultima_quinzena_fechada(),
  interno.forma_em(uuid, timestamptz),
  interno.lancamento_faturavel(app.lancamentos),
  interno.itens_a_faturar(uuid, timestamptz),
  interno.item_fatura(app.lancamentos),
  interno.fatura_json(app.faturas),
  interno.resumo_faturas(uuid),
  interno.pdf_nota_valido(uuid, text)
from public, anon, authenticated;

revoke all on function
  api.previa_fatura(uuid, date, date),
  api.gerar_fatura(uuid, date, date, jsonb),
  api.marcar_fatura_paga(uuid, date),
  api.cancelar_fatura(uuid, text),
  api.trocar_pdf_fatura(uuid, text),
  api.faturas(uuid),
  api.fatura(uuid),
  api.faturas_resumo()
from public, anon, authenticated, service_role;
grant execute on function
  api.previa_fatura(uuid, date, date),
  api.gerar_fatura(uuid, date, date, jsonb),
  api.marcar_fatura_paga(uuid, date),
  api.cancelar_fatura(uuid, text),
  api.trocar_pdf_fatura(uuid, text),
  api.faturas(uuid),
  api.fatura(uuid),
  api.faturas_resumo()
to authenticated;
