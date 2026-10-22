-- Fase 4.1, Tarefa 2 (docs/fases/fase-4-1-categorias-paradas-desenho.md §4.4, §10): paradas, horas estimadas e centro de
-- custo ao pedir; orçamento pela tarifa da categoria.
--   * app.atividades_paradas: até 3 paradas por pedido, na ordem; de um ponto do Google só o place_id, de um ponto
--     marcado no mapa as coordenadas, nunca os dois (termos do Google; a linha da rota não é gravada). Sem acesso direto;
--   * app.atividades.horas_estimadas (0,5 a 24, de 0,5 em 0,5);
--   * interno.validar_pedido aceita `paradas`, `horas_estimadas` e `centro_custo` (até 80); a categoria de veículo do
--     cliente aceita as duas modalidades;
--   * api.criar_pedido grava paradas, horas e centro de custo; a categoria de veículo do cliente (IVO Motorista) grava
--     VEICULO_CLIENTE e só precisa do motorista ativo (nenhum veículo); tarifa com valor por hora exige as horas; a
--     disponibilidade é a mesma de api.categorias_disponiveis (categoria criada depois da última publicação →
--     CATEGORIA_INDISPONIVEL);
--   * interno.linhas_do_pedido (calcular_orcamento e enviar_orcamento): com categoria, interno.linhas_para_categoria —
--     a tarifa da versão, quando existe; senão o preço de hoje. Assim a prévia do cliente (categorias_disponiveis) e o
--     orçamento do motorista saem da mesma tabela. Quando a entrada não traz `paradas`/`horas`, valem as do pedido (o
--     Orçar de hoje não as manda); o motorista ajusta mandando-as. Sem categoria, o cálculo de hoje (as chaves novas
--     não valem);
--   * api.enviar_orcamento: veiculo_id não é exigido na categoria de veículo do cliente;
--   * api.confirmar_corrida: p_centro_custo não nulo SUBSTITUI o gravado (vazio limpa); nulo mantém. A repetição com a
--     mesma chave continua não trocando;
--   * api.pedido devolve `paradas` [{texto, place_id, lat, lng}] na ordem e `horas_estimadas`; painel_empresa traz em
--     cada pedido `paradas` (os textos) e `horas_estimadas`; api.meus_pedidos e api.pendencias trazem em cada item
--     `paradas` (os textos, [] sem paradas). Só chaves novas no JSON.
-- Compatibilidade: o app atual (sem categoria, sem as chaves novas) e o app da fase 4 continuam iguais. Mesmas
-- assinaturas ("create or replace" mantém os privilégios); a função nova nasce fechada.

------------------------------------------------------------------------------------------------
-- 1. Dados.
------------------------------------------------------------------------------------------------
create table app.atividades_paradas (
  atividade_id uuid not null references app.atividades (id) on delete cascade,
  ordem smallint not null check (ordem between 1 and 3),
  texto text not null check (char_length(btrim(texto)) between 3 and 200),
  place_id text check (place_id ~ '^[A-Za-z0-9_-]+$' and char_length(place_id) <= 300),
  lat numeric(9,6) check (lat between -90 and 90),
  lng numeric(9,6) check (lng between -180 and 180),
  primary key (atividade_id, ordem),
  constraint atividades_paradas_par check ((lat is null) = (lng is null)),
  constraint atividades_paradas_google check (place_id is null or lat is null)
);
alter table app.atividades_paradas enable row level security;
revoke all on table app.atividades_paradas from public, anon, authenticated;

alter table app.atividades
  add column horas_estimadas numeric(4,1)
    check (horas_estimadas between 0.5 and 24 and horas_estimadas * 2 = trunc(horas_estimadas * 2));

------------------------------------------------------------------------------------------------
-- 2. Validação e criação do pedido (corpos de 20261022120000_categorias_tarifas.sql, seção 10, salvo o marcado "4.1"
--    a partir daqui).
------------------------------------------------------------------------------------------------

