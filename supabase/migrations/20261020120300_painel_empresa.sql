-- Fase 4, Tarefa 14 (docs/fases/fase-4-ivo-estilo-uber-desenho.md §6.9): "Painel da empresa", no computador, para o
-- Administrador da empresa cliente (N1) e o Master (ADM).
--   * app.configuracao ganha `contato_recarga` (texto até 60, opcional): o telefone ou WhatsApp que o painel mostra em
--     "Para recarregar, fale com a IVO". O ADM edita em Configurações (api.definir_contato_recarga); ler_configuracao
--     passa a devolvê-lo (o tipo de retorno muda: drop e create, com os mesmos privilégios).
--   * api.painel_empresa(p_empresa, p_mes): só leitura. O N1 vê só a própria empresa (p_empresa é ignorado); o ADM informa
--     a empresa. Os outros recebem SEM_PERMISSAO, auditado. p_mes nulo = mês atual no fuso de São Paulo. Devolve
--     {ok, resumo, proximas, recentes, do_mes, pessoas}:
--       - gasto_cent = cobranças do mês (DEBITO, MULTA e ADITIVO) menos os ESTORNOS dessas cobranças no mês;
--       - total_mes_cent = saldo contábil no 1º dia às 00:00 + RECARGAS do mês + limite de crédito do contrato vigente;
--       - reservado_cent e disponivel_cent = os de agora (interno.saldos);
--       - proximas = até 10 pedidos SOLICITADA, ORCADA ou AGENDADA, por início crescente;
--       - recentes = até 10 pedidos EM_ANDAMENTO, CONCLUIDA, CANCELADA, RECUSADA, REPROVADA ou EXPIRADA dos últimos
--         30 dias, por início decrescente;
--       - valor_cent: do orçamento aprovado, senão do pendente; no cancelado, o da MULTA. `estimado` = ainda sem valor
--         num pedido que ainda vai acontecer (a tela mostra "a orçar");
--       - do_mes = as corridas do mês (por início) que podem ter cobrança: EM_ANDAMENTO, CONCLUIDA e CANCELADA, até
--         1000, para o "Exportar CSV do mês" (conferir a fatura por centro de custo);
--       - sem_corridas = N1 e N2 ativos sem pedido criado nos últimos 90 dias;
--       - convites_pendentes = convites não usados e não vencidos: o convite ainda sem usuário de menos de 24 h (a
--         validade do link) e o convidado que ainda não criou a senha e tem um link de acesso válido. O convite usado
--         ao gerar o link (o usuário nasce com `senha_pendente`) conta enquanto o link valer.
-- Só acrescenta.

------------------------------------------------------------------------------------------------
-- 1. Contato de recarga (Configurações).
------------------------------------------------------------------------------------------------
alter table app.configuracao
  add column contato_recarga text check (contato_recarga is null or char_length(contato_recarga) between 1 and 60);

create function api.definir_contato_recarga(p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  anterior text;
  v_texto text := nullif(btrim(p_texto), '');
begin
  if not (select app.pode_fazer('GERIR_CONFIGURACAO')) then
    return interno.negar('DEFINIR_CONTATO_RECARGA', 'configuracao', 'SEM_PERMISSAO');
  end if;
  if char_length(v_texto) > 60 then
    return interno.negar('DEFINIR_CONTATO_RECARGA', 'configuracao', 'CAMPOS_INVALIDOS');
  end if;
  select c.contato_recarga into anterior from app.configuracao c where c.id for update;
  insert into app.configuracao (id, contato_recarga, alterado_por)
  values (true, v_texto, (select auth.uid()))
  on conflict (id) do update set contato_recarga = excluded.contato_recarga,
                                 alterado_por = excluded.alterado_por, alterado_em = now();
  perform interno.auditar('DEFINIR_CONTATO_RECARGA', 'configuracao', 'OK', null,
    jsonb_build_object('anterior', anterior, 'novo', v_texto));
  return jsonb_build_object('ok', true);
end $$;

drop function api.ler_configuracao();
create function api.ler_configuracao()
returns table (retencao_fotos_dias int, alterado_em timestamptz, mapas_teto_diario_empresa int, contato_recarga text)
language sql stable security definer set search_path = '' as $$
  select c.retencao_fotos_dias, c.alterado_em, c.mapas_teto_diario_empresa, c.contato_recarga
  from app.configuracao c
  where (select app.pode_fazer('GERIR_CONFIGURACAO'))
$$;

------------------------------------------------------------------------------------------------
-- 2. Painel da empresa.
------------------------------------------------------------------------------------------------

-- Uma linha das tabelas do painel.
create function interno.painel_pedido(a app.atividades) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'solicitante_nome', p.nome, 'inicio', a.inicio,
    'fim_previsto', interno.fim_da_atividade(a), 'origem', a.origem, 'destino', a.destino,
    'categoria_nome', k.nome, 'centro_custo', a.centro_custo, 'status', a.status,
    'valor_cent', v.valor,
    'estimado', v.valor is null and a.status in ('SOLICITADA', 'ORCADA', 'AGENDADA'))
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

create function api.painel_empresa(p_empresa uuid default null, p_mes date default null)
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

------------------------------------------------------------------------------------------------
-- 3. Privilégios.
------------------------------------------------------------------------------------------------
revoke execute on function interno.painel_pedido(app.atividades) from public, anon, authenticated;
revoke all on function
  api.definir_contato_recarga(text),
  api.ler_configuracao(),
  api.painel_empresa(uuid, date)
from public, anon, authenticated, service_role;
grant execute on function
  api.definir_contato_recarga(text),
  api.ler_configuracao(),
  api.painel_empresa(uuid, date)
to authenticated;
