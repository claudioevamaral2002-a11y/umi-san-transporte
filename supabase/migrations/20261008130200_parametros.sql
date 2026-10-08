-- Parâmetros versionados (fase 1). Ver docs/fases/fase-1-desenho.md §1.
-- Dinheiro em centavos (bigint), percentuais em pontos-base (int), prazos em horas (int).
-- Nenhuma versão é semeada: o ADM publica a primeira tabela ("Tabela ainda não publicada" até lá).

-- Faixas de cancelamento: array não vazio de {antecedencia_min_horas >= 0, multa_bp 0..10000},
-- antecedência estritamente decrescente, último item com antecedência 0. IMMUTABLE (usada em CHECK).
create function interno.faixas_validas(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n int;
  e jsonb;
  i int;
  horas int;
  anterior int := null;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  n := jsonb_array_length(p);
  if n < 1 or n > 20 then return false; end if;
  for i in 0 .. n - 1 loop
    e := p -> i;
    if jsonb_typeof(e) <> 'object'
       or (select count(*) from jsonb_object_keys(e)) <> 2
       or not (e ? 'antecedencia_min_horas') or not (e ? 'multa_bp')
       or jsonb_typeof(e -> 'antecedencia_min_horas') <> 'number'
       or jsonb_typeof(e -> 'multa_bp') <> 'number'
       or (e ->> 'antecedencia_min_horas') !~ '^[0-9]{1,6}$'
       or (e ->> 'multa_bp') !~ '^[0-9]{1,5}$'
    then return false; end if;
    if (e ->> 'multa_bp')::int > 10000 then return false; end if;
    horas := (e ->> 'antecedencia_min_horas')::int;
    if anterior is not null and horas >= anterior then return false; end if;
    anterior := horas;
  end loop;
  return anterior = 0;
end $$;

revoke execute on function interno.faixas_validas(jsonb) from public, anon, authenticated;

create table app.parametros_versoes (
  versao int generated always as identity unique,
  vigente_desde timestamptz not null,
  publicado_por uuid references auth.users (id) on delete set null,
  publicado_em timestamptz not null default now(),
  -- veículo próprio
  km_sem_reboque_cent bigint not null check (km_sem_reboque_cent >= 0),
  km_com_reboque_cent bigint not null check (km_com_reboque_cent >= 0),
  taxa_fixa_reboque_cent bigint not null check (taxa_fixa_reboque_cent >= 0),
  retorno_trecho_unico_bp int not null check (retorno_trecho_unico_bp between 0 and 10000),
  hora_espera_cent bigint not null check (hora_espera_cent >= 0),
  hospedagem_diaria_cent bigint not null check (hospedagem_diaria_cent >= 0),
  -- veículo da Umi San
  diaria_motorista_cent bigint not null check (diaria_motorista_cent >= 0),
  -- comuns
  faixas_cancelamento jsonb not null check (interno.faixas_validas(faixas_cancelamento)),
  prazo_orcar_horas int not null check (prazo_orcar_horas > 0),
  validade_orcamento_horas int not null check (validade_orcamento_horas > 0),
  limiar_urgente_horas int not null check (limiar_urgente_horas > 0),
  limite_saldo_negativo_cent bigint not null check (limite_saldo_negativo_cent >= 0),
  alerta_saldo_baixo_cent bigint not null check (alerta_saldo_baixo_cent >= 0),
  retencao_fotos_dias int not null check (retencao_fotos_dias > 0)
);
create index parametros_versoes_vigencia on app.parametros_versoes (vigente_desde desc, versao desc);

alter table app.parametros_versoes enable row level security;

-- Imutável para todos (mesmo padrão da auditoria).
create function interno.parametros_imutaveis() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'versões de parâmetros são imutáveis' using errcode = '42501';
end $$;
revoke execute on function interno.parametros_imutaveis() from public, anon, authenticated;
create trigger parametros_sem_update before update or delete on app.parametros_versoes
  for each row execute function interno.parametros_imutaveis();
create trigger parametros_sem_truncate before truncate on app.parametros_versoes
  for each statement execute function interno.parametros_imutaveis();

grant select on app.parametros_versoes to authenticated;
create policy parametros_ler on app.parametros_versoes for select to authenticated using (
  (select (app.pode_acessar()).usuario_id) is not null
);

-- Negação com detalhe (a de 3 argumentos segue valendo, sem detalhe).
create function interno.negar(p_acao text, p_alvo text, p_codigo text, p_detalhe jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform interno.auditar(p_acao, p_alvo, 'NEGADO', p_codigo, p_detalhe);
  return jsonb_build_object('ok', false, 'codigo', p_codigo);
end $$;
revoke execute on function interno.negar(text, text, text, jsonb) from public, anon, authenticated;

-- Publica uma nova versão. p traz exatamente os 14 campos de parâmetros (nomes das colunas).
create function api.publicar_parametros(p jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inteiros constant text[] := array[
    'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent', 'retorno_trecho_unico_bp',
    'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent', 'prazo_orcar_horas',
    'validade_orcamento_horas', 'limiar_urgente_horas', 'limite_saldo_negativo_cent',
    'alerta_saldo_baixo_cent', 'retencao_fotos_dias'];
  conhecidos constant text[] := inteiros || array['faixas_cancelamento'];
  desconhecidos text[];
  ausentes text[];
  invalidos text[] := '{}';
  k text;
  v bigint;
  nova int;
begin
  if not (select app.pode_fazer('EDITAR_PARAMETROS')) then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'SEM_PERMISSAO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'VIGENCIA_NO_PASSADO');
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('p')));
  end if;

  select coalesce(array_agg(c order by c), '{}') into desconhecidos
    from jsonb_object_keys(p) c where c <> all (conhecidos);
  select coalesce(array_agg(c order by c), '{}') into ausentes
    from unnest(conhecidos) c where not (p ? c);

  foreach k in array inteiros loop
    if p ? k and not (
      jsonb_typeof(p -> k) = 'number'
      and (p ->> k) ~ '^[0-9]{1,16}$'
    ) then
      invalidos := array_append(invalidos, k);
    end if;
  end loop;
  if p ? 'faixas_cancelamento' and not interno.faixas_validas(p -> 'faixas_cancelamento') then
    invalidos := array_append(invalidos, 'faixas_cancelamento');
  end if;

  -- limites de valor (iguais aos CHECKs da tabela; aqui viram CAMPOS_INVALIDOS em vez de erro)
  foreach k in array inteiros loop
    if p ? k and k <> all (invalidos) then
      v := (p ->> k)::bigint;
      if (k = 'retorno_trecho_unico_bp' and v > 10000)
         or (k in ('prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas', 'retencao_fotos_dias')
             and (v < 1 or v > 2147483647))
      then
        invalidos := array_append(invalidos, k);
      end if;
    end if;
  end loop;

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(invalidos) > 0 then
    return interno.negar('PUBLICAR_PARAMETROS', 'parametros', 'CAMPOS_INVALIDOS',
      jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                         'invalidos', to_jsonb(invalidos)));
  end if;

  insert into app.parametros_versoes (
    vigente_desde, publicado_por,
    km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
    hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
    limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias)
  values (
    p_vigente_desde, (select auth.uid()),
    (p ->> 'km_sem_reboque_cent')::bigint, (p ->> 'km_com_reboque_cent')::bigint,
    (p ->> 'taxa_fixa_reboque_cent')::bigint, (p ->> 'retorno_trecho_unico_bp')::int,
    (p ->> 'hora_espera_cent')::bigint, (p ->> 'hospedagem_diaria_cent')::bigint,
    (p ->> 'diaria_motorista_cent')::bigint, p -> 'faixas_cancelamento',
    (p ->> 'prazo_orcar_horas')::int, (p ->> 'validade_orcamento_horas')::int,
    (p ->> 'limiar_urgente_horas')::int, (p ->> 'limite_saldo_negativo_cent')::bigint,
    (p ->> 'alerta_saldo_baixo_cent')::bigint, (p ->> 'retencao_fotos_dias')::int)
  returning versao into nova;

  perform interno.auditar('PUBLICAR_PARAMETROS', 'parametros:' || nova, 'OK', null,
    jsonb_build_object('versao', nova, 'vigente_desde', p_vigente_desde));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

revoke execute on function api.publicar_parametros(jsonb, timestamptz) from public, anon;
grant execute on function api.publicar_parametros(jsonb, timestamptz) to authenticated;

-- Leitura (security_invoker: a RLS da tabela decide quem vê).
create view api.parametros_historico with (security_invoker = true) as
select versao, vigente_desde, publicado_em,
       km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
       hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
       prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
       limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias
from app.parametros_versoes
order by vigente_desde desc, versao desc;

create view api.parametros_vigentes with (security_invoker = true) as
select versao, vigente_desde, publicado_em,
       km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
       hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
       prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
       limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias
from app.parametros_versoes
where vigente_desde <= now()
order by vigente_desde desc, versao desc
limit 1;

revoke all on api.parametros_historico, api.parametros_vigentes from public, anon, authenticated;
grant select on api.parametros_historico, api.parametros_vigentes to authenticated;
