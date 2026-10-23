-- v2.1, Tarefa 3 (docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.5, §2): diárias, outros custos e volta à origem
-- no pedido; excluir categoria sem uso.
--   * app.atividades ganha diarias_estimadas (0 a 30), outros_custos (texto até 120, sem valor: o Ivo põe o valor no
--     orçamento) e volta_a_origem (o Para é o mesmo lugar do De: circuito fechado). interno.validar_pedido aceita as três
--     chaves, opcionais (nulo = ausente); api.criar_pedido grava (outros custos aparado, vazio = nenhum; a volta à
--     origem só fica true quando o De e o Para são o mesmo lugar: mesmo place_id ou menos de 300 m, senão false);
--   * preço: interno.linhas_da_tarifa e interno.linhas_para_categoria ganham p_volta_a_origem (default false): com ele,
--     sem a linha RETORNO (no preço de hoje, sem tarifa da categoria, o retorno do contrato vale 0). A assinatura muda,
--     então são recriadas (drop + create) e nascem fechadas;
--   * api.categorias_disponiveis aceita `diarias` (0 a 30; viram hospedagem_diarias, e a categoria que não cobra diária
--     fica sem a linha HOSPEDAGEM, sem recusa) e `volta_a_origem`; cada categoria traz `cobra_diaria`;
--   * interno.linhas_do_pedido (calcular_orcamento e enviar_orcamento): sem `hospedagem_diarias` na entrada, valem as
--     diárias do pedido; a volta à origem é SEMPRE a do pedido (a entrada não a traz). `diarias` da entrada antiga
--     continua aceito e descartado (com categoria). Invariante: prévia do cliente = orçamento do motorista;
--   * api.pedido devolve diarias_estimadas, outros_custos, volta_a_origem e a forma_cobranca da empresa (esta, nula para
--     o motorista);
--   * api.excluir_categoria(p_codigo): só GERIR_CONTRATOS; apaga a categoria que nenhum pedido, nenhum preço de contrato
--     (contratos_categorias), nenhuma tarifa publicada e nenhum veículo usam; senão CATEGORIA_EM_USO.
--     api.categorias_adm traz `pode_excluir` em cada categoria;
--   * api.extrato aceita até 9 tipos no filtro (PAGAMENTO_FATURA é o nono).
-- Compatibilidade: a v1 e a v2.0 em cache não mandam as chaves novas e continuam iguais (o pedido fica sem diárias, sem
-- outros custos e com volta_a_origem false; o pedido antigo de ida e volta tem o mesmo preço). Corpos copiados das
-- últimas versões, salvo os trechos marcados com "v2.1".

------------------------------------------------------------------------------------------------
-- 1. Colunas do pedido.
------------------------------------------------------------------------------------------------
alter table app.atividades
  add column diarias_estimadas smallint
    constraint atividades_diarias_estimadas_check check (diarias_estimadas between 0 and 30),
  add column outros_custos text
    constraint atividades_outros_custos_check check (char_length(outros_custos) between 1 and 120
                                                     and outros_custos = btrim(outros_custos)),
  add column volta_a_origem boolean not null default false;

