-- v2.1, Tarefa 1 (docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.1, §4.2, §6): forma de cobrança no contrato e
-- pedir/aprovar sem saldo no Faturado.
--   * app.contratos_versoes.forma_cobranca: CREDITO (pré-pago, como hoje) ou FATURADO (NF). As versões existentes ficam
--     CREDITO;
--   * interno.validar_contrato aceita, além dos 13 campos de hoje, o opcional `forma_cobranca` (valor inválido → detalhe
--     `forma_cobranca`; nulo = ausente). interno.inserir_contrato grava a recebida; sem ela, a da última versão (maior
--     número, mesmo agendada) da mesma empresa; sem versão, a do modelo vigente; sem modelo, CREDITO. Assim o app v1
--     e a v2.0 em cache (que não mandam a chave) continuam publicando, sem trocar a forma. api.publicar_tarifas copia a versão vigente inteira (to_jsonb), então a
--     forma vai junto sem mudar a função;
--   * interno.forma_cobranca(empresa): a do contrato vigente (sem contrato: CREDITO);
--   * FATURADO: api.criar_pedido não confere SEM_CREDITO e api.aprovar_orcamento (e api.confirmar_corrida, que a chama)
--     não recusa por SALDO_INSUFICIENTE. A reserva e o lançamento RESERVA continuam (agenda, reconciliação e débito na
--     saída dependem deles); o disponível fica negativo, e é esse o valor devido;
--   * FATURADO: o limite de saldo negativo e o alerta de saldo baixo não se aplicam: interno.saldos devolve limite e alerta
--     0 e abaixo_alerta false, além de `forma_cobranca` (api.saldo_empresa e o painel do ADM a devolvem também);
--   * api.painel_empresa: o resumo traz `forma_cobranca` (no FATURADO, total_mes_cent sem o limite);
--   * api.listar_contratos e api.historico_contrato trazem `forma_cobranca` (coluna nova no fim; o tipo de retorno muda,
--     então são recriadas com os mesmos privilégios).
-- Compatibilidade: empresa no CREDITO se comporta exatamente como antes (mesmas checagens, na mesma ordem, e os mesmos
-- códigos de recusa). Corpos copiados das últimas versões, salvo os trechos marcados com "v2.1".

------------------------------------------------------------------------------------------------
-- 1. Coluna nova (as versões existentes ficam CREDITO; a tabela continua imutável).
------------------------------------------------------------------------------------------------
alter table app.contratos_versoes
  add column forma_cobranca text not null default 'CREDITO'
  constraint contratos_versoes_forma_cobranca_check check (forma_cobranca in ('CREDITO', 'FATURADO'));

------------------------------------------------------------------------------------------------
-- 2. Validação e gravação do contrato.
------------------------------------------------------------------------------------------------