-- Lista de paradas: array de até 3 objetos {texto (3 a 200), place_id?} ou {texto, lat, lng}; nunca place_id e ponto
-- juntos; só essas chaves. Lista vazia vale (nenhuma parada).
create function interno.paradas_validas(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  x jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 3 then
    return false;
  end if;
  for x in select e from jsonb_array_elements(p) e loop
    if jsonb_typeof(x) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(x) k where k not in ('texto', 'place_id', 'lat', 'lng')) then
      return false;
    end if;
    if coalesce(jsonb_typeof(x -> 'texto'), 'null') <> 'string' then
      return false;
    end if;
    if char_length(btrim(x ->> 'texto')) not between 3 and 200 then
      return false;
    end if;
    if coalesce(jsonb_typeof(x -> 'place_id'), 'null') not in ('string', 'null') then
      return false;
    end if;
    if jsonb_typeof(x -> 'place_id') = 'string'
       and ((x ->> 'place_id') !~ '^[A-Za-z0-9_-]+$' or char_length(x ->> 'place_id') > 300) then
      return false;
    end if;
    if coalesce(jsonb_typeof(x -> 'lat'), 'null') <> coalesce(jsonb_typeof(x -> 'lng'), 'null') then
      return false;
    end if;
    if coalesce(jsonb_typeof(x -> 'lat'), 'null') <> 'null' then
      if jsonb_typeof(x -> 'lat') <> 'number' then
        return false;
      end if;
      if (x ->> 'lat')::numeric not between -90 and 90 or (x ->> 'lng')::numeric not between -180 and 180 then
        return false;
      end if;
      if coalesce(jsonb_typeof(x -> 'place_id'), 'null') <> 'null' then
        return false;
      end if;
    end if;
  end loop;
  return true;
end $$;

