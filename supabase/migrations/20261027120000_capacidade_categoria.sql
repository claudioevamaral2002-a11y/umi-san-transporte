-- v2.2, Tarefa 1 (docs/fases/v2-2-correcoes-auditoria-desenho.md §4.1): até quantas pessoas cada categoria leva.
--   * app.categorias ganha pessoas_max (1 a 99; nulo = sem limite). PASSAGEIROS fica com 4 (a descrição já dizia
--     "até 4 pessoas");
--   * api.salvar_categoria aceita a chave opcional `pessoas_max` (inteiro de 1 a 99 ou null = sem limite). Sem a chave,
--     mantém o valor (o app v2.1 não a manda). Inválida → CAMPOS_INVALIDOS com detalhe {invalidos: ['pessoas_max']};
--   * api.categorias_disponiveis e api.categorias_adm trazem `pessoas_max` em cada categoria (chave nova);
--   * api.criar_pedido: com categoria de carga PESSOAS ou AMBOS e pessoas_qtd acima de pessoas_max, recusa
--     ACIMA_DA_CAPACIDADE (auditado, detalhe {pessoas_max}); a resposta leva também `pessoas_max`. A conferência vem
--     depois de validar_pedido e antes da trava da agenda. Pedido sem categoria (app v1) não tem limite.
-- Corpos copiados das últimas versões (salvar_categoria: 20261022120000; categorias_disponiveis e categorias_adm:
-- 20261023120300; criar_pedido: 20261026120000, com a trava da agenda), salvo os trechos marcados com "v2.2".

------------------------------------------------------------------------------------------------
-- 1. Coluna.
------------------------------------------------------------------------------------------------
alter table app.categorias
  add column pessoas_max smallint constraint categorias_pessoas_max_check check (pessoas_max between 1 and 99);
update app.categorias set pessoas_max = 4 where codigo = 'PASSAGEIROS';

------------------------------------------------------------------------------------------------
-- 2. Master: salvar categoria (corpo de 20261022120000_categorias_tarifas.sql) + pessoas_max.
------------------------------------------------------------------------------------------------

-- Entrada: {codigo?, nome, descricao_curta, ordem, ativa?, veiculo_cliente?, reboque? ('SIM'|'NAO'), carga?,
-- pessoas_max? (v2.2: 1 a 99, ou null = sem limite; ausente mantém o valor)}.
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
                 where x not in ('codigo', 'nome', 'descricao_curta', 'ordem', 'ativa', 'veiculo_cliente', 'reboque', 'carga',
                             'pessoas_max'))
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
  -- v2.2: pessoas_max inteiro de 1 a 99 ou null (sem limite)
  if coalesce(jsonb_typeof(p -> 'pessoas_max'), 'null') <> 'null'
     and not coalesce(jsonb_typeof(p -> 'pessoas_max') = 'number' and (p ->> 'pessoas_max') ~ '^[0-9]{1,2}$'
                      and (p ->> 'pessoas_max')::int between 1 and 99, false) then
    return interno.negar('SALVAR_CATEGORIA', 'categoria', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('pessoas_max')));
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
  -- v2.2: a chave presente (mesmo null) troca o valor; ausente, mantém
  if p ? 'pessoas_max' then
    k.pessoas_max := (p ->> 'pessoas_max')::smallint;
  end if;
  if k.veiculo_cliente and k.reboque = 'SIM' then
    return interno.negar('SALVAR_CATEGORIA', 'categoria:' || k.codigo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('reboque')));
  end if;

  begin
    if v_novo then
      insert into app.categorias (codigo, nome, descricao_curta, carga, reboque, ordem, ativa, veiculo_cliente, pessoas_max)
      values (k.codigo, k.nome, k.descricao_curta, k.carga, k.reboque, k.ordem, k.ativa, k.veiculo_cliente, k.pessoas_max);
    else
      update app.categorias set nome = k.nome, descricao_curta = k.descricao_curta, carga = k.carga, reboque = k.reboque,
                                ordem = k.ordem, ativa = k.ativa, veiculo_cliente = k.veiculo_cliente,
                                pessoas_max = k.pessoas_max
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

------------------------------------------------------------------------------------------------
-- 3. Prévia do cliente (corpo de 20261023120300_pedido_diarias_categorias.sql) + pessoas_max.
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
      -- v2.2
      'pessoas_max', k.pessoas_max,
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
-- 4. Leitura da tela "Categorias e preços" (corpo de 20261023120300_pedido_diarias_categorias.sql) + pessoas_max.
------------------------------------------------------------------------------------------------
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
                                          -- v2.2
                                          'pessoas_max', k.pessoas_max,
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
-- 5. criar_pedido (corpo de 20261026120000_criar_pedido_trava_agenda.sql, com a trava da agenda) + ACIMA_DA_CAPACIDADE.
------------------------------------------------------------------------------------------------
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
    -- v2.2: a categoria leva até pessoas_max pessoas (nulo = sem limite). Vale a carga da categoria (a gravada).
    if v_cat.carga in ('PESSOAS', 'AMBOS') and v_cat.pessoas_max is not null
       and coalesce((p ->> 'pessoas_qtd')::int, 0) > v_cat.pessoas_max then
      return interno.negar('CRIAR_PEDIDO', 'pedido', 'ACIMA_DA_CAPACIDADE',
               jsonb_build_object('categoria', v_categoria, 'pessoas_max', v_cat.pessoas_max,
                                  'pessoas_qtd', (p ->> 'pessoas_qtd')::int))
             || jsonb_build_object('pessoas_max', v_cat.pessoas_max);
    end if;
  end if;
  -- 4.1: com categoria, carga e reboque gravados são os da categoria (não os que o aparelho mandou); na de veículo do
  -- cliente, a modalidade é VEICULO_CLIENTE.

  v_inicio := (p ->> 'inicio')::timestamptz;
  v_periodo := tstzrange(v_inicio, v_inicio + make_interval(mins => (p ->> 'duracao_min')::int), '[)');
  -- fase 4: no "Agora", o Ivo tem 15 min para responder.
  v_prazo := case when v_agora then least(now() + interval '15 minutes', v_inicio)
                  else least(now() + make_interval(hours => c.prazo_orcar_horas), v_inicio) end;

  -- Um pedido por vez para o mesmo motorista (sem deadlock na restrição de exclusão da agenda).
  perform pg_advisory_xact_lock(hashtext('agenda:' || v_motorista::text));

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

-- Privilégios: todas as funções acima são "create or replace" de funções existentes e mantêm os seus.
