-- Fase 4, Tarefa 11 (especificação §6.7, "Categorias e preços"): leitura do ADM para a tela nova. A Tarefa 1 criou só
-- as escritas (salvar_categoria, publicar_contrato_categorias); categorias_disponiveis é do cliente e esconde as
-- inativas. Esta migration usa o número que o Ruling R6 reservou para "corridas do mês", que não foi preciso:
-- api.meus_pedidos já devolve ao motorista o total aprovado das corridas concluídas.
--   * api.categorias_adm(p_empresa, p_versao): todas as categorias (ativas ou não) e, com p_versao, o preço por
--     categoria daquela versão do contrato (da empresa, ou da tabela modelo com p_empresa nulo). `precos` nulo quer
--     dizer versão sem preço por categoria (as publicadas antes da fase 4): cada categoria cai nos campos de hoje.
-- Só acrescenta uma função de leitura.

create function api.categorias_adm(p_empresa uuid default null, p_versao int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_precos jsonb;
begin
  if not (select app.pode_fazer('GERIR_CONTRATOS')) then
    return interno.negar('CATEGORIAS_ADM', 'categoria', 'SEM_PERMISSAO');
  end if;
  if p_versao is not null then
    select c.id into v_id from app.contratos_versoes c
     where c.versao = p_versao and ((p_empresa is null and c.empresa_id is null) or c.empresa_id = p_empresa);
    if v_id is null then
      return interno.negar('CATEGORIAS_ADM', 'contrato:' || coalesce(p_empresa::text, 'modelo'), 'NAO_ENCONTRADO');
    end if;
    select jsonb_object_agg(x.categoria, jsonb_build_object('km_cent', x.km_cent, 'taxa_fixa_cent', x.taxa_fixa_cent))
      into v_precos
      from app.contratos_categorias x where x.contrato_id = v_id;
  end if;
  return jsonb_build_object('ok', true,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nome', k.nome,
                                                                'descricao_curta', k.descricao_curta,
                                                                'ordem', k.ordem, 'ativa', k.ativa)
                                             order by k.ordem, k.codigo)
                              from app.categorias k), '[]'::jsonb),
    'precos', v_precos);
end $$;

revoke all on function api.categorias_adm(uuid, int) from public, anon, authenticated, service_role;
grant execute on function api.categorias_adm(uuid, int) to authenticated;
