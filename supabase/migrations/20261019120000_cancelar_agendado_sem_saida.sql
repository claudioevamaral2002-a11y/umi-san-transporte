-- Pedido AGENDADO que chegou ao fim do horário reservado sem o motorista sair (decisão do dono, 19/10/2026):
--   * prazo: início + duração prevista, no mínimo 1 h depois do início. Se o serviço anterior do motorista atrasou
--     (atraso_anterior_ate), o prazo conta a partir dessa hora;
--   * enquanto o motorista tiver outra viagem EM_ANDAMENTO, espera (ele ainda pode estar terminando a anterior);
--   * cancela SEM multa (a falha é do prestador): libera a reserva inteira e passa a CANCELADA, com o motivo
--     no histórico. AGENDADA → EXPIRADA não está em app.transicoes_permitidas (imutável), e "cancelado
--     automaticamente" é o que o dono pediu.
-- Mesma ordem de travas do registrar_saida/cancelar_agendado (pedido, depois a conta), então saída e cancelamento
-- automático se excluem. Só acrescenta função e job: nada que o app atual envia muda.

create function interno.prazo_saida(a app.atividades) returns timestamptz
language sql stable set search_path = '' as $$
  select greatest(a.inicio, coalesce(a.atraso_anterior_ate, a.inicio))
         + greatest(a.duracao_min, 60) * interval '1 minute'
$$;

create function interno.cancelar_agendados_sem_saida() returns int
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  a app.atividades;
  rs app.reservas;
  v_chave uuid;
  n int := 0;
begin
  for x in
    select c.id from app.atividades c
     where c.status = 'AGENDADA' and interno.prazo_saida(c) <= now()
     order by c.inicio
     limit 500
  loop
    -- quem estiver travado (saída em curso) fica para a próxima rodada
    select * into a from app.atividades t where t.id = x.id for no key update skip locked;
    if a.id is null or a.status <> 'AGENDADA' or interno.prazo_saida(a) > now() then
      continue;
    end if;
    if exists (select 1 from app.atividades o
                where o.motorista_id = a.motorista_id and o.status = 'EM_ANDAMENTO') then
      continue;
    end if;

    perform interno.travar_conta(a.empresa_id);
    v_chave := gen_random_uuid();
    select * into rs from app.reservas r where r.atividade_id = a.id and r.ativa for no key update;
    if rs.id is not null then
      update app.reservas set ativa = false, liberada_em = now() where id = rs.id;
      perform interno.inserir_lancamento(a.empresa_id, 'LIBERACAO_RESERVA', rs.valor_cent, a.id, rs.orcamento_id,
                                         rs.id, null, null, null, v_chave);
    end if;
    perform interno.transicionar(a.id, 'CANCELADA',
                                 'Cancelado automaticamente: o motorista não saiu no horário. Reserva devolvida, sem multa.');
    perform interno.auditar('CANCELAR_SEM_SAIDA', 'atividade:' || a.id::text, 'OK', null,
      jsonb_build_object('liberado_cent', coalesce(rs.valor_cent, 0), 'inicio', a.inicio,
                         'prazo', interno.prazo_saida(a)));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function interno.prazo_saida(app.atividades) from public, anon, authenticated, service_role;
revoke all on function interno.cancelar_agendados_sem_saida() from public, anon, authenticated, service_role;

-- Idempotente: cron.schedule com nome substitui o job de mesmo nome.
select cron.schedule('cancelar-sem-saida', '7,22,37,52 * * * *', 'select interno.cancelar_agendados_sem_saida()');
