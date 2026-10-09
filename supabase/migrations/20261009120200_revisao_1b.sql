-- Revisão de segurança da fase 1B (Task 4).
--
-- R1: o gestor da empresa (cliente N1) não substitui convite pendente alheio. preparar_convite apaga o
--     convite pendente do mesmo e-mail antes de criar o novo; sem esta regra um N1 poderia trocar um
--     convite pendente feito pelo ADM (motorista, gestor de frota, ADM ou cliente de outra empresa) por um
--     convite de CLIENTE da própria empresa. Para o N1, convite pendente que não seja CLIENTE da própria
--     empresa responde EMAIL_EM_USO (mesmo código de e-mail já usado; nada é apagado). O ADM segue podendo
--     substituir qualquer convite pendente.
create or replace function api.preparar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid,
                                                p_nivel smallint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_dom jsonb := jsonb_build_object('email_dominio', left(split_part(lower(trim(coalesce(p_email, ''))), '@', 2), 100));
  v_adm boolean := (select app.pode_fazer('GERIR_USUARIOS'));
  v_n1 boolean := (select app.pode_fazer('GERIR_EQUIPE_EMPRESA'));
  v_empresa uuid := p_empresa;
  v_nivel smallint := p_nivel;
  cod text;
  novo uuid;
  antigo uuid;
begin
  if not v_adm and not v_n1 then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO', v_dom);
  end if;
  if not v_adm then
    -- gestor da empresa: só CLIENTE, só a própria empresa (forçada pelo servidor)
    if p_papel is distinct from 'CLIENTE'
       or (p_empresa is not null and p_empresa is distinct from (select (app.pode_acessar()).empresa_id)) then
      return interno.negar('PREPARAR_CONVITE', 'convite', 'SEM_PERMISSAO', v_dom);
    end if;
    v_empresa := (select (app.pode_acessar()).empresa_id);
  end if;
  if not interno.checar_limite('CONVIDAR', 10, interval '1 day') then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'LIMITE_EXCEDIDO', v_dom);
  end if;

  if v_adm and p_papel = 'CLIENTE' and v_nivel is null then
    v_nivel := 1;
  end if;
  if (p_papel = 'CLIENTE' and (v_nivel is null or v_nivel not between 1 and 3))
     or (p_papel is distinct from 'CLIENTE' and v_nivel is not null) then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'CAMPOS_INVALIDOS', v_dom);
  end if;
  cod := interno.checar_convite(v_email, p_nome, p_papel, v_empresa);
  if cod is not null then
    return interno.negar('PREPARAR_CONVITE', 'convite', cod, v_dom);
  end if;

  perform pg_advisory_xact_lock(hashtext('convite:' || v_email));
  if not v_adm and exists (
    select 1 from app.convites c
     where c.email = v_email and c.usado_em is null
       and (c.papel <> 'CLIENTE' or c.empresa_id is distinct from v_empresa)
  ) then
    return interno.negar('PREPARAR_CONVITE', 'convite', 'EMAIL_EM_USO', v_dom);
  end if;
  delete from app.convites where email = v_email and usado_em is null returning id into antigo;
  insert into app.convites (email, nome, papel, empresa_id, nivel, criado_por)
  values (v_email, trim(p_nome), p_papel, v_empresa, v_nivel, (select auth.uid()))
  returning id into novo;

  perform interno.auditar('PREPARAR_CONVITE', 'convite:' || novo, 'OK', null,
    jsonb_build_object('papel', p_papel, 'empresa_id', v_empresa, 'nivel', v_nivel, 'substituiu', antigo,
                       'gestor_empresa', not v_adm));
  return jsonb_build_object('ok', true, 'convite_id', novo, 'email', v_email);
end $$;

-- create or replace mantém os privilégios; reafirmados por clareza.
revoke all on function api.preparar_convite(text, text, app.papel, uuid, smallint) from public, anon, service_role;
grant execute on function api.preparar_convite(text, text, app.papel, uuid, smallint) to authenticated;
