-- Porta da Edge Function definir-senha: troca de senha só logo após link (convite/recuperação) ou com
-- reautenticação recente (e aal2 se houver fator verificado). Decide pelo `amr` do JWT do chamador.
create function api.autorizar_definir_senha()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_amr jsonb := case when jsonb_typeof(coalesce((select auth.jwt()), '{}'::jsonb) -> 'amr') = 'array'
                      then (select auth.jwt()) -> 'amr' else '[]'::jsonb end;
  v_link boolean;
  v_senha boolean;
  v_fator boolean;
begin
  if v_uid is null or not exists (select 1 from app.perfis pf where pf.usuario_id = v_uid and pf.ativo) then
    return interno.negar('AUTORIZAR_DEFINIR_SENHA', 'usuario', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('DEFINIR_SENHA', 10, interval '1 hour') then
    return interno.negar('AUTORIZAR_DEFINIR_SENHA', 'usuario', 'LIMITE_EXCEDIDO');
  end if;

  select
    coalesce(bool_or(e ->> 'method' in ('invite', 'recovery', 'otp', 'magiclink')
      and case when e ->> 'timestamp' ~ '^[0-9]{1,12}$' then to_timestamp((e ->> 'timestamp')::bigint) end
          >= now() - interval '15 minutes'), false),
    coalesce(bool_or(e ->> 'method' in ('password', 'totp')
      and case when e ->> 'timestamp' ~ '^[0-9]{1,12}$' then to_timestamp((e ->> 'timestamp')::bigint) end
          >= now() - interval '5 minutes'), false)
  into v_link, v_senha
  from jsonb_array_elements(v_amr) e
  where jsonb_typeof(e) = 'object';

  if v_link then
    perform interno.auditar('AUTORIZAR_DEFINIR_SENHA', 'usuario:' || v_uid, 'OK', null, jsonb_build_object('via', 'link'));
    return jsonb_build_object('ok', true);
  end if;

  v_fator := exists (select 1 from auth.mfa_factors f
                     where f.user_id = v_uid and f.factor_type::text = 'totp' and f.status::text = 'verified');
  if v_senha and (not v_fator or v_claims ->> 'aal' = 'aal2') then
    perform interno.auditar('AUTORIZAR_DEFINIR_SENHA', 'usuario:' || v_uid, 'OK', null, jsonb_build_object('via', 'senha'));
    return jsonb_build_object('ok', true);
  end if;

  return interno.negar('AUTORIZAR_DEFINIR_SENHA', 'usuario:' || v_uid, 'REAUTENTICACAO_NECESSARIA');
end $$;

revoke all on function api.autorizar_definir_senha() from public, anon;
grant execute on function api.autorizar_definir_senha() to authenticated;

-- Logos: o DELETE também exige o padrão <uuid>/logo.(png|webp).
drop policy logos_apagar on storage.objects;
create policy logos_apagar on storage.objects for delete to authenticated
using (
  bucket_id = 'logos'
  and (select app.pode_fazer('GERIR_EMPRESAS'))
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.(png|webp)$'
);
