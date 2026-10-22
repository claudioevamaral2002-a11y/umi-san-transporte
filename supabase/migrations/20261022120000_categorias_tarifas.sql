-- Fase 4.1, Tarefa 1 (docs/fases/fase-4-1-categorias-paradas-desenho.md §4.1–§4.3 e §10): categorias livres, tabela de
-- preço própria por categoria e cálculo pela tarifa.
--   * app.categorias: sai a trava dos três códigos; entra `veiculo_cliente` (a IVO Motorista dirige o carro do cliente);
--     o nome é único entre as ativas. Semente: Carga Leve passa a ter reboque, Carga Pesada é desligada (fica para o
--     histórico) e entra a MOTORISTA ("IVO Motorista");
--   * app.veiculos: sai a trava dos três códigos; um gatilho confere cada código contra app.categorias (só as que usam
--     veículo da IVO);
--   * app.tarifas_categoria: os oito valores de cada categoria, presos a UMA versão do contrato (imutável, como
--     app.contratos_categorias). Zerado = não cobra;
--   * cálculo: interno.linhas_da_tarifa; interno.linhas_para_categoria usa a tarifa quando a versão tem uma, senão o
--     caminho de hoje (interno.linhas_da_categoria) — nenhum preço muda até o Master publicar a tabela;
--   * RPCs: categorias_disponiveis (paradas, horas, categorias do banco), salvar_categoria (cria e edita),
--     salvar_veiculo (categorias do banco), categorias_adm (tarifa da versão ou a inicial), publicar_tarifas (nova),
--     publicar_contrato e publicar_contrato_categorias (levam as tarifas adiante).
-- "create or replace" com as mesmas assinaturas mantém os privilégios; as funções novas nascem fechadas (seção 9).

------------------------------------------------------------------------------------------------
-- 1. Categorias livres.
------------------------------------------------------------------------------------------------
alter table app.categorias drop constraint categorias_codigo_check;
alter table app.categorias add constraint categorias_codigo_formato check (codigo ~ '^[A-Z0-9][A-Z0-9_]{0,39}$');
alter table app.categorias add column veiculo_cliente boolean not null default false;
-- Veículo do cliente não cobra reboque (especificação §4.1).
alter table app.categorias add constraint categorias_cliente_sem_reboque check (not (veiculo_cliente and reboque = 'SIM'));

-- Semente (dono, 22/10): Carga Leve com reboque; Carga Pesada desligada antes de a IVO Motorista entrar (em produção o
-- dono já tinha renomeado a Carga Pesada para "IVO Motorista", e o nome é único só entre as ativas).
update app.categorias set reboque = 'SIM' where codigo = 'CARGA_LEVE';
update app.categorias set ativa = false where codigo = 'CARGA_PESADA';
insert into app.categorias (codigo, nome, descricao_curta, carga, reboque, ordem, veiculo_cliente)
values ('MOTORISTA', 'IVO Motorista', 'Ivo dirige o carro da sua empresa', 'PESSOAS', 'NAO', 3, true);

create unique index categorias_nome_ativa on app.categorias (lower(btrim(nome))) where ativa;

------------------------------------------------------------------------------------------------
-- 2. Veículos: as categorias vêm do banco (só as que usam veículo da IVO; desligadas continuam valendo).
------------------------------------------------------------------------------------------------
alter table app.veiculos drop constraint veiculos_categorias_check;
alter table app.veiculos add constraint veiculos_categorias_nao_vazias check (cardinality(categorias) > 0);

create function interno.veiculo_categorias_validas() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.categorias) c
              where not exists (select 1 from app.categorias k where k.codigo = c and not k.veiculo_cliente)) then
    raise exception 'categoria de veículo inválida: %', new.categorias using errcode = '23514';
  end if;
  return new;
end $$;
create trigger veiculos_categorias before insert or update of categorias on app.veiculos
  for each row execute function interno.veiculo_categorias_validas();

------------------------------------------------------------------------------------------------
-- 3. Tarifa por categoria. Sem GRANT: leitura e escrita só por funções SECURITY DEFINER.
------------------------------------------------------------------------------------------------
create table app.tarifas_categoria (
  contrato_id bigint not null references app.contratos_versoes (id) on delete restrict,
  categoria text not null references app.categorias (codigo),
  taxa_fixa_cent bigint not null check (taxa_fixa_cent >= 0),
  km_cent bigint not null check (km_cent >= 0),
  hora_cent bigint not null check (hora_cent >= 0),
  hora_espera_cent bigint not null check (hora_espera_cent >= 0),
  parada_cent bigint not null check (parada_cent >= 0),
  reboque_cent bigint not null check (reboque_cent >= 0),
  hospedagem_diaria_cent bigint not null check (hospedagem_diaria_cent >= 0),
  retorno_bp int not null check (retorno_bp between 0 and 10000),
  primary key (contrato_id, categoria)
);
alter table app.tarifas_categoria enable row level security;

-- Imutável como a versão do contrato a que pertence (mesma função de gatilho).
create trigger tarifas_categoria_sem_update before update or delete on app.tarifas_categoria
  for each row execute function interno.contratos_imutaveis();
create trigger tarifas_categoria_sem_truncate before truncate on app.tarifas_categoria
  for each statement execute function interno.contratos_imutaveis();

------------------------------------------------------------------------------------------------
-- 4. Funções internas.
------------------------------------------------------------------------------------------------

-- Código de uma categoria nova, gerado do nome: sem o prefixo "IVO", sem acentos, em maiúsculas, "_" no lugar de
-- espaços e símbolos; se já existir (ativa ou não), ganha _2, _3… Ex.: "IVO Motorista" → MOTORISTA.
create function interno.codigo_categoria(p_nome text) returns text
language plpgsql stable set search_path = '' as $$
declare
  base text;
  cand text;
  n int := 1;
