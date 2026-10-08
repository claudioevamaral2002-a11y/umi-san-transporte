-- Núcleo de acesso (fase 1). Ver docs/fases/fase-1-desenho.md §1–§3.

create type app.papel as enum ('ADM', 'MOTORISTA', 'CLIENTE');

create table app.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 120),
  logo_caminho text,
  criada_em timestamptz not null default now()
);

create table app.perfis (
  usuario_id uuid primary key references auth.users (id) on delete restrict,
  nome text not null check (length(trim(nome)) between 2 and 120),
  telefone text,
  papel app.papel not null,
  empresa_id uuid references app.empresas (id),
  ativo boolean not null default true,
  senha_pendente boolean not null default true,
  criado_em timestamptz not null default now(),
  check ((papel = 'CLIENTE') = (empresa_id is not null))
);

create table app.convites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and email like '%@%'),
  nome text not null,
  papel app.papel not null,
  empresa_id uuid references app.empresas (id),
  criado_por uuid references auth.users (id),
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  check ((papel = 'CLIENTE') = (empresa_id is not null))
);
create unique index convites_um_pendente_por_email on app.convites (email) where usado_em is null;

create table app.permissoes_delegadas (
  chave text primary key check (chave in ('MOTORISTA_LANCA_RECARGA', 'MOTORISTA_EDITA_PARAMETROS', 'CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO')),
  ativo boolean not null default false,
  alterado_por uuid references auth.users (id),
  alterado_em timestamptz
);
insert into app.permissoes_delegadas (chave) values
  ('MOTORISTA_LANCA_RECARGA'), ('MOTORISTA_EDITA_PARAMETROS'), ('CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO');

create table app.auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  usuario_id uuid,
  papel app.papel,
  acao text not null,
  alvo text,
  resultado text not null check (resultado in ('OK', 'NEGADO', 'ERRO')),
  codigo text,
  detalhe jsonb,
  ip text,
  dispositivo text
);
create index auditoria_em on app.auditoria (em desc);

create table interno.limites (
  usuario_id uuid not null,
  acao text not null,
  janela_inicio timestamptz not null,
  contagem int not null default 0,
  primary key (usuario_id, acao, janela_inicio)
);

alter table app.empresas enable row level security;
alter table app.perfis enable row level security;
alter table app.convites enable row level security;
alter table app.permissoes_delegadas enable row level security;
alter table app.auditoria enable row level security;

insert into app.empresas (nome) values ('Umi San');

-- Auditoria imutável para todos (inclusive ADM e postgres em operação normal).
create function interno.auditoria_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'auditoria é imutável' using errcode = '42501';
end $$;
create trigger auditoria_sem_update before update or delete on app.auditoria
  for each row execute function interno.auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on app.auditoria
  for each statement execute function interno.auditoria_imutavel();