-- Valida o jsonb de um contrato (os 13 campos; v2.1: mais o opcional forma_cobranca, CREDITO ou FATURADO; nulo =
-- ausente). null = válido; senão o detalhe da recusa (no máximo 20 chaves desconhecidas, cada uma com até 60
-- caracteres: o chamador controla o texto). Corpo de 20261009120100_contratos_papeis_niveis.sql.
create or replace function interno.validar_contrato(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  inteiros constant text[] := array[
    'km_sem_reboque_cent', 'km_com_reboque_cent', 'taxa_fixa_reboque_cent', 'retorno_trecho_unico_bp',
    'hora_espera_cent', 'hospedagem_diaria_cent', 'diaria_motorista_cent', 'prazo_orcar_horas',
    'validade_orcamento_horas', 'limiar_urgente_horas', 'limite_saldo_negativo_cent', 'alerta_saldo_baixo_cent'];
  conhecidos constant text[] := inteiros || array['faixas_cancelamento'];
  -- v2.1: chaves aceitas, mas não exigidas
  opcionais constant text[] := array['forma_cobranca'];
  desconhecidos text[];
  ausentes text[];
  invalidos text[] := '{}';
  k text;
  v bigint;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('invalidos', jsonb_build_array('p'));
  end if;

  select coalesce(array_agg(left(c, 60) order by c), '{}') into desconhecidos
    from (select c from jsonb_object_keys(p) c where c <> all (conhecidos || opcionais) order by c limit 20) x;
  select coalesce(array_agg(c order by c), '{}') into ausentes
    from unnest(conhecidos) c where not (p ? c);

  foreach k in array inteiros loop
    if p ? k and not (jsonb_typeof(p -> k) = 'number' and (p ->> k) ~ '^[0-9]{1,16}$') then
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
         or (k in ('prazo_orcar_horas', 'validade_orcamento_horas', 'limiar_urgente_horas') and (v < 1 or v > 2147483647))
      then
        invalidos := array_append(invalidos, k);
      end if;
    end if;
  end loop;

  -- v2.1: forma de cobrança (opcional; nulo = ausente, herda)
  if coalesce(jsonb_typeof(p -> 'forma_cobranca'), 'null') <> 'null'
     and not (jsonb_typeof(p -> 'forma_cobranca') = 'string' and (p ->> 'forma_cobranca') in ('CREDITO', 'FATURADO')) then
    invalidos := array_append(invalidos, 'forma_cobranca');
  end if;

  if cardinality(desconhecidos) > 0 or cardinality(ausentes) > 0 or cardinality(invalidos) > 0 then
    return jsonb_build_object('desconhecidos', to_jsonb(desconhecidos), 'ausentes', to_jsonb(ausentes),
                              'invalidos', to_jsonb(invalidos));
  end if;
  return null;
end $$;

-- Grava uma versão (p já validado). Numeração por empresa (modelo = empresa nula), serializada por lock.
-- v2.1: forma_cobranca de p; sem ela, a da última versão (maior número) da mesma empresa; sem versão, a do modelo;
-- sem modelo, CREDITO. Corpo de 20261009120100_contratos_papeis_niveis.sql.
create or replace function interno.inserir_contrato(p_empresa uuid, p jsonb, p_vigente_desde timestamptz,
                                                    p_publicado_por uuid, p_publicado_por_nome text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  nova int;
  v_forma text;
begin
  perform pg_advisory_xact_lock(hashtext('contrato:' || coalesce(p_empresa::text, 'modelo')));
  select coalesce(max(c.versao), 0) + 1 into nova
    from app.contratos_versoes c
   where (p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa;

  -- v2.1: a forma herdada da última versão publicada da mesma empresa (a de maior número, inclusive uma agendada para
  -- o futuro: quem publica sem a chave não desfaz a troca já agendada)
  v_forma := coalesce(p ->> 'forma_cobranca',
                      (select c.forma_cobranca from app.contratos_versoes c
                        where (p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa
                        order by c.versao desc limit 1),
                      case when p_empresa is not null
                           then (select k.forma_cobranca from interno.contrato_vigente(null) k) end,
                      'CREDITO');

  insert into app.contratos_versoes (
    empresa_id, versao, vigente_desde, publicado_por, publicado_por_nome,
    km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
    hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
    prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
    limite_saldo_negativo_cent, alerta_saldo_baixo_cent, forma_cobranca)
  values (
    p_empresa, nova, p_vigente_desde, p_publicado_por, p_publicado_por_nome,
    (p ->> 'km_sem_reboque_cent')::bigint, (p ->> 'km_com_reboque_cent')::bigint,
    (p ->> 'taxa_fixa_reboque_cent')::bigint, (p ->> 'retorno_trecho_unico_bp')::int,
    (p ->> 'hora_espera_cent')::bigint, (p ->> 'hospedagem_diaria_cent')::bigint,
    (p ->> 'diaria_motorista_cent')::bigint, p -> 'faixas_cancelamento',
    (p ->> 'prazo_orcar_horas')::int, (p ->> 'validade_orcamento_horas')::int,
    (p ->> 'limiar_urgente_horas')::int, (p ->> 'limite_saldo_negativo_cent')::bigint,
    (p ->> 'alerta_saldo_baixo_cent')::bigint, v_forma);
  return nova;
end $$;

-- Forma de cobrança do contrato VIGENTE da empresa (sem contrato vigente: CREDITO).
create function interno.forma_cobranca(p_empresa uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select k.forma_cobranca from interno.contrato_vigente(p_empresa) k), 'CREDITO')
$$;

------------------------------------------------------------------------------------------------
-- 3. Saldos: + forma_cobranca; no FATURADO, limite e alerta não se aplicam.
--    Corpo de 20261009140000_saldo_livro_razao.sql.
------------------------------------------------------------------------------------------------
create or replace function interno.saldos(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'empresa_id', p_empresa,
    'saldo_contabil_cent', coalesce(c.saldo_contabil_cent, 0),
    'reservado_cent', coalesce(c.reservado_cent, 0),
    'disponivel_cent', coalesce(c.saldo_contabil_cent, 0) - coalesce(c.reservado_cent, 0),
    'limite_cent', case when k.forma_cobranca = 'FATURADO' then 0 else coalesce(k.limite_saldo_negativo_cent, 0) end,
    'alerta_cent', case when k.forma_cobranca = 'FATURADO' then 0 else coalesce(k.alerta_saldo_baixo_cent, 0) end,
    'abaixo_alerta', k.id is not null and k.forma_cobranca <> 'FATURADO'
                     and coalesce(c.saldo_contabil_cent, 0) - coalesce(c.reservado_cent, 0) < k.alerta_saldo_baixo_cent,
    'atualizado_em', c.atualizado_em,
    -- v2.1
    'forma_cobranca', coalesce(k.forma_cobranca, 'CREDITO'))
  from (select p_empresa as id) x
  left join app.contas c on c.empresa_id = x.id
  left join lateral interno.contrato_vigente(x.id) k on true
$$;

------------------------------------------------------------------------------------------------
-- 4. Pedir sem saldo no FATURADO (corpo de 20261022120100_paradas_pedido.sql; as migrations seguintes não o redefiniram).
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
                       'centro_custo', nullif(btrim(p ->> 'centro_custo'), ''),
                       'forma_cobranca', c.forma_cobranca));
  -- fase 3A: os dois pontos com coordenadas viram locais da empresa (aparecem primeiro na próxima busca).
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'origem'),
    (p ->> 'origem_lat')::numeric, (p ->> 'origem_lng')::numeric, p ->> 'origem_place_id');
  perform interno.guardar_local(v.empresa_id, btrim(p ->> 'destino'),
    (p ->> 'destino_lat')::numeric, (p ->> 'destino_lng')::numeric, p ->> 'destino_place_id');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'prazo_orcar_ate', v_prazo);
