-- Fase 3B, Tarefa 1 (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.2, §2.5, §2.6; especificação §4.5):
--   * colunas da execução em app.atividades (saída, conclusão, previsão, atraso do anterior, km rodados, observação);
--   * api.registrar_saida: AGENDADA → EM_ANDAMENTO numa transação que libera a reserva e lança o DEBITO do valor
--     aprovado (mesmo orçamento da reserva; a reconciliação continua limpa). Travas na ordem atividade → conta, a mesma
--     do cancelar_agendado: saída e cancelamento se excluem. Janela: a partir de 60 min antes do início (D1);
--   * api.informar_previsao: nova previsão de término; o bloco da agenda vai até ela, sem passar do início do próximo
--     bloco do motorista; se passar, o próximo pedido fica marcado com atraso_anterior_ate e é avisado (D4);
--   * api.concluir: EM_ANDAMENTO → CONCLUIDA, sem cobrar nada (o débito foi na saída);
--   * api.pendencias: "próximos" mostram o pedido em andamento mesmo atrasado (com `atrasado`), e o atraso do anterior.
-- Só acrescenta colunas e funções: o app aberto durante o deploy continua funcionando. Nomes de ação são constantes.

------------------------------------------------------------------------------------------------
-- 1. Colunas.
------------------------------------------------------------------------------------------------
alter table app.atividades
  add column saiu_em timestamptz,
  add column concluiu_em timestamptz,
  add column fim_previsto timestamptz,
  add column atraso_anterior_ate timestamptz,
  add column km_rodados numeric(7, 1) check (km_rodados >= 0),
  add column observacao_conclusao text check (char_length(observacao_conclusao) <= 1000),
  add column etas_usadas int not null default 0 check (etas_usadas between 0 and 12);

-- Fim que vale para a agenda e para o atraso: a previsão informada, ou início + duração.
create function interno.fim_da_atividade(a app.atividades) returns timestamptz
language sql immutable set search_path = '' as $$
  select coalesce(a.fim_previsto, a.inicio + make_interval(mins => a.duracao_min))
$$;

-- Aviso leve no tópico do pedido e da empresa (o front relê api.pedido/api.pendencias ao receber).
create function interno.publicar_atividade(a app.atividades, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  msg jsonb := jsonb_build_object('id', a.id, 'status', a.status, 'motivo', p_motivo, 'em', now());
begin
  perform realtime.send(msg, 'status', 'atividade:' || a.id::text, true);
  perform realtime.send(msg, 'status', 'empresa:' || a.empresa_id::text, true);
end $$;

------------------------------------------------------------------------------------------------
-- 2. Saída (deslize para sair).
------------------------------------------------------------------------------------------------
-- {ok, atividade_id, debitado_cent, saiu_em, disponivel_cent (só ADM)}
create function api.registrar_saida(p_atividade uuid, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contas;
  rs app.reservas;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_param jsonb := '{}'::jsonb;
  r jsonb;
  v_res jsonb;
  v_agora timestamptz := clock_timestamp();
begin
  if v.usuario_id is null then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('REGISTRAR_SAIDA', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if p_chave is null then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('REGISTRAR_SAIDA', 30, interval '1 hour') then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  c := interno.travar_conta(a.empresa_id);
  r := interno.idempotencia_buscar(a.empresa_id, p_chave, 'REGISTRAR_SAIDA', v_alvo, v_param);
  if r is not null then
    if (r ->> 'confere')::boolean then
      perform interno.auditar('REGISTRAR_SAIDA', v_alvo, 'OK', null,
        jsonb_build_object('repeticao', true, 'chave', p_chave));
      return r -> 'resultado';
    end if;
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'CHAVE_REUTILIZADA');
  end if;
  if a.status <> 'AGENDADA' then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'STATUS_INVALIDO');
  end if;
  if v_agora < a.inicio - interval '60 minutes' then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'FORA_DA_JANELA',
             jsonb_build_object('inicio', a.inicio, 'libera_em', a.inicio - interval '60 minutes'))
           || jsonb_build_object('libera_em', a.inicio - interval '60 minutes');
  end if;
  if exists (select 1 from app.atividades x
              where x.motorista_id = a.motorista_id and x.status = 'EM_ANDAMENTO' and x.id <> a.id) then
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'OUTRA_EM_ANDAMENTO');
  end if;

  select * into rs from app.reservas x where x.atividade_id = a.id and x.ativa for no key update;
  if rs.id is null then
    raise exception 'atividade % AGENDADA sem reserva ativa', a.id using errcode = 'XX001';
  end if;

  begin
    update app.reservas set ativa = false, liberada_em = now() where id = rs.id;
    perform interno.inserir_lancamento(a.empresa_id, 'LIBERACAO_RESERVA', rs.valor_cent, a.id, rs.orcamento_id, rs.id,
                                       null, null, null, p_chave);
    perform interno.inserir_lancamento(a.empresa_id, 'DEBITO', -rs.valor_cent, a.id, rs.orcamento_id, null, null,
                                       'Serviço do pedido nº ' || a.numero, null, p_chave);
    update app.atividades set saiu_em = now() where id = a.id;
    perform interno.transicionar(a.id, 'EM_ANDAMENTO', null);
    v_res := jsonb_build_object('ok', true, 'atividade_id', a.id, 'debitado_cent', rs.valor_cent, 'saiu_em', now());
    -- saldo só para quem pode ver saldo (o motorista não; Adendo A10)
    if v.papel = 'ADM' then
      v_res := v_res || jsonb_build_object('disponivel_cent', (select (s ->> 'disponivel_cent')::bigint
                                                                 from interno.saldos(a.empresa_id) s));
    end if;
    perform interno.idempotencia_gravar(a.empresa_id, p_chave, 'REGISTRAR_SAIDA', v_alvo, v_param, v_res);
  exception when unique_violation then
    -- 1 DEBITO por atividade (lancamentos_um_debito) ou 1 EM_ANDAMENTO por motorista (atividades_uma_em_andamento)
    if exists (select 1 from app.atividades x
                where x.motorista_id = a.motorista_id and x.status = 'EM_ANDAMENTO' and x.id <> a.id) then
      return interno.negar('REGISTRAR_SAIDA', v_alvo, 'OUTRA_EM_ANDAMENTO');
    end if;
    return interno.negar('REGISTRAR_SAIDA', v_alvo, 'JA_PROCESSADO');
  end;

  perform interno.auditar('REGISTRAR_SAIDA', v_alvo, 'OK', null,
    jsonb_build_object('reserva_id', rs.id, 'orcamento_id', rs.orcamento_id, 'debitado_cent', rs.valor_cent,
                       'chave', p_chave));
  return v_res;