-- Perfil do usuário corrente, ou null se não pode acessar (inativo, senha pendente, sem aal2 quando exigido).
create function app.pode_acessar() returns app.perfis
language sql stable security definer set search_path = '' as $$
  select p.*
  from app.perfis p
  where p.usuario_id = (select auth.uid())
    and p.ativo
    and not p.senha_pendente
    and (p.papel = 'CLIENTE' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;

-- Única fonte de "quem pode o quê". Ações novas entram aqui.
create function app.pode_fazer(acao text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  delegado boolean;
begin
  if v.usuario_id is null then return false; end if;
  case acao
    when 'GERIR_USUARIOS', 'GERIR_PERMISSOES', 'GERIR_EMPRESAS', 'VER_AUDITORIA' then
      return v.papel = 'ADM';
    when 'EDITAR_PARAMETROS' then
      select ativo into delegado from app.permissoes_delegadas where chave = 'MOTORISTA_EDITA_PARAMETROS';
      return v.papel = 'ADM' or (v.papel = 'MOTORISTA' and coalesce(delegado, false));
    when 'LANCAR_RECARGA' then
      select ativo into delegado from app.permissoes_delegadas where chave = 'MOTORISTA_LANCA_RECARGA';
      return v.papel = 'ADM' or (v.papel = 'MOTORISTA' and coalesce(delegado, false));
    else
      return false;
  end case;
end $$;

revoke execute on function app.pode_acessar(), app.pode_fazer(text) from public, anon;
grant execute on function app.pode_acessar(), app.pode_fazer(text) to authenticated;

-- Auditoria e negação padronizadas (Adendo A2: confirmam a transação).
create function interno.auditar(p_acao text, p_alvo text, p_resultado text, p_codigo text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cabecalhos jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  insert into app.auditoria (usuario_id, papel, acao, alvo, resultado, codigo, detalhe, ip, dispositivo)
  values (
    (select auth.uid()),
    (select papel from app.perfis where usuario_id = (select auth.uid())),
    p_acao, p_alvo, p_resultado, p_codigo, p_detalhe,
    split_part(cabecalhos ->> 'x-forwarded-for', ',', 1),
    left(cabecalhos ->> 'user-agent', 200)
  );
end $$;

create function interno.negar(p_acao text, p_alvo text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform interno.auditar(p_acao, p_alvo, 'NEGADO', p_codigo, null);
  return jsonb_build_object('ok', false, 'codigo', p_codigo);
end $$;

-- Rate limit por janela fixa. true = dentro do limite (e conta a tentativa).
create function interno.checar_limite(p_acao text, p_max int, p_janela interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  inicio timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_janela)) * extract(epoch from p_janela));
  atual int;
begin
  insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
  values ((select auth.uid()), p_acao, inicio, 1)
  on conflict (usuario_id, acao, janela_inicio) do update set contagem = interno.limites.contagem + 1
  returning contagem into atual;
  return atual <= p_max;
end $$;

revoke execute on function interno.auditar(text, text, text, text, jsonb), interno.negar(text, text, text),
  interno.checar_limite(text, int, interval), interno.auditoria_imutavel() from public, anon, authenticated;

-- Convite → perfil (usuário criado sem convite não ganha perfil).
create function interno.criar_perfil_do_convite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c app.convites;
begin
  select * into c from app.convites
  where email = lower(new.email) and usado_em is null
  order by criado_em desc limit 1;
  if found then
    insert into app.perfis (usuario_id, nome, papel, empresa_id, senha_pendente)
    values (new.id, c.nome, c.papel, c.empresa_id, true);
    update app.convites set usado_em = now() where id = c.id;
  end if;
  return new;
end $$;
create trigger perfil_do_convite after insert on auth.users
  for each row execute function interno.criar_perfil_do_convite();

-- Qualquer troca de senha marca senha_pendente; só api.sistema_confirmar_senha limpa (Adendo A3).
create function interno.marcar_senha_pendente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update app.perfis set senha_pendente = true where usuario_id = new.id;
  end if;
  return new;
end $$;
create trigger senha_trocada after update of encrypted_password on auth.users
  for each row execute function interno.marcar_senha_pendente();

revoke execute on function interno.criar_perfil_do_convite(), interno.marcar_senha_pendente() from public, anon, authenticated;

-- Leitura sob RLS (as views de api são security_invoker).
grant select on app.empresas, app.perfis, app.permissoes_delegadas, app.auditoria to authenticated;

create policy empresas_ler on app.empresas for select to authenticated using (
  (select (app.pode_acessar()).papel) in ('ADM', 'MOTORISTA')
  or id = (select (app.pode_acessar()).empresa_id)
);
create policy perfis_ler on app.perfis for select to authenticated using (
  usuario_id = (select auth.uid())
  or app.pode_fazer('GERIR_USUARIOS')
);
create policy permissoes_ler on app.permissoes_delegadas for select to authenticated using (
  (select app.pode_acessar()) is not null
);
create policy auditoria_ler on app.auditoria for select to authenticated using (
  app.pode_fazer('VER_AUDITORIA')
);
