-- Fase 4.1, Ruling F4 (docs/fases/fase-4-1-categorias-paradas-desenho.md §5): em ida e volta, o km é a ida pelas paradas
-- mais a volta direta; o cliente manda os dois trechos e o servidor confere a soma.
--   * api.categorias_disponiveis aceita `km_volta` (opcional; número de 0 a 5000, 1 casa, a mesma regra de `km`; nulo =
--     ausente). Em ida e volta (levar e trazer), com km_volta o km do preço é km + km_volta, como o cálculo do motorista
--     (que manda o total); sem km_volta, continua o dobro de km. Em trecho único, km_volta é ignorado (não recusado).
-- Compatibilidade: sem km_volta nada muda (resultado e recusas iguais). Mesma assinatura ("create or replace" mantém os
-- privilégios). Corpo de 20261022120000_categorias_tarifas.sql (20261022120100 não o redefiniu).

------------------------------------------------------------------------------------------------
-- Cliente (N1/N2): categorias ativas do banco com disponibilidade e preço estimado.
--    Entrada: {km (um trecho, 0 a 5000, 1 casa), levar, trazer, km_volta? (0 a 5000, 1 casa; só em ida e volta),
--    paradas? (0 a 3), horas? (0,5 a 24, de 0,5 em 0,5)}.
--    Disponível = (veículo do cliente e há motorista ativo) ou (veículo ATIVO do motorista que atende), E a versão
--    vigente tem tarifa da categoria ou ela é uma das três de antes da 4.1 (que caem no preço de hoje). Uma categoria
--    criada depois da última publicação fica "Indisponível no momento". Preço por interno.linhas_para_categoria; total 0
--    deixa a categoria indisponível, salvo a por hora sem `horas` na entrada (disponível, preço pendente). Cada categoria traz ainda carga, reboque, veiculo_cliente, cobra_hora e
--    cobra_parada (Ruling F1).
------------------------------------------------------------------------------------------------
create or replace function api.categorias_disponiveis(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  v_mot uuid := interno.motorista_padrao();
  e jsonb;
  r jsonb;
  k record;
  t app.tarifas_categoria;
  v_disp boolean;
  saida jsonb := '[]';
begin
  if not (select app.pode_fazer('PREVIA_ORCAMENTO')) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('CATEGORIAS', 300, interval '1 hour') then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('km', 'km_volta', 'levar', 'trazer', 'paradas', 'horas'))
     or coalesce(jsonb_typeof(p -> 'km'), 'null') <> 'number'
     or not coalesce(case when (p ->> 'km') ~ '^[0-9]{1,4}(\.[0-9])?$' then (p ->> 'km')::numeric <= 5000 end, false)
     or (coalesce(jsonb_typeof(p -> 'km_volta'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'km_volta') = 'number' and (p ->> 'km_volta') ~ '^[0-9]{1,4}(\.[0-9])?$'
                               then (p ->> 'km_volta')::numeric <= 5000 end, false))
     or not coalesce(case when jsonb_typeof(p -> 'levar') = 'boolean' and jsonb_typeof(p -> 'trazer') = 'boolean'
                          then (p ->> 'levar')::boolean or (p ->> 'trazer')::boolean end, false)
     or (coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null'
         and not coalesce(jsonb_typeof(p -> 'paradas') = 'number' and (p ->> 'paradas') ~ '^[0-3]$', false))
     or (coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null'
         and not coalesce(case when jsonb_typeof(p -> 'horas') = 'number' and (p ->> 'horas') ~ '^[0-9]{1,2}(\.[0-9]{1,6})?$'
                               then (p ->> 'horas')::numeric between 0.5 and 24
                                    and (p ->> 'horas')::numeric * 2 = trunc((p ->> 'horas')::numeric * 2) end, false)) then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c.id is null then
    return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, 'SEM_CONTRATO');
  end if;
  -- Ida e volta: com km_volta, a ida (pelas paradas) + a volta direta; sem, o dobro de km (como antes). Trecho único:
  -- só km (km_volta ignorado).
  e := jsonb_build_object('km',
         case when not ((p ->> 'levar')::boolean and (p ->> 'trazer')::boolean) then (p ->> 'km')::numeric
              when coalesce(jsonb_typeof(p -> 'km_volta'), 'null') <> 'null'
                then (p ->> 'km')::numeric + (p ->> 'km_volta')::numeric
              else (p ->> 'km')::numeric * 2 end);
  if coalesce(jsonb_typeof(p -> 'paradas'), 'null') <> 'null' then
    e := e || jsonb_build_object('paradas', (p ->> 'paradas')::int);
  end if;
  if coalesce(jsonb_typeof(p -> 'horas'), 'null') <> 'null' then
    e := e || jsonb_build_object('horas', (p ->> 'horas')::numeric);
  end if;

  for k in select * from app.categorias x where x.ativa order by x.ordem, x.codigo loop
    select * into t from app.tarifas_categoria x where x.contrato_id = c.id and x.categoria = k.codigo;
    v_disp := v_mot is not null
              and (k.veiculo_cliente or interno.veiculo_atende(v_mot, k.codigo) is not null)
              and (t.contrato_id is not null or k.codigo in ('PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA'));
    r := null;
    if v_disp then
      r := interno.linhas_para_categoria(c, (p ->> 'levar')::boolean, (p ->> 'trazer')::boolean, k.codigo, e);
      if not (r ->> 'ok')::boolean then
        if r ->> 'codigo' <> 'VALOR_INVALIDO' then
          return interno.negar('CATEGORIAS_DISPONIVEIS', 'empresa:' || v.empresa_id, r ->> 'codigo');
        end if;
        -- Total 0: só fica disponível (preço pendente) a categoria por hora quando as horas não vieram; senão a tarifa
        -- nunca dá preço para esta entrada e a categoria fica "Indisponível no momento".
        v_disp := coalesce(t.hora_cent > 0, false) and coalesce(jsonb_typeof(p -> 'horas'), 'null') = 'null';
        r := null;
      end if;
    end if;
    saida := saida || jsonb_build_array(jsonb_build_object(
      'codigo', k.codigo, 'nome', k.nome, 'descricao_curta', k.descricao_curta, 'carga', k.carga, 'reboque', k.reboque,
      'veiculo_cliente', k.veiculo_cliente, 'disponivel', v_disp,
      'cobra_hora', coalesce(t.hora_cent > 0, false), 'cobra_parada', coalesce(t.parada_cent > 0, false),
      'total_cent', r -> 'total_cent', 'linhas', r -> 'linhas'));
  end loop;
  return jsonb_build_object('ok', true, 'categorias', saida);
end $$;
