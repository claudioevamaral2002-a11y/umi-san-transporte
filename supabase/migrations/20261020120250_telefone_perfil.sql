-- Fase 4, Tarefa 11 (Ruling R15): o telefone do próprio perfil. Nenhuma RPC gravava app.perfis.telefone, então o
-- "Ligar" do acompanhamento (api.pedido.motorista_telefone, migration 20261020120200) nunca aparecia.
--   * api.salvar_meu_telefone(p_telefone): qualquer usuário que acessa o app (app.pode_acessar), só o próprio perfil.
--     Formato brasileiro: DDD (sem zero) + número, 10 dígitos (fixo) ou 11 (celular, começa com 9), depois de tirar
--     espaços, parênteses, pontos, hífens e um "+55" inicial. Gravado só com os dígitos. Nulo ou vazio apaga.
--   * api.meu_telefone(): o telefone gravado (para a tela "Perfil e segurança" do app novo).
-- Só acrescenta funções: o app atual não muda.

create function interno.normalizar_telefone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  d text;
begin
  if p is null or length(p) > 25 or btrim(p) !~ '^(\+55)?[0-9() .-]*$' then
    return null;
  end if;
  d := regexp_replace(regexp_replace(btrim(p), '^\+55', ''), '[^0-9]', '', 'g');
  if d ~ '^[1-9][1-9](9[0-9]{8}|[2-8][0-9]{7})$' then
    return d;
  end if;
  return null;
end $$;

create function api.salvar_meu_telefone(p_telefone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  v_novo text;
begin
  if v.usuario_id is null then
    return interno.negar('SALVAR_TELEFONE', 'usuario', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('SALVAR_TELEFONE', 30, interval '1 hour') then
    return interno.negar('SALVAR_TELEFONE', 'usuario:' || v.usuario_id, 'LIMITE_EXCEDIDO');
  end if;
  if nullif(btrim(coalesce(p_telefone, '')), '') is not null then
    v_novo := interno.normalizar_telefone(p_telefone);
    if v_novo is null then
      return interno.negar('SALVAR_TELEFONE', 'usuario:' || v.usuario_id, 'TELEFONE_INVALIDO');
    end if;
  end if;
  update app.perfis set telefone = v_novo where usuario_id = v.usuario_id;
  perform interno.auditar('SALVAR_TELEFONE', 'usuario:' || v.usuario_id, 'OK', null,
    jsonb_build_object('apagou', v_novo is null));
  return jsonb_build_object('ok', true, 'telefone', v_novo);
end $$;

create function api.meu_telefone()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
begin
  if v.usuario_id is null then
    return interno.negar('MEU_TELEFONE', 'usuario', 'SEM_PERMISSAO');
  end if;
  return jsonb_build_object('ok', true, 'telefone', nullif(btrim(coalesce(v.telefone, '')), ''));
end $$;

revoke execute on function interno.normalizar_telefone(text) from public, anon, authenticated;
revoke all on function
  api.salvar_meu_telefone(text),
  api.meu_telefone()
from public, anon, authenticated, service_role;
grant execute on function
  api.salvar_meu_telefone(text),
  api.meu_telefone()
to authenticated;
