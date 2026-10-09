-- Fase 2A, Task 3 (complemento): calendário do mês numa única consulta (sem uma chamada de horarios_livres por dia).
-- api.dias_do_mes(p_mes, p_duracao_min): para cada dia do mês que contém p_mes (America/Sao_Paulo):
--   livre           = há ao menos um início livre (mesmas regras de api.horarios_livres);
--   dia_cheio       = dia com inícios no futuro, nenhum livre (dia passado: livre = dia_cheio = false);
--   meus            = pedidos em andamento visíveis ao perfil (mesmo escopo de api.meus_pedidos) que começam no dia —
--                     SOLICITADA/ORCADA no prazo, AGENDADA, EM_ANDAMENTO, CONCLUIDA;
--   aguardando_voce = desses, os que esperam uma ação deste usuário (cliente: ORCADA que pode decidir; motorista:
--                     SOLICITADA atribuída; ADM: SOLICITADA e ORCADA; gestor de frota: nenhum);
--   ocupado         = algum bloco ocupando a agenda no dia (cliente: os da empresa e os do motorista de pedidos novos).
-- Só contagens: nada de outra empresa além de "ocupado". pode_abrir da agenda já usa interno.pode_ver_atividade,
-- a mesma checagem de api.pedido.

create function api.dias_do_mes(p_mes date, p_duracao_min int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_equipe boolean;
  v_motorista uuid;
  v_ini date;
  v_fim date;
  v_dias jsonb;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('DIAS_DO_MES', 'agenda', 'SEM_PERMISSAO');
  end if;
  if p_mes is null or p_duracao_min is null or p_duracao_min not between 30 and 1440 then
    return interno.negar('DIAS_DO_MES', 'agenda', 'CAMPOS_INVALIDOS',
      jsonb_build_object('invalidos', jsonb_build_array(case when p_mes is null then 'p_mes' else 'p_duracao_min' end)));
  end if;
  v_motorista := interno.motorista_padrao();
  if v_motorista is null then
    return interno.negar('DIAS_DO_MES', 'agenda', 'SEM_MOTORISTA');
  end if;
  v_equipe := v.papel in ('ADM', 'GESTOR_FROTA', 'MOTORISTA');
  v_ini := date_trunc('month', p_mes)::date;
  v_fim := (v_ini + interval '1 month')::date;

  with dias as (
    select g::date as dia,
           (g::date + time '00:00') at time zone 'America/Sao_Paulo' as dia_ini,
           ((g::date + 1) + time '00:00') at time zone 'America/Sao_Paulo' as dia_fim
    from generate_series(v_ini::timestamp, (v_fim - 1)::timestamp, interval '1 day') g
  ), candidatos as (
    select d.dia, ((d.dia + time '05:00') + make_interval(mins => 30 * i)) at time zone 'America/Sao_Paulo' as ini
    from dias d cross join generate_series(0, 34) i
  ), inicios as (
    select c.dia,
           not exists (
             select 1 from app.agenda_blocos b
              where b.motorista_id = v_motorista and interno.bloco_ocupa(b)
                and b.periodo && tstzrange(c.ini, c.ini + make_interval(mins => p_duracao_min), '[)')) as vago
    from candidatos c
    where c.ini > now() and c.ini <= now() + interval '366 days'
  ), por_dia as (
    select x.dia, count(*) as futuros, count(*) filter (where x.vago) as vagos
    from inicios x group by x.dia
  ), pedidos as (
    select (a.inicio at time zone 'America/Sao_Paulo')::date as dia,
           count(*) as meus,
           count(*) filter (where
             (a.status = 'ORCADA' and (v.papel = 'ADM' or interno.pode_decidir(v, a)))
             or (a.status = 'SOLICITADA' and (v.papel = 'ADM' or (v.papel = 'MOTORISTA' and a.motorista_id = v.usuario_id)))
           ) as aguardando
    from app.atividades a
    where a.inicio >= (v_ini + time '00:00') at time zone 'America/Sao_Paulo'
      and a.inicio < (v_fim + time '00:00') at time zone 'America/Sao_Paulo'
      and a.status in ('SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA')
      and (v_equipe or a.empresa_id = v.empresa_id)
      and interno.pode_ver_atividade(v, a)
      and not interno.prazo_vencido(a.id)
    group by 1
  ), ocupados as (
    select d.dia
    from dias d
    where exists (
      select 1 from app.agenda_blocos b join app.atividades a on a.id = b.atividade_id
       where interno.bloco_ocupa(b)
         and b.periodo && tstzrange(d.dia_ini, d.dia_fim, '[)')
         and (v_equipe or a.empresa_id = v.empresa_id or b.motorista_id = v_motorista))
  )
  select jsonb_agg(jsonb_build_object(
           'dia', d.dia,
           'livre', coalesce(s.vagos, 0) > 0,
           'dia_cheio', coalesce(s.futuros, 0) > 0 and coalesce(s.vagos, 0) = 0,
           'meus', coalesce(p.meus, 0),
           'aguardando_voce', coalesce(p.aguardando, 0),
           'ocupado', o.dia is not null) order by d.dia)
    into v_dias
    from dias d
    left join por_dia s on s.dia = d.dia
    left join pedidos p on p.dia = d.dia
    left join ocupados o on o.dia = d.dia;

  return jsonb_build_object('ok', true, 'mes', v_ini, 'duracao_min', p_duracao_min, 'dias', v_dias);
end $$;

revoke all on function api.dias_do_mes(date, int) from public, anon, authenticated, service_role;
grant execute on function api.dias_do_mes(date, int) to authenticated;
