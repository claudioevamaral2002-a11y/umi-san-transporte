-- Fase 4, Tarefa 1 (docs/fases/fase-4-ivo-estilo-uber-desenho.md §5.1, §5.3, §5.5): categorias de corrida, preço por
-- categoria dentro do contrato e veículos do motorista.
--   * app.categorias: PASSAGEIROS, CARGA_LEVE e CARGA_PESADA (carga e reboque fixos; nome, descrição, ordem e "ativa" o ADM edita);
--   * app.contratos_categorias: preço por km e taxa fixa de cada categoria, presos a UMA versão do contrato (imutável);
--     contrato sem essas linhas (todos os de hoje) cai nos preços atuais: o total é o da prévia de hoje;
--   * app.veiculos: do motorista; o cliente só vê a categoria como disponível se há veículo ATIVO que a atende;
--   * RPCs: categorias_disponiveis (cliente N1/N2), meus_veiculos, salvar_veiculo, mudar_situacao_veiculo (motorista ou
--     ADM), salvar_categoria e publicar_contrato_categorias (ADM). api.publicar_contrato NÃO muda.
-- Só acrescenta tabelas e funções: o app aberto durante o deploy continua funcionando.

------------------------------------------------------------------------------------------------
-- 1. Tabelas. Sem GRANT a anon/authenticated: toda leitura e escrita passa por funções SECURITY DEFINER.
------------------------------------------------------------------------------------------------
create table app.categorias (
  codigo text primary key check (codigo in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA')),
  nome text not null check (length(btrim(nome)) between 2 and 40),
  descricao_curta text not null check (length(btrim(descricao_curta)) between 1 and 60),
  carga app.tipo_carga not null,
  reboque app.reboque not null,
  ordem int not null check (ordem between 1 and 99),
  ativa boolean not null default true
);
alter table app.categorias enable row level security;

insert into app.categorias (codigo, nome, descricao_curta, carga, reboque, ordem) values
  ('PASSAGEIROS',  'IVO Passageiros',  'até 4 pessoas', 'PESSOAS',     'NAO', 1),
  ('CARGA_LEVE',   'IVO Carga Leve',   'até 800 kg',    'EQUIPAMENTO', 'NAO', 2),
  ('CARGA_PESADA', 'IVO Carga Pesada', 'com reboque',   'EQUIPAMENTO', 'SIM', 3);

create table app.contratos_categorias (
  contrato_id bigint not null references app.contratos_versoes (id) on delete restrict,
  categoria text not null references app.categorias (codigo),
  km_cent bigint not null check (km_cent >= 0),
  taxa_fixa_cent bigint not null check (taxa_fixa_cent >= 0),
  primary key (contrato_id, categoria)
);
alter table app.contratos_categorias enable row level security;

-- Imutável como a versão do contrato a que pertence (mesma função de gatilho).
create trigger contratos_categorias_sem_update before update or delete on app.contratos_categorias
  for each row execute function interno.contratos_imutaveis();
create trigger contratos_categorias_sem_truncate before truncate on app.contratos_categorias
  for each statement execute function interno.contratos_imutaveis();

create table app.veiculos (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references app.perfis (usuario_id) on delete restrict,
  modelo text not null check (length(btrim(modelo)) between 1 and 60),
  cor text not null check (length(btrim(cor)) between 1 and 30),
  placa text not null check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$') unique,
  lugares int not null check (lugares between 0 and 60),
  carga_max_kg int not null check (carga_max_kg between 0 and 50000),
  reboque_desc text check (reboque_desc is null or length(reboque_desc) between 1 and 60),
  categorias text[] not null check (cardinality(categorias) > 0 and categorias <@ array['PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA']),
  situacao text not null default 'ATIVO' check (situacao in ('ATIVO', 'MANUTENCAO', 'INATIVO')),
  criado_em timestamptz not null default now()
);
create index veiculos_motorista on app.veiculos (motorista_id, criado_em, id);
alter table app.veiculos enable row level security;

------------------------------------------------------------------------------------------------
-- 2. Funções internas.
------------------------------------------------------------------------------------------------

-- Cópia do contrato com os preços da categoria. Passageiros e Carga Leve trocam o km sem reboque; Carga Pesada troca
-- o km com reboque e a taxa fixa do reboque. Sem linha para a categoria (contrato antigo): o contrato, sem mudança.
create function interno.contrato_da_categoria(c app.contratos_versoes, p_categoria text)
returns app.contratos_versoes language plpgsql stable security definer set search_path = '' as $$
declare
  r app.contratos_versoes := c;
  cc app.contratos_categorias;
begin
  if c.id is null then return c; end if;
  select * into cc from app.contratos_categorias x where x.contrato_id = c.id and x.categoria = p_categoria;
  if cc.contrato_id is null then return c; end if;
  if p_categoria = 'CARGA_PESADA' then
    r.km_com_reboque_cent := cc.km_cent;
    r.taxa_fixa_reboque_cent := cc.taxa_fixa_cent;
  else
    r.km_sem_reboque_cent := cc.km_cent;
  end if;
  return r;
end $$;

-- Linhas do orçamento de uma categoria (veículo próprio): o reboque é o da categoria, não o que o cliente marcou.
create function interno.linhas_da_categoria(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                            p_categoria text, e jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select interno.calcular_linhas(
    interno.contrato_da_categoria(c, p_categoria), p_levar, p_trazer, 'VEICULO_PROPRIO',
    coalesce(e, '{}'::jsonb) || jsonb_build_object('usa_reboque',
      coalesce((select k.reboque = 'SIM' from app.categorias k where k.codigo = p_categoria), false)))
$$;

-- O primeiro veículo ATIVO (o mais antigo) do motorista que atende a categoria, ou nulo.
create function interno.veiculo_atende(p_motorista uuid, p_categoria text) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from app.veiculos v
   where v.motorista_id = p_motorista and v.situacao = 'ATIVO' and p_categoria = any (v.categorias)
   order by v.criado_em, v.id
   limit 1
$$;

-- Valida o preço por categoria de um contrato: as 3 chaves exatas, cada uma {km_cent, taxa_fixa_cent} inteiros.
-- Nulo = válido; senão o detalhe da recusa.
create function interno.validar_categorias_preco(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  codigos constant text[] := array['PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA'];
  inv text[] := '{}';
  k text;
  campo text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('invalidos', jsonb_build_array('categorias'));
  end if;
  if exists (select 1 from jsonb_object_keys(p) x where x <> all (codigos)) then
    inv := array_append(inv, 'categorias');
  end if;
  foreach k in array codigos loop
    if not (p ? k) or jsonb_typeof(p -> k) <> 'object' then
      inv := array_append(inv, k);
      continue;
    end if;
    if exists (select 1 from jsonb_object_keys(p -> k) x where x not in ('km_cent', 'taxa_fixa_cent')) then
      inv := array_append(inv, k);
      continue;
    end if;
    foreach campo in array array['km_cent', 'taxa_fixa_cent'] loop
      if not (jsonb_typeof(p -> k -> campo) = 'number' and (p -> k ->> campo) ~ '^[0-9]{1,16}$') then
        inv := array_append(inv, k || '.' || campo);
      end if;
    end loop;
  end loop;
  if cardinality(inv) > 0 then
    return jsonb_build_object('invalidos', to_jsonb(inv));
  end if;
  return null;
end $$;

revoke execute on function
  interno.contrato_da_categoria(app.contratos_versoes, text),
  interno.linhas_da_categoria(app.contratos_versoes, boolean, boolean, text, jsonb),
  interno.veiculo_atende(uuid, text),
  interno.validar_categorias_preco(jsonb)
from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 3. Cliente (N1/N2): categorias ativas com disponibilidade e preço estimado da rota (a prévia, por categoria).
--    Entrada: {km (um trecho, 0 a 5000, 1 casa), levar, trazer}. Com Levar e Trazer o km é ida e volta (dobro).
--    Categoria sem veículo ativo do motorista atribuído vem indisponível e sem preço.
------------------------------------------------------------------------------------------------
create function api.categorias_disponiveis(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  v_mot uuid := interno.motorista_padrao();
  e jsonb;
  r jsonb;
  k record;
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
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('km', 'levar', 'trazer'))
     or coalesce(jsonb_typeof(p -> 'km'), 'null') <> 'number'
     or not coalesce(case when (p ->> 'km') ~ '^[0-9]{1,4}(\.[0-9])?$' then (p ->> 'km')::numeric <= 5000 end, false)
     or not coalesce(case when jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
                          then (p ->> 'levar')::boolean or (p ->> 'trazer')::boolean end, false) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  e := jsonb_build_object('km', (p ->> 'km')::numeric
                                * case when (p ->> 'levar')::boolean and (p ->> 'trazer')::boolean then 2 else 1 end);

  for k in select * from app.categorias x where x.ativa order by x.ordem, x.codigo loop
    v_disp := v_mot is not null and interno.veiculo_atende(v_mot, k.codigo) is not null;
    if v_disp then
      r := interno.linhas_da_categoria(c, (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean, k.codigo, e);
      if not (r ->> 'ok')::boolean then
        return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, r ->> 'codigo');
      end if;
    end if;
    saida := saida || jsonb_build_array(jsonb_build_object(
      'codigo', k.codigo, 'nome', k.nome, 'descricao_curta', k.descricao_curta, 'disponivel', v_disp,
      'total_cent', case when v_disp then r -> 'total_cent' end,
      'linhas', case when v_disp then r -> 'linhas' end));
  end loop;
  return jsonb_build_object('ok', true, 'categorias', saida);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Veículos: o MOTORISTA cuida dos próprios; o ADM, de todos (informando o motorista ao criar).
------------------------------------------------------------------------------------------------
create function api.meus_veiculos()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA') then
    return interno.negar('MEUS_VEICULOS', 'veiculo', 'SEM_PERMISSAO');
  end if;
  return jsonb_build_object('ok', true, 'veiculos', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'motorista_id', x.motorista_id, 'modelo', x.modelo, 'cor', x.cor, 'placa', x.placa,
             'lugares', x.lugares, 'carga_max_kg', x.carga_max_kg, 'reboque_desc', x.reboque_desc,
             'categorias', to_jsonb(x.categorias), 'situacao', x.situacao, 'criado_em', x.criado_em)
           || case when v.papel = 'ADM' then jsonb_build_object('motorista_nome', x.motorista_nome) else '{}'::jsonb end
           order by x.criado_em, x.id)
      from (select vv.*, pf.nome as motorista_nome
              from app.veiculos vv join app.perfis pf on pf.usuario_id = vv.motorista_id
             where v.papel = 'ADM' or vv.motorista_id = v.usuario_id
             order by vv.criado_em, vv.id
             limit 500) x), '[]'::jsonb));
