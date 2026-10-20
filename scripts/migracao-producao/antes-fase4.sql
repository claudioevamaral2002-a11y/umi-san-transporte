-- Estado de produção antes da fase 4 (banco com as migrations até a fase 3B, já sobre antes.sql): um pedido do
-- cliente da Umi San orçado pelo motorista, pelas RPCs de hoje (o app atual). Assim as migrations da fase 4 (colunas
-- novas em app.atividades, restrições, novas versões de api.pedido e do orçamento) rodam sobre dados de verdade, e
-- depois.sql confere que o pedido sobreviveu igual. Usado só pelo CI (Ruling R18).
do $$
declare
  r jsonb;
  v_id uuid;
begin
  -- Cliente N1 da Umi San (cli@prod.local) cria o pedido para daqui a 3 dias.
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2',
    'role', 'authenticated', 'aal', 'aal1')::text, true);
  r := api.criar_pedido(jsonb_build_object(
    'duracao_min', 60, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
    'carga', 'PESSOAS', 'pessoas_qtd', 2, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
    'inicio', to_char((date_trunc('hour', now()) + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'criar_pedido falhou na semente da fase 4: %', r;
  end if;
  v_id := (r ->> 'id')::uuid;

  -- Motorista (mot@prod.local) envia o orçamento: 10 km a R$ 3,50 + retorno de 50% = R$ 52,50.
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f3',
    'role', 'authenticated', 'aal', 'aal2')::text, true);
  r := api.enviar_orcamento(v_id, '{"km": 10}'::jsonb, null);
  if not coalesce((r ->> 'ok')::boolean, false) or (r ->> 'total_cent')::bigint <> 5250 then
    raise exception 'enviar_orcamento falhou na semente da fase 4: %', r;
  end if;
end $$;
