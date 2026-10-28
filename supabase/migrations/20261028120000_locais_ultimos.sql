-- v2.2.1: "Últimos lugares" no De/Para. Com o texto vazio (o campo acabou de receber o foco), os locais da empresa vêm
-- dos usados por último para os mais antigos (app.locais_empresa.ultimo_uso, atualizado por interno.guardar_local a
-- cada api.criar_pedido). Com texto, a ordem continua a de antes (mais usados primeiro). Corpo copiado de
-- 20261015140000_termos_google.sql; só a ordem muda. Mesma assinatura: as permissões (grants) ficam como estão.
create or replace function api.locais_da_empresa(p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  t text;
begin
  if v.usuario_id is null or v.papel <> 'CLIENTE' or v.empresa_id is null then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'SEM_PERMISSAO');
  end if;
  if char_length(coalesce(p_texto, '')) > 120 then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('LOCAIS_DA_EMPRESA', 600, interval '1 hour') then
    return interno.negar('LOCAIS_DA_EMPRESA', 'locais', 'LIMITE_EXCEDIDO');
  end if;
  -- Curingas do LIKE viram texto comum.
  t := replace(replace(replace(interno.sem_acento(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_');
  -- v2.2.1: sem texto, os últimos usados primeiro; com texto, os mais usados (as duas primeiras chaves ficam nulas).
  return jsonb_build_object('ok', true, 'locais', coalesce((
    select jsonb_agg(jsonb_build_object('nome', l.nome, 'lat', l.lat, 'lng', l.lng, 'place_id', l.place_id)
                     order by case when t = '' then l.ultimo_uso end desc, case when t = '' then l.id end desc,
                              l.usos desc, l.ultimo_uso desc, l.id)
    from (select x.* from app.locais_empresa x
          where x.empresa_id = v.empresa_id
            and (t = '' or interno.sem_acento(x.nome) like '%' || t || '%')
          order by case when t = '' then x.ultimo_uso end desc, case when t = '' then x.id end desc,
                   x.usos desc, x.ultimo_uso desc, x.id
          limit 5) l), '[]'::jsonb));
end $$;