------------------------------------------------------------------------------------------------
-- 2. Validação e criação do pedido (corpos de 20261022120100_paradas_pedido.sql e 20261023120000_forma_cobranca.sql).
------------------------------------------------------------------------------------------------
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
                                     'paradas', 'horas_estimadas', 'centro_custo',
                                     -- v2.1
                                     'diarias_estimadas', 'outros_custos', 'volta_a_origem'];
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

  -- v2.1: diárias (hospedagem) estimadas, inteiro de 0 a 30; outros custos, texto até 120 caracteres (aparado; vazio =
  -- nenhum); volta à origem, booleano. As três são opcionais (nulo = ausente).
  if coalesce(jsonb_typeof(p -> 'diarias_estimadas'), 'null') <> 'null'
     and not coalesce(case when jsonb_typeof(p -> 'diarias_estimadas') = 'number'
                                and (p ->> 'diarias_estimadas') ~ '^[0-9]{1,2}$'
                           then (p ->> 'diarias_estimadas')::int between 0 and 30 end, false) then
    inv := array_append(inv, 'diarias_estimadas');
  end if;
  if coalesce(jsonb_typeof(p -> 'outros_custos'), 'null') <> 'null'
     and not coalesce(case when jsonb_typeof(p -> 'outros_custos') = 'string'
                           then char_length(btrim(p ->> 'outros_custos')) <= 120 end, false) then
    inv := array_append(inv, 'outros_custos');
  end if;
  if coalesce(jsonb_typeof(p -> 'volta_a_origem'), 'null') not in ('boolean', 'null') then
    inv := array_append(inv, 'volta_a_origem');
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
  v_volta boolean;
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
  -- Sem crédito nenhum: nem saldo disponível nem limite para ficar negativo. v2.1: só no CREDITO (no FATURADO o
  -- pedido não exige saldo; a corrida entra na fatura da quinzena).
  if c.forma_cobranca <> 'FATURADO' then
    v_saldo := interno.saldos(v.empresa_id);
    if (v_saldo ->> 'disponivel_cent')::bigint + (v_saldo ->> 'limite_cent')::bigint <= 0 then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'SEM_CREDITO',
        jsonb_build_object('disponivel_cent', (v_saldo ->> 'disponivel_cent')::bigint,
                           'limite_cent', (v_saldo ->> 'limite_cent')::bigint));
    end if;
  end if;
  v_detalhe := interno.validar_pedido(p);
  if v_detalhe is not null then
    return interno.negar('CRIAR_PEDIDO', 'pedido', 'CAMPOS_INVALIDOS', v_detalhe);
  end if;
  -- v2.1: a volta à origem tira o RETORNO do preço, então não se confia no aparelho: só vale quando o Para é o mesmo
  -- lugar do De pelo que o pedido grava (a regra de `voltaAOrigem` da tela): mesmo place_id, ou os dois pontos com
  -- coordenadas a menos de 300 m (haversine, raio médio da Terra). Fora disso grava false, sem recusa (compatível com
  -- o que já se envia). Ponto do Google de um lado e marcado no mapa do outro não dá para comparar: false.
  v_volta := coalesce((p ->> 'volta_a_origem')::boolean, false)
             and (coalesce(nullif(p ->> 'origem_place_id', '') = p ->> 'destino_place_id', false)
                  or coalesce(jsonb_typeof(p -> 'origem_lat') = 'number' and jsonb_typeof(p -> 'destino_lat') = 'number'
                              and 2 * 6371000 * asin(least(1, sqrt(
                                    sin(radians((p ->> 'destino_lat')::float8 - (p ->> 'origem_lat')::float8) / 2) ^ 2
                                    + cos(radians((p ->> 'origem_lat')::float8)) * cos(radians((p ->> 'destino_lat')::float8))
                                      * sin(radians((p ->> 'destino_lng')::float8 - (p ->> 'origem_lng')::float8) / 2) ^ 2)))
                                  < 300, false));
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
      categoria, agora, horas_estimadas, centro_custo,
      diarias_estimadas, outros_custos, volta_a_origem)
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
      v_categoria, v_agora, (p ->> 'horas_estimadas')::numeric, nullif(btrim(p ->> 'centro_custo'), ''),
      -- v2.1
      (p ->> 'diarias_estimadas')::smallint, nullif(btrim(p ->> 'outros_custos'), ''),
      v_volta)
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
                       'centro_custo', nullif(btrim(p ->> 'centro_custo'), ''),
                       'forma_cobranca', c.forma_cobranca,
                       'diarias_estimadas', (p ->> 'diarias_estimadas')::int,
                       'outros_custos', nullif(btrim(p ->> 'outros_custos'), ''),
                       'volta_a_origem', v_volta));
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Preço: volta à origem sem RETORNO; diárias do pedido (corpos de 20261022120000_categorias_tarifas.sql,
--    20261022120100_paradas_pedido.sql e 20261022120300_km_volta.sql).
------------------------------------------------------------------------------------------------
drop function interno.linhas_da_tarifa(app.tarifas_categoria, boolean, boolean, boolean, jsonb);
drop function interno.linhas_para_categoria(app.contratos_versoes, boolean, boolean, text, jsonb);

create function interno.linhas_da_tarifa(t app.tarifas_categoria, p_reboque boolean, p_levar boolean, p_trazer boolean,
                                         e jsonb, p_volta_a_origem boolean default false)
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
      -- v2.1: a volta à origem (circuito fechado) não paga o retorno de trecho único
      if not (p_levar and p_trazer) and t.retorno_bp > 0 and not coalesce(p_volta_a_origem, false) then
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

