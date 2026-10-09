-- Fase 2B, revisão independente do motor de saldo (docs/fases/fase-2b-desenho-e-plano.md "Banco"). Endurecimento:
--   I1 — sem deadlock entre estorno e cancelamento: toda trava de app.atividades passa a FOR NO KEY UPDATE (não
--        conflita com o FOR KEY SHARE da checagem de FK ao gravar lançamento/reserva que aponta a atividade), e
--        api.estornar_lancamento trava a atividade do lançamento original ANTES da conta (ordem atividade → conta);
--   I2 — cancelar_agendado só devolve disponivel_cent ao cliente e ao ADM (motorista não vê saldo; Adendo A10);
--   I3 — cancelar_agendado recebe a multa que o cliente viu na prévia (obrigatória para o cliente): se a faixa mudou
--        até a confirmação, nada é feito e volta MULTA_ALTERADA com a multa nova (auditado). Faixa e validade da
--        aprovação pelo relógio (clock_timestamp), não pelo início da transação (M4);
--   I4 — trigger de coerência no livro-razão (atividade/orçamento/reserva/estorno da mesma empresa, valor e estado da
--        reserva, estorno = −original de tipo estornável) e nas reservas (empresa e orçamento da atividade) → 23514;
--   I5 — app.contas protegida: UPDATE só de dentro do trigger do livro-razão, INSERT só zerada, sem DELETE/TRUNCATE;
--        travar_conta não recria conta de empresa que já tem lançamentos (integridade, XX001);
--   I6 — reconciliação: RESERVA_SEM_PAR, RESERVA_VALOR_DIVERGENTE, EMPRESA_DIVERGENTE, ESTORNO_DIVERGENTE,
--        AGENDADA_SEM_APROVACAO; COBRANCA_SEM_APROVACAO exige a aprovação do MESMO orçamento;
--   M1 — evento `saldo` no tópico saldo:<empresa_id> (só ADM e clientes da empresa; a equipe não vê saldo);
--   M2 — idempotência de recarga/ajuste/estorno confere também motivo (e o comprovante da recarga);
--   M5 — multa do cancelamento pelo orçamento da RESERVA; sem orçamento/faixas = erro de integridade (nunca 0 calado);
--   M6 — painel_adm recusa datas infinitas (CAMPOS_INVALIDOS).
-- Corpos iguais aos das migrations anteriores salvo o indicado em cada seção. Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. I1 — travas de atividade em FOR NO KEY UPDATE (corpos iguais aos de 20261009130000/20261009130200).
------------------------------------------------------------------------------------------------

create or replace function interno.transicionar(p_atividade uuid, p_para app.status_atividade, p_observacao text)
returns app.status_atividade
language plpgsql security definer set search_path = '' as $$
declare
  v_de app.status_atividade;
begin
  select a.status into v_de from app.atividades a where a.id = p_atividade for no key update;
  if not found then
    raise exception 'atividade % inexistente', p_atividade using errcode = 'P0002';
  end if;
  if not exists (select 1 from app.transicoes_permitidas t where t.de = v_de and t.para = p_para) then
    raise exception 'transição % → % não permitida', v_de, p_para using errcode = '23514';
  end if;
  update app.atividades set status = p_para, atualizada_em = now() where id = p_atividade;
  insert into app.atividade_historico (atividade_id, de, para, por, observacao)
  values (p_atividade, v_de, p_para, (select auth.uid()), nullif(btrim(coalesce(p_observacao, '')), ''));
  if p_para in ('RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA', 'CONCLUIDA') then
    update app.agenda_blocos set ativo = false where atividade_id = p_atividade and ativo;
  end if;
  if p_para in ('SOLICITADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA', 'AGENDADA') then
    update app.orcamentos
       set status = case p_para when 'SOLICITADA' then 'SUBSTITUIDO' when 'REPROVADA' then 'REPROVADO'
                                when 'EXPIRADA' then 'EXPIRADO' when 'CANCELADA' then 'CANCELADO'
                                else 'APROVADO' end
     where atividade_id = p_atividade and status = 'PENDENTE';
  end if;
  return v_de;
end $$;

create or replace function api.enviar_orcamento(p_atividade uuid, p jsonb, p_horario_sugerido timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  c app.contratos_versoes;
  o app.orcamentos;
  r jsonb;
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
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
  select * into c from interno.contrato_vigente(a.empresa_id);
  r := interno.calcular_linhas(c, a.levar, a.trazer, a.modalidade, p);
  if not (r ->> 'ok')::boolean then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, r ->> 'codigo', r -> 'detalhe');
  end if;
  if p_horario_sugerido is not null
     and (p_horario_sugerido <= now() or p_horario_sugerido > now() + interval '366 days') then
    return interno.negar('ENVIAR_ORCAMENTO', v_alvo, 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('horario_sugerido')));
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
  o.valido_ate := least(now() + make_interval(hours => c.validade_orcamento_horas), a.inicio);
  o.horario_sugerido := p_horario_sugerido;
  o.status := 'PENDENTE';
  o.enviado_por := v.usuario_id;
  o.enviado_em := now();
  o.hash := interno.hash_orcamento(o, a);
  insert into app.orcamentos select o.*;

  perform interno.transicionar(a.id, 'ORCADA', null);
  update app.agenda_blocos set expira_em = o.valido_ate where atividade_id = a.id and ativo;

  perform interno.auditar('ENVIAR_ORCAMENTO', v_alvo, 'OK', null,
    jsonb_build_object('orcamento_id', o.id, 'versao', o.versao, 'modalidade', o.modalidade, 'total_cent', o.total_cent,
                       'contrato_versao', o.contrato_versao, 'valido_ate', o.valido_ate, 'hash', o.hash));
  return jsonb_build_object('ok', true, 'orcamento_id', o.id, 'versao', o.versao, 'total_cent', o.total_cent,
                            'valido_ate', o.valido_ate);