create or replace function interno.validar_pedido(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  obrigatorios constant text[] := array['inicio', 'duracao_min', 'origem', 'destino', 'levar', 'trazer', 'carga',
                                        'modalidade', 'reboque'];
  opcionais constant text[] := array['pessoas_qtd', 'equipamento_desc', 'peso_kg', 'dimensoes', 'contato_nome',
                                     'contato_telefone', 'observacoes',
                                     -- fase 3A
                                     'origem_lat', 'origem_lng', 'destino_lat', 'destino_lng', 'origem_place_id',
                                     'destino_place_id',
                                     -- fase 4
                                     'categoria', 'agora',
                                     -- 4.1
                                     'paradas', 'horas_estimadas', 'centro_custo'];
  desconhecidos text[];
  ausentes text[];
  inv text[] := '{}';
  v_carga text;
  v_pessoas boolean;
  v_equip boolean;
  v_inicio timestamptz;
  k app.categorias;
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

  -- fase 4: categoria só no veículo próprio, com a carga dela (a disponibilidade é conferida no criar_pedido). 4.1: o
  -- reboque enviado não precisa bater com o da categoria (o app da fase 4 em cache manda NAO na Carga Leve); o
  -- criar_pedido grava o reboque da categoria. 4.1: a categoria de veículo do cliente (IVO Motorista) aceita as duas
  -- modalidades (o app da fase 4 manda VEICULO_PROPRIO em toda categoria) e o criar_pedido grava VEICULO_CLIENTE.
  if coalesce(jsonb_typeof(p -> 'categoria'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'categoria') = 'string' then
      select * into k from app.categorias x where x.codigo = p ->> 'categoria';
    end if;
    if k.codigo is null
       or (not k.veiculo_cliente and coalesce(p ->> 'modalidade', '') <> 'VEICULO_PROPRIO')
       or v_carga is distinct from k.carga::text then
      inv := array_append(inv, 'categoria');
    end if;
  end if;
  -- 4.1: até 3 paradas (interno.paradas_validas); horas estimadas de 0,5 a 24, de 0,5 em 0,5; centro de custo até 80
  -- caracteres (aparado; vazio = nenhum). A exigência das horas (tarifa com valor por hora) é conferida no criar_pedido,
  -- que conhece o contrato.
  if coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null' and not interno.paradas_validas(p -> 'paradas') then
    inv := array_append(inv, 'paradas');
  end if;
  if coalesce(jsonb_typeof(p -> 'horas_estimadas'), 'null') <> 'null'
     and not coalesce(case when jsonb_typeof(p -> 'horas_estimadas') = 'number'
                                and (p ->> 'horas_estimadas') ~ '^[0-9]{1,2}(\.[0-9]{1,6})?$'
                           then (p ->> 'horas_estimadas')::numeric between 0.5 and 24
                                and (p ->> 'horas_estimadas')::numeric * 2 = trunc((p ->> 'horas_estimadas')::numeric * 2)
                      end, false) then
    inv := array_append(inv, 'horas_estimadas');
  end if;
  if coalesce(jsonb_typeof(p -> 'centro_custo'), 'null') <> 'null'
     and not coalesce(case when jsonb_typeof(p -> 'centro_custo') = 'string'
                           then char_length(btrim(p ->> 'centro_custo')) <= 80 end, false) then
    inv := array_append(inv, 'centro_custo');
  end if;
  -- fase 4: "Agora" = o primeiro horário livre a partir de agora + 60 min (folga de 5 min para o relógio do aparelho),
  -- no máximo 36 h depois (o "Agora" das 23h30 cai no dia seguinte).
  if coalesce(jsonb_typeof(p -> 'agora'), 'null') not in ('boolean', 'null') then
    inv := array_append(inv, 'agora');
  elsif jsonb_typeof(p -> 'agora') = 'boolean' and (p ->> 'agora')::boolean and v_inicio is not null
        and (v_inicio < now() + interval '55 minutes' or v_inicio > now() + interval '36 hours') then
    inv := array_append(inv, 'agora');
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
  v_categoria text;
  v_agora boolean;
  v_cat app.categorias;
  v_tarifa app.tarifas_categoria;
  v_paradas int;
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
  -- fase 4: categoria inativa ou sem veículo ATIVO do motorista que a atenda (a tela mostra "Indisponível no momento").
  -- 4.1: a mesma regra de api.categorias_disponiveis: a de veículo do cliente (IVO Motorista) só precisa do motorista
  -- ativo; e a versão vigente precisa ter tarifa da categoria, salvo as três de antes da 4.1 (preço de hoje). Uma
  -- categoria criada depois da última publicação fica indisponível.
  v_categoria := p ->> 'categoria';
  v_agora := coalesce((p ->> 'agora')::boolean, false);
  if v_categoria is not null then
    select * into v_cat from app.categorias x where x.codigo = v_categoria;
    select * into v_tarifa from app.tarifas_categoria t where t.contrato_id = c.id and t.categoria = v_categoria;
    if not coalesce(v_cat.ativa, false)
       or not (v_cat.veiculo_cliente or interno.veiculo_atende(v_motorista, v_categoria) is not null)
       or not (v_tarifa.contrato_id is not null or v_categoria in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA')) then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'CATEGORIA_INDISPONIVEL', jsonb_build_object('categoria', v_categoria));
    end if;
    -- 4.1: tarifa com valor por hora exige as horas estimadas.
    if coalesce(v_tarifa.hora_cent > 0, false) and coalesce(jsonb_typeof(p -> 'horas_estimadas'), 'null') = 'null' then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'CAMPOS_INVALIDOS',
        jsonb_build_object('desconhecidos', '[]'::jsonb, 'ausentes', '[]'::jsonb,
                           'invalidos', jsonb_build_array('horas_estimadas')));
    end if;
  end if;
  -- 4.1: com categoria, carga e reboque gravados são os da categoria (não os que o aparelho mandou); na de veículo do
  -- cliente, a modalidade é VEICULO_CLIENTE.

  v_inicio := (p ->> 'inicio')::timestamptz;
  v_periodo := tstzrange(v_inicio, v_inicio + make_interval(mins => (p ->> 'duracao_min')::int), '[)');
  -- fase 4: no "Agora", o Ivo tem 15 min para responder.
  v_prazo := case when v_agora then least(now() + interval '15 minutes', v_inicio)
                  else least(now() + make_interval(hours => c.prazo_orcar_horas), v_inicio) end;

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
      origem_lat, origem_lng, destino_lat, destino_lng, origem_place_id, destino_place_id,
      categoria, agora, horas_estimadas, centro_custo)
    values (
      v.empresa_id, v.usuario_id, v_motorista, v_inicio, (p ->> 'duracao_min')::int,
      btrim(p ->> 'origem'), btrim(p ->> 'destino'), (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean,
      coalesce(v_cat.carga, (p ->> 'carga')::app.tipo_carga),
      (p ->> 'pessoas_qtd')::int, nullif(btrim(p ->> 'equipamento_desc'), ''), (p ->> 'peso_kg')::numeric,
      nullif(btrim(p ->> 'dimensoes'), ''),
      case when v_cat.veiculo_cliente then 'VEICULO_CLIENTE'::app.modalidade else (p ->> 'modalidade')::app.modalidade end,
      coalesce(v_cat.reboque, (p ->> 'reboque')::app.reboque),
      nullif(btrim(p ->> 'contato_nome'), ''), nullif(btrim(p ->> 'contato_telefone'), ''),
      nullif(p ->> 'observacoes', ''), v_prazo,
      (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric,
      (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric,
      p ->> 'origem_place_id', p ->> 'destino_place_id',
      v_categoria, v_agora, (p ->> 'horas_estimadas')::numeric, nullif(btrim(p ->> 'centro_custo'), ''))
    returning id, numero into v_id, v_numero;
    -- 4.1: as paradas, na ordem (do Google só o place_id; de um ponto marcado, as coordenadas).
    insert into app.atividades_paradas (atividade_id, ordem, texto, place_id, lat, lng)
    select v_id, x.o, btrim(x.e ->> 'texto'), x.e ->> 'place_id', (x.e ->> 'lat')::numeric, (x.e ->> 'lng')::numeric
      from jsonb_array_elements(case when jsonb_typeof(p -> 'paradas') = 'array' then p -> 'paradas' else '[]'::jsonb end)
           with ordinality x(e, o);
    get diagnostics v_paradas = row_count;
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
                       'expiradas', v_expiradas, 'categoria', v_categoria, 'agora', v_agora,
                       'paradas', v_paradas, 'horas_estimadas', (p ->> 'horas_estimadas')::numeric,
                       'centro_custo', nullif(btrim(p ->> 'centro_custo'), '')));
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Orçamento pela tarifa da categoria (invariante: prévia do cliente = orçamento do motorista).
------------------------------------------------------------------------------------------------

-- Linhas da tabela do pedido (corpo de 20261020120100_pedido_estilo_uber.sql). 4.1: com categoria,
-- interno.linhas_para_categoria (a tarifa da versão, quando existe; senão o preço de hoje), como em
-- api.categorias_disponiveis. Sem `paradas` na entrada, vale o número de paradas do pedido; sem `horas`, as horas
-- estimadas. Sem categoria, o cálculo de hoje. `e` já vem sem as chaves da corrida.
create or replace function interno.linhas_do_pedido(c app.contratos_versoes, a app.atividades, e jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e jsonb := e;
  n int;
begin
  if a.categoria is null then
    return interno.calcular_linhas(c, a.levar, a.trazer, a.modalidade, e);
  end if;
  if jsonb_typeof(v_e) = 'object' then
    if coalesce(jsonb_typeof(v_e -> 'paradas'), 'null') = 'null' then
      select count(*) into n from app.atividades_paradas x where x.atividade_id = a.id;
      v_e := (v_e - 'paradas') || case when n > 0 then jsonb_build_object('paradas', n) else '{}'::jsonb end;
    end if;
    if coalesce(jsonb_typeof(v_e -> 'horas'), 'null') = 'null' and a.horas_estimadas is not null then
      v_e := (v_e - 'horas') || jsonb_build_object('horas', a.horas_estimadas);
    end if;
  end if;
  return interno.linhas_para_categoria(c, a.levar, a.trazer, a.categoria, v_e);
end $$;

-- Envio do orçamento (corpo de 20261020120400_ajustes_revisao_final.sql).
create or replace function api.enviar_orcamento(p_atividade uuid, p jsonb, p_horario_sugerido timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  teto_cent constant bigint := 100000000000;  -- R$ 1 bilhão, o mesmo de interno.calcular_linhas
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contratos_versoes;
  o app.orcamentos;
  r jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_veiculo uuid;
  v_ajuste bigint := 0;
  v_motivo text;
  v_tabela bigint;
  v_min bigint;
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if a.id is null then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if not interno.pode_orcar(v, a) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if a.status <> 'SOLICITADA' then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'PRAZO_VENCIDO');
  end if;

  -- fase 4: ajuste e motivo
  if coalesce(jsonb_typeof(p -> 'ajuste_cent'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'ajuste_cent') in ('string', 'number') and (p ->> 'ajuste_cent') ~ '^[+-]?[0-9]{1,12}$' then
      v_ajuste := (p ->> 'ajuste_cent')::bigint;
    else
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
        jsonb_build_object('invalidos', jsonb_build_array('ajuste_cent')));
    end if;
  end if;
  if v_ajuste <> 0 then
    if coalesce(jsonb_typeof(p -> 'ajuste_motivo'), 'null') <> 'string'
       or char_length(btrim(p ->> 'ajuste_motivo')) not between 3 and 200 then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'MOTIVO_INVALIDO');
    end if;
    v_motivo := btrim(p ->> 'ajuste_motivo');
  end if;
  -- fase 4: veículo
  if coalesce(jsonb_typeof(p -> 'veiculo_id'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'veiculo_id') <> 'string'
       or (p ->> 'veiculo_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VEICULO_INVALIDO');
    end if;
    v_veiculo := (p ->> 'veiculo_id')::uuid;
  end if;
  if v_veiculo is not null
     and not exists (select 1 from app.veiculos x
                      where x.id = v_veiculo and x.situacao = 'ATIVO' and x.motorista_id = a.motorista_id
                        and (a.categoria is null or a.categoria = any (x.categorias))) then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VEICULO_INVALIDO',
      jsonb_build_object('veiculo_id', v_veiculo, 'categoria', a.categoria));
  end if;
  -- R18: categoria sem veiculo_id (Orçar do app atual e do ADM): o veículo ativo do motorista que atende a categoria.
  -- 4.1: a categoria de veículo do cliente (IVO Motorista) não usa veículo da IVO (veiculo_id fica nulo).
  if v_veiculo is null and a.categoria is not null
     and not coalesce((select k.veiculo_cliente from app.categorias k where k.codigo = a.categoria), false) then
    v_veiculo := interno.veiculo_atende(a.motorista_id, a.categoria);
    if v_veiculo is null then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VEICULO_INVALIDO',
        jsonb_build_object('veiculo_id', null, 'categoria', a.categoria));
    end if;
  end if;

  select * into c from interno.contrato_vigente(a.empresa_id);
  r := interno.linhas_do_pedido(c, a, interno.entrada_sem_corrida(p));
  if not (r ->> 'ok')::boolean then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  if p_horario_sugerido is not null
     and (p_horario_sugerido <= now() or p_horario_sugerido > now() + interval '366 days') then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('horario_sugerido')));
  end if;

  -- fase 4: o ajuste entra nas linhas e no total (antes do hash).
  v_tabela := (r ->> 'total_cent')::bigint;
  if v_ajuste <> 0 then
    v_min := -interno.arred(v_tabela / 2.0);
    if v_ajuste < v_min or v_ajuste > v_tabela then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'AJUSTE_FORA_DO_LIMITE',
        jsonb_build_object('ajuste_cent', v_ajuste, 'tabela_cent', v_tabela, 'min_cent', v_min, 'max_cent', v_tabela));
    end if;
    if v_tabela + v_ajuste > teto_cent then
      return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VALOR_FORA_DO_LIMITE');
    end if;
    r := jsonb_set(jsonb_set(r, '{linhas}', (r -> 'linhas') || jsonb_build_array(interno.linha_orcamento(
           'AJUSTE_MOTORISTA', v_motivo, 1, v_ajuste, null, null, v_ajuste))),
         '{total_cent}', to_jsonb(v_tabela + v_ajuste));
  end if;
  -- R18: orçamento de 0 não sai (a saída lançaria um débito de 0, que o livro-razão recusa).
  if (r ->> 'total_cent')::bigint <= 0 then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'VALOR_INVALIDO',
      jsonb_build_object('total_cent', (r ->> 'total_cent')::bigint, 'tabela_cent', v_tabela, 'ajuste_cent', v_ajuste));
  end if;

  -- defensivo: nunca dois PENDENTES (a revisão já marcou o anterior como SUBSTITUIDO)
  update app.orcamentos set status = 'SUBSTITUIDO' where atividade_id = a.id and status = 'PENDENTE';

  o.id := gen_random_uuid();
  o.atividade_id := a.id;
  o.versao := coalesce((select max(x.versao) from app.orcamentos x where x.atividade_id = a.id), 0) + 1;
  o.modalidade := (r ->> 'modalidade')::app.modalidade;
  o.entrada := p;
  o.linhas := r -> 'linhas';
  o.total_cent := (r ->> 'total_cent')::bigint;
  o.contrato_versao := c.versao;
  o.snapshot := interno.snapshot_contrato(c);
  o.valido_ate := interno.validade_orcamento(c, a);
  o.horario_sugerido := p_horario_sugerido;
  o.status := 'PENDENTE';
  o.enviado_por := v.usuario_id;
  o.enviado_em := now();
  o.hash := interno.hash_orcamento(o, a);
  insert into app.orcamentos select o.*;

  update app.atividades set veiculo_id = v_veiculo where id = a.id and veiculo_id is distinct from v_veiculo;
  perform interno.transicionar(a.id, 'ORCADA', null);
  update app.agenda_blocos set expira_em = o.valido_ate where atividade_id = a.id and ativo;

  perform interno.auditar('ENVIAR_ORCAMENTO', v_alvo, 'OK', null,
    jsonb_build_object('orcamento_id', o.id, 'versao', o.versao, 'modalidade', o.modalidade, 'total_cent', o.total_cent,
                       'contrato_versao', o.contrato_versao, 'valido_ate', o.valido_ate, 'hash', o.hash,
                       'categoria', a.categoria, 'veiculo_id', v_veiculo, 'tabela_cent', v_tabela,
                       'ajuste_cent', v_ajuste, 'ajuste_motivo', v_motivo));
  return jsonb_build_object('ok', true, 'orcamento_id', o.id, 'versao', o.versao, 'total_cent', o.total_cent,
                            'valido_ate', o.valido_ate);
