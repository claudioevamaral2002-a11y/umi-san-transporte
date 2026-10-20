-- Fase 4, ajustes da revisão final do branch (Ruling R18). Só "create or replace" com as mesmas assinaturas: os
-- privilégios ficam como estão e o app atual não muda de contrato com o banco.
--   1. api.enviar_orcamento: pedido com categoria e sem veiculo_id usa o veículo ATIVO do motorista que atende a
--      categoria (interno.veiculo_atende) — o Orçar do app atual e o do ADM não mandam veículo. VEICULO_INVALIDO só
--      quando o veiculo_id informado é inválido ou nenhum veículo ativo atende a categoria;
--   3. api.enviar_orcamento: total 0 recusado (VALOR_INVALIDO), para a saída nunca lançar um débito de 0 no livro-razão;
--   2. api.publicar_contrato: a versão nova herda o preço por categoria (app.contratos_categorias) da versão anterior
--      da mesma empresa (ou do modelo), para a publicação pela tela de Contratos do app atual não apagar esses preços.
--      api.publicar_contrato_categorias continua gravando as próprias linhas (não copia);
--   4. api.pedido: motorista_telefone só em AGENDADA e EM_ANDAMENTO, e em CONCLUIDA só nas 24 h depois da conclusão
--      (minimização LGPD, refina R14); nulo nos outros casos;
--   5. api.painel_empresa: limite de 120 leituras por hora por pessoa (LIMITE_EXCEDIDO, auditado por interno.negar).
-- Corpos iguais aos das migrations anteriores, salvo os trechos marcados com "R18".

------------------------------------------------------------------------------------------------
-- 1 e 3. Envio do orçamento (corpo de 20261020120100_pedido_estilo_uber.sql).
------------------------------------------------------------------------------------------------
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
  if v_veiculo is null and a.categoria is not null then
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
-- 2. Publicação do contrato (corpo de 20261009120100_contratos_papeis_niveis.sql).
------------------------------------------------------------------------------------------------
create or replace function api.publicar_contrato(p_empresa uuid, p jsonb, p_vigente_desde timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alvo text := 'contrato:' || coalesce(p_empresa::text, 'modelo');
  v_detalhe jsonb;
  nova int;
  v_id bigint;
  v_copiadas int;
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
  -- R18: a versão nova herda o preço por categoria da versão anterior da mesma empresa (ou do modelo).
  select c.id into v_id from app.contratos_versoes c
   where c.versao = nova and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa);
  insert into app.contratos_categorias (contrato_id, categoria, km_cent, taxa_fixa_cent)
  select v_id, cc.categoria, cc.km_cent, cc.taxa_fixa_cent
    from app.contratos_categorias cc
   where cc.contrato_id = (select c.id from app.contratos_versoes c
                            where c.versao < nova
                              and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa)
                            order by c.versao desc limit 1);
  get diagnostics v_copiadas = row_count;

  perform interno.auditar('PUBLICAR_CONTRATO', v_alvo, 'OK', null,
    jsonb_build_object('empresa_id', p_empresa, 'versao', nova, 'vigente_desde', p_vigente_desde,
                       'categorias_copiadas', v_copiadas));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Detalhe do pedido (corpo de 20261020120200_telefone_motorista.sql).
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
                              where pf.usuario_id = a.motorista_id) end);

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
-- 5. Painel da empresa (corpo de 20261020120300_painel_empresa.sql).
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
  v_limite := coalesce((select k.limite_saldo_negativo_cent from interno.contrato_vigente(v_empresa) k), 0);

  return jsonb_build_object('ok', true,
    'resumo', jsonb_build_object(
      'mes', to_char(v_mes, 'YYYY-MM-DD'),
      'gasto_cent', v_gasto,
      'reservado_cent', (v_saldos ->> 'reservado_cent')::bigint,
      'disponivel_cent', (v_saldos ->> 'disponivel_cent')::bigint,
      'total_mes_cent', v_inicial + v_recargas + v_limite,
      'contato_recarga', (select c.contato_recarga from app.configuracao c where c.id)),
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
