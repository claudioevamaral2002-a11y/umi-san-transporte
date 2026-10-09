-- Fase 2B, Task 2 (docs/fases/fase-2b-desenho-e-plano.md "Banco"; especificação §4.3, §4.6, §6, §9; Adendo A2):
--   * aprovar_orcamento: numa transação, trava atividade → conta; checa, nesta ordem: permissão (dono N2 ou N1;
--     nunca N3 nem a equipe do prestador), estado ORCADA com orçamento PENDENTE e now() < valido_ate (vencido: expira
--     na hora e devolve ORCAMENTO_VENCIDO), versão + hash (ORCAMENTO_ALTERADO), horário (PRE_RESERVA vira RESERVA;
--     conflito → HORARIO_OCUPADO), crédito do contrato VIGENTE (disponível − total ≥ −limite, senão
--     SALDO_INSUFICIENTE com os valores); então cria a reserva + lançamento RESERVA, AGENDADA (orçamento APROVADO)
--     e grava a aprovação (usuário, data/hora, IP, dispositivo, versão, hash);
--   * simular_cancelamento / cancelar_agendado: faixa pelas horas até o início contra as faixas do SNAPSHOT do
--     orçamento aprovado (a primeira, em ordem decrescente de antecedência, com horas_antes ≥ antecedencia_min_horas;
--     depois do início vale a de 0 h); multa = total × multa_bp / 10000 arredondada meio para cima. Cliente (dono/N1):
--     LIBERACAO_RESERVA + MULTA (se > 0) + CANCELADA na mesma transação; motorista atribuído/ADM: LIBERACAO_RESERVA +
--     CANCELADA, motivo obrigatório. Só em AGENDADA (depois da saída, fase 3, não há cancelamento).
-- Ordem de travas: atividade → conta (a mesma da Task 1). Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Auxiliares.
------------------------------------------------------------------------------------------------

-- IP como em interno.auditar (prefere o do Cloudflare; informativo: cabeçalhos podem ser forjados).
create function interno.ip_requisicao() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(h ->> 'cf-connecting-ip', trim(split_part(h ->> 'x-forwarded-for', ',', 1))), 64)
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- Dispositivo informado pelo app (até 200 caracteres); sem ele, o user-agent.
create function interno.dispositivo_requisicao(p_dispositivo text) returns text
language sql stable set search_path = '' as $$
  select left(coalesce(nullif(btrim(coalesce(p_dispositivo, '')), ''), h ->> 'user-agent'), 200)
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x
$$;

-- Faixa e multa de cancelamento. p_faixas: as do snapshot (antecedência estritamente decrescente, última = 0).
-- {horas_antes (2 casas), faixa: {antecedencia_min_horas, multa_bp}, multa_cent}
create function interno.calcular_multa(p_total_cent bigint, p_faixas jsonb, p_inicio timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  with ant as (
    select extract(epoch from (p_inicio - now())) / 3600.0 as horas
  ), f as (
    select (e ->> 'antecedencia_min_horas')::int as h, (e ->> 'multa_bp')::int as bp
    from jsonb_array_elements(p_faixas) e
  ), escolhida as (
    select f.h, f.bp
    from f, ant
    order by (ant.horas >= f.h) desc, case when ant.horas >= f.h then -f.h else f.h end
    limit 1
  )
  select jsonb_build_object(
    'horas_antes', round(ant.horas, 2),
    'faixa', jsonb_build_object('antecedencia_min_horas', x.h, 'multa_bp', x.bp),
    'multa_cent', interno.arred(p_total_cent * x.bp / 10000.0))
  from ant, escolhida x
$$;

------------------------------------------------------------------------------------------------
-- 2. Aprovação.
------------------------------------------------------------------------------------------------

-- p_versao e p_hash: os do orçamento mostrado ao cliente (api.pedido → orcamento.versao/hash). p_chave: gerada pelo
-- front a cada intenção de aprovar. p_dispositivo: descrição curta do aparelho (opcional).
-- OK: {ok, atividade_id, reservado_cent, disponivel_cent}. SALDO_INSUFICIENTE: {ok:false, codigo, disponivel_cent,
-- limite_cent, total_cent, falta_cent}. Mesma chave: o resultado original, sem novo efeito.
create function api.aprovar_orcamento(p_atividade uuid, p_versao int, p_hash text, p_chave uuid,
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
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
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
  select * into o from app.orcamentos x where x.atividade_id = a.id and x.status = 'PENDENTE' for update;
  if o.id is null then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  -- validade direto no banco (sem depender do cron): vencido expira agora, e a expiração fica gravada (A2)
  if o.valido_ate <= now() or interno.prazo_vencido(a.id) then
    perform interno.transicionar(a.id, 'EXPIRADA', 'Prazo vencido');
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'ORCAMENTO_VENCIDO');
  end if;
  if p_versao <> o.versao or p_hash <> o.hash or o.hash <> interno.hash_orcamento(o, a) then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'ORCAMENTO_ALTERADO');
  end if;
  if not exists (select 1 from app.agenda_blocos b where b.atividade_id = a.id and b.ativo) then
    return interno.negar('APROVAR_ORCAMENTO', v_alvo, 'HORARIO_OCUPADO');
  end if;

  -- crédito: limite do contrato VIGENTE da empresa (sem contrato vigente: limite 0)
  v_limite := coalesce((select k.limite_saldo_negativo_cent from interno.contrato_vigente(a.empresa_id) k), 0);
  v_disp := c.saldo_contabil_cent - c.reservado_cent;
  if v_disp - o.total_cent < -v_limite then
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
                       'chave', p_chave));
  return v_res;