end $$;


------------------------------------------------------------------------------------------------
-- 4. Confirmação: o centro de custo informado substitui o do pedido (corpo de 20261020120100_pedido_estilo_uber.sql).
------------------------------------------------------------------------------------------------

-- A aprovação de hoje (api.aprovar_orcamento) mais o centro de custo (texto livre, até 80 caracteres). 4.1: o centro
-- de custo já pode vir do pedido; p_centro_custo não nulo o SUBSTITUI (aparado; vazio limpa), nulo mantém. Gravado só
-- quando a aprovação dá certo nesta chamada: a repetição com a mesma chave (o pedido já estava AGENDADA) devolve o
-- resultado original e não troca o centro de custo.
create or replace function api.confirmar_corrida(p_atividade uuid, p_versao int, p_hash text, p_chave uuid,
                                                 p_centro_custo text default null, p_dispositivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_cc text := nullif(btrim(coalesce(p_centro_custo, '')), '');
  v_antes app.status_atividade;
  v_anterior text;
  r jsonb;
  n int;
begin
  if char_length(v_cc) > 80 then
    return interno.negar('CONFIRMAR_CORRIDA', v_alvo, 'CENTRO_CUSTO_INVALIDO');
  end if;
  select x.status, x.centro_custo into v_antes, v_anterior from app.atividades x where x.id = p_atividade;
  r := api.aprovar_orcamento(p_atividade, p_versao, p_hash, p_chave, p_dispositivo);
  if coalesce((r ->> 'ok')::boolean, false) and p_centro_custo is not null and v_antes = 'ORCADA' then
    update app.atividades set centro_custo = v_cc
     where id = p_atividade and status = 'AGENDADA' and centro_custo is distinct from v_cc;
    get diagnostics n = row_count;
    if n > 0 then
      perform interno.auditar('CONFIRMAR_CORRIDA', v_alvo, 'OK', null,
        jsonb_build_object('centro_custo', v_cc, 'anterior', v_anterior, 'chave', p_chave));
    end if;
  end if;
  return r;
end $$;

------------------------------------------------------------------------------------------------
-- 5. Leituras: detalhe do pedido e painel da empresa.
------------------------------------------------------------------------------------------------

-- Os textos das paradas do pedido, na ordem ([] sem paradas): para as listas (De → paradas → Para).
create function interno.paradas_textos(p_atividade uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_agg(x.texto order by x.ordem) from app.atividades_paradas x
                    where x.atividade_id = p_atividade), '[]'::jsonb)