end $$;

------------------------------------------------------------------------------------------------
-- 5. Aprovar sem saldo no FATURADO (corpo de 20261009141000_endurecimento_saldo.sql; as migrations seguintes não o
--    redefiniram). api.confirmar_corrida chama esta e não muda.
------------------------------------------------------------------------------------------------
create or replace function api.aprovar_orcamento(p_atividade uuid, p_versao int, p_hash text, p_chave uuid,
                                                 p_dispositivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  o app.orcamentos;
  c app.contas;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_param jsonb := jsonb_build_object('versao', p_versao, 'hash', p_hash);
  r jsonb;
  v_limite bigint;
  v_disp bigint;
  v_reserva bigint;
  v_res jsonb;
  v_forma text;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if p_chave is null or p_versao is null or p_hash is null then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('APROVAR_ORCAMENTO', 60, interval '1 hour') then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  c := interno.travar_conta(a.empresa_id);
  r := interno.idempotencia_buscar(a.empresa_id, p_chave, 'APROVAR_ORCAMENTO', v_alvo, v_param);
  if r is not null then
    if (r ->> 'confere')::boolean then
      perform interno.auditar('APROVAR_ORCAMENTO', v_alvo, 'OK', null,
        jsonb_build_object('repeticao', true, 'chave', p_chave));
      return r -> 'resultado';
    end if;
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'CHAVE_REUTILIZADA');
  end if;

  if a.status <> 'ORCADA' then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  select * into o from app.orcamentos x where x.atividade_id = a.id and x.status = 'PENDENTE' for no key update;
  if o.id is null then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  -- validade direto no banco (sem depender do cron), pelo relógio: vencido expira agora e a expiração fica gravada
  if o.valido_ate <= clock_timestamp()
     or exists (select 1 from app.agenda_blocos b
                 where b.atividade_id = a.id and b.ativo and b.tipo = 'PRE_RESERVA' and b.expira_em <= clock_timestamp()) then
    perform interno.transicionar(a.id, 'EXPIRADA', 'Prazo vencido');
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'ORCAMENTO_VENCIDO');
  end if;
  if p_versao <> o.versao or p_hash <> o.hash or o.hash <> interno.hash_orcamento(o, a) then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'ORCAMENTO_ALTERADO');
  end if;
  if not exists (select 1 from app.agenda_blocos b where b.atividade_id = a.id and b.ativo) then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'HORARIO_OCUPADO');
  end if;

  -- crédito: limite do contrato VIGENTE da empresa (sem contrato vigente: limite 0). v2.1: no FATURADO não há recusa
  -- por saldo; a reserva e o RESERVA abaixo continuam (agenda, reconciliação e débito na saída dependem deles).
  v_forma := interno.forma_cobranca(a.empresa_id);
  v_limite := case when v_forma = 'FATURADO' then 0
                   else coalesce((select k.limite_saldo_negativo_cent from interno.contrato_vigente(a.empresa_id) k), 0) end;
  v_disp := c.saldo_contabil_cent - c.reservado_cent;
  if v_forma <> 'FATURADO' and v_disp - o.total_cent < -v_limite then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'SALDO_INSUFICIENTE',
             jsonb_build_object('disponivel_cent', v_disp, 'limite_cent', v_limite, 'total_cent', o.total_cent))
           || jsonb_build_object('disponivel_cent', v_disp, 'limite_cent', v_limite, 'total_cent', o.total_cent,
                                 'falta_cent', o.total_cent - v_disp - v_limite);
  end if;

  begin
    update app.agenda_blocos set tipo = 'RESERVA', expira_em = null where atividade_id = a.id and ativo;
    insert into app.reservas (empresa_id, atividade_id, orcamento_id, valor_cent)
    values (a.empresa_id, a.id, o.id, o.total_cent)
    returning id into v_reserva;
    perform interno.inserir_lancamento(a.empresa_id, 'RESERVA', o.total_cent, a.id, o.id, v_reserva, null, null, null,
                                       p_chave);
    perform interno.transicionar(a.id, 'AGENDADA', null);  -- fecha o orçamento PENDENTE como APROVADO
    insert into app.aprovacoes (atividade_id, orcamento_id, orcamento_versao, hash, usuario_id, ip, dispositivo,
                                chave_idempotencia)
    values (a.id, o.id, o.versao, o.hash, v.usuario_id, interno.ip_requisicao(),
            interno.dispositivo_requisicao(p_dispositivo), p_chave);
    v_res := jsonb_build_object('ok', true, 'atividade_id', a.id, 'reservado_cent', o.total_cent,
                                'disponivel_cent', v_disp - o.total_cent);
    perform interno.idempotencia_gravar(a.empresa_id, p_chave, 'APROVAR_ORCAMENTO', v_alvo, v_param, v_res);
  exception
    when unique_violation then
      return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'JA_PROCESSADO');
    when exclusion_violation then
      return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'HORARIO_OCUPADO');
  end;

  perform interno.auditar('APROVAR_ORCAMENTO', v_alvo, 'OK', null,
    jsonb_build_object('orcamento_id', o.id, 'versao', o.versao, 'hash', o.hash, 'total_cent', o.total_cent,
                       'reserva_id', v_reserva, 'disponivel_antes_cent', v_disp, 'limite_cent', v_limite,
                       'chave', p_chave, 'forma_cobranca', v_forma));
  return v_res;