end $$;

------------------------------------------------------------------------------------------------
-- 3. Cancelamento de AGENDADA.
------------------------------------------------------------------------------------------------

-- Prévia (nada é gravado): cliente (dono/N1) vê a faixa e a multa; motorista atribuído/ADM, sem custo.
-- {ok, atividade_id, numero, total_cent, liberado_cent, horas_antes, faixa ({antecedencia_min_horas, multa_bp} ou
--  null para o prestador), multa_cent, cobra_multa, motivo_obrigatorio}
create function api.simular_cancelamento(p_atividade uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  o app.orcamentos;
  v_cliente boolean;
  v_prestador boolean;
  v_liberado bigint;
  m jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if v.usuario_id is null then
    return interno.negar('SIMULAR_CANCELAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade;
  v_cliente := interno.pode_decidir(v, a);
  v_prestador := interno.pode_orcar(v, a);
  if not (v_cliente or v_prestador) then
    return interno.negar('SIMULAR_CANCELAMENTO', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if a.status <> 'AGENDADA' then
    return interno.negar('SIMULAR_CANCELAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  select * into o from app.orcamentos x where x.atividade_id = a.id and x.status = 'APROVADO'
   order by x.versao desc limit 1;
  select coalesce(sum(r.valor_cent), 0) into v_liberado from app.reservas r where r.atividade_id = a.id and r.ativa;
  m := interno.calcular_multa(o.total_cent, o.snapshot -> 'faixas_cancelamento', a.inicio);
  return jsonb_build_object(
    'ok', true, 'atividade_id', a.id, 'numero', a.numero, 'total_cent', o.total_cent, 'liberado_cent', v_liberado,
    'horas_antes', m -> 'horas_antes',
    'faixa', case when v_cliente then m -> 'faixa' end,
    'multa_cent', case when v_cliente then (m ->> 'multa_cent')::bigint else 0 end,
    'cobra_multa', v_cliente, 'motivo_obrigatorio', v_prestador);
end $$;

-- Cancela AGENDADA. Cliente (dono N2/N1): libera a reserva e lança a MULTA da faixa do snapshot (se > 0), motivo
-- opcional. Motorista atribuído/ADM: libera a reserva, sem custo, motivo obrigatório. Trava a atividade (serializa
-- com outro cancelamento e, na fase 3, com a saída) e depois a conta.
-- {ok, atividade_id, liberado_cent, multa_cent, faixa (null sem multa calculada), disponivel_cent}
create function api.cancelar_agendado(p_atividade uuid, p_motivo text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  o app.orcamentos;
  c app.contas;
  rs app.reservas;
  v_cliente boolean;
  v_prestador boolean;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  m jsonb;
  v_multa bigint := 0;
  v_liberado bigint := 0;
  r jsonb;
  v_res jsonb;
begin
  if v.usuario_id is null then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for update;
  v_cliente := interno.pode_decidir(v, a);
  v_prestador := interno.pode_orcar(v, a);
  if not (v_cliente or v_prestador) then
    return interno.negar('CANCELAR_AGENDADO', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if p_chave is null then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if (v_prestador and length(v_motivo) not between 3 and 500) or length(v_motivo) > 500 then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not interno.checar_limite('CANCELAR_AGENDADO', 30, interval '1 hour') then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  c := interno.travar_conta(a.empresa_id);
  r := interno.idempotencia_buscar(a.empresa_id, p_chave, 'CANCELAR_AGENDADO', v_alvo, '{}'::jsonb);
  if r is not null then
    if (r ->> 'confere')::boolean then
      perform interno.auditar('CANCELAR_AGENDADO', v_alvo, 'OK', null,
        jsonb_build_object('repeticao', true, 'chave', p_chave));
      return r -> 'resultado';
    end if;
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'CHAVE_REUTILIZADA');
  end if;
  if a.status <> 'AGENDADA' then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'STATUS_INVALIDO');
  end if;

  select * into o from app.orcamentos x where x.atividade_id = a.id and x.status = 'APROVADO'
   order by x.versao desc limit 1;
  select * into rs from app.reservas x where x.atividade_id = a.id and x.ativa for update;
  if v_cliente then
    m := interno.calcular_multa(o.total_cent, o.snapshot -> 'faixas_cancelamento', a.inicio);
    v_multa := coalesce((m ->> 'multa_cent')::bigint, 0);
  end if;

  begin
    if rs.id is not null then
      update app.reservas set ativa = false, liberada_em = now() where id = rs.id;
      perform interno.inserir_lancamento(a.empresa_id, 'LIBERACAO_RESERVA', rs.valor_cent, a.id, rs.orcamento_id, rs.id,
                                         null, null, null, p_chave);
      v_liberado := rs.valor_cent;
    end if;
    if v_multa > 0 then
      perform interno.inserir_lancamento(a.empresa_id, 'MULTA', -v_multa, a.id, o.id, null, null,
        'Multa de cancelamento do pedido nº ' || a.numero || ' (' || ((m #>> '{faixa,multa_bp}')::int / 100.0)::numeric(6, 2)
          || '%)', null, p_chave);
    end if;
    perform interno.transicionar(a.id, 'CANCELADA', nullif(v_motivo, ''));
    v_res := jsonb_build_object('ok', true, 'atividade_id', a.id, 'liberado_cent', v_liberado, 'multa_cent', v_multa,
                                'faixa', m -> 'faixa',
                                'disponivel_cent', (select (s ->> 'disponivel_cent')::bigint
                                                      from interno.saldos(a.empresa_id) s));
    perform interno.idempotencia_gravar(a.empresa_id, p_chave, 'CANCELAR_AGENDADO', v_alvo, '{}'::jsonb, v_res);
  exception when unique_violation then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'JA_PROCESSADO');
  end;

  perform interno.auditar('CANCELAR_AGENDADO', v_alvo, 'OK', null,
    jsonb_build_object('motivo', nullif(v_motivo, ''), 'prestador', v_prestador, 'liberado_cent', v_liberado,
                       'multa_cent', v_multa, 'faixa', m -> 'faixa', 'horas_antes', m -> 'horas_antes',
                       'chave', p_chave));
  return v_res;
end $$;

------------------------------------------------------------------------------------------------
-- 4. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.ip_requisicao(),
  interno.dispositivo_requisicao(text),
  interno.calcular_multa(bigint, jsonb, timestamptz)
from public, anon, authenticated;

revoke all on function
  api.aprovar_orcamento(uuid, int, text, uuid, text),
  api.simular_cancelamento(uuid),
  api.cancelar_agendado(uuid, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  api.aprovar_orcamento(uuid, int, text, uuid, text),
  api.simular_cancelamento(uuid),
  api.cancelar_agendado(uuid, text, uuid)
to authenticated;