$$;

-- Detalhe do pedido (corpo de 20261020120400_ajustes_revisao_final.sql). 4.1: paradas e horas estimadas.
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
                   where f.atividade_id = a.id and f.enviada_em is not null and f.apagada_em is null)) || jsonb_build_object(
    -- fase 4
    'categoria', a.categoria,
    'categoria_nome', (select k.nome from app.categorias k where k.codigo = a.categoria),
    'veiculo', case when a.status in ('ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA') then
                 (select jsonb_build_object('modelo', x.modelo, 'cor', x.cor, 'placa', x.placa)
                    from app.veiculos x where x.id = a.veiculo_id) end,
    'centro_custo', a.centro_custo, 'agora', a.agora, 'avaliacao', a.avaliacao,
    'ultima_posicao', case when a.status = 'EM_ANDAMENTO' and interno.pode_ver_rastreio(v, a) then
                        (select jsonb_build_object('lat', x.lat, 'lng', x.lng, 'em', x.em)
                           from app.posicoes x where x.atividade_id = a.id
                          order by x.em desc, x.id desc limit 1) end) || jsonb_build_object(
    -- fase 4, T10
    -- R18: em CONCLUIDA, só nas 24 h depois da conclusão (minimização LGPD)
    'motorista_telefone', case when a.status in ('AGENDADA', 'EM_ANDAMENTO')
                                 or (a.status = 'CONCLUIDA' and a.concluiu_em > now() - interval '24 hours') then
                            (select nullif(btrim(pf.telefone), '') from app.perfis pf
                              where pf.usuario_id = a.motorista_id) end) || jsonb_build_object(
    -- 4.1
    'paradas', coalesce((select jsonb_agg(jsonb_build_object('texto', x.texto, 'place_id', x.place_id,
                                                             'lat', x.lat, 'lng', x.lng) order by x.ordem)
                           from app.atividades_paradas x where x.atividade_id = a.id), '[]'::jsonb),
    'horas_estimadas', a.horas_estimadas);

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
      'enviar_fotos', interno.pode_enviar_foto(v, a),
      -- fase 4
      'avaliar', a.status = 'CONCLUIDA' and a.avaliacao is null and interno.pode_decidir(v, a)));
