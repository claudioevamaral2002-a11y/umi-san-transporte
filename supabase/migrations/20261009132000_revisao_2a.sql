-- Fase 2A, Task 6 (docs/fases/fase-2a-desenho-e-plano.md "Plano" 6; revisão de segurança e concorrência):
--   1. api.pedido expõe ao motorista/ADM o orçamento anterior quando o cliente pediu revisão (pré-preenche o Orçar);
--   2. tópico de tempo real `equipe` (ADM, gestor de frota, motorista) com {id, status, em, empresa_id} a cada
--      mudança de status, autorizado por app.pode_ver_equipe() dentro de app.pode_ver_topico;
--   3. R1 — agenda: cliente só vê detalhes dos blocos dos pedidos que pode ver (N2 via só "ocupado" no do colega,
--      especificação §5 "o cliente vê só 'ocupado' nos pedidos de outros");
--   4. R2 — cálculo do orçamento com teto: estouro numérico (contrato com valores absurdos) vira
--      {ok:false, codigo:'VALOR_FORA_DO_LIMITE'} em vez de erro 500; total acima de R$ 1 bilhão também;
--   5. R3 — negações auditadas com teto por usuário (300/hora): acima disso a negação continua valendo, mas não grava
--      linha de auditoria (uma linha AUDITORIA_LIMITADA marca o corte). Evita encher o banco com chamadas negadas.
-- Nomes de ação da auditoria são constantes.

------------------------------------------------------------------------------------------------
-- 1. Tempo real: tópico da equipe.
------------------------------------------------------------------------------------------------

-- Equipe do prestador (com aal2, via app.pode_acessar): ADM, gestor de frota e motorista.
create function app.pode_ver_equipe() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  return coalesce(v.usuario_id is not null and v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA'), false);
end $$;
revoke execute on function app.pode_ver_equipe() from public, anon;
grant execute on function app.pode_ver_equipe() to authenticated;

-- Tópicos privados: atividade:<id> para quem vê o pedido; empresa:<id> para os usuários da empresa e a equipe;
-- equipe para a equipe do prestador. Qualquer outro tópico é recusado.
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
  end if;
  return false;
end $$;

-- Payload mínimo: o front relê as leituras ao receber. A equipe recebe também a empresa (para filtrar a tela).
create or replace function interno.atividade_publicar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  msg jsonb;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    msg := jsonb_build_object('id', new.id, 'status', new.status, 'em', now());
    perform realtime.send(msg, 'status', 'atividade:' || new.id::text, true);
    perform realtime.send(msg, 'status', 'empresa:' || new.empresa_id::text, true);
    perform realtime.send(msg || jsonb_build_object('empresa_id', new.empresa_id), 'status', 'equipe', true);
  end if;
  return null;
end $$;

------------------------------------------------------------------------------------------------
-- 2. Detalhe do pedido com o orçamento anterior (revisão pedida) para quem orça.
------------------------------------------------------------------------------------------------

-- Só motorista (atribuído: pode_ver_atividade já garante) e ADM, só em SOLICITADA depois de uma revisão: a última
-- versão enviada (SUBSTITUIDO) com a entrada, o memorial, o total e o motivo da revisão pedida pelo cliente.
create function interno.orcamento_anterior(v app.perfis, a app.atividades) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when v.papel in ('ADM', 'MOTORISTA') and a.status = 'SOLICITADA' then (
    select jsonb_build_object(
             'versao', o.versao, 'modalidade', o.modalidade, 'entrada', o.entrada, 'linhas', o.linhas,
             'total_cent', o.total_cent,
             'motivo_revisao', (select h.observacao from app.atividade_historico h
                                 where h.atividade_id = a.id and h.de = 'ORCADA' and h.para = 'SOLICITADA'
                                 order by h.id desc limit 1))
      from app.orcamentos o
     where o.atividade_id = a.id
       and o.versao = (select max(x.versao) from app.orcamentos x where x.atividade_id = a.id)
       and o.status = 'SUBSTITUIDO')
  end
$$;

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
    'criada_em', a.criada_em, 'atualizada_em', a.atualizada_em);

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
      'cancelar', v_aberto and (interno.pode_decidir(v, a) or interno.pode_orcar(v, a))));
end $$;

