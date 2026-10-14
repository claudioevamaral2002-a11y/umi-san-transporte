-- Fase 3A (docs/fases/fase-3a-desenho-enderecos-previa.md §4 item 5 e §5): prévia do orçamento em "Confira o pedido".
--   Só cliente N1 e N2. Usa o contrato vigente AGORA da empresa de quem chama (a mesma regra de api.calcular_orcamento)
--   e interno.calcular_linhas, com km e reboque (veículo próprio); o resto do orçamento é do motorista.
--   Nunca grava orçamento. Recusas auditadas (Adendo A2).

------------------------------------------------------------------------------------------------
-- 1. Permissão (corpo de 20261009140000_saldo_livro_razao.sql com PREVIA_ORCAMENTO).
------------------------------------------------------------------------------------------------
create or replace function app.pode_fazer(acao text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or acao is null then return false; end if;
  case acao
    when 'GERIR_USUARIOS', 'GERIR_EMPRESAS', 'VER_AUDITORIA', 'GERIR_CONTRATOS', 'LANCAR_SALDO', 'GERIR_CONFIGURACAO',
         'VER_PAINEL_ADM' then
      return v.papel = 'ADM';
    when 'GERIR_EQUIPE_EMPRESA' then
      return v.papel = 'CLIENTE' and v.nivel = 1 and v.empresa_id is not null;
    when 'VER_AGENDA_FROTA' then
      return v.papel in ('ADM', 'GESTOR_FROTA');
    when 'CRIAR_PEDIDO', 'PREVIA_ORCAMENTO' then
      return v.papel = 'CLIENTE' and v.nivel in (1, 2) and v.empresa_id is not null;
    when 'ORCAR_PEDIDO' then
      return v.papel in ('ADM', 'MOTORISTA');
    else
      return false;
  end case;
end $$;

------------------------------------------------------------------------------------------------
-- 2. Prévia. Entrada: {km (da rota, um trecho: 0 a 5000, 1 casa), usa_reboque (opcional), levar, trazer, modalidade}.
--    Com Levar e Trazer o km do orçamento é ida e volta: a prévia usa o dobro do km da rota.
--    Saída: a de interno.calcular_linhas ({ok, modalidade, linhas, total_cent}).
------------------------------------------------------------------------------------------------
create function api.previa_orcamento(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  e jsonb;
  r jsonb;
begin
  if not (select app.pode_fazer('PREVIA_ORCAMENTO')) then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('PREVIA_ORCAMENTO', 300, interval '1 hour') then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('km', 'usa_reboque', 'levar', 'trazer', 'modalidade'))
     or coalesce(jsonb_typeof(p -> 'km'), 'null') <> 'number'
     or not coalesce(case when (p ->> 'km') ~ '^[0-9]{1,4}(\.[0-9])?$' then (p ->> 'km')::numeric <= 5000 end, false)
     or coalesce(jsonb_typeof(p -> 'usa_reboque'), 'boolean') not in ('boolean', 'null')
     or not coalesce(case when jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
                          then (p ->> 'levar')::boolean or (p ->> 'trazer')::boolean end, false)
     or coalesce(p ->> 'modalidade', '') not in ('VEICULO_PROPRIO', 'VEICULO_CLIENTE') then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa:' || v.empresa_id, 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  -- Só km e reboque (no veículo próprio); no veículo do cliente as diárias são do motorista.
  e := case when p ->> 'modalidade' = 'VEICULO_PROPRIO'
            then jsonb_build_object('km', (p ->> 'km')::numeric
                                          * case when (p ->> 'levar')::boolean and (p ->> 'trazer')::boolean then 2 else 1 end,
                                    'usa_reboque', coalesce((p ->> 'usa_reboque')::boolean, false))
            else '{}'::jsonb end;
  r := interno.calcular_linhas(c, (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean,
                               (p ->> 'modalidade')::app.modalidade, e);
  if not (r ->> 'ok')::boolean then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa:' || v.empresa_id, r ->> 'codigo');
  end if;
  return r;
end $$;

revoke all on function api.previa_orcamento(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.previa_orcamento(jsonb) to authenticated;