begin
  base := regexp_replace(coalesce(p_nome, ''), '^\s*ivo(\s+|$)', '', 'i');
  base := upper(translate(base, 'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝ',
                                'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnNyyY'));
  base := btrim(left(btrim(regexp_replace(base, '[^A-Z0-9]+', '_', 'g'), '_'), 34), '_');
  if base = '' then
    base := 'CATEGORIA';
  end if;
  cand := base;
  while exists (select 1 from app.categorias k where k.codigo = cand) loop
    n := n + 1;
    cand := base || '_' || n;
  end loop;
  return cand;
end $$;

-- A tarifa da categoria nesta versão do contrato (nula quando a versão não tem tarifa dela).
create function interno.tarifa_da_categoria(c app.contratos_versoes, p_categoria text) returns app.tarifas_categoria
language sql stable security definer set search_path = '' as $$
  select t.* from app.tarifas_categoria t where t.contrato_id = c.id and t.categoria = p_categoria
$$;

-- Os preços que valem hoje para a categoria, no formato da tarifa (para preencher a tela na primeira vez):
-- km de contratos_categorias ou do contrato (Carga Pesada: o km com reboque); taxa fixa de contratos_categorias só em
-- Passageiros/Carga Leve (na Carga Pesada ela era a do reboque); reboque = taxa do reboque quando a categoria tem
-- reboque; espera, hospedagem e retorno do contrato; hora e parada 0. Veículo do cliente: hoje não cobra km, retorno,
-- espera nem reboque (só a hospedagem é comum).
create function interno.tarifa_inicial(c app.contratos_versoes, p_categoria text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  k app.categorias;
  cc app.contratos_categorias;
  v_pesada boolean := p_categoria = 'CARGA_PESADA';
begin
  if c.id is null then
    return null;
  end if;
  select * into k from app.categorias x where x.codigo = p_categoria;
  select * into cc from app.contratos_categorias x where x.contrato_id = c.id and x.categoria = p_categoria;
  if coalesce(k.veiculo_cliente, false) then
    return jsonb_build_object('taxa_fixa_cent', 0, 'km_cent', 0, 'hora_cent', 0, 'hora_espera_cent', 0, 'parada_cent', 0,
                              'retorno_bp', 0, 'reboque_cent', 0, 'hospedagem_diaria_cent', c.hospedagem_diaria_cent);
  end if;
  return jsonb_build_object(
    'taxa_fixa_cent', case when v_pesada then 0 else coalesce(cc.taxa_fixa_cent, 0) end,
    'km_cent', coalesce(cc.km_cent, case when v_pesada then c.km_com_reboque_cent else c.km_sem_reboque_cent end),
    'hora_cent', 0,
    'hora_espera_cent', c.hora_espera_cent,
    'parada_cent', 0,
    'retorno_bp', c.retorno_trecho_unico_bp,
    'reboque_cent', case when k.reboque = 'SIM'
                         then case when v_pesada then coalesce(cc.taxa_fixa_cent, c.taxa_fixa_reboque_cent)
                                   else c.taxa_fixa_reboque_cent end
                         else 0 end,
    'hospedagem_diaria_cent', c.hospedagem_diaria_cent);
end $$;

-- Cálculo pela tarifa (só no servidor). Preços SEMPRE de t; a entrada traz só quantidades: km (trajeto total, 1 casa),
-- horas e espera_horas (de 0,5 em 0,5), paradas (0 a 3), pedagio_cent, hospedagem_diarias, outros (até 5). `modalidade`
-- e `usa_reboque` (que a calculadora de hoje manda) são aceitos e ignorados: o reboque é o da categoria (p_reboque).
-- Cada linha só sai quando o valor da tarifa e a quantidade são > 0 (zerado = não cobra). Mesmo formato e mesmo teto
-- de interno.calcular_linhas; total 0 → VALOR_INVALIDO.
create function interno.linhas_da_tarifa(t app.tarifas_categoria, p_reboque boolean, p_levar boolean, p_trazer boolean,
                                         e jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  teto_cent constant bigint := 100000000000;  -- R$ 1 bilhão, o mesmo de interno.calcular_linhas
  conhecidos constant text[] := array['km', 'horas', 'espera_horas', 'paradas', 'pedagio_cent', 'hospedagem_diarias',
                                      'outros', 'modalidade', 'usa_reboque'];
  desconhecidos text[];
  inv text[] := '{}';
  v_km numeric := 0;
  v_horas numeric := 0;
  v_espera numeric := 0;
  v_paradas int := 0;
  v_pedagio bigint := 0;
  v_hosp int := 0;
  v_km_cent bigint;
  v_total numeric;
  linhas jsonb := '[]';
  o jsonb;
begin
  if t.contrato_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'SEM_CONTRATO');
  end if;
  if e is null or jsonb_typeof(e) <> 'object' then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('invalidos', jsonb_build_array('p')));
  end if;
  select coalesce(array_agg(left(k, 60) order by k), '{}') into desconhecidos
    from (select k from jsonb_object_keys(e) k where k <> all (conhecidos) order by k limit 20) x;
  if cardinality(desconhecidos) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('desconhecidos', to_jsonb(desconhecidos)));
  end if;

  -- quantidades (ausente/nulo = 0)
  if coalesce(jsonb_typeof(e -> 'km'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'km') = 'number' and (e ->> 'km') ~ '^[0-9]{1,6}(\.[0-9]{1,6})?$'
       and (e ->> 'km')::numeric * 10 = trunc((e ->> 'km')::numeric * 10) and (e ->> 'km')::numeric <= 100000 then
      v_km := (e ->> 'km')::numeric;
    else
      inv := array_append(inv, 'km');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'horas'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'horas') = 'number' and (e ->> 'horas') ~ '^[0-9]{1,3}(\.[0-9]{1,6})?$'
       and (e ->> 'horas')::numeric * 2 = trunc((e ->> 'horas')::numeric * 2) and (e ->> 'horas')::numeric <= 240 then
      v_horas := (e ->> 'horas')::numeric;
    else
      inv := array_append(inv, 'horas');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'espera_horas'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'espera_horas') = 'number' and (e ->> 'espera_horas') ~ '^[0-9]{1,3}(\.[0-9]{1,6})?$'
       and (e ->> 'espera_horas')::numeric * 2 = trunc((e ->> 'espera_horas')::numeric * 2)
       and (e ->> 'espera_horas')::numeric <= 240 then
      v_espera := (e ->> 'espera_horas')::numeric;
    else
      inv := array_append(inv, 'espera_horas');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'paradas'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'paradas') = 'number' and (e ->> 'paradas') ~ '^[0-3]$' then
      v_paradas := (e ->> 'paradas')::int;
    else
      inv := array_append(inv, 'paradas');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'pedagio_cent'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'pedagio_cent') = 'number' and (e ->> 'pedagio_cent') ~ '^[0-9]{1,9}$' then
      v_pedagio := (e ->> 'pedagio_cent')::bigint;
    else
      inv := array_append(inv, 'pedagio_cent');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'hospedagem_diarias'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'hospedagem_diarias') = 'number' and (e ->> 'hospedagem_diarias') ~ '^[0-9]{1,2}$'
       and (e ->> 'hospedagem_diarias')::int <= 60 then
      v_hosp := (e ->> 'hospedagem_diarias')::int;
    else
      inv := array_append(inv, 'hospedagem_diarias');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'outros'), 'null') <> 'null' then
    if jsonb_typeof(e -> 'outros') <> 'array' or jsonb_array_length(e -> 'outros') > 5
       or exists (
         select 1 from jsonb_array_elements(e -> 'outros') x
          where not coalesce(
                  jsonb_typeof(x) = 'object'
                  and (select count(*) from jsonb_object_keys(x) k where k not in ('descricao', 'valor_cent')) = 0
                  and jsonb_typeof(x -> 'descricao') = 'string' and length(btrim(x ->> 'descricao')) between 3 and 120
                  and jsonb_typeof(x -> 'valor_cent') = 'number' and (x ->> 'valor_cent') ~ '^[0-9]{1,9}$'
                  and (x ->> 'valor_cent')::bigint > 0, false)) then
      inv := array_append(inv, 'outros');
    end if;
  end if;
  if coalesce(jsonb_typeof(e -> 'modalidade'), 'null') not in ('string', 'null') then
    inv := array_append(inv, 'modalidade');
  end if;
  if coalesce(jsonb_typeof(e -> 'usa_reboque'), 'null') not in ('boolean', 'null') then
    inv := array_append(inv, 'usa_reboque');
  end if;
  if cardinality(inv) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS', 'detalhe',
                              jsonb_build_object('invalidos', to_jsonb(inv)));
  end if;

  begin
    if t.taxa_fixa_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'TAXA_FIXA', 'Taxa fixa', 1, t.taxa_fixa_cent, null, null, t.taxa_fixa_cent));
    end if;
    if v_km > 0 and t.km_cent > 0 then
      v_km_cent := interno.arred(v_km * t.km_cent);
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'KM', case when p_levar and p_trazer then 'Km rodados (ida e volta)' else 'Km rodados (trecho único)' end,
        v_km, t.km_cent, null, null, v_km_cent));
      if not (p_levar and p_trazer) and t.retorno_bp > 0 then
        linhas := linhas || jsonb_build_array(interno.linha_orcamento(
          'RETORNO', 'Retorno (' || replace(trim_scale(t.retorno_bp / 100.0)::text, '.', ',') || '%)',
          null, null, t.retorno_bp, v_km_cent, interno.arred(v_km_cent * t.retorno_bp / 10000.0)));
      end if;
    end if;
    if v_horas > 0 and t.hora_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'HORAS', 'Horas', v_horas, t.hora_cent, null, null, interno.arred(v_horas * t.hora_cent)));
    end if;
    if v_espera > 0 and t.hora_espera_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'ESPERA', 'Espera (horas)', v_espera, t.hora_espera_cent, null, null, interno.arred(v_espera * t.hora_espera_cent)));
    end if;
    if v_paradas > 0 and t.parada_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'PARADAS', 'Paradas', v_paradas, t.parada_cent, null, null, v_paradas * t.parada_cent));
    end if;
    if coalesce(p_reboque, false) and t.reboque_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'REBOQUE', 'Taxa de reboque', 1, t.reboque_cent, null, null, t.reboque_cent));
    end if;
    if v_pedagio > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'PEDAGIO', 'Pedágio/balsa (estimado)', 1, v_pedagio, null, null, v_pedagio));
    end if;
    if v_hosp > 0 and t.hospedagem_diaria_cent > 0 then
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'HOSPEDAGEM', 'Hospedagem (diárias)', v_hosp, t.hospedagem_diaria_cent, null, null, v_hosp * t.hospedagem_diaria_cent));
    end if;
    for o in select x from jsonb_array_elements(coalesce(e -> 'outros', '[]')) x loop
      linhas := linhas || jsonb_build_array(interno.linha_orcamento(
        'OUTROS', 'Outros: ' || btrim(o ->> 'descricao'), 1, (o ->> 'valor_cent')::bigint, null, null,
        (o ->> 'valor_cent')::bigint));
    end loop;
    select coalesce(sum((l ->> 'valor_cent')::numeric), 0) into v_total from jsonb_array_elements(linhas) l;
  exception when numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'codigo', 'VALOR_FORA_DO_LIMITE');
  end;
  if v_total > teto_cent then
    return jsonb_build_object('ok', false, 'codigo', 'VALOR_FORA_DO_LIMITE');
  end if;
  if v_total <= 0 then
    return jsonb_build_object('ok', false, 'codigo', 'VALOR_INVALIDO');
  end if;
  return jsonb_build_object('ok', true,
    'modalidade', case when (select k.veiculo_cliente from app.categorias k where k.codigo = t.categoria)
                       then 'VEICULO_CLIENTE' else 'VEICULO_PROPRIO' end,
    'linhas', linhas, 'total_cent', v_total::bigint);