end $$;

create or replace function api.pedir_revisao(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_horas int;
  v_prazo timestamptz;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'ORCADA' then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if not interno.checar_limite('PEDIR_REVISAO', 10, interval '1 hour') then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('PEDIR_REVISAO', v_alvo, 'PRAZO_VENCIDO');
  end if;

  -- prazo do contrato vigente; sem vigente, o do snapshot do orçamento revisado
  v_horas := coalesce(
    (select c.prazo_orcar_horas from interno.contrato_vigente(a.empresa_id) c),
    (select (x.snapshot ->> 'prazo_orcar_horas')::int from app.orcamentos x
      where x.atividade_id = a.id and x.status = 'PENDENTE'));
  v_prazo := least(now() + make_interval(hours => v_horas), a.inicio);

  perform interno.transicionar(a.id, 'SOLICITADA', v_motivo);
  update app.atividades set prazo_orcar_ate = v_prazo where id = a.id;
  update app.agenda_blocos set expira_em = v_prazo where atividade_id = a.id and ativo;

  perform interno.auditar('PEDIR_REVISAO', v_alvo, 'OK', null,
    jsonb_build_object('motivo', v_motivo, 'prazo_orcar_ate', v_prazo));
  return jsonb_build_object('ok', true, 'prazo_orcar_ate', v_prazo);
end $$;

create or replace function api.reprovar_orcamento(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if not interno.pode_decidir(v, a) then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) > 500 then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'ORCADA' then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('REPROVAR_ORCAMENTO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'REPROVADA', nullif(v_motivo, ''));
  perform interno.auditar('REPROVAR_ORCAMENTO', v_alvo, 'OK', null, jsonb_build_object('motivo', nullif(v_motivo, '')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function interno.expirar_atividade(p_atividade uuid, p_pular_travadas boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_pular_travadas then
    select a.id into v_id from app.atividades a where a.id = p_atividade for no key update skip locked;
  else
    select a.id into v_id from app.atividades a where a.id = p_atividade for no key update;
  end if;
  if v_id is null or not interno.prazo_vencido(p_atividade) then
    return false;
  end if;
  perform interno.transicionar(p_atividade, 'EXPIRADA', 'Prazo vencido');
  return true;
end $$;

create or replace function api.recusar_pedido(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
begin
  if not (select app.pode_fazer('ORCAR_PEDIDO')) then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if a.id is null then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if v.papel = 'MOTORISTA' and a.motorista_id <> v.usuario_id then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status <> 'SOLICITADA' then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('RECUSAR_PEDIDO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'RECUSADA', v_motivo);
  perform interno.auditar('RECUSAR_PEDIDO', v_alvo, 'OK', null, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('ok', true);
end $$;

create or replace function api.cancelar_pedido(p_atividade uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  a app.atividades;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'atividade:' || coalesce(p_atividade::text, '-');
  v_prestador boolean;
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA', 'CLIENTE') then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  v_prestador := v.papel in ('ADM', 'MOTORISTA');
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  if a.id is null then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if (v.papel = 'MOTORISTA' and a.motorista_id <> v.usuario_id)
     or (v.papel = 'CLIENTE' and not (a.empresa_id = v.empresa_id
                                       and (v.nivel = 1 or (v.nivel = 2 and a.solicitante_id = v.usuario_id)))) then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if (v_prestador and length(v_motivo) not between 3 and 500) or length(v_motivo) > 500 then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if a.status not in ('SOLICITADA', 'ORCADA') then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'STATUS_INVALIDO');
  end if;
  if interno.expirar_atividade(a.id) then
    return interno.negar('CANCELAR_PEDIDO', v_alvo, 'PRAZO_VENCIDO');
  end if;
  perform interno.transicionar(a.id, 'CANCELADA', nullif(v_motivo, ''));
  perform interno.auditar('CANCELAR_PEDIDO', v_alvo, 'OK', null,
    jsonb_build_object('de', a.status, 'motivo', nullif(v_motivo, ''), 'prestador', v_prestador, 'multa_cent', 0));
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 2. Lançamentos manuais do ADM: I1 (estorno trava a atividade antes da conta) e M2 (idempotência confere motivo e
--    comprovante). Demais regras iguais às de 20261009140000.
------------------------------------------------------------------------------------------------

create or replace function api.lancar_recarga(p_empresa uuid, p_valor_cent bigint, p_motivo text, p_comprovante text,
                                              p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_comprovante text := nullif(btrim(coalesce(p_comprovante, '')), '');
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null or p_chave is null or p_valor_cent is null or p_valor_cent <= 0
     or length(coalesce(v_comprovante, '')) > 200 then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if p_valor_cent > interno.teto_cent() then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'VALOR_FORA_DO_LIMITE');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('LANCAR_RECARGA', v_alvo, 'NAO_ENCONTRADO');
  end if;
  return interno.lancar_manual('LANCAR_RECARGA', 'RECARGA', p_empresa, p_valor_cent, null, null, v_motivo, v_comprovante,
                               p_chave, jsonb_build_object('valor_cent', p_valor_cent, 'motivo', v_motivo,
                                                           'comprovante', v_comprovante));
end $$;

create or replace function api.lancar_ajuste(p_empresa uuid, p_valor_cent bigint, p_motivo text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'empresa:' || coalesce(p_empresa::text, '-');
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_empresa is null or p_chave is null or p_valor_cent is null or p_valor_cent = 0 then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if abs(p_valor_cent) > interno.teto_cent() then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'VALOR_FORA_DO_LIMITE');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not exists (select 1 from app.empresas e where e.id = p_empresa) then
    return interno.negar('LANCAR_AJUSTE', v_alvo, 'NAO_ENCONTRADO');
  end if;
  return interno.lancar_manual('LANCAR_AJUSTE', 'AJUSTE', p_empresa, p_valor_cent, null, null, v_motivo, null,
                               p_chave, jsonb_build_object('valor_cent', p_valor_cent, 'motivo', v_motivo));
end $$;

-- I1: o lançamento original com atividade (MULTA, DEBITO, ADITIVO) tem a atividade travada ANTES da conta — a mesma
-- ordem de aprovar/cancelar (atividade → conta). Sem isso, estorno (conta → FK na atividade) × cancelamento
-- (atividade → conta) podiam se travar mutuamente.
create or replace function api.estornar_lancamento(p_lancamento bigint, p_motivo text, p_chave uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alvo text := 'lancamento:' || coalesce(p_lancamento::text, '-');
  l app.lancamentos;
begin
  if not (select app.pode_fazer('LANCAR_SALDO')) then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('LANCAR_SALDO', 200, interval '1 hour') then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;
  if p_lancamento is null or p_chave is null then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if length(v_motivo) not between 3 and 500 then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  select * into l from app.lancamentos x where x.id = p_lancamento;
  if l.id is null then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'NAO_ENCONTRADO');
  end if;
  if l.tipo not in ('RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO') then
    return interno.negar('ESTORNAR_LANCAMENTO', v_alvo, 'NAO_ESTORNAVEL');
  end if;
  if l.atividade_id is not null then
    perform 1 from app.atividades a where a.id = l.atividade_id for no key update;
  end if;
  return interno.lancar_manual('ESTORNAR_LANCAMENTO', 'ESTORNO', l.empresa_id, -l.valor_cent, l.atividade_id, l.id,
                               v_motivo, null, p_chave, jsonb_build_object('lancamento_id', l.id, 'motivo', v_motivo));
end $$;

------------------------------------------------------------------------------------------------
-- 3. Aprovação: I1 (FOR NO KEY UPDATE na atividade e no orçamento) e M4 (validade pelo relógio: a transação pode ter
--    esperado travas, e o início dela não é "agora"). Demais regras iguais às de 20261009140100.
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
-- 4. Cancelamento de AGENDADA: I2, I3, M4 e M5.
------------------------------------------------------------------------------------------------

-- Faixa e multa de cancelamento pelo RELÓGIO (p_agora; padrão clock_timestamp()). p_faixas: as do snapshot
-- (antecedência estritamente decrescente, última = 0). Sem total ou sem faixas: erro de integridade (o snapshot do
-- orçamento sempre as tem; multa 0 calada esconderia o defeito). {horas_antes (2 casas), faixa, multa_cent}
drop function interno.calcular_multa(bigint, jsonb, timestamptz);
create function interno.calcular_multa(p_total_cent bigint, p_faixas jsonb, p_inicio timestamptz,
                                       p_agora timestamptz default clock_timestamp())
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_horas numeric;
  v_h int;
  v_bp int;
begin
  if p_total_cent is null or p_inicio is null or p_agora is null or p_faixas is null
     or jsonb_typeof(p_faixas) <> 'array' or jsonb_array_length(p_faixas) = 0 then
    raise exception 'multa de cancelamento sem orçamento ou sem faixas' using errcode = 'XX001';
  end if;
  v_horas := extract(epoch from (p_inicio - p_agora)) / 3600.0;
  select f.h, f.bp into v_h, v_bp
  from (select (e ->> 'antecedencia_min_horas')::int as h, (e ->> 'multa_bp')::int as bp
          from jsonb_array_elements(p_faixas) e) f
  order by (v_horas >= f.h) desc, case when v_horas >= f.h then -f.h else f.h end
  limit 1;
  if v_h is null or v_bp is null then
    raise exception 'faixa de cancelamento inválida' using errcode = 'XX001';
  end if;
  return jsonb_build_object(
    'horas_antes', round(v_horas, 2),
    'faixa', jsonb_build_object('antecedencia_min_horas', v_h, 'multa_bp', v_bp),
    'multa_cent', interno.arred(p_total_cent * v_bp / 10000.0));
end $$;

-- Orçamento da reserva ATIVA da atividade (a multa é sobre o que foi aprovado e reservado). Sem reserva ativa ou sem
-- orçamento em AGENDADA: erro de integridade (a reconciliação aponta AGENDADA_SEM_RESERVA).
create function interno.orcamento_da_reserva(p_atividade uuid) returns app.orcamentos
language plpgsql stable security definer set search_path = '' as $$
declare
  o app.orcamentos;
begin
  select x.* into o from app.reservas r join app.orcamentos x on x.id = r.orcamento_id
   where r.atividade_id = p_atividade and r.ativa;
  if o.id is null then
    raise exception 'atividade % AGENDADA sem reserva ativa/orçamento', p_atividade using errcode = 'XX001';
  end if;
  return o;
end $$;

-- Prévia: igual à de 20261009140100, com a multa pelo orçamento da reserva e pelo relógio (o mesmo cálculo da
-- confirmação; a tela devolve multa_cent em p_multa_esperada_cent).
create or replace function api.simular_cancelamento(p_atividade uuid)
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
  o := interno.orcamento_da_reserva(a.id);
  select coalesce(sum(r.valor_cent), 0) into v_liberado from app.reservas r where r.atividade_id = a.id and r.ativa;
  m := interno.calcular_multa(o.total_cent, o.snapshot -> 'faixas_cancelamento', a.inicio);
  return jsonb_build_object(
    'ok', true, 'atividade_id', a.id, 'numero', a.numero, 'total_cent', o.total_cent, 'liberado_cent', v_liberado,
    'horas_antes', m -> 'horas_antes',
    'faixa', case when v_cliente then m -> 'faixa' end,
    'multa_cent', case when v_cliente then (m ->> 'multa_cent')::bigint else 0 end,
    'cobra_multa', v_cliente, 'motivo_obrigatorio', v_prestador);
end $$;

-- Cancela AGENDADA. Cliente (dono N2/N1): p_multa_esperada_cent OBRIGATÓRIA (a multa_cent da prévia); se a multa
-- calculada agora (faixa pelo relógio) for outra, nada é feito: {ok:false, codigo:'MULTA_ALTERADA', multa_cent, faixa}
-- (auditado) e a tela pede nova confirmação (com chave nova). Igual: libera a reserva e lança a MULTA (se > 0) do
-- orçamento da reserva. Motorista atribuído/ADM: libera a reserva, sem custo, motivo obrigatório (a multa esperada é
-- ignorada). A chave confere motivo e multa esperada. Trava atividade → reserva → conta.
-- {ok, atividade_id, liberado_cent, multa_cent, faixa (null sem multa calculada), disponivel_cent (só cliente e ADM)}
drop function api.cancelar_agendado(uuid, text, uuid);
create function api.cancelar_agendado(p_atividade uuid, p_motivo text, p_chave uuid,
                                      p_multa_esperada_cent bigint default null)
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
  v_param jsonb;
  m jsonb;
  v_multa bigint := 0;
  v_liberado bigint := 0;
  r jsonb;
  v_res jsonb;
begin
  if v.usuario_id is null then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'SEM_PERMISSAO');
  end if;
  select * into a from app.atividades x where x.id = p_atividade for no key update;
  v_cliente := interno.pode_decidir(v, a);
  v_prestador := interno.pode_orcar(v, a);
  if not (v_cliente or v_prestador) then
    return interno.negar('CANCELAR_AGENDADO', v_alvo,
                         case when v.papel = 'ADM' then 'NAO_ENCONTRADO' else 'SEM_PERMISSAO' end);
  end if;
  if p_chave is null
     or (v_cliente and (p_multa_esperada_cent is null or p_multa_esperada_cent not between 0 and interno.teto_cent())) then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'CAMPOS_INVALIDOS');
  end if;
  if (v_prestador and length(v_motivo) not between 3 and 500) or length(v_motivo) > 500 then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'MOTIVO_OBRIGATORIO');
  end if;
  if not interno.checar_limite('CANCELAR_AGENDADO', 30, interval '1 hour') then
    return interno.negar('CANCELAR_AGENDADO', v_alvo, 'LIMITE_EXCEDIDO');
  end if;

  v_param := jsonb_build_object('motivo', nullif(v_motivo, ''),
                                'multa_esperada_cent', case when v_cliente then p_multa_esperada_cent end);
  c := interno.travar_conta(a.empresa_id);
  r := interno.idempotencia_buscar(a.empresa_id, p_chave, 'CANCELAR_AGENDADO', v_alvo, v_param);
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

  select * into rs from app.reservas x where x.atividade_id = a.id and x.ativa for no key update;
  if v_cliente then
    o := interno.orcamento_da_reserva(a.id);
    m := interno.calcular_multa(o.total_cent, o.snapshot -> 'faixas_cancelamento', a.inicio);
    v_multa := (m ->> 'multa_cent')::bigint;
    if v_multa <> p_multa_esperada_cent then
      return interno.negar('CANCELAR_AGENDADO', v_alvo, 'MULTA_ALTERADA',
               jsonb_build_object('multa_esperada_cent', p_multa_esperada_cent, 'multa_cent', v_multa,
                                  'faixa', m -> 'faixa', 'horas_antes', m -> 'horas_antes'))
             || jsonb_build_object('multa_cent', v_multa, 'faixa', m -> 'faixa');
    end if;
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
                                'faixa', m -> 'faixa');
    -- I2: saldo só para quem pode ver saldo (cliente da empresa e ADM); o motorista não (Adendo A10)
    if v_cliente or v.papel = 'ADM' then
      v_res := v_res || jsonb_build_object('disponivel_cent', (select (s ->> 'disponivel_cent')::bigint
                                                                 from interno.saldos(a.empresa_id) s));
    end if;
    perform interno.idempotencia_gravar(a.empresa_id, p_chave, 'CANCELAR_AGENDADO', v_alvo, v_param, v_res);
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
-- 5. I4 — coerência do livro-razão e das reservas (vale também para quem grava por fora das RPCs) → 23514.
------------------------------------------------------------------------------------------------

-- Lançamento: atividade, orçamento, reserva e estornado da MESMA empresa e coerentes entre si; RESERVA/LIBERAÇÃO com
-- o valor e o estado da reserva (RESERVA de reserva ativa; LIBERAÇÃO de reserva já liberada); ESTORNO = −original,
-- de tipo estornável, na mesma atividade.
create function interno.lancamento_validar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a app.atividades;
  o app.orcamentos;
  r app.reservas;
  l app.lancamentos;
begin
  if new.atividade_id is not null then
    select * into a from app.atividades x where x.id = new.atividade_id;
    if a.id is not null and a.empresa_id <> new.empresa_id then
      raise exception 'lançamento: atividade de outra empresa' using errcode = '23514';
    end if;
  end if;
  if new.orcamento_id is not null then
    select * into o from app.orcamentos x where x.id = new.orcamento_id;
    if o.id is not null and o.atividade_id is distinct from new.atividade_id then
      raise exception 'lançamento: orçamento de outra atividade' using errcode = '23514';
    end if;
  end if;
  if new.reserva_id is not null then
    select * into r from app.reservas x where x.id = new.reserva_id;
    if r.id is not null and (r.empresa_id <> new.empresa_id or r.atividade_id is distinct from new.atividade_id
                             or r.orcamento_id is distinct from new.orcamento_id or r.valor_cent <> new.valor_cent) then
      raise exception 'lançamento: reserva de outra empresa/atividade/orçamento ou com outro valor'
        using errcode = '23514';
    end if;
    if r.id is not null and ((new.tipo = 'RESERVA' and not r.ativa) or (new.tipo = 'LIBERACAO_RESERVA' and r.ativa)) then
      raise exception 'lançamento: estado da reserva incompatível com %', new.tipo using errcode = '23514';
    end if;
  end if;
  if new.estorna_id is not null then
    select * into l from app.lancamentos x where x.id = new.estorna_id;
    if l.id is not null and (l.empresa_id <> new.empresa_id
                             or l.tipo not in ('RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO')
                             or new.valor_cent <> -l.valor_cent
                             or new.atividade_id is distinct from l.atividade_id) then
      raise exception 'estorno incoerente com o lançamento estornado' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger lancamentos_validar before insert on app.lancamentos
  for each row execute function interno.lancamento_validar();

-- Reserva: da empresa da atividade, com orçamento da própria atividade.
create function interno.reserva_coerente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.atividades a where a.id = new.atividade_id and a.empresa_id = new.empresa_id)
     or not exists (select 1 from app.orcamentos o where o.id = new.orcamento_id and o.atividade_id = new.atividade_id) then
    raise exception 'reserva incoerente com a atividade/orçamento' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reservas_coerente before insert on app.reservas
  for each row execute function interno.reserva_coerente();

------------------------------------------------------------------------------------------------
-- 6. I5 — app.contas só muda pelo livro-razão; M1 — evento `saldo` no tópico saldo:<empresa>.
------------------------------------------------------------------------------------------------

-- UPDATE só de dentro do trigger do livro-razão (profundidade ≥ 2: o UPDATE direto roda com profundidade 1); INSERT só
-- zerada; nunca DELETE/TRUNCATE. (Teste que injeta divergência desliga este trigger dentro da própria transação.)
create function interno.conta_proteger() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'contas não podem ser apagadas' using errcode = '42501';
  elsif tg_op = 'INSERT' then
    if new.saldo_contabil_cent <> 0 or new.reservado_cent <> 0 then
      raise exception 'conta nasce zerada (o saldo vem do livro-razão)' using errcode = '42501';
    end if;
  elsif pg_trigger_depth() < 2 or new.empresa_id <> old.empresa_id then
    raise exception 'conta só muda por lançamento no livro-razão' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger contas_proteger before insert or update or delete on app.contas
  for each row execute function interno.conta_proteger();
create trigger contas_sem_truncate before truncate on app.contas
  for each statement execute function interno.conta_proteger();

-- Conta que falta é criada (zerada) só para empresa SEM histórico; com lançamentos, falta de conta é corrupção.
create or replace function interno.travar_conta(p_empresa uuid) returns app.contas
language plpgsql security definer set search_path = '' as $$
declare
  c app.contas;
begin
  select * into c from app.contas x where x.empresa_id = p_empresa for update;
  if c.empresa_id is null then
    if exists (select 1 from app.lancamentos l where l.empresa_id = p_empresa) then
      raise exception 'conta da empresa % sumiu, mas há lançamentos', p_empresa using errcode = 'XX001';
    end if;
    insert into app.contas (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
    select * into c from app.contas x where x.empresa_id = p_empresa for update;
  end if;
  return c;
end $$;

-- Igual à de 20261009140000, com o aviso no tópico saldo:<empresa> (não mais empresa:<id>, que a equipe assina).
create or replace function interno.lancamento_aplicar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update app.contas
     set saldo_contabil_cent = saldo_contabil_cent + interno.efeito_contabil(new.tipo, new.valor_cent),
         reservado_cent = reservado_cent + interno.efeito_reservado(new.tipo, new.valor_cent),
         atualizado_em = now()
   where empresa_id = new.empresa_id;
  if not found then
    raise exception 'conta da empresa % inexistente', new.empresa_id using errcode = '23503';
  end if;
  perform realtime.send(jsonb_build_object('empresa_id', new.empresa_id, 'em', now()), 'saldo',
                        'saldo:' || new.empresa_id::text, true);
  return null;
end $$;

-- Tópicos privados (igual a 20261009132000, mais saldo:<id>): saldo só para o ADM e os clientes da empresa.
create or replace function app.pode_ver_topico(p_topico text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  a app.atividades;
  v_empresa uuid;
begin
  if v.usuario_id is null or p_topico is null then
    return false;
  end if;
  if p_topico = 'equipe' then
    return app.pode_ver_equipe();
  elsif p_topico ~ ('^atividade:' || uuid_re || '$') then
    select * into a from app.atividades x where x.id = substr(p_topico, 11)::uuid;
    return interno.pode_ver_atividade(v, a);
  elsif p_topico ~ ('^empresa:' || uuid_re || '$') then
    v_empresa := substr(p_topico, 9)::uuid;
    return exists (select 1 from app.empresas e where e.id = v_empresa)
       and (v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA') or (v.papel = 'CLIENTE' and v.empresa_id = v_empresa));
  elsif p_topico ~ ('^saldo:' || uuid_re || '$') then
    v_empresa := substr(p_topico, 7)::uuid;
    return exists (select 1 from app.empresas e where e.id = v_empresa)
       and (v.papel = 'ADM' or (v.papel = 'CLIENTE' and v.empresa_id = v_empresa));
  end if;
  return false;
end $$;

------------------------------------------------------------------------------------------------
-- 7. I6 — reconciliação com as divergências novas (o resto igual ao de 20261009140000).
------------------------------------------------------------------------------------------------

-- Divergências (até 200 de cada tipo):
--   CONTA_DIVERGENTE: contábil da conta ≠ Σ efeito_contabil, ou reservado ≠ Σ reservas ativas, ou ≠ Σ efeito_reservado;
--   RESERVA_FORA_DE_AGENDADA: reserva ativa em atividade que não está AGENDADA;
--   AGENDADA_SEM_RESERVA: atividade AGENDADA sem reserva ativa;
--   AGENDADA_SEM_APROVACAO: atividade AGENDADA sem aprovação registrada do orçamento APROVADO;
--   RESERVA_SEM_PAR: reserva sem exatamente 1 lançamento RESERVA, ou com LIBERACAO_RESERVA ≠ (0 se ativa, 1 se não);
--   RESERVA_VALOR_DIVERGENTE: lançamento RESERVA/LIBERACAO_RESERVA com valor ≠ o da reserva;
--   EMPRESA_DIVERGENTE: lançamento ou reserva de empresa diferente da atividade/reserva a que aponta;
--   ESTORNO_DIVERGENTE: estorno ≠ −original, de outra empresa ou de tipo não estornável;
--   COBRANCA_SEM_APROVACAO: DEBITO/MULTA sem aprovação registrada do MESMO orçamento (orcamento_id do lançamento);
--   COBRANCA_DUPLICADA: mais de 1 DEBITO (ou mais de 1 MULTA) na mesma atividade.
-- Devolve {reconciliacao_id, ok, empresas, divergencias}.
create or replace function interno.reconciliar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  n int;
  v_id bigint;
begin
  select count(*) into n from app.empresas;
  select coalesce(jsonb_agg(x.item), '[]') into d
  from (
    (select jsonb_build_object('tipo', 'CONTA_DIVERGENTE', 'empresa_id', e.id,
              'contabil_conta', coalesce(c.saldo_contabil_cent, 0), 'contabil_livro', coalesce(l.contabil, 0),
              'reservado_conta', coalesce(c.reservado_cent, 0), 'reservado_reservas', coalesce(r.reservado, 0),
              'reservado_livro', coalesce(l.reservado, 0)) as item
       from app.empresas e
       left join app.contas c on c.empresa_id = e.id
       left join lateral (select sum(interno.efeito_contabil(x.tipo, x.valor_cent)) as contabil,
                                 sum(interno.efeito_reservado(x.tipo, x.valor_cent)) as reservado
                            from app.lancamentos x where x.empresa_id = e.id) l on true
       left join lateral (select sum(x.valor_cent) as reservado
                            from app.reservas x where x.empresa_id = e.id and x.ativa) r on true
      where coalesce(c.saldo_contabil_cent, 0) <> coalesce(l.contabil, 0)
         or coalesce(c.reservado_cent, 0) <> coalesce(r.reservado, 0)
         or coalesce(c.reservado_cent, 0) <> coalesce(l.reservado, 0)
      order by e.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_FORA_DE_AGENDADA', 'empresa_id', x.empresa_id,
              'atividade_id', x.atividade_id, 'reserva_id', x.id, 'status', a.status)
       from app.reservas x join app.atividades a on a.id = x.atividade_id
      where x.ativa and a.status <> 'AGENDADA'
      order by x.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'AGENDADA_SEM_RESERVA', 'empresa_id', a.empresa_id, 'atividade_id', a.id)
       from app.atividades a
      where a.status = 'AGENDADA'
        and not exists (select 1 from app.reservas x where x.atividade_id = a.id and x.ativa)
      order by a.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'AGENDADA_SEM_APROVACAO', 'empresa_id', a.empresa_id, 'atividade_id', a.id)
       from app.atividades a
      where a.status = 'AGENDADA'
        and not exists (select 1 from app.aprovacoes p join app.orcamentos o on o.id = p.orcamento_id
                         where p.atividade_id = a.id and o.atividade_id = a.id and o.status = 'APROVADO')
      order by a.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_SEM_PAR', 'empresa_id', x.empresa_id, 'atividade_id', x.atividade_id,
              'reserva_id', x.id, 'ativa', x.ativa, 'reservas_lancadas', q.reservas, 'liberacoes_lancadas', q.liberacoes)
       from app.reservas x
       cross join lateral (select count(*) filter (where l.tipo = 'RESERVA') as reservas,
                                  count(*) filter (where l.tipo = 'LIBERACAO_RESERVA') as liberacoes
                             from app.lancamentos l where l.reserva_id = x.id) q
      where q.reservas <> 1 or q.liberacoes <> case when x.ativa then 0 else 1 end
      order by x.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'RESERVA_VALOR_DIVERGENTE', 'empresa_id', l.empresa_id,
              'atividade_id', l.atividade_id, 'reserva_id', x.id, 'lancamento_id', l.id, 'lancamento_tipo', l.tipo,
              'valor_lancamento', l.valor_cent, 'valor_reserva', x.valor_cent)
       from app.lancamentos l join app.reservas x on x.id = l.reserva_id
      where l.valor_cent <> x.valor_cent
      order by l.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'EMPRESA_DIVERGENTE', 'empresa_id', y.empresa_id, 'origem', y.origem,
              'id', y.id, 'atividade_id', y.atividade_id, 'empresa_apontada', y.empresa_apontada)
       from (select 'lancamento' as origem, l.id::text as id, l.empresa_id, l.atividade_id,
                    a.empresa_id as empresa_apontada, l.id as ordem
               from app.lancamentos l join app.atividades a on a.id = l.atividade_id
              where a.empresa_id <> l.empresa_id
             union all
             select 'lancamento', l.id::text, l.empresa_id, l.atividade_id, x.empresa_id, l.id
               from app.lancamentos l join app.reservas x on x.id = l.reserva_id
              where x.empresa_id <> l.empresa_id
             union all
             select 'reserva', x.id::text, x.empresa_id, x.atividade_id, a.empresa_id, x.id
               from app.reservas x join app.atividades a on a.id = x.atividade_id
              where a.empresa_id <> x.empresa_id) y
      order by y.origem, y.ordem
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'ESTORNO_DIVERGENTE', 'empresa_id', e.empresa_id, 'lancamento_id', e.id,
              'estorna_id', o.id, 'valor_estorno', e.valor_cent, 'valor_original', o.valor_cent,
              'tipo_original', o.tipo)
       from app.lancamentos e join app.lancamentos o on o.id = e.estorna_id
      where e.valor_cent <> -o.valor_cent or e.empresa_id <> o.empresa_id
         or o.tipo not in ('RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO')
      order by e.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'COBRANCA_SEM_APROVACAO', 'empresa_id', l.empresa_id,
              'atividade_id', l.atividade_id, 'lancamento_id', l.id, 'lancamento_tipo', l.tipo,
              'orcamento_id', l.orcamento_id)
       from app.lancamentos l
      where l.tipo in ('DEBITO', 'MULTA')
        and not exists (select 1 from app.aprovacoes p
                         where p.atividade_id = l.atividade_id and p.orcamento_id = l.orcamento_id)
      order by l.id
      limit 200)
    union all
    (select jsonb_build_object('tipo', 'COBRANCA_DUPLICADA', 'empresa_id', min(l.empresa_id::text)::uuid,
              'atividade_id', l.atividade_id, 'lancamento_tipo', l.tipo, 'quantidade', count(*))
       from app.lancamentos l
      where l.tipo in ('DEBITO', 'MULTA')
      group by l.atividade_id, l.tipo
     having count(*) > 1
      order by l.atividade_id
      limit 200)
  ) x;

  insert into app.reconciliacoes (ok, empresas, divergencias)
  values (jsonb_array_length(d) = 0, n, d)
  returning id into v_id;
  if jsonb_array_length(d) = 0 then
    perform interno.auditar('RECONCILIAR_SALDOS', 'reconciliacao:' || v_id, 'OK', null,
      jsonb_build_object('empresas', n));
  else
    perform interno.auditar('RECONCILIAR_SALDOS', 'reconciliacao:' || v_id, 'ERRO', 'DIVERGENCIA_SALDO',
      jsonb_build_object('empresas', n, 'divergencias', jsonb_array_length(d)));
  end if;
  return jsonb_build_object('reconciliacao_id', v_id, 'ok', jsonb_array_length(d) = 0, 'empresas', n,
                            'divergencias', d);