create function interno.linhas_para_categoria(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                              p_categoria text, e jsonb, p_volta_a_origem boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t app.tarifas_categoria;
  k app.categorias;
  v_c app.contratos_versoes := c;
begin
  if c.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'SEM_CONTRATO');
  end if;
  select * into t from app.tarifas_categoria x where x.contrato_id = c.id and x.categoria = p_categoria;
  if t.contrato_id is not null then
    select * into k from app.categorias x where x.codigo = p_categoria;
    return interno.linhas_da_tarifa(t, coalesce(k.reboque = 'SIM' and not k.veiculo_cliente, false), p_levar, p_trazer, e,
                                    coalesce(p_volta_a_origem, false));
  end if;
  -- v2.1: no preço de hoje, a volta à origem também não paga o retorno de trecho único
  if coalesce(p_volta_a_origem, false) then
    v_c.retorno_trecho_unico_bp := 0;
  end if;
  return interno.linhas_da_categoria(v_c, p_levar, p_trazer, p_categoria,
    case when jsonb_typeof(e) = 'object' then e - 'horas' - 'paradas' else e end);
end $$;

create or replace function interno.linhas_do_pedido(c app.contratos_versoes, a app.atividades, e jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e jsonb := e;
  n int;
  v_c app.contratos_versoes := c;
begin
  -- v2.1: sem `hospedagem_diarias` na entrada, as diárias que o cliente estimou ao pedir
  if jsonb_typeof(v_e) = 'object' and coalesce(jsonb_typeof(v_e -> 'hospedagem_diarias'), 'null') = 'null'
     and coalesce(a.diarias_estimadas, 0) > 0 then
    v_e := (v_e - 'hospedagem_diarias') || jsonb_build_object('hospedagem_diarias', a.diarias_estimadas);
  end if;
  if a.categoria is null then
    -- v2.1: a volta à origem do pedido (sempre a do pedido) não paga o retorno de trecho único
    if a.volta_a_origem then
      v_c.retorno_trecho_unico_bp := 0;
    end if;
    return interno.calcular_linhas(v_c, a.levar, a.trazer, a.modalidade, v_e);
  end if;
  if jsonb_typeof(v_e) = 'object' then
    v_e := v_e - 'diarias';
    if coalesce(jsonb_typeof(v_e -> 'paradas'), 'null') = 'null' then
      select count(*) into n from app.atividades_paradas x where x.atividade_id = a.id;
      v_e := (v_e - 'paradas') || case when n > 0 then jsonb_build_object('paradas', n) else '{}'::jsonb end;
    end if;
    if coalesce(jsonb_typeof(v_e -> 'horas'), 'null') = 'null' and a.horas_estimadas is not null then
      v_e := (v_e - 'horas') || jsonb_build_object('horas', a.horas_estimadas);
    end if;
  end if;
  return interno.linhas_para_categoria(c, a.levar, a.trazer, a.categoria, v_e, a.volta_a_origem);
end $$;

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
  v_volta boolean;
  saida jsonb := '[]';
begin
  if not (select app.pode_fazer('PREVIA_ORCAMENTO')) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CATEGORIAS', 300, interval '1 hour') then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x
                 where x not in ('km', 'km_volta', 'levar', 'trazer', 'paradas', 'horas', 'diarias', 'volta_a_origem'))
     or coalesce(jsonb_typeof(p -> 'km'), 'null') <> 'number'
     or not coalesce(case when (p ->> 'km') ~ '^[0-9]{1,4}(\.[0-9])?$' then (p ->> 'km')::numeric <= 5000 end, false)
     or (coalesce(jsonb_typeof(p -> 'km_volta'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'km_volta') = 'number' and (p ->> 'km_volta') ~ '^[0-9]{1,4}(\.[0-9])?$'
                               then (p ->> 'km_volta')::numeric <= 5000 end, false))
     or not coalesce(case when jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
                          then (p ->> 'levar')::boolean or (p ->> 'trazer')::boolean end, false)
     or (coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null'
         and not coalesce(jsonb_typeof(p -> 'paradas') = 'number' and (p ->> 'paradas') ~ '^[0-3]$', false))
     or (coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'horas') = 'number' and (p ->> 'horas') ~ '^[0-9]{1,2}(\.[0-9]{1,6})?$'
                               then (p ->> 'horas')::numeric between 0.5 and 24
                                    and (p ->> 'horas')::numeric * 2 = trunc((p ->> 'horas')::numeric * 2) end, false))
     -- v2.1: diárias de 0 a 30 e volta à origem booleana (nulo = ausente)
     or (coalesce(jsonb_typeof(p -> 'diarias'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'diarias') = 'number' and (p ->> 'diarias') ~ '^[0-9]{1,2}$'
                               then (p ->> 'diarias')::int between 0 and 30 end, false))
     or coalesce(jsonb_typeof(p -> 'volta_a_origem'), 'null') not in ('boolean', 'null') then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  -- Ida e volta: com km_volta, a ida (pelas paradas) + a volta direta; sem, o dobro de km (como antes). Trecho único:
  -- só km (km_volta ignorado).
  e := jsonb_build_object('km',
         case when not ((p ->> 'levar')::boolean and (p ->> 'trazer')::boolean) then (p ->> 'km')::numeric
              when coalesce(jsonb_typeof(p -> 'km_volta'), 'null') <> 'null'
                then (p ->> 'km')::numeric + (p ->> 'km_volta')::numeric
              else (p ->> 'km')::numeric * 2 end);
  if coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null' then
    e := e || jsonb_build_object('paradas', (p ->> 'paradas')::int);
  end if;
  if coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null' then
    e := e || jsonb_build_object('horas', (p ->> 'horas')::numeric);
  end if;
  -- v2.1: as diárias viram hospedagem_diarias (a categoria que não cobra diária fica sem a linha HOSPEDAGEM)
  if coalesce((p ->> 'diarias')::int, 0) > 0 then
    e := e || jsonb_build_object('hospedagem_diarias', (p ->> 'diarias')::int);
  end if;
  -- A prévia só estima: aceita a volta à origem que a tela manda. O que vale no preço é a do pedido, que
  -- api.criar_pedido só grava true quando o De e o Para são o mesmo lugar (mesmo place_id ou menos de 300 m).
  v_volta := coalesce((p ->> 'volta_a_origem')::boolean, false);

  for k in select * from app.categorias x where x.ativa order by x.ordem, x.codigo loop
    select * into t from app.tarifas_categoria x where x.contrato_id = c.id and x.categoria = k.codigo;
    v_disp := v_mot is not null
              and (k.veiculo_cliente or interno.veiculo_atende(v_mot, k.codigo) is not null)
              and (t.contrato_id is not null or k.codigo in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA'));
    r := null;
    if v_disp then
      r := interno.linhas_para_categoria(c, (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean, k.codigo, e, v_volta);
      if not (r ->> 'ok')::boolean then
        if r ->> 'codigo' <> 'VALOR_INVALIDO' then
          return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, r ->> 'codigo');
        end if;
        -- Total 0: só fica disponível (preço pendente) a categoria por hora quando as horas não vieram; senão a tarifa
        -- nunca dá preço para esta entrada e a categoria fica "Indisponível no momento".
        v_disp := coalesce(t.hora_cent > 0, false) and coalesce(jsonb_typeof(p -> 'horas'), 'null') = 'null';
        r := null;
      end if;
    end if;
    saida := saida || jsonb_build_array(jsonb_build_object(
      'codigo', k.codigo, 'nome', k.nome, 'descricao_curta', k.descricao_curta, 'carga', k.carga, 'reboque', k.reboque,
      'veiculo_cliente', k.veiculo_cliente, 'disponivel', v_disp,
      'cobra_hora', coalesce(t.hora_cent > 0, false), 'cobra_parada', coalesce(t.parada_cent > 0, false),
      -- v2.1: a tarifa da categoria (ou, sem ela, o contrato) tem diária de hospedagem
      'cobra_diaria', case when t.contrato_id is not null then t.hospedagem_diaria_cent > 0
                           when k.codigo in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA')
                             then coalesce(c.hospedagem_diaria_cent > 0, false)
                           else false end,
      'total_cent', r -> 'total_cent', 'linhas', r -> 'linhas'));
  end loop;
  return jsonb_build_object('ok', true, 'categorias', saida);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Detalhe do pedido (corpo de 20261022120100_paradas_pedido.sql): + diárias, outros custos, volta à origem e a forma
--    de cobrança da empresa. É a leitura do cliente e do motorista (chamada e calculadora).
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
    'horas_estimadas', a.horas_estimadas) || jsonb_build_object(
    -- v2.1
    'diarias_estimadas', a.diarias_estimadas, 'outros_custos', a.outros_custos, 'volta_a_origem', a.volta_a_origem,
    -- a forma de cobrança é da empresa: o motorista não a recebe
    'forma_cobranca', case when v.papel <> 'MOTORISTA' then interno.forma_cobranca(a.empresa_id) end);

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

