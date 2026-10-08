-- Localiza um ADM ATIVO pelo e-mail (uso do workflow resetar-2fa-adm, via chave de serviço).
-- Só devolve o id quando o e-mail pertence a um ADM ativo; qualquer outro caso é NAO_PERMITIDO.
create function api.sistema_papel_por_email(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  select pf.usuario_id into v_id
  from app.perfis pf join auth.users u on u.id = pf.usuario_id
  where v_email <> '' and lower(trim(u.email)) = v_email and pf.papel = 'ADM' and pf.ativo
  limit 1;
  if v_id is null then
    perform interno.auditar_como(null, 'LOCALIZAR_ADM', 'usuario', 'NEGADO', 'NAO_PERMITIDO', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'NAO_PERMITIDO');
  end if;
  perform interno.auditar_como(v_id, 'LOCALIZAR_ADM', 'usuario:' || v_id, 'OK', null, '{"origem":"sistema"}');
  return jsonb_build_object('ok', true, 'usuario_id', v_id);
end $$;

revoke all on function api.sistema_papel_por_email(text) from public, anon, authenticated;
grant execute on function api.sistema_papel_por_email(text) to service_role;