end $$;

------------------------------------------------------------------------------------------------
-- 6. Painel da empresa (corpo de 20261020120400_ajustes_revisao_final.sql): o resumo traz forma_cobranca.
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

  return jsonb_build_object('ok', true,
    'resumo', jsonb_build_object(
      'mes', to_char(v_mes, 'YYYY-MM-DD'),
      'gasto_cent', v_gasto,
      'reservado_cent', (v_saldos ->> 'reservado_cent')::bigint,
      'disponivel_cent', (v_saldos ->> 'disponivel_cent')::bigint,
      'total_mes_cent', v_inicial + v_recargas + v_limite,
      'contato_recarga', (select c.contato_recarga from app.configuracao c where c.id),
      'forma_cobranca', v_forma),
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
-- 7. Leituras de contrato do ADM (corpos de 20261009120100_contratos_papeis_niveis.sql): + forma_cobranca, no fim.
--    O tipo de retorno muda: drop + create, com os mesmos privilégios (seção 8).
------------------------------------------------------------------------------------------------
drop function api.listar_contratos();
drop function api.historico_contrato(uuid);

-- ADM: a tabela modelo (empresa nula, primeira linha) e cada empresa, com o contrato vigente (campos nulos
-- se não houver) e a próxima vigência agendada.
create function api.listar_contratos()
returns table (empresa_id uuid, empresa_nome text, versao int, vigente_desde timestamptz, publicado_em timestamptz,
               publicado_por_nome text, km_sem_reboque_cent bigint, km_com_reboque_cent bigint,
               taxa_fixa_reboque_cent bigint, retorno_trecho_unico_bp int, hora_espera_cent bigint,
               hospedagem_diaria_cent bigint, diaria_motorista_cent bigint, faixas_cancelamento jsonb,
               prazo_orcar_horas int, validade_orcamento_horas int, limiar_urgente_horas int,
               limite_saldo_negativo_cent bigint, alerta_saldo_baixo_cent bigint, proxima_vigencia timestamptz,
               forma_cobranca text)
language sql stable security definer set search_path = '' as $$
  with alvos as (
    select null::uuid as id, null::text as nome, 0 as ordem
    union all
    select e.id, e.nome, 1 from app.empresas e
  )
  select a.id, a.nome, c.versao, c.vigente_desde, c.publicado_em, c.publicado_por_nome,
         c.km_sem_reboque_cent, c.km_com_reboque_cent, c.taxa_fixa_reboque_cent, c.retorno_trecho_unico_bp,
         c.hora_espera_cent, c.hospedagem_diaria_cent, c.diaria_motorista_cent, c.faixas_cancelamento,
         c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas,
         c.limite_saldo_negativo_cent, c.alerta_saldo_baixo_cent,
         (select min(f.vigente_desde) from app.contratos_versoes f
           where ((a.id is null and f.empresa_id is null) or f.empresa_id = a.id) and f.vigente_desde > now()),
         c.forma_cobranca
  from alvos a
  left join lateral interno.contrato_vigente(a.id) c on true
  where (select app.pode_fazer('GERIR_CONTRATOS'))
  order by a.ordem, a.nome, a.id
$$;

-- ADM: todas as versões de uma empresa (nulo = modelo), da vigência mais nova para a mais antiga.
create function api.historico_contrato(p_empresa uuid)
returns table (versao int, vigente_desde timestamptz, publicado_em timestamptz, publicado_por_nome text,
               km_sem_reboque_cent bigint, km_com_reboque_cent bigint, taxa_fixa_reboque_cent bigint,
               retorno_trecho_unico_bp int, hora_espera_cent bigint, hospedagem_diaria_cent bigint,
               diaria_motorista_cent bigint, faixas_cancelamento jsonb, prazo_orcar_horas int,
               validade_orcamento_horas int, limiar_urgente_horas int, limite_saldo_negativo_cent bigint,
               alerta_saldo_baixo_cent bigint, forma_cobranca text)
language sql stable security definer set search_path = '' as $$
  select c.versao, c.vigente_desde, c.publicado_em, c.publicado_por_nome,
         c.km_sem_reboque_cent, c.km_com_reboque_cent, c.taxa_fixa_reboque_cent, c.retorno_trecho_unico_bp,
         c.hora_espera_cent, c.hospedagem_diaria_cent, c.diaria_motorista_cent, c.faixas_cancelamento,
         c.prazo_orcar_horas, c.validade_orcamento_horas, c.limiar_urgente_horas,
         c.limite_saldo_negativo_cent, c.alerta_saldo_baixo_cent, c.forma_cobranca
  from app.contratos_versoes c
  where (select app.pode_fazer('GERIR_CONTRATOS'))
    and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
  order by c.vigente_desde desc, c.versao desc
  limit 200
$$;

------------------------------------------------------------------------------------------------
-- 8. Privilégios: a função interna nova nasce fechada; as recriadas voltam a ser só de authenticated; as substituídas
--    ("create or replace") mantêm os seus.
------------------------------------------------------------------------------------------------
revoke execute on function interno.forma_cobranca(uuid) from public, anon, authenticated;

revoke all on function api.listar_contratos(), api.historico_contrato(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.listar_contratos(), api.historico_contrato(uuid) to authenticated;