end $$;

-- Entrada: {id?, motorista_id? (só o ADM, ao criar), modelo, cor, placa, lugares, carga_max_kg, reboque_desc?, categorias}.
-- A placa é gravada em maiúsculas e sem hífen. Com id, edita (o dono não muda).
create function api.salvar_veiculo(p jsonb)
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
                  then jsonb_array_length(p -> 'categorias') between 1 and 3
                       and not exists (select 1 from jsonb_array_elements(p -> 'categorias') x
                                        where jsonb_typeof(x) <> 'string'
                                           or not exists (select 1 from app.categorias k where k.codigo = x #>> '{}'))
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

create function api.mudar_situacao_veiculo(p_id uuid, p_situacao text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_dono uuid;
  v_antes text;
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA') then
    return interno.negar('MUDAR_SITUACAO_VEICULO', 'veiculo', 'SEM_PERMISSAO');
  end if;
  if p_id is null or p_situacao is null or p_situacao not in ('ATIVO', 'MANUTENCAO', 'INATIVO') then
    return interno.negar('MUDAR_SITUACAO_VEICULO', 'veiculo', 'VEICULO_INVALIDO');
  end if;
  select ve.motorista_id, ve.situacao into v_dono, v_antes from app.veiculos ve where ve.id = p_id for update;
  if v_dono is null then
    return interno.negar('MUDAR_SITUACAO_VEICULO', 'veiculo:' || p_id, 'NAO_ENCONTRADO');
  end if;
  if v.papel = 'MOTORISTA' and v_dono <> v.usuario_id then
    return interno.negar('MUDAR_SITUACAO_VEICULO', 'veiculo:' || p_id, 'SEM_PERMISSAO');
  end if;
  update app.veiculos set situacao = p_situacao where id = p_id;
  perform interno.auditar('MUDAR_SITUACAO_VEICULO', 'veiculo:' || p_id, 'OK', null,
    jsonb_build_object('anterior', v_antes, 'nova', p_situacao));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 5. ADM: categorias e contrato com preço por categoria.
------------------------------------------------------------------------------------------------

-- Entrada: {codigo, nome, descricao_curta, ordem, ativa}. Nunca muda o código nem a correspondência carga/reboque;
-- categoria nova não se cria.
create function api.salvar_categoria(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_anterior jsonb;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('SALVAR_CATEGORIA', 'categoria', 'SEM_PERMISSAO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('codigo', 'nome', 'descricao_curta', 'ordem', 'ativa'))
     or coalesce(jsonb_typeof(p -> 'codigo'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'nome'), '') <> 'string' or length(btrim(p ->> 'nome')) not between 2 and 40
     or coalesce(jsonb_typeof(p -> 'descricao_curta'), '') <> 'string' or length(btrim(p ->> 'descricao_curta')) not between 1 and 60
     or not coalesce(jsonb_typeof(p -> 'ordem') = 'number' and (p ->> 'ordem') ~ '^[0-9]{1,2}$'
                     and (p ->> 'ordem')::int between 1 and 99, false)
     or coalesce(jsonb_typeof(p -> 'ativa'), '') <> 'boolean' then
    return interno.negar('SALVAR_CATEGORIA', 'categoria', 'CAMPOS_INVALIDOS');
  end if;
  select to_jsonb(k) into v_anterior from app.categorias k where k.codigo = p ->> 'codigo' for update;
  if v_anterior is null then
    return interno.negar('SALVAR_CATEGORIA', 'categoria:' || left(p ->> 'codigo', 40), 'NAO_ENCONTRADO');
  end if;
  update app.categorias set nome = btrim(p ->> 'nome'), descricao_curta = btrim(p ->> 'descricao_curta'),
                            ordem = (p ->> 'ordem')::int, ativa = (p ->> 'ativa')::boolean
   where codigo = p ->> 'codigo';
  perform interno.auditar('SALVAR_CATEGORIA', 'categoria:' || (p ->> 'codigo'), 'OK', null,
    jsonb_build_object('anterior', v_anterior - 'carga' - 'reboque', 'novo', p));
  return jsonb_build_object('ok', true);
end $$;

-- As mesmas regras de api.publicar_contrato (reaproveita validar_contrato e inserir_contrato), mais o preço de cada
-- categoria, gravado na mesma transação. p_categorias = {"PASSAGEIROS":{"km_cent":…,"taxa_fixa_cent":…}, …} (as 3 chaves).
create function api.publicar_contrato_categorias(p_empresa uuid, p jsonb, p_categorias jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  nova int;
  v_id bigint;
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

  perform interno.auditar('PUBLICAR_CONTRATO', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'categorias', p_categorias));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Privilégios das RPCs.
------------------------------------------------------------------------------------------------
revoke all on function
  api.categorias_disponiveis(jsonb),
  api.meus_veiculos(),
  api.salvar_veiculo(jsonb),
  api.mudar_situacao_veiculo(uuid, text),
  api.salvar_categoria(jsonb),
  api.publicar_contrato_categorias(uuid, jsonb, jsonb, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function
  api.categorias_disponiveis(jsonb),
  api.meus_veiculos(),
  api.salvar_veiculo(jsonb),
  api.mudar_situacao_veiculo(uuid, text),
  api.salvar_categoria(jsonb),
  api.publicar_contrato_categorias(uuid, jsonb, jsonb, timestamptz)
to authenticated;