end $$;

-- Uma linha das tabelas do painel (corpo de 20261020120300_painel_empresa.sql). 4.1: os textos das paradas, na ordem,
-- e as horas estimadas (colunas "Paradas" e "Horas" do CSV).
create or replace function interno.painel_pedido(a app.atividades) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'solicitante_nome', p.nome, 'inicio', a.inicio,
    'fim_previsto', interno.fim_da_atividade(a), 'origem', a.origem, 'destino', a.destino,
    'categoria_nome', k.nome, 'centro_custo', a.centro_custo, 'status', a.status,
    'valor_cent', v.valor,
    'estimado', v.valor is null and a.status in ('SOLICITADA', 'ORCADA', 'AGENDADA'),
    'paradas', interno.paradas_textos(a.id),
    'horas_estimadas', a.horas_estimadas)
  from (select 1) x
  left join app.perfis p on p.usuario_id = a.solicitante_id
  left join app.categorias k on k.codigo = a.categoria
  cross join lateral (
    select case
      when a.status = 'CANCELADA' then
        (select -l.valor_cent from app.lancamentos l where l.atividade_id = a.id and l.tipo = 'MULTA')
      else coalesce(
        (select o.total_cent from app.orcamentos o where o.atividade_id = a.id and o.status = 'APROVADO'
          order by o.versao desc limit 1),
        (select o.total_cent from app.orcamentos o where o.atividade_id = a.id and o.status = 'PENDENTE'))
    end as valor) v