------------------------------------------------------------------------------------------------
-- 3. R1 — agenda: cliente vê detalhes só dos pedidos que pode ver; os demais (outra empresa ou, para o N2, o do
--    colega) só como {inicio, fim, ocupado}.
------------------------------------------------------------------------------------------------
create or replace function api.agenda(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_equipe boolean;
  v_motorista uuid;
  blocos jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('VER_AGENDA', 'agenda', 'SEM_PERMISSAO');
  end if;
  if p_de is null or p_ate is null or p_ate <= p_de or p_ate - p_de > interval '62 days' then
    return interno.negar('VER_AGENDA', 'agenda', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array('periodo')));
  end if;
  v_equipe := v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA');
  v_motorista := interno.motorista_padrao();

  select coalesce(jsonb_agg(x.item order by x.ini, x.id), '[]') into blocos
  from (
    select lower(b.periodo) as ini, b.id,
      case when v_equipe or interno.pode_ver_atividade(v, a) then
        jsonb_build_object(
          'inicio', lower(b.periodo), 'fim', upper(b.periodo), 'ocupado', true, 'tipo', b.tipo,
          'expira_em', case when b.tipo = 'PRE_RESERVA' then b.expira_em end,
          'atividade_id', a.id, 'numero', a.numero, 'status', a.status, 'origem', a.origem, 'destino', a.destino,
          'propria_empresa', a.empresa_id is not distinct from v.empresa_id,
          'pode_abrir', interno.pode_ver_atividade(v, a))
        || case when v_equipe then jsonb_build_object(
             'empresa_id', a.empresa_id, 'empresa_nome', e.nome, 'motorista_id', b.motorista_id,
             'motorista_nome', pf.nome)
           else '{}'::jsonb end
      else
        jsonb_build_object('inicio', lower(b.periodo), 'fim', upper(b.periodo), 'ocupado', true)
      end as item
    from app.agenda_blocos b
    join app.atividades a on a.id = b.atividade_id
    join app.empresas e on e.id = a.empresa_id
    left join app.perfis pf on pf.usuario_id = b.motorista_id
    where interno.bloco_ocupa(b)
      and b.periodo && tstzrange(p_de, p_ate, '[)')
      and (v_equipe or a.empresa_id = v.empresa_id or b.motorista_id = v_motorista)
    order by lower(b.periodo), b.id
    limit 2000
  ) x;
  return jsonb_build_object('ok', true, 'blocos', blocos);
end $$;

------------------------------------------------------------------------------------------------
-- 4. R2 — teto do cálculo. A função original vira interno.calcular_linhas_sem_teto; interno.calcular_linhas (mesma
--    assinatura, chamada por calcular_orcamento/enviar_orcamento) captura estouro numérico e limita o total.
------------------------------------------------------------------------------------------------
alter function interno.calcular_linhas(app.contratos_versoes, boolean, boolean, app.modalidade, jsonb)
  rename to calcular_linhas_sem_teto;

create function interno.calcular_linhas(c app.contratos_versoes, p_levar boolean, p_trazer boolean,
                                        p_modalidade app.modalidade, e jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  teto_cent constant bigint := 100000000000;  -- R$ 1 bilhão
  r jsonb;
begin
  begin
    r := interno.calcular_linhas_sem_teto(c, p_levar, p_trazer, p_modalidade, e);
  exception when numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'codigo', 'VALOR_FORA_DO_LIMITE');
  end;
  if (r ->> 'ok')::boolean and (r ->> 'total_cent')::numeric > teto_cent then
    return jsonb_build_object('ok', false, 'codigo', 'VALOR_FORA_DO_LIMITE');
  end if;
  return r;
end $$;

------------------------------------------------------------------------------------------------
-- 5. R3 — teto da auditoria de negações por usuário (300 por hora). Sem usuário (sistema) audita sempre.
------------------------------------------------------------------------------------------------
create or replace function interno.negar(p_acao text, p_alvo text, p_codigo text, p_detalhe jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  teto constant int := 300;
  v_uid uuid := (select auth.uid());
  v_n int;
begin
  if v_uid is null then
    perform interno.auditar(p_acao, p_alvo, 'NEGADO', p_codigo, p_detalhe);
  else
    insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
    values (v_uid, 'NEGACOES_AUDITADAS', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1)
    on conflict (usuario_id, acao, janela_inicio) do update set contagem = interno.limites.contagem + 1
    returning contagem into v_n;
    if v_n <= teto then
      perform interno.auditar(p_acao, p_alvo, 'NEGADO', p_codigo, p_detalhe);
    elsif v_n = teto + 1 then
      perform interno.auditar('AUDITORIA_LIMITADA', 'auditoria', 'NEGADO', 'LIMITE_EXCEDIDO',
        jsonb_build_object('acao', p_acao, 'teto_por_hora', teto));
    end if;
  end if;
  return jsonb_build_object('ok', false, 'codigo', p_codigo);
end $$;

create or replace function interno.negar(p_acao text, p_alvo text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return interno.negar(p_acao, p_alvo, p_codigo, null::jsonb);
end $$;

------------------------------------------------------------------------------------------------
-- 6. Privilégios (create or replace mantém os existentes; as funções novas nascem fechadas).
------------------------------------------------------------------------------------------------
revoke execute on function
  interno.orcamento_anterior(app.perfis, app.atividades),
  interno.calcular_linhas(app.contratos_versoes, boolean, boolean, app.modalidade, jsonb),
  interno.calcular_linhas_sem_teto(app.contratos_versoes, boolean, boolean, app.modalidade, jsonb),
  interno.negar(text, text, text),
  interno.negar(text, text, text, jsonb)
from public, anon, authenticated;
