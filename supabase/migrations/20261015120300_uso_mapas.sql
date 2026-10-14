-- Fase 3A (docs/fases/fase-3a-desenho-enderecos-previa.md §6): cada chamada ao Google feita pela função `enderecos`
-- passa antes por api.registrar_uso_mapas, com o JWT de quem usa:
--   limite por usuário: SUGERIR 60/min, DETALHAR 30/min, ROTA 20/min e 500 por dia;
--   teto por empresa e por dia (America/Sao_Paulo): app.configuracao.mapas_teto_diario_empresa (padrão 2.000), que o ADM
--   ajusta em Configurações. A equipe da IVO (sem empresa) conta no teto 'IVO'.
-- Acima do teto, a função devolve TETO_DIARIO e o app cai no texto livre.

------------------------------------------------------------------------------------------------
-- 1. Teto na configuração global (linha única).
------------------------------------------------------------------------------------------------
alter table app.configuracao
  add column mapas_teto_diario_empresa int not null default 2000
    check (mapas_teto_diario_empresa between 1 and 1000000);

create function api.definir_teto_mapas(p_valor int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  anterior int;
begin
  if not (select app.pode_fazer('GERIR_CONFIGURACAO')) then
    return interno.negar('DEFINIR_TETO_MAPAS', 'configuracao', 'SEM_PERMISSAO');
  end if;
  if p_valor is null or p_valor not between 1 and 1000000 then
    return interno.negar('DEFINIR_TETO_MAPAS', 'configuracao', 'CAMPOS_INVALIDOS');
  end if;
  select c.mapas_teto_diario_empresa into anterior from app.configuracao c where c.id for update;
  insert into app.configuracao (id, mapas_teto_diario_empresa, alterado_por)
  values (true, p_valor, (select auth.uid()))
  on conflict (id) do update set mapas_teto_diario_empresa = excluded.mapas_teto_diario_empresa,
                                 alterado_por = excluded.alterado_por, alterado_em = now();
  perform interno.auditar('DEFINIR_TETO_MAPAS', 'configuracao', 'OK', null,
    jsonb_build_object('anterior', anterior, 'novo', p_valor));
  return jsonb_build_object('ok', true);
end $$;

-- A leitura do ADM ganha o teto (o tipo de retorno muda: drop e create, com os mesmos privilégios).
drop function api.ler_configuracao();
create function api.ler_configuracao()
returns table (retencao_fotos_dias int, alterado_em timestamptz, mapas_teto_diario_empresa int)
language sql stable security definer set search_path = '' as $$
  select c.retencao_fotos_dias, c.alterado_em, c.mapas_teto_diario_empresa
  from app.configuracao c
  where (select app.pode_fazer('GERIR_CONFIGURACAO'))
$$;

------------------------------------------------------------------------------------------------
-- 2. Contagem diária por empresa.
------------------------------------------------------------------------------------------------
create table app.uso_mapas (
  empresa_chave text not null,  -- empresa_id, ou 'IVO' para a equipe
  dia date not null,
  chamadas int not null default 0,
  primary key (empresa_chave, dia)
);
alter table app.uso_mapas enable row level security;
-- Sem GRANT a authenticated: só api.registrar_uso_mapas escreve.

create function api.registrar_uso_mapas(p_tipo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  k text;
  teto int;
  n int;
  maximo int := case p_tipo when 'SUGERIR' then 60 when 'DETALHAR' then 30 when 'ROTA' then 20 end;
begin
  if v.usuario_id is null or (v.papel = 'CLIENTE' and v.empresa_id is null) then
    return interno.negar('USO_MAPAS', 'mapas', 'SEM_PERMISSAO');
  end if;
  if maximo is null then
    return interno.negar('USO_MAPAS', 'mapas', 'CAMPOS_INVALIDOS');
  end if;
  if not interno.checar_limite('MAPAS_' || p_tipo, maximo, interval '1 minute') then
    return interno.negar('USO_MAPAS', 'mapas:' || p_tipo, 'LIMITE_EXCEDIDO');
  end if;
  -- Uma pessoa sozinha não esgota o teto da empresa.
  if not interno.checar_limite('MAPAS_DIA', 500, interval '1 day') then
    return interno.negar('USO_MAPAS', 'mapas:dia', 'LIMITE_EXCEDIDO');
  end if;
  k := case when v.papel = 'CLIENTE' then v.empresa_id::text else 'IVO' end;
  teto := coalesce((select c.mapas_teto_diario_empresa from app.configuracao c where c.id), 2000);
  insert into app.uso_mapas (empresa_chave, dia, chamadas)
  values (k, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (empresa_chave, dia) do update set chamadas = app.uso_mapas.chamadas + 1
  returning chamadas into n;
  if n > teto then
    return interno.negar('USO_MAPAS', 'empresa:' || k, 'TETO_DIARIO');
  end if;
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------------------------
-- 3. Privilégios.
------------------------------------------------------------------------------------------------
revoke all on function
  api.definir_teto_mapas(int),
  api.ler_configuracao(),
  api.registrar_uso_mapas(text)
from public, anon, authenticated, service_role;
grant execute on function
  api.definir_teto_mapas(int),
  api.ler_configuracao(),
  api.registrar_uso_mapas(text)
to authenticated;