$$;

-- Lista de pedidos (corpo de 20261009131000_leituras_tempo_real.sql). 4.1: cada item com `paradas` (os textos).
create or replace function api.meus_pedidos(p_filtro jsonb default '{}')
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
             'empresa_nome', case when v_equipe then e.nome end,
             -- 4.1
             'paradas', interno.paradas_textos(a.id)) as item
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

-- Pendências (corpo de 20261020120100_pedido_estilo_uber.sql). 4.1: cada item com `paradas` (os textos).
create or replace function api.pendencias()
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
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora,
             'paradas', interno.paradas_textos(a.id)) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    left join app.categorias k on k.codigo = a.categoria
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
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora,
             'paradas', interno.paradas_textos(a.id)) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    join app.orcamentos o on o.atividade_id = a.id and o.status = 'PENDENTE'
    left join app.categorias k on k.codigo = a.categoria
    where a.status = 'ORCADA'
      and v.papel <> 'MOTORISTA'
      and (v_equipe or a.empresa_id = v.empresa_id)
      and (v.papel in ('ADM', 'GESTOR_FROTA') or interno.pode_decidir(v, a))
      and not interno.prazo_vencido(a.id)
    order by o.valido_ate, a.numero
    limit 200
  ) x;

  -- EM_ANDAMENTO aparece sempre (atrasado ou não); AGENDADA até o fim previsto.
  select coalesce(jsonb_agg(x.item order by x.ordem, x.inicio, x.numero), '[]') into r_proximos
  from (
    select case when a.status = 'EM_ANDAMENTO' then 0 else 1 end as ordem, a.inicio, a.numero, jsonb_build_object(
             'id', a.id, 'numero', a.numero, 'status', a.status, 'inicio', a.inicio, 'duracao_min', a.duracao_min,
             'origem', a.origem, 'destino', a.destino,
             'saiu_em', a.saiu_em, 'fim_previsto', interno.fim_da_atividade(a),
             'atrasado', a.status = 'EM_ANDAMENTO' and interno.fim_da_atividade(a) < now(),
             'atraso_anterior_ate', a.atraso_anterior_ate,
             'empresa_nome', case when v_equipe then e.nome end,
             'categoria_nome', k.nome, 'agora', a.agora,
             'paradas', interno.paradas_textos(a.id)) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    left join app.categorias k on k.codigo = a.categoria
    where (a.status = 'EM_ANDAMENTO'
           or (a.status = 'AGENDADA' and interno.fim_da_atividade(a) > now()))
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
    order by case when a.status = 'EM_ANDAMENTO' then 0 else 1 end, a.inicio, a.numero
    limit 50
  ) x;

  return jsonb_build_object('ok', true, 'aguardando_orcamento', r_orcar, 'aguardando_aprovacao', r_aprovar,
                            'proximos', r_proximos);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Privilégios: a função nova nasce fechada; as substituídas mantêm os seus.
------------------------------------------------------------------------------------------------
revoke execute on function interno.paradas_validas(jsonb), interno.paradas_textos(uuid)
  from public, anon, authenticated;