------------------------------------------------------------------------------------------------
-- 5. Excluir categoria sem uso.
------------------------------------------------------------------------------------------------

-- A categoria já foi usada: num pedido, num preço de contrato, numa tarifa publicada ou num veículo.
create function interno.categoria_em_uso(p_codigo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.atividades a where a.categoria = p_codigo)
      or exists (select 1 from app.contratos_categorias x where x.categoria = p_codigo)
      or exists (select 1 from app.tarifas_categoria t where t.categoria = p_codigo)
      or exists (select 1 from app.veiculos v where p_codigo = any (v.categorias))
$$;

-- Apaga a categoria que nunca foi usada (a usada se desativa pelo salvar_categoria). Recusas: SEM_PERMISSAO,
-- CAMPOS_INVALIDOS, NAO_ENCONTRADO, CATEGORIA_EM_USO. {ok}
create function api.excluir_categoria(p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k app.categorias;
  v_alvo text := 'categoria:' || coalesce(left(p_codigo, 40), '-');
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('EXCLUIR_CATEGORIA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if p_codigo is null or char_length(p_codigo) not between 1 and 60 then
    return interno.negar('EXCLUIR_CATEGORIA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  -- a mesma trava de api.salvar_categoria
  perform pg_advisory_xact_lock(hashtext('categorias'));
  select * into k from app.categorias x where x.codigo = p_codigo for update;
  if k.codigo is null then
    return interno.negar('EXCLUIR_CATEGORIA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if interno.categoria_em_uso(k.codigo) then
    return interno.negar('EXCLUIR_CATEGORIA', v_alvo, 'CATEGORIA_EM_USO');
  end if;
  begin
    delete from app.categorias where codigo = k.codigo;
  exception when foreign_key_violation then
    -- um pedido ou uma publicação que chegou entre a conferência e o delete
    return interno.negar('EXCLUIR_CATEGORIA', v_alvo, 'CATEGORIA_EM_USO');
  end;
  perform interno.auditar('EXCLUIR_CATEGORIA', v_alvo, 'OK', null, jsonb_build_object('anterior', to_jsonb(k)));
  return jsonb_build_object('ok', true);
end $$;

-- Leitura da tela "Categorias e preços" (corpo de 20261022120000_categorias_tarifas.sql) + pode_excluir.
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
                                          -- v2.1
                                          'pode_excluir', not interno.categoria_em_uso(k.codigo),
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

------------------------------------------------------------------------------------------------
-- 6. Extrato (corpo de 20261020120100_pedido_estilo_uber.sql): até 9 tipos no filtro (os 9 tipos de lançamento).
------------------------------------------------------------------------------------------------
create or replace function api.extrato(p_empresa uuid default null, p_filtro jsonb default '{}')
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
      if jsonb_typeof(f -> 'tipos') = 'array' and jsonb_array_length(f -> 'tipos') between 1 and 9
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
      || case when a.id is not null then jsonb_build_object('centro_custo', a.centro_custo) else '{}'::jsonb end
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
-- 7. Privilégios: as funções recriadas e as novas nascem fechadas; as substituídas ("create or replace") mantêm os
--    seus.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.linhas_da_tarifa(app.tarifas_categoria, boolean, boolean, boolean, jsonb, boolean),
  interno.linhas_para_categoria(app.contratos_versoes, boolean, boolean, text, jsonb, boolean),
  interno.categoria_em_uso(text)
from public, anon, authenticated;

revoke all on function api.excluir_categoria(text) from public, anon, authenticated, service_role;
grant execute on function api.excluir_categoria(text) to authenticated;
