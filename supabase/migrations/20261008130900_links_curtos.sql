-- Links curtos de acesso, imunes a pré-visualização (WhatsApp, navegador, varredores de e-mail).
--
-- O link entregue é `${origem}/c/<código>`. Abrir a página não gasta nada: o token de uso único do Auth
-- (hashed_token do generateLink) só é usado quando a pessoa toca em "Continuar" — a Edge Function
-- resgatar-link chama api.sistema_resgatar_link (marca como usado) e então verifyOtp (POST) no servidor.
--
-- Guardamos só o SHA-256 do código (nunca o código em si). Só a service_role chega aqui (via RPC
-- SECURITY DEFINER); anon/authenticated não têm USAGE em interno (guarda 0001).

create table interno.links_acesso (
  codigo_hash text primary key check (codigo_hash ~ '^[0-9a-f]{64}$'),
  token_hash text not null check (length(token_hash) between 16 and 200),
  tipo text not null check (tipo in ('invite', 'recovery')),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '24 hours',
  usado_em timestamptz
);
create index links_acesso_usuario on interno.links_acesso (usuario_id) where usado_em is null;

-- Limite de tentativas de resgate por IP (hash) e janela diária (anônimo: não há auth.uid()).
create table interno.limites_ip (
  ip_hash text not null,
  acao text not null,
  janela_inicio timestamptz not null,
  contagem int not null default 0,
  primary key (ip_hash, acao, janela_inicio)
);

revoke all on interno.links_acesso, interno.limites_ip from public, anon, authenticated;

-- Código de 10 símbolos do alfabeto sem ambiguidade (sem 0/O, 1/I/L): 31^10 ≈ 8·10^14 (~49 bits).
-- Amostragem por rejeição (byte < 248 = 8·31) para não enviesar.
create function interno.gerar_codigo_link() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea;
  b int;
  codigo text := '';