end $$;

------------------------------------------------------------------------------------------------
-- 8. M6 — painel do ADM recusa datas infinitas (o resto igual ao de 20261009140000).
------------------------------------------------------------------------------------------------
create or replace function api.painel_adm(p_de timestamptz default null, p_ate timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_de timestamptz;
  v_ate timestamptz;
  v_empresas jsonb;
  v_corridas jsonb;
  v_aprovado jsonb;
  v_pend jsonb;
  v_rec jsonb;
begin
  if not (select app.pode_fazer('VER_PAINEL_ADM')) then
    return interno.negar('VER_PAINEL_ADM', 'painel', 'SEM_PERMISSAO');
  end if;
  if (p_de is not null and not isfinite(p_de)) or (p_ate is not null and not isfinite(p_ate)) then
    return interno.negar('VER_PAINEL_ADM', 'painel', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('periodo')));
  end if;
  v_de := coalesce(p_de, date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  v_ate := coalesce(p_ate, now());
  if v_ate <= v_de or v_ate - v_de > interval '366 days' then
    return interno.negar('VER_PAINEL_ADM', 'painel', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('periodo')));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_nome', e.nome,
                                               'tem_contrato', exists (select 1 from interno.contrato_vigente(e.id)))
                            || interno.saldos(e.id) order by e.nome, e.id), '[]')
    into v_empresas
    from app.empresas e;

  select jsonb_build_object('agendadas', count(*) filter (where a.status = 'AGENDADA'),
                            'em_andamento', count(*) filter (where a.status = 'EM_ANDAMENTO'))
    into v_corridas
    from app.atividades a where a.status in ('AGENDADA', 'EM_ANDAMENTO');

  select jsonb_build_object('total_cent', coalesce(sum(r.valor_cent), 0), 'quantidade', count(*))
    into v_aprovado
    from app.reservas r where r.criada_em >= v_de and r.criada_em < v_ate;

  select jsonb_build_object(
           'aguardando_orcamento', count(*) filter (where a.status = 'SOLICITADA'),
           'aguardando_aprovacao', count(*) filter (where a.status = 'ORCADA'),
           'empresas_abaixo_alerta', (select count(*) from jsonb_array_elements(v_empresas) x
                                       where (x ->> 'abaixo_alerta')::boolean))
    into v_pend
    from app.atividades a
   where a.status in ('SOLICITADA', 'ORCADA') and not interno.prazo_vencido(a.id);

  select jsonb_build_object('id', r.id, 'em', r.em, 'ok', r.ok, 'empresas', r.empresas,
                            'divergencias_qtd', jsonb_array_length(r.divergencias),
                            'divergencias', (select coalesce(jsonb_agg(x), '[]')
                                               from (select x from jsonb_array_elements(r.divergencias) x limit 50) y))
    into v_rec
    from app.reconciliacoes r order by r.em desc, r.id desc limit 1;

  return jsonb_build_object('ok', true, 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                            'empresas', v_empresas, 'corridas', v_corridas, 'aprovado', v_aprovado,
                            'pendencias', v_pend, 'ultima_reconciliacao', v_rec);
end $$;

------------------------------------------------------------------------------------------------
-- 9. Privilégios (create or replace mantém os existentes; as funções novas/recriadas nascem fechadas).
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.calcular_multa(bigint, jsonb, timestamptz, timestamptz),
  interno.orcamento_da_reserva(uuid),
  interno.lancamento_validar(),
  interno.reserva_coerente(),
  interno.conta_proteger()
from public, anon, authenticated;

revoke all on function api.cancelar_agendado(uuid, text, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function api.cancelar_agendado(uuid, text, uuid, bigint) to authenticated;
