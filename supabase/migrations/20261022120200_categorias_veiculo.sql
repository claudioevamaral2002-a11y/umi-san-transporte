-- Fase 4.1, Tarefa 5: os nomes das categorias para o cadastro e a lista de veículos (motorista e ADM).
-- api.categorias_adm é só do Master (GERIR_CONTRATOS) e api.categorias_disponiveis só do cliente; sem esta leitura o
-- motorista não tinha de onde tirar os nomes atuais. Devolve todas as categorias (também as inativas e a de veículo do
-- cliente, para nomear as etiquetas de um veículo antigo); a tela de cadastro mostra só as ativas que usam veículo da
-- IVO. Só nome e marcações, nenhum preço.
create function api.categorias_veiculo()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null or v.papel not in ('ADM', 'MOTORISTA') then
    return interno.negar('CATEGORIAS_VEICULO', 'categoria', 'SEM_PERMISSAO');
  end if;
  return jsonb_build_object('ok', true,
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', k.codigo, 'nome', k.nome, 'ordem', k.ordem, 'ativa', k.ativa,
                                          'veiculo_cliente', k.veiculo_cliente)
                       order by k.ordem, k.codigo)
        from app.categorias k), '[]'::jsonb));
end $$;

revoke all on function api.categorias_veiculo() from public, anon, authenticated, service_role;
grant execute on function api.categorias_veiculo() to authenticated;