begin
  while length(codigo) < 10 loop
    bytes := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      b := get_byte(bytes, i);
      if b < 248 and length(codigo) < 10 then
        codigo := codigo || substr(alfabeto, (b % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  return codigo;
end $$;

create function interno.hash_texto(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$$;

revoke execute on function interno.gerar_codigo_link(), interno.hash_texto(text) from public, anon, authenticated;

-- Cria o link curto de um token recém-gerado (generateLink) e devolve o código em claro (única vez).
-- Links anteriores ainda não usados da mesma pessoa expiram (o Auth também invalida o token antigo).
create function api.sistema_criar_link_curto(p_token_hash text, p_tipo text, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text;
begin
  if p_token_hash is null or p_token_hash !~ '^[A-Za-z0-9_-]{16,200}$'
     or p_tipo is null or p_tipo not in ('invite', 'recovery')
     or p_usuario is null or not exists (select 1 from auth.users u where u.id = p_usuario)
  then
    perform interno.auditar_como(null, 'CRIAR_LINK_CURTO', 'link', 'NEGADO', 'CAMPOS_INVALIDOS', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS');
  end if;

  update interno.links_acesso set expira_em = least(expira_em, now())
  where usuario_id = p_usuario and usado_em is null;

  loop
    v_codigo := interno.gerar_codigo_link();
    begin
      insert into interno.links_acesso (codigo_hash, token_hash, tipo, usuario_id)
      values (interno.hash_texto(v_codigo), p_token_hash, p_tipo, p_usuario);
      exit;
    exception when unique_violation then
      -- colisão (astronomicamente rara): sorteia outro
    end;
  end loop;

  perform interno.auditar_como(p_usuario, 'CRIAR_LINK_CURTO', 'usuario:' || p_usuario, 'OK', null,
    jsonb_build_object('origem', 'sistema', 'tipo', p_tipo));
  return jsonb_build_object('ok', true, 'codigo_link', v_codigo);
end $$;

-- Resgate atômico (uso único): limite por IP/dia → busca pelo hash com FOR UPDATE → marca usado →
-- devolve token_hash + tipo para o verifyOtp no servidor. Nunca diz se o código existiu e expirou
-- para quem ainda não acertou um código (NAO_ENCONTRADO), mas distingue usado/expirado (EXPIRADO).
create function api.sistema_resgatar_link(p_codigo text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s-]', '', 'g'));
  v_ip_hash text := interno.hash_texto('ip:' || coalesce(nullif(trim(p_ip), ''), 'desconhecido'));
  v_inicio timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_contagem int;
  v_link interno.links_acesso;
begin
  insert into interno.limites_ip (ip_hash, acao, janela_inicio, contagem)
  values (v_ip_hash, 'RESGATAR_LINK', v_inicio, 1)
  on conflict (ip_hash, acao, janela_inicio) do update set contagem = interno.limites_ip.contagem + 1
  returning contagem into v_contagem;
  if v_contagem > 30 then
    -- audita só a primeira recusa do dia (força bruta não enche a auditoria)
    if v_contagem = 31 then
      perform interno.auditar_como(null, 'RESGATAR_LINK', 'link', 'NEGADO', 'LIMITE_EXCEDIDO', '{"origem":"sistema"}');
    end if;
    return jsonb_build_object('ok', false, 'codigo', 'LIMITE_EXCEDIDO');
  end if;

  if v_codigo !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$' then
    perform interno.auditar_como(null, 'RESGATAR_LINK', 'link', 'NEGADO', 'NAO_ENCONTRADO', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'NAO_ENCONTRADO');
  end if;

  select * into v_link from interno.links_acesso where codigo_hash = interno.hash_texto(v_codigo) for update;
  if not found then
    perform interno.auditar_como(null, 'RESGATAR_LINK', 'link', 'NEGADO', 'NAO_ENCONTRADO', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'NAO_ENCONTRADO');
  end if;
  if v_link.usado_em is not null or v_link.expira_em <= now() then
    perform interno.auditar_como(v_link.usuario_id, 'RESGATAR_LINK', 'usuario:' || v_link.usuario_id, 'NEGADO',
      'EXPIRADO', jsonb_build_object('origem', 'sistema', 'usado', v_link.usado_em is not null));
    return jsonb_build_object('ok', false, 'codigo', 'EXPIRADO');
  end if;

  update interno.links_acesso set usado_em = now() where codigo_hash = v_link.codigo_hash;
  perform interno.auditar_como(v_link.usuario_id, 'RESGATAR_LINK', 'usuario:' || v_link.usuario_id, 'OK', null,
    jsonb_build_object('origem', 'sistema', 'tipo', v_link.tipo));
  return jsonb_build_object('ok', true, 'token_hash', v_link.token_hash, 'tipo', v_link.tipo);
end $$;

revoke all on function api.sistema_criar_link_curto(text, text, uuid), api.sistema_resgatar_link(text, text)
  from public, anon, authenticated;
grant execute on function api.sistema_criar_link_curto(text, text, uuid), api.sistema_resgatar_link(text, text)
  to service_role;

-- Registro de falha no verifyOtp depois do resgate (allowlist de ações de sistema).
create or replace function api.sistema_registrar(p_usuario uuid, p_acao text, p_alvo text, p_resultado text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_acao is null
     or p_acao <> all (array['CONVIDAR_LINK', 'GERAR_LINK', 'DESATIVAR_AUTH', 'REATIVAR_AUTH', 'RESETAR_2FA', 'DEFINIR_SENHA',
                             'VERIFICAR_LINK'])
     or p_resultado is null or p_resultado not in ('OK', 'NEGADO', 'ERRO')
     or (p_codigo is not null and p_codigo !~ '^[A-Z][A-Z0-9_]{1,59}$')
  then
    perform interno.auditar_como(p_usuario, 'SISTEMA_REGISTRAR_INVALIDO', null, 'NEGADO', 'CAMPOS_INVALIDOS', '{"origem":"sistema"}');
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS');
  end if;
  perform interno.auditar_como(p_usuario, p_acao, left(p_alvo, 200), p_resultado, p_codigo, '{"origem":"sistema"}');
  return jsonb_build_object('ok', true);
end $$;