end $$;

------------------------------------------------------------------------------------------------
-- 3. Previsão de término (atraso).
------------------------------------------------------------------------------------------------
-- {ok, fim_previsto, conflito, proximo_id, proximo_numero}
create function api.informar_previsao(p_atividade uuid, p_fim timestamptz, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  meu app.agenda_blocos;
  prox app.agenda_blocos;
  pa app.atividades;
  r record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_agora timestamptz := clock_timestamp();
  v_fim_bloco timestamptz;
  v_conflito boolean := false;
begin
  if v.usuario_id is null then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('INFORMAR_PREVISAO', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if p_fim is null or p_fim <= v_agora or p_fim > v_agora + interval '24 hours' then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'PREVISAO_INVALIDA');
  end if;
  if length(v_motivo) > 200 then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('INFORMAR_PREVISAO', 30, interval '1 hour') then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  select * into meu from app.agenda_blocos b where b.atividade_id = a.id and b.ativo for update;
  if meu.id is null then
    raise exception 'atividade % EM_ANDAMENTO sem bloco ativo', a.id using errcode = 'XX001';
  end if;
  -- Pré-reservas vencidas que colidem com a extensão expiram agora (como no criar_pedido; ordem fixa de travas).
  for r in
    select b.atividade_id from app.agenda_blocos b
     where b.motorista_id = a.motorista_id and b.ativo and b.tipo = 'PRE_RESERVA' and b.expira_em <= now()
       and b.atividade_id <> a.id and b.periodo && tstzrange(lower(meu.periodo), p_fim, '[)')
     order by b.atividade_id
  loop
    perform interno.expirar_atividade(r.atividade_id);
  end loop;
  -- Próximo bloco ativo do motorista depois deste.
  select * into prox from app.agenda_blocos b
   where b.motorista_id = a.motorista_id and b.ativo and b.atividade_id <> a.id
     and lower(b.periodo) >= lower(meu.periodo)
   order by lower(b.periodo)
   limit 1;
  v_fim_bloco := greatest(least(p_fim, coalesce(lower(prox.periodo), 'infinity'::timestamptz)),
                          lower(meu.periodo) + interval '1 minute');
  v_conflito := prox.id is not null and p_fim > lower(prox.periodo);

  begin
    update app.agenda_blocos set periodo = tstzrange(lower(periodo), v_fim_bloco, '[)') where id = meu.id;
  exception when exclusion_violation then
    return interno.negar('INFORMAR_PREVISAO', v_alvo, 'HORARIO_OCUPADO');
  end;
  update app.atividades set fim_previsto = p_fim, atualizada_em = now() where id = a.id returning * into a;

  -- O atraso marcado antes em outro pedido (por uma previsão anterior) é desfeito; o próximo, se colidir, é marcado.
  for r in
    select x.id from app.atividades x
     where x.motorista_id = a.motorista_id and x.atraso_anterior_ate is not null and x.status = 'AGENDADA'
       and x.id is distinct from prox.atividade_id
     order by x.id
  loop
    update app.atividades set atraso_anterior_ate = null where id = r.id returning * into pa;
    perform interno.publicar_atividade(pa, 'atraso');
  end loop;
  pa := null;
  if prox.id is not null then
    update app.atividades
       set atraso_anterior_ate = case when v_conflito then p_fim end
     where id = prox.atividade_id and status in ('SOLICITADA', 'ORCADA', 'AGENDADA')
       and atraso_anterior_ate is distinct from case when v_conflito then p_fim end
    returning * into pa;
    if pa.id is not null then
      perform interno.publicar_atividade(pa, 'atraso');
    end if;
  end if;
  perform interno.publicar_atividade(a, 'previsao');

  perform interno.auditar('INFORMAR_PREVISAO', v_alvo, 'OK', null,
    jsonb_build_object('fim_previsto', p_fim, 'fim_bloco', v_fim_bloco, 'motivo', nullif(v_motivo, ''),
                       'conflito', v_conflito, 'proximo_id', prox.atividade_id));
  return jsonb_build_object('ok', true, 'fim_previsto', p_fim, 'conflito', v_conflito,
                            'proximo_id', case when v_conflito then prox.atividade_id end,
                            'proximo_numero', case when v_conflito then
                              (select x.numero from app.atividades x where x.id = prox.atividade_id) end);
end $$;

------------------------------------------------------------------------------------------------
-- 4. Conclusão (não cobra nada). As posições e o km rodados entram na Tarefa 2 (20261018120100).
------------------------------------------------------------------------------------------------
-- {ok, concluiu_em, km_rodados}
create function api.concluir(p_atividade uuid, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  pa app.atividades;
  r record;
  v_obs text := btrim(coalesce(p_observacao, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if v.usuario_id is null then
    return interno.negar('CONCLUIR', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_orcar(v, a) then
    return interno.negar('CONCLUIR', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if a.status <> 'EM_ANDAMENTO' then
    return interno.negar('CONCLUIR', v_alvo, 'STATUS_INVALIDO');
  end if;
  if length(v_obs) > 1000 then
    return interno.negar('CONCLUIR', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('CONCLUIR', 30, interval '1 hour') then
    return interno.negar('CONCLUIR', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  update app.atividades set concluiu_em = now(), observacao_conclusao = nullif(v_obs, '') where id = a.id;
  perform interno.transicionar(a.id, 'CONCLUIDA', null);  -- desativa o bloco da agenda
  -- O atraso que esta viagem causava no próximo deixa de existir.
  for r in
    select x.id from app.atividades x
     where x.motorista_id = a.motorista_id and x.atraso_anterior_ate is not null
     order by x.id
  loop
    update app.atividades set atraso_anterior_ate = null where id = r.id returning * into pa;
    perform interno.publicar_atividade(pa, 'atraso');
  end loop;

  select * into a from app.atividades x where x.id = a.id;
  perform interno.auditar('CONCLUIR', v_alvo, 'OK', null, jsonb_build_object('km_rodados', a.km_rodados));
  return jsonb_build_object('ok', true, 'concluiu_em', a.concluiu_em, 'km_rodados', a.km_rodados);
end $$;

------------------------------------------------------------------------------------------------
-- 5. Pendências: o pedido em andamento não some quando passa do fim (vira "atrasado"); atraso do anterior.
--    Corpo igual ao de 20261009131000, salvo o bloco `proximos`.
------------------------------------------------------------------------------------------------
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
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
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
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
    join app.orcamentos o on o.atividade_id = a.id and o.status = 'PENDENTE'
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
             'empresa_nome', case when v_equipe then e.nome end) as item
    from app.atividades a
    join app.empresas e on e.id = a.empresa_id
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
-- 6. Privilégios.
------------------------------------------------------------------------------------------------
revoke all on function
  interno.fim_da_atividade(app.atividades),
  interno.publicar_atividade(app.atividades, text)
from public, anon, authenticated;
revoke all on function
  api.registrar_saida(uuid, uuid),
  api.informar_previsao(uuid, timestamptz, text),
  api.concluir(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function
  api.registrar_saida(uuid, uuid),
  api.informar_previsao(uuid, timestamptz, text),
  api.concluir(uuid, text)
to authenticated;