end $$;

-- Caminho de hoje (versão sem tarifa da categoria), corpo de 20261020120000_categorias_veiculos.sql. 4.1: o reboque do
-- cálculo é o de ANTES da 4.1 (só a Carga Pesada), e não mais o da tabela de categorias: a Carga Leve ganhou reboque,
-- mas o preço dela só muda quando o Master publicar a tabela nova (especificação §4.2, "nenhum preço muda").
create or replace function interno.linhas_da_categoria(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                                       p_categoria text, e jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select interno.calcular_linhas(
    interno.contrato_da_categoria(c, p_categoria), p_levar, p_trazer, 'VEICULO_PROPRIO',
    coalesce(e, '{}'::jsonb) || jsonb_build_object('usa_reboque', p_categoria = 'CARGA_PESADA'))
$$;

-- Linhas do orçamento de uma categoria: pela tarifa da versão, quando existe (o reboque é o da categoria, e nunca no
-- veículo do cliente); senão o caminho de hoje, sem as quantidades que ele não conhece (horas, paradas).
create function interno.linhas_para_categoria(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                              p_categoria text, e jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t app.tarifas_categoria;
  k app.categorias;
begin
  if c.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'SEM_CONTRATO');
  end if;
  select * into t from app.tarifas_categoria x where x.contrato_id = c.id and x.categoria = p_categoria;
  if t.contrato_id is not null then
    select * into k from app.categorias x where x.codigo = p_categoria;
    return interno.linhas_da_tarifa(t, coalesce(k.reboque = 'SIM' and not k.veiculo_cliente, false), p_levar, p_trazer, e);
  end if;
  return interno.linhas_da_categoria(c, p_levar, p_trazer, p_categoria,
    case when jsonb_typeof(e) = 'object' then e - 'horas' - 'paradas' else e end);
end $$;

-- Valida as tarifas de uma publicação: exatamente as categorias ATIVAS, cada uma com os oito campos inteiros ≥ 0
-- (retorno até 10000 bp). Nulo = válido; senão o detalhe da recusa.
create function interno.validar_tarifas(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  campos constant text[] := array['taxa_fixa_cent', 'km_cent', 'hora_cent', 'hora_espera_cent', 'parada_cent',
                                  'retorno_bp', 'reboque_cent', 'hospedagem_diaria_cent'];
  ativas text[];
  desconhecidas text[];
  inv text[] := '{}';
  k text;
  campo text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('invalidos', jsonb_build_array('tarifas'));
  end if;
  select coalesce(array_agg(x.codigo order by x.ordem, x.codigo), '{}') into ativas from app.categorias x where x.ativa;
  select coalesce(array_agg(left(c, 60) order by c), '{}') into desconhecidas
    from (select c from jsonb_object_keys(p) c where c <> all (ativas) order by c limit 20) x;
  foreach k in array ativas loop
    if not (p ? k) or jsonb_typeof(p -> k) <> 'object' then
      inv := array_append(inv, k);
      continue;
    end if;
    if exists (select 1 from jsonb_object_keys(p -> k) x where x <> all (campos)) then
      inv := array_append(inv, k);
      continue;
    end if;
    foreach campo in array campos loop
      if not coalesce(case when jsonb_typeof(p -> k -> campo) = 'number' and (p -> k ->> campo) ~ '^[0-9]{1,16}$'
                           then campo <> 'retorno_bp' or (p -> k ->> campo)::numeric <= 10000 end, false) then
        inv := array_append(inv, k || '.' || campo);
      end if;
    end loop;
  end loop;
  if cardinality(inv) > 0 or cardinality(desconhecidas) > 0 then
    return jsonb_build_object('invalidos', to_jsonb(inv), 'desconhecidas', to_jsonb(desconhecidas));
  end if;
  return null;
end $$;

------------------------------------------------------------------------------------------------
-- 5. Cliente (N1/N2): categorias ativas do banco com disponibilidade e preço estimado.
--    Entrada: {km (um trecho, 0 a 5000, 1 casa), levar, trazer, paradas? (0 a 3), horas? (0,5 a 24, de 0,5 em 0,5)}.
--    Disponível = (veículo do cliente e há motorista ativo) ou (veículo ATIVO do motorista que atende), E a versão
--    vigente tem tarifa da categoria ou ela é uma das três de antes da 4.1 (que caem no preço de hoje). Uma categoria
--    criada depois da última publicação fica "Indisponível no momento". Preço por interno.linhas_para_categoria; total 0
--    (ex.: por hora sem as horas) vem sem preço. Cada categoria traz ainda carga, reboque, veiculo_cliente, cobra_hora e
--    cobra_parada (Ruling F1).
------------------------------------------------------------------------------------------------
create or replace function api.categorias_disponiveis(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  v_mot uuid := interno.motorista_padrao();
  e jsonb;
  r jsonb;
  k record;
  t app.tarifas_categoria;
  v_disp boolean;
  saida jsonb := '[]';
begin
  if not (select app.pode_fazer('PREVIA_ORCAMENTO')) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CATEGORIAS', 300, interval '1 hour') then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('km', 'levar', 'trazer', 'paradas', 'horas'))
     or coalesce(jsonb_typeof(p -> 'km'), 'null') <> 'number'
     or not coalesce(case when (p ->> 'km') ~ '^[0-9]{1,4}(\.[0-9])?$' then (p ->> 'km')::numeric <= 5000 end, false)
     or not coalesce(case when jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
                          then (p ->> 'levar')::boolean or (p ->> 'trazer')::boolean end, false)
     or (coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null'
         and not coalesce(jsonb_typeof(p -> 'paradas') = 'number' and (p ->> 'paradas') ~ '^[0-3]$', false))
     or (coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'horas') = 'number' and (p ->> 'horas') ~ '^[0-9]{1,2}(\.[0-9]{1,6})?$'
                               then (p ->> 'horas')::numeric between 0.5 and 24
                                    and (p ->> 'horas')::numeric * 2 = trunc((p ->> 'horas')::numeric * 2) end, false)) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  e := jsonb_build_object('km', (p ->> 'km')::numeric
                                * case when (p ->> 'levar')::boolean and (p ->> 'trazer')::boolean then 2 else 1 end);
  if coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null' then
    e := e || jsonb_build_object('paradas', (p ->> 'paradas')::int);
  end if;
  if coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null' then
    e := e || jsonb_build_object('horas', (p ->> 'horas')::numeric);
  end if;

  for k in select * from app.categorias x where x.ativa order by x.ordem, x.codigo loop
    select * into t from app.tarifas_categoria x where x.contrato_id = c.id and x.categoria = k.codigo;
    v_disp := v_mot is not null
              and (k.veiculo_cliente or interno.veiculo_atende(v_mot, k.codigo) is not null)
              and (t.contrato_id is not null or k.codigo in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA'));
    r := null;
    if v_disp then
      r := interno.linhas_para_categoria(c, (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean, k.codigo, e);
      if not (r ->> 'ok')::boolean then
        if r ->> 'codigo' <> 'VALOR_INVALIDO' then
          return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, r ->> 'codigo');
        end if;
        r := null;
      end if;
    end if;
    saida := saida || jsonb_build_array(jsonb_build_object(
      'codigo', k.codigo, 'nome', k.nome, 'descricao_curta', k.descricao_curta, 'carga', k.carga, 'reboque', k.reboque,
      'veiculo_cliente', k.veiculo_cliente, 'disponivel', v_disp,
      'cobra_hora', coalesce(t.hora_cent > 0, false), 'cobra_parada', coalesce(t.parada_cent > 0, false),
      'total_cent', r -> 'total_cent', 'linhas', r -> 'linhas'));
  end loop;
  return jsonb_build_object('ok', true, 'categorias', saida);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Veículos (corpo de 20261020120000_categorias_veiculos.sql). 4.1: as categorias vêm do banco — cada uma precisa
--    existir e usar veículo da IVO (não `veiculo_cliente`); até 20 por veículo. O gatilho da seção 2 confere de novo.
------------------------------------------------------------------------------------------------
create or replace function api.salvar_veiculo(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_id uuid;
  v_dono uuid;
  v_novo boolean := false;
  v_placa text;
  v_modelo text;
  v_cor text;
  v_reboque text;
  v_cats text[];
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA') then
    return interno.negar('SALVAR_VEICULO', 'veiculo', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('SALVAR_VEICULO', 120, interval '1 hour') then
    return interno.negar('SALVAR_VEICULO', 'usuario:' || v.usuario_id, 'LIMITE_EXCEDIDO');
  end if;

  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x
                 where x not in ('id', 'motorista_id', 'modelo', 'cor', 'placa', 'lugares', 'carga_max_kg', 'reboque_desc', 'categorias'))
     or coalesce(jsonb_typeof(p -> 'modelo'), '') <> 'string' or length(btrim(p ->> 'modelo')) not between 1 and 60
     or coalesce(jsonb_typeof(p -> 'cor'), '') <> 'string' or length(btrim(p ->> 'cor')) not between 1 and 30
     or coalesce(jsonb_typeof(p -> 'placa'), '') <> 'string'
     or upper(replace(btrim(p ->> 'placa'), '-', '')) !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
     or not coalesce(jsonb_typeof(p -> 'lugares') = 'number' and (p ->> 'lugares') ~ '^[0-9]{1,2}$'
                     and (p ->> 'lugares')::int <= 60, false)
     or not coalesce(jsonb_typeof(p -> 'carga_max_kg') = 'number' and (p ->> 'carga_max_kg') ~ '^[0-9]{1,5}$'
                     and (p ->> 'carga_max_kg')::int <= 50000, false)
     or coalesce(jsonb_typeof(p -> 'reboque_desc'), 'null') not in ('string', 'null')
     or (jsonb_typeof(p -> 'reboque_desc') = 'string' and length(btrim(p ->> 'reboque_desc')) > 60)
     or not (case when jsonb_typeof(p -> 'categorias') = 'array'
                  then jsonb_array_length(p -> 'categorias') between 1 and 20
                       and not exists (select 1 from jsonb_array_elements(p -> 'categorias') x
                                        where jsonb_typeof(x) <> 'string'
                                           or not exists (select 1 from app.categorias k
                                                           where k.codigo = x #>> '{}' and not k.veiculo_cliente))
                  else false end)
     or coalesce(jsonb_typeof(p -> 'id'), 'null') not in ('string', 'null')
     or (jsonb_typeof(p -> 'id') = 'string' and (p ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
     or coalesce(jsonb_typeof(p -> 'motorista_id'), 'null') not in ('string', 'null')
     or (jsonb_typeof(p -> 'motorista_id') = 'string'
         and (p ->> 'motorista_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    return interno.negar('SALVAR_VEICULO', 'veiculo', 'VEICULO_INVALIDO');
  end if;

  v_placa := upper(replace(btrim(p ->> 'placa'), '-', ''));
  v_modelo := btrim(p ->> 'modelo');
  v_cor := btrim(p ->> 'cor');
  v_reboque := nullif(btrim(coalesce(p ->> 'reboque_desc', '')), '');
  select array_agg(c order by o) into v_cats
    from (select c, min(o) as o from jsonb_array_elements_text(p -> 'categorias') with ordinality t(c, o) group by c) d;

  if coalesce(jsonb_typeof(p -> 'id'), 'null') = 'string' then
    v_id := (p ->> 'id')::uuid;
    select ve.motorista_id into v_dono from app.veiculos ve where ve.id = v_id;
    if v_dono is null then
      return interno.negar('SALVAR_VEICULO', 'veiculo:' || v_id, 'NAO_ENCONTRADO');
    end if;
    if v.papel = 'MOTORISTA' and v_dono <> v.usuario_id then
      return interno.negar('SALVAR_VEICULO', 'veiculo:' || v_id, 'SEM_PERMISSAO');
    end if;
    if coalesce(jsonb_typeof(p -> 'motorista_id'), 'null') = 'string' and (p ->> 'motorista_id')::uuid <> v_dono then
      return interno.negar('SALVAR_VEICULO', 'veiculo:' || v_id, 'VEICULO_INVALIDO');
    end if;
  else
    v_novo := true;
    if v.papel = 'MOTORISTA' then
      if coalesce(jsonb_typeof(p -> 'motorista_id'), 'null') = 'string' and (p ->> 'motorista_id')::uuid <> v.usuario_id then
        return interno.negar('SALVAR_VEICULO', 'veiculo', 'SEM_PERMISSAO');
      end if;
      v_dono := v.usuario_id;
    else
      if coalesce(jsonb_typeof(p -> 'motorista_id'), 'null') <> 'string' then
        return interno.negar('SALVAR_VEICULO', 'veiculo', 'VEICULO_INVALIDO');
      end if;
      v_dono := (p ->> 'motorista_id')::uuid;
      if not exists (select 1 from app.perfis pf where pf.usuario_id = v_dono and pf.papel = 'MOTORISTA' and pf.ativo) then
        return interno.negar('SALVAR_VEICULO', 'veiculo', 'VEICULO_INVALIDO');
      end if;
    end if;
  end if;

  if exists (select 1 from app.veiculos ve where ve.placa = v_placa and ve.id is distinct from v_id) then
    return interno.negar('SALVAR_VEICULO', 'veiculo', 'PLACA_DUPLICADA');
  end if;

  begin
    if v_novo then
      insert into app.veiculos (motorista_id, modelo, cor, placa, lugares, carga_max_kg, reboque_desc, categorias)
      values (v_dono, v_modelo, v_cor, v_placa, (p ->> 'lugares')::int, (p ->> 'carga_max_kg')::int, v_reboque, v_cats)
      returning id into v_id;
    else
      update app.veiculos set modelo = v_modelo, cor = v_cor, placa = v_placa, lugares = (p ->> 'lugares')::int,
                              carga_max_kg = (p ->> 'carga_max_kg')::int, reboque_desc = v_reboque, categorias = v_cats
       where id = v_id;
    end if;
  exception when unique_violation then
    return interno.negar('SALVAR_VEICULO', 'veiculo', 'PLACA_DUPLICADA');
  end;

  perform interno.auditar('SALVAR_VEICULO', 'veiculo:' || v_id, 'OK', null,
    jsonb_build_object('novo', v_novo, 'motorista_id', v_dono, 'placa', v_placa, 'categorias', to_jsonb(v_cats)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

------------------------------------------------------------------------------------------------
-- 7. Master: categorias e tarifas.
------------------------------------------------------------------------------------------------

-- Entrada: {codigo?, nome, descricao_curta, ordem, ativa?, veiculo_cliente?, reboque? ('SIM'|'NAO'), carga?}.
-- Sem `codigo`, cria (o código é gerado do nome e devolvido: {ok, codigo}); com `codigo`, edita (o código nunca muda;
-- o que não vier fica como está). Veículo do cliente não tem reboque. Nome repetido entre as ativas →
-- CATEGORIA_DUPLICADA. Só quem gere contratos (o Master).
create or replace function api.salvar_categoria(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k app.categorias;
  v_anterior jsonb;
  v_novo boolean;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('SALVAR_CATEGORIA', 'categoria', 'SEM_PERMISSAO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x
                 where x not in ('codigo', 'nome', 'descricao_curta', 'ordem', 'ativa', 'veiculo_cliente', 'reboque', 'carga'))
     or coalesce(jsonb_typeof(p -> 'codigo'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(p -> 'nome'), '') <> 'string' or length(btrim(p ->> 'nome')) not between 2 and 40
     or coalesce(jsonb_typeof(p -> 'descricao_curta'), '') <> 'string' or length(btrim(p ->> 'descricao_curta')) not between 1 and 60
     or not coalesce(jsonb_typeof(p -> 'ordem') = 'number' and (p ->> 'ordem') ~ '^[0-9]{1,2}$'
                     and (p ->> 'ordem')::int between 1 and 99, false)
     or coalesce(jsonb_typeof(p -> 'ativa'), 'null') not in ('boolean', 'null')
     or coalesce(jsonb_typeof(p -> 'veiculo_cliente'), 'null') not in ('boolean', 'null')
     or (coalesce(jsonb_typeof(p -> 'reboque'), 'null') <> 'null'
         and not coalesce(jsonb_typeof(p -> 'reboque') = 'string' and (p ->> 'reboque') in ('SIM', 'NAO'), false))
     or (coalesce(jsonb_typeof(p -> 'carga'), 'null') <> 'null'
         and not coalesce(jsonb_typeof(p -> 'carga') = 'string' and (p ->> 'carga') in ('PESSOAS', 'EQUIPAMENTO', 'AMBOS'), false)) then
    return interno.negar('SALVAR_CATEGORIA', 'categoria', 'CAMPOS_INVALIDOS');
  end if;

  -- Uma criação/edição de categoria por vez (o código gerado e o nome único).
  perform pg_advisory_xact_lock(hashtext('categorias'));
  v_novo := coalesce(jsonb_typeof(p -> 'codigo'), 'null') = 'null';
  if v_novo then
    k.codigo := interno.codigo_categoria(btrim(p ->> 'nome'));
    k.ativa := true;
    k.veiculo_cliente := false;
    k.reboque := 'NAO';
    k.carga := 'PESSOAS';
  else
    select * into k from app.categorias x where x.codigo = p ->> 'codigo' for update;
    if k.codigo is null then
      return interno.negar('SALVAR_CATEGORIA', 'categoria:' || left(p ->> 'codigo', 40), 'NAO_ENCONTRADO');
    end if;
    v_anterior := to_jsonb(k);
  end if;
  k.nome := btrim(p ->> 'nome');
  k.descricao_curta := btrim(p ->> 'descricao_curta');
  k.ordem := (p ->> 'ordem')::int;
  k.ativa := coalesce((p ->> 'ativa')::boolean, k.ativa);
  k.veiculo_cliente := coalesce((p ->> 'veiculo_cliente')::boolean, k.veiculo_cliente);
  k.reboque := coalesce((p ->> 'reboque')::app.reboque, k.reboque);
  k.carga := coalesce((p ->> 'carga')::app.tipo_carga, k.carga);
  if k.veiculo_cliente and k.reboque = 'SIM' then
    return interno.negar('SALVAR_CATEGORIA', 'categoria:' || k.codigo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('reboque')));
  end if;

  begin
    if v_novo then
      insert into app.categorias (codigo, nome, descricao_curta, carga, reboque, ordem, ativa, veiculo_cliente)
      values (k.codigo, k.nome, k.descricao_curta, k.carga, k.reboque, k.ordem, k.ativa, k.veiculo_cliente);
    else
      update app.categorias set nome = k.nome, descricao_curta = k.descricao_curta, carga = k.carga, reboque = k.reboque,
                                ordem = k.ordem, ativa = k.ativa, veiculo_cliente = k.veiculo_cliente
       where codigo = k.codigo;
    end if;
  exception when unique_violation then
    return interno.negar('SALVAR_CATEGORIA', 'categoria:' || k.codigo, 'CATEGORIA_DUPLICADA',
      jsonb_build_object('nome', k.nome));
  end;

  perform interno.auditar('SALVAR_CATEGORIA', 'categoria:' || k.codigo, 'OK', null,
    jsonb_build_object('nova', v_novo, 'anterior', v_anterior, 'novo', to_jsonb(k)));
  if v_novo then
    return jsonb_build_object('ok', true, 'codigo', k.codigo);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Leitura da tela "Categorias e preços" (corpo de 20261020120260_categorias_adm.sql). 4.1: cada categoria traz ainda
-- carga, reboque, veiculo_cliente e `tarifa`: a da versão pedida (ou da vigente, sem p_versao), com inicial:false; se a
-- versão não tem tarifa da categoria, os preços de hoje (interno.tarifa_inicial) com inicial:true; nula sem contrato.
create or replace function api.categorias_adm(p_empresa uuid default null, p_versao int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c app.contratos_versoes;
  v_precos jsonb;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('CATEGORIAS_ADM', 'categoria', 'SEM_PERMISSAO');
  end if;
  if p_versao is not null then
    select * into c from app.contratos_versoes x
     where x.versao = p_versao and ((p_empresa is null and x.empresa_id is null) or x.empresa_id = p_empresa);
    if c.id is null then
      return interno.negar('CATEGORIAS_ADM', 'contrato:' || coalesce(p_empresa::text, 'modelo'), 'NAO_ENCONTRADO');
    end if;
    select jsonb_object_agg(x.categoria, jsonb_build_object('km_cent', x.km_cent, 'taxa_fixa_cent', x.taxa_fixa_cent))
      into v_precos
      from app.contratos_categorias x where x.contrato_id = c.id;
  else
    select * into c from interno.contrato_vigente(p_empresa);
  end if;
  return jsonb_build_object('ok', true,
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nome', k.nome, 'descricao_curta', k.descricao_curta,
                                          'ordem', k.ordem, 'ativa', k.ativa, 'carga', k.carga, 'reboque', k.reboque,
                                          'veiculo_cliente', k.veiculo_cliente,
                                          'tarifa', case when c.id is null then null
                                                         when t.contrato_id is not null
                                                         then to_jsonb(t) - 'contrato_id' - 'categoria'
                                                              || jsonb_build_object('inicial', false)
                                                         else interno.tarifa_inicial(c, k.codigo)
                                                              || jsonb_build_object('inicial', true) end)
                       order by k.ordem, k.codigo)
        from app.categorias k
        left join app.tarifas_categoria t on t.contrato_id = c.id and t.categoria = k.codigo), '[]'::jsonb),
    'precos', v_precos);
end $$;

-- Publica a tabela de preço por categoria: uma versão nova do contrato da empresa (ou da tabela modelo, com p_empresa
-- nulo) com os campos comuns copiados da versão VIGENTE (prazos, faixas de cancelamento, crédito e os preços de hoje,
-- que o app atual continua usando) e a tarifa de TODAS as categorias ativas:
-- p_tarifas = {"CODIGO": {taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent, parada_cent, retorno_bp, reboque_cent,
-- hospedagem_diaria_cent}, …}. O preço por categoria de antes (contratos_categorias) da vigente também segue.
-- Mesmas regras de vigência e auditoria de publicar_contrato.
create function api.publicar_tarifas(p_empresa uuid, p_tarifas jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  c app.contratos_versoes;
  nova int;
  v_id bigint;
  v_copiadas int;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('PUBLICAR_TARIFAS', 'contrato', 'SEM_PERMISSAO');
  end if;
  if p_empresa is not null and not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PUBLICAR_TARIFAS', 'contrato', 'NAO_ENCONTRADO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'VIGENCIA_NO_PASSADO');
  end if;
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  -- As categorias ativas não mudam no meio da publicação (mesmo lock de salvar_categoria).
  perform pg_advisory_xact_lock(hashtext('categorias'));
  v_detalhe := interno.validar_tarifas(p_tarifas);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  select * into c from interno.contrato_vigente(p_empresa);
  if c.id is null then
    return interno.negar('PUBLICAR_TARIFAS', v_alvo, 'SEM_CONTRATO');
  end if;

  nova := interno.inserir_contrato(p_empresa,
    to_jsonb(c) - array['id', 'empresa_id', 'versao', 'vigente_desde', 'publicado_por', 'publicado_por_nome', 'publicado_em'],
    p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())));
  select x.id into v_id from app.contratos_versoes x
   where x.versao = nova and ((p_empresa is null and x.empresa_id is null) or x.empresa_id = p_empresa);
  insert into app.tarifas_categoria (contrato_id, categoria, taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent,
                                     parada_cent, reboque_cent, hospedagem_diaria_cent, retorno_bp)
  select v_id, j.key, (j.value ->> 'taxa_fixa_cent')::bigint, (j.value ->> 'km_cent')::bigint,
         (j.value ->> 'hora_cent')::bigint, (j.value ->> 'hora_espera_cent')::bigint, (j.value ->> 'parada_cent')::bigint,
         (j.value ->> 'reboque_cent')::bigint, (j.value ->> 'hospedagem_diaria_cent')::bigint, (j.value ->> 'retorno_bp')::int
    from jsonb_each(p_tarifas) j;
  insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
  select v_id, cc.categoria, cc.km_cent, cc.taxa_fixa_cent from app.contratos_categorias cc where cc.contrato_id = c.id;
  get diagnostics v_copiadas = row_count;

  perform interno.auditar('PUBLICAR_TARIFAS', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'versao_base', c.versao, 'tarifas', p_tarifas, 'categorias_copiadas', v_copiadas));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

------------------------------------------------------------------------------------------------
-- 8. Publicações de hoje levam as tarifas adiante.
------------------------------------------------------------------------------------------------

-- Corpo de 20261020120400_ajustes_revisao_final.sql. 4.1: a versão nova herda também as tarifas por categoria da
-- versão anterior da mesma empresa (ou do modelo), para a tela de Contratos do app atual não apagá-las.
create or replace function api.publicar_contrato(p_empresa uuid, p jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  nova int;
  v_id bigint;
  v_anterior bigint;
  v_copiadas int;
  v_tarifas int;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'SEM_PERMISSAO');
  end if;
  if p_empresa is not null and not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'NAO_ENCONTRADO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'VIGENCIA_NO_PASSADO');
  end if;
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  v_detalhe := interno.validar_contrato(p);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;

  nova := interno.inserir_contrato(p_empresa, p, p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())));
  -- R18: a versão nova herda o preço por categoria da versão anterior da mesma empresa (ou do modelo); 4.1: e as tarifas.
  select c.id into v_id from app.contratos_versoes c
   where c.versao = nova and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa);
  select c.id into v_anterior from app.contratos_versoes c
   where c.versao < nova and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
   order by c.versao desc limit 1;
  insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
  select v_id, cc.categoria, cc.km_cent, cc.taxa_fixa_cent
    from app.contratos_categorias cc where cc.contrato_id = v_anterior;
  get diagnostics v_copiadas = row_count;
  insert into app.tarifas_categoria (contrato_id, categoria, taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent,
                                     parada_cent, reboque_cent, hospedagem_diaria_cent, retorno_bp)
  select v_id, t.categoria, t.taxa_fixa_cent, t.km_cent, t.hora_cent, t.hora_espera_cent, t.parada_cent, t.reboque_cent,
         t.hospedagem_diaria_cent, t.retorno_bp
    from app.tarifas_categoria t where t.contrato_id = v_anterior;
  get diagnostics v_tarifas = row_count;

  perform interno.auditar('PUBLICAR_CONTRATO', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'categorias_copiadas', v_copiadas, 'tarifas_copiadas', v_tarifas));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

-- Corpo de 20261020120000_categorias_veiculos.sql. 4.1: a versão nova herda as tarifas por categoria da versão
-- anterior (o preço por categoria de antes continua vindo de p_categoria, com as 3 chaves de sempre).
create or replace function api.publicar_contrato_categorias(p_empresa uuid, p jsonb, p_categorias jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  nova int;
  v_id bigint;
  v_tarifas int;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'SEM_PERMISSAO');
  end if;
  if p_empresa is not null and not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('PUBLICAR_CONTRATO', 'contrato', 'NAO_ENCONTRADO');
  end if;

  if p_vigente_desde is null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;
  if p_vigente_desde < now() - interval '1 minute' then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'VIGENCIA_NO_PASSADO');
  end if;
  if p_vigente_desde > now() + interval '1 year' then  -- inclui 'infinity'
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('vigente_desde')));
  end if;

  v_detalhe := interno.validar_contrato(p);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  v_detalhe := interno.validar_categorias_preco(p_categorias);
  if v_detalhe is not null then
    return interno.negar('PUBLICAR_CONTRATO', v_alvo, 'CAMPOS_INVALIDOS', v_detalhe);
  end if;

  nova := interno.inserir_contrato(p_empresa, p, p_vigente_desde, (select auth.uid()),
    (select pf.nome from app.perfis pf where pf.usuario_id = (select auth.uid())));
  select c.id into v_id from app.contratos_versoes c
   where c.versao = nova and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa);
  insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
  select v_id, k.key, (k.value ->> 'km_cent')::bigint, (k.value ->> 'taxa_fixa_cent')::bigint
    from jsonb_each(p_categorias) k;
  -- 4.1: as tarifas da versão anterior seguem.
  insert into app.tarifas_categoria (contrato_id, categoria, taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent,
                                     parada_cent, reboque_cent, hospedagem_diaria_cent, retorno_bp)
  select v_id, t.categoria, t.taxa_fixa_cent, t.km_cent, t.hora_cent, t.hora_espera_cent, t.parada_cent, t.reboque_cent,
         t.hospedagem_diaria_cent, t.retorno_bp
    from app.tarifas_categoria t
   where t.contrato_id = (select c.id from app.contratos_versoes c
                           where c.versao < nova
                             and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
                           order by c.versao desc limit 1);
  get diagnostics v_tarifas = row_count;

  perform interno.auditar('PUBLICAR_CONTRATO', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'categorias', p_categorias, 'tarifas_copiadas', v_tarifas));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

------------------------------------------------------------------------------------------------
-- 9. Privilégios: as funções novas nascem fechadas; as substituídas mantêm os seus.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.veiculo_categorias_validas(),
  interno.codigo_categoria(text),
  interno.tarifa_da_categoria(app.contratos_versoes, text),
  interno.tarifa_inicial(app.contratos_versoes, text),
  interno.linhas_da_tarifa(app.tarifas_categoria, boolean, boolean, boolean, jsonb),
  interno.linhas_para_categoria(app.contratos_versoes, boolean, boolean, text, jsonb),
  interno.validar_tarifas(jsonb)
from public, anon, authenticated;

revoke all on function api.publicar_tarifas(uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function api.publicar_tarifas(uuid, jsonb, timestamptz) to authenticated;
