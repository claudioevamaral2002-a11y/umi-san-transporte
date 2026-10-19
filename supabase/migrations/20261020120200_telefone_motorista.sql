-- Fase 4, Tarefa 10 (Ruling R14; especificação §6.5): o botão "Ligar" do acompanhamento do cliente.
-- api.pedido devolve `motorista_telefone`: o telefone do perfil do motorista do pedido (app.perfis.telefone, coluna da
-- fase 1, anulável e sem formato fixo; a tela só usa os dígitos no link tel:). Só a partir de AGENDADA (AGENDADA,
-- EM_ANDAMENTO e CONCLUIDA): antes disso o cliente ainda não confirmou a corrida, e um cancelado não precisa mais dele.
-- Quem não vê o pedido já recebe NAO_ENCONTRADO (interno.pode_ver_atividade), então o telefone nunca sai para fora.
-- Telefone vazio ou só com espaços vira nulo (o botão não aparece). Mesma assinatura: o app atual não muda (a chave
-- nova é ignorada) e create or replace mantém os privilégios. Corpo igual ao de 20261020120100_pedido_estilo_uber.sql,
-- salvo o marcado com "fase 4, T10".

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
    'motorista_telefone', case when a.status in ('AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA') then
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

