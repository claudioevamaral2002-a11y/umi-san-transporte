# Fase 1 — Acesso, perfis, permissões e parâmetros: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entrada segura (convite → senha forte não vazada → 2FA para ADM/motorista), permissões garantidas no banco com matriz de delegação, tabela de preços versionada visível a todos, auditoria imutável, logo do cliente e identidade IVO Transportes.

**Architecture:** regras no Postgres (schema `app` com RLS; RPCs `api.*` que devolvem `{ok, codigo}` e auditam negações; funções de autorização `app.pode_*`), operações que exigem a Admin API do Supabase em Edge Functions (Deno) que primeiro chamam uma RPC com o JWT de quem pediu; front Vite/React lê só views `api.*` e chama RPCs/funções.

**Tech Stack:** a mesma da fase 0 + Supabase Edge Functions (Deno, `npm:@supabase/supabase-js@2.117.3`), Supabase Auth MFA TOTP, Cloudflare Turnstile (CAPTCHA nativo do Auth), Supabase Storage.

**Referências:** `docs/fases/fase-1-desenho.md` (fonte da verdade desta fase), `docs/especificacao.md` (1–3, 9, Adendos A1–A7), `docs/marca/` (kit IVO: SVGs, ícones, `TIPOGRAFIA.md`).

**Formato deste plano:** código completo nas partes de segurança do banco (Task 3) e nos contratos; nas demais tarefas, contratos exatos + testes obrigatórios — o implementador escreve o código com TDD (teste primeiro, ver falhar quando possível, implementar, ver passar).

**Convenções (valem para todas as tarefas)**
- Projeto `C:\dev\umi-san-transporte`, branch `fase-1`. Nunca push/merge na `main` (merge = deploy em produção, só com o usuário).
- **Sem Docker local** (decisão do usuário): nada de `supabase start` local. pgTAP, integração e e2e com banco rodam **só no CI** — push no `fase-1` + `gh run watch <id> --exit-status`. Local: lint, typecheck, unidade, build, e2e de telas que não dependem do banco (se houver).
- `gh`: `C:\Program Files\GitHub CLI\gh.exe` (Git Bash: `"/c/Program Files/GitHub CLI/gh.exe"`), rodar de dentro do repositório.
- Commits terminam com linha em branco + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migrations: `supabase/migrations/2026100813MMSS_nome.sql` em ordem crescente; nunca editar migration já presente na `main` (as da fase 0) — criar nova.
- Todo objeto novo em `api`/`app`/`interno` segue a guarda pgTAP `0001_privilegios` (que deve continuar verde): tabelas de `app` com RLS e sem escrita para `anon`/`authenticated`; funções de `app` executáveis por `authenticated` só se `pode_*` e `SECURITY DEFINER`; toda `SECURITY DEFINER` com `search_path = ''`; views de `api` `security_invoker`; nada de `api` executável por `anon`.
- RPCs `api.*` de negócio: `SECURITY DEFINER`, `search_path = ''`, retornam `jsonb`. Negação/limite → `return interno.negar(...)` (audita e confirma). `RAISE` só para violação de integridade.
- RPCs chamadas **só** pelas Edge Functions com a chave de serviço: prefixo `api.sistema_*`, `EXECUTE` só para `service_role`.
- Mensagens ao usuário genéricas; o front traduz `codigo` (mapa em `src/lib/erros.ts`).
- Em políticas, sempre `(select app.pode_fazer(...))` e `(select (app.pode_acessar()).usuario_id) is not null` — nunca testar a linha composta inteira com IS [NOT] NULL.
- Convites: Edge Functions usam o e-mail normalizado gravado em convites.
- Nunca imprimir/ler valores de segredos.

---

### Task 1: Identidade IVO Transportes no app

**Files:** `src/design/tokens.css`, `src/design/estilos.css`, `src/design/componentes/*` (ajustes de cor), `src/design/componentes/LogoIvo.tsx` (novo), `src/assets/marca/*.svg` (do kit), `public/` ícones do kit, `vite.config.ts`, `index.html`, `package.json` (remover `@vite-pwa/assets-generator` e `pwa-assets.config.ts`), `public/icone.svg` (remover), testes e2e que citam "Umi San Transporte".

- [ ] Paleta (Adendo A7) em `tokens.css`, mantendo os nomes de variáveis existentes:
  - claro: fundo `#F6F4EE`, superfície `#FFFFFF`, texto `#0A2540`, texto suave `#4B5B70`, borda `#E1E6ED`, ação `#FF6A00` com texto `#0A2540`, marinho `#0A2540`, marinho-2 `#1E4B7A`, cinza-azulado `#96A6BB`.
  - status (texto sobre claro, AA ≥ 4.5): solicitada `#5B6B80`, aguardando `#B45309`, agendada `#1E4B7A`, andamento `#C2410C`, concluída `#15803D`, cancelada `#B91C1C`.
  - escuro e alto contraste: recalcular a partir da paleta, todos com AA (calcular e listar as razões no relatório).
  - novo token `--cor-alerta-texto: #C2410C` (laranja legível para texto; `#FF6A00` nunca como texto sobre claro).
- [ ] Escala tipográfica do `docs/marca/TIPOGRAFIA.md` como utilitários (`.ivo-display`, `.ivo-h1`, `.ivo-h2`, `.ivo-h3`, `.ivo-corpo`, `.ivo-botao`, `.ivo-legenda`, `.ivo-sobretitulo`, `.ivo-valor`) em `estilos.css` (`@layer components`), incluindo o ajuste ≥ 768 px. Pesos 300–800 da Manrope (`@fontsource-variable/manrope` já cobre). Botões 600–700; nunca 300 em controles.
- [ ] `LogoIvo.tsx`: `<img>` do SVG oficial importado de `src/assets/marca/` (variantes `simbolo` | `logotipo` | `horizontal`, cor `azul` | `branco`), com `alt="IVO Transportes"`. Copiar do kit só os SVGs usados. **Não** recriar o "IVO" com fonte.
- [ ] Ícones PWA: usar os PNGs do kit em `public/` (`ivo-icon-escuro-192.png`, `ivo-icon-escuro-512.png`, `ivo-maskable-512.png` purpose `maskable`, `apple-touch-icon-180.png`, `favicon-32.png`); manifest manual no `VitePWA` (`name: 'IVO Transportes'`, `short_name: 'IVO'`, `background_color`/`theme_color` `#0A2540`); links de ícone no `index.html`. Remover `pwaAssets` e a dependência `@vite-pwa/assets-generator` (e o override de `sharp` se não for mais necessário — conferir `npm audit`).
- [ ] `CarregandoPickup`: cores da nova paleta (rodas `#0A2540`, detalhes `#FF6A00`).
- [ ] Atualizar e2e e textos: título "IVO Transportes", manifest `name`. `/vitrine` continua existindo nesta tarefa.
- [ ] Verificar: lint, typecheck, unidade, `build:test`, e2e local (wrangler) verdes; orçamento ≤ 150 KB; zero CSP violations; push + CI verde. Commit: `feat(marca): identidade IVO Transportes (paleta, tipografia, logo, ícones)`.

---

### Task 2: Auth como código (CAPTCHA, produção, Edge Functions no deploy)

**Files:** `supabase/config.toml`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/fases/fase-1-desenho.md` (só se algo do CLI exigir mudança).

- [ ] `config.toml`:
  - `[auth.captcha] enabled = true`, `provider = "turnstile"`, `secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"`.
  - `[remotes.producao]` com `project_id = "eoczqrpvhfeulfhjblaw"` e override de `[remotes.producao.auth] site_url = "https://umi-san-transporte.pages.dev"`, `additional_redirect_urls = ["https://umi-san-transporte.pages.dev/definir-senha"]`. Conferir a sintaxe exata com `npx supabase --help`/docs do CLI 2.120; se `remotes` não suportar o caso, alternativa: `site_url = "env(SUPABASE_SITE_URL)"` com valor por ambiente. Registrar a escolha no relatório.
  - `[edge_runtime]` habilitado; segredos locais das funções em `supabase/functions/.env` **gerado no CI** (não versionado; adicionar ao `.gitignore`) com `APP_ORIGENS=http://127.0.0.1:8788`.
- [ ] CI (`ci.yml`, job `testes`): `env` com `SUPABASE_AUTH_CAPTCHA_SECRET: 1x0000000000000000000000000000000AA` (segredo **de teste público** da Cloudflare, sempre aprova) antes de `supabase start`; gerar `supabase/functions/.env`. Front de teste usa `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (adicionar ao `env-local.ts`).
- [ ] Deploy (`deploy.yml`), nesta ordem, antes do build: `npx supabase config push --project-ref "$REF"` (com `SUPABASE_AUTH_CAPTCHA_SECRET: ${{ secrets.TURNSTILE_SECRET_KEY }}`; usar `--yes` se o comando pedir confirmação) → `db push --yes` → `npx supabase secrets set APP_ORIGENS=https://umi-san-transporte.pages.dev --project-ref "$REF"` → `npx supabase functions deploy --project-ref "$REF"` (só se existir alguma função; tolerar pasta vazia até a Task 7). Build com `VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}`.
- [ ] `.env.example`: acrescentar `VITE_TURNSTILE_SITE_KEY`.
- [ ] Verificar no CI: `supabase start` sobe com captcha; integração existente **vai quebrar** no login com senha (agora exige `captchaToken`) → atualizar `tests/integracao/ajuda.ts` para enviar `options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }` (token de teste aceito pelo segredo de teste). CI verde. Commit: `feat(auth): CAPTCHA Turnstile e configuração de produção como código`.

---

### Task 3: Núcleo de acesso no banco (empresas, perfis, convites, auditoria, limites, autorização)

**Files:** `supabase/migrations/20261008130000_acesso_nucleo.sql`, `supabase/tests/0003_acesso_nucleo.test.sql`.

Código de referência (implementar exatamente; ajustes só se o CI provar necessidade, explicando):

```sql
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
  nome text not null check (length(trim(nome)) between 2 and 120),
  papel app.papel not null,
  empresa_id uuid references app.empresas (id),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  check ((papel = 'CLIENTE') = (empresa_id is not null))
);
create unique index convites_um_pendente_por_email on app.convites (email) where usado_em is null;

create table app.permissoes_delegadas (
  chave text primary key check (chave in ('MOTORISTA_LANCA_RECARGA', 'MOTORISTA_EDITA_PARAMETROS', 'CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO')),
  ativo boolean not null default false,
  alterado_por uuid references auth.users (id) on delete set null,
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
    -- ip é informativo: cabeçalhos podem ser forjados pelo cliente.
    left(coalesce(cabecalhos ->> 'cf-connecting-ip', trim(split_part(cabecalhos ->> 'x-forwarded-for', ',', 1))), 64),
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
  inicio timestamptz;
  atual int;
begin
  if (select auth.uid()) is null or p_janela <= interval '0' then
    return false;
  end if;
  if p_janela >= interval '1 day' then
    inicio := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  else
    inicio := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_janela)) * extract(epoch from p_janela));
  end if;
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
    values (new.id, trim(c.nome), c.papel, c.empresa_id, true);
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
  or (select app.pode_fazer('GERIR_USUARIOS'))
);
create policy permissoes_ler on app.permissoes_delegadas for select to authenticated using (
  (select (app.pode_acessar()).usuario_id) is not null
);
create policy auditoria_ler on app.auditoria for select to authenticated using (
  (select app.pode_fazer('VER_AUDITORIA'))
);
```

Observações para o implementador:
- `perfis_ler` deixa o próprio perfil legível mesmo com `senha_pendente`/aal1 — o front precisa saber em que etapa a pessoa está (definir senha, cadastrar 2FA). Nada além do próprio perfil fica visível nesse estado.
- Se o CI acusar que `postgres` não pode criar trigger em `auth.users`, reportar BLOCKED (não contornar).

**Testes pgTAP obrigatórios (`0003_acesso_nucleo.test.sql`)** — criar usuários via `insert into auth.users` como no `0002`, simular sessão com `set local role authenticated` + `set_config('request.jwt.claims', '{"sub":..., "role":"authenticated", "aal":"aal1|aal2"}', true)`:
1. usuário sem convite → nenhum perfil criado.
2. convite + insert em `auth.users` → perfil com papel/empresa do convite, `senha_pendente = true`, convite marcado `usado_em`.
3. `pode_acessar()` nulo para: sem perfil; inativo; `senha_pendente`; ADM aal1; MOTORISTA aal1. Não nulo para CLIENTE aal1 e ADM aal2 (após `senha_pendente = false`).
4. update de `encrypted_password` → `senha_pendente` volta a `true`.
5. `pode_fazer('EDITAR_PARAMETROS')`: ADM true; MOTORISTA false; MOTORISTA true após ativar a delegação; CLIENTE false.
6. auditoria: insert via `interno.auditar` funciona; `update`/`delete` recusados com 42501 mesmo como `postgres`; `truncate` recusado.
7. `interno.checar_limite('X', 2, '1 hour')` → true, true, false.
8. RLS: cliente lê só o próprio perfil; ADM lê todos; cliente da empresa A não lê empresa B; ninguém além do ADM lê auditoria.
9. guarda `0001` continua verde (rodar a suíte inteira).

Commit: `feat(db): núcleo de acesso — perfis, convites, matriz, auditoria imutável, limites`.

---

### Task 4: Parâmetros versionados

**Files:** migration `..._parametros.sql`, `supabase/tests/0004_parametros.test.sql`.

- [ ] Tabela `app.parametros_versoes` com as colunas do desenho §1 (centavos `bigint`, percentuais em pontos-base `int`, prazos em horas `int`, `retencao_fotos_dias int`, `faixas_cancelamento jsonb`, `vigente_desde timestamptz`, `publicado_por uuid`, `publicado_em timestamptz default now()`, `versao int generated always as identity unique`). CHECKs: valores ≥ 0; prazos > 0; `retorno_trecho_unico_bp between 0 and 10000`.
- [ ] `interno.faixas_validas(jsonb) returns boolean`: array não vazio de objetos `{antecedencia_min_horas: int ≥ 0, multa_bp: int 0..10000}`, `antecedencia_min_horas` estritamente decrescente, último item com `antecedencia_min_horas = 0`. CHECK usando a função (ela deve ser `immutable`).
- [ ] Imutável: trigger que recusa UPDATE/DELETE (mesmo padrão da auditoria).
- [ ] `api.publicar_parametros(p jsonb, p_vigente_desde timestamptz) returns jsonb`: `pode_fazer('EDITAR_PARAMETROS')` senão negar `SEM_PERMISSAO`; `p_vigente_desde >= now() - interval '1 minute'` senão `VIGENCIA_NO_PASSADO`; valida campos obrigatórios (`CAMPOS_INVALIDOS` com lista no detalhe da auditoria); insere; audita `OK` com a versão; retorna `{ok:true, versao}`. EXECUTE só `authenticated`.
- [ ] Views `api.parametros_vigentes` (a versão com maior `vigente_desde <= now()`) e `api.parametros_historico` (todas, ordem decrescente), `security_invoker`, legíveis por quem tem `pode_acessar()` (RLS na tabela). Somente colunas necessárias (sem `select *`).
- [ ] pgTAP: publicar cria versão nova e a anterior fica intacta; faixas inválidas (vazia, não decrescente, multa > 10000, último ≠ 0) recusadas; vigência no passado negada e auditada; motorista sem delegação negado e auditado; com delegação permitido; UPDATE/DELETE recusados; vigente muda quando `vigente_desde` chega (testar com duas versões, uma no futuro).

Commit: `feat(db): tabela de preços e regras versionada e imutável`.

---

### Task 5: RPCs de gestão e views da API

**Files:** migration `..._gestao_api.sql`, `supabase/tests/0005_gestao_api.test.sql`.

Contratos (todas `SECURITY DEFINER`, `search_path = ''`, retorno `jsonb {ok, codigo?, ...}`, negações auditadas):

| Função | Quem | Regras |
|---|---|---|
| `api.preparar_convite(p_email text, p_nome text, p_papel app.papel, p_empresa uuid)` | `GERIR_USUARIOS` | limite `CONVIDAR` 10/dia (`LIMITE_EXCEDIDO`); e-mail normalizado; se já existe perfil com esse e-mail → `JA_CADASTRADO`; substitui convite pendente anterior do mesmo e-mail; audita; retorna `{ok, convite_id}` |
| `api.alterar_perfil(p_usuario uuid, p_nome text, p_papel app.papel, p_empresa uuid)` | `GERIR_USUARIOS` | não pode alterar o próprio papel (`PROPRIO_PAPEL`); não pode deixar o sistema sem ADM ativo (`ULTIMO_ADM`) |
| `api.definir_ativo(p_usuario uuid, p_ativo boolean, p_motivo text)` | `GERIR_USUARIOS` | motivo obrigatório; não desativa a si mesmo; não desativa o último ADM |
| `api.definir_permissao(p_chave text, p_ativo boolean, p_motivo text)` | `GERIR_PERMISSOES` | motivo obrigatório; chave inválida → `CHAVE_INVALIDA` |
| `api.salvar_empresa(p_id uuid, p_nome text)` | `GERIR_EMPRESAS` | `p_id` nulo cria; retorna `{ok, id}` |
| `api.definir_logo_empresa(p_empresa uuid, p_caminho text)` | `GERIR_EMPRESAS` | caminho deve ser `<p_empresa>/logo.png` ou `.webp` |
| `api.sistema_confirmar_senha(p_usuario uuid)` | só `service_role` | limpa `senha_pendente`; audita (usuario_id = p_usuario) |
| `api.sistema_convite_primeiro_adm(p_email text, p_nome text)` | só `service_role` | só se não existir nenhum perfil ADM (`JA_EXISTE_ADM`); cria convite ADM |
| `api.sistema_registrar(p_usuario uuid, p_acao text, p_alvo text, p_resultado text, p_codigo text)` | só `service_role` | auditoria de operações feitas pela Admin API nas Edge Functions |

Views `security_invoker` (colunas mínimas):
- `api.meu_perfil` (nome, papel, empresa_id, empresa_nome, empresa_logo_caminho, ativo, senha_pendente, tem_2fa — `exists` em `auth.mfa_factors` verificado; se `security_invoker` não puder ler `auth.mfa_factors`, expor via função `app.pode_ver_meu_2fa()` definer e documentar)
- `api.usuarios` (ADM: usuario_id, nome, email, telefone, papel, empresa, ativo, senha_pendente, tem_2fa, criado_em) — email vem de `auth.users`; se exigir definer, fazer como função `api.listar_usuarios()` que checa `GERIR_USUARIOS`
- `api.empresas`, `api.permissoes`, `api.auditoria` (ADM, com filtros por parâmetros na chamada: usar função `api.listar_auditoria(p_de, p_ate, p_usuario, p_acao, p_limite)` com teto de 500 linhas)

pgTAP: cada função com caso permitido e negado (auditado); `sistema_*` não executáveis por `authenticated`; `ULTIMO_ADM` e `PROPRIO_PAPEL`; limite de convite (11º negado); views não retornam nada a quem não pode.

Commit: `feat(db): RPCs de gestão de usuários, matriz e empresas com auditoria`.

---

### Task 6: Integração — helpers de perfil/2FA e testes de acesso

**Files:** `tests/integracao/ajuda.ts`, `tests/integracao/totp.ts` (novo), `tests/integracao/acesso.test.ts` (novo).

- [ ] `totp.ts`: gera código TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) a partir do segredo base32 — implementação própria com `node:crypto` (sem dependência nova), com teste de unidade usando o vetor do RFC (`scripts`/`src` não; colocar em `tests/integracao/totp.test.ts` rodando na suíte de integração).
- [ ] `ajuda.ts`: `criarPessoa({ papel, empresa? })` → insere convite via `comBanco`, cria usuário pela Admin API (dispara a trigger), marca `senha_pendente = false` via `comBanco`, faz login com `captchaToken`, e para ADM/MOTORISTA cadastra e verifica TOTP (`mfa.enroll` → `challenge` → `verify` com `totp.ts`) devolvendo cliente em aal2. Retorna `{ id, cliente, token, empresaId }`. Também `empresaNova(nome)`.
- [ ] `acesso.test.ts` cobre a lista "Integração" do desenho §5 que não depende das Edge Functions (as de `definir-senha`/convite ficam na Task 7): cliente não altera parâmetros/matriz/usuários/empresas/auditoria; delegação de parâmetros liga/desliga; motorista nunca altera matriz/usuários; ninguém edita auditoria via API (escrita direta em `app` = 406; RPC inexistente); cliente A não vê perfil de B; ADM/motorista em aal1 recusados; desativado recusado na chamada seguinte; senha trocada por `auth.updateUser` → próxima RPC recusada; negação aparece em `api.listar_auditoria` com `NEGADO`.

Commit: `test(integracao): acesso por perfil, delegação, 2FA e desativação`.

---

### Task 7: Edge Functions (`definir-senha`, `convidar`, `gerir-usuario`)

**Files:** `supabase/functions/_compartilhado/{cors.ts,clientes.ts,respostas.ts,hibp.ts,senha.ts}`, `supabase/functions/definir-senha/index.ts`, `supabase/functions/convidar/index.ts`, `supabase/functions/gerir-usuario/index.ts`, `supabase/functions/deno.json` (imports fixados: `npm:@supabase/supabase-js@2.117.3`), testes `tests/integracao/funcoes.test.ts`, e testes de unidade Deno ou Vitest para `senha.ts`/`hibp.ts` (lógica pura exportada sem dependência de Deno).

Contratos:
- Todas: `POST` apenas; CORS só para origens em `APP_ORIGENS` (separadas por vírgula; responder `OPTIONS`); exigem `Authorization: Bearer <jwt do usuário>`; respostas `{ok, codigo?, ...}` com HTTP 200 para negação de negócio e 401/405 para protocolo; nunca devolvem detalhes internos; rate limit próprio por usuário (contador em memória por instância + o da RPC).
- `definir-senha` `{senha}`: usuário autenticado (aal1 basta — é o fluxo do convite/recuperação). Regras de força (≥ 10, maiúscula, minúscula, número) → `SENHA_FRACA`; HIBP k-anonimato (`https://api.pwnedpasswords.com/range/<5 primeiros hex do SHA-1>` com cabeçalho `Add-Padding: true`; comparar sufixo) → `SENHA_VAZADA`; se o HIBP não responder em 5 s → `VERIFICACAO_INDISPONIVEL` (falha fechada). Grava com `auth.admin.updateUserById(id, { password })` e então `api.sistema_confirmar_senha(id)` com cliente de serviço.
- `convidar` `{email, nome, papel, empresa_id?}`: chama `api.preparar_convite` **com o JWT do ADM** (a RPC decide); se ok, `auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: <origem>/definir-senha } })` (se o usuário já existir sem perfil, usar `type: 'recovery'`); responde `{ok, link}`; registra via `api.sistema_registrar`.
- `gerir-usuario` `{acao: 'GERAR_LINK'|'DESATIVAR'|'REATIVAR'|'RESETAR_2FA', usuario_id, motivo?}`: autorização sempre por RPC com o JWT do ADM (`definir_ativo` para desativar/reativar; para `GERAR_LINK`/`RESETAR_2FA` criar RPC `api.autorizar_operacao_usuario(p_usuario, p_acao)` na mesma tarefa, com auditoria); depois Admin API: `generateLink` recovery; `updateUserById(id, { ban_duration: '876000h' | 'none' })`; `auth.admin.mfa.listFactors` + `deleteFactor`.
- Testes de integração (chamando `${SUPABASE_URL}/functions/v1/<nome>` no CI): senha fraca/vazada (`Password123`) recusadas e forte aceita (após ela, `senha_pendente = false` e RPC funciona); convite por não-ADM negado; convite por ADM devolve link que, aberto (seguindo o redirect do `/auth/v1/verify`), dá sessão do novo usuário com perfil correto; 11º convite negado; desativar bloqueia renovação de sessão; resetar 2FA remove o fator (próximo acesso exige novo cadastro).
- Confirmar no CI que o `supabase start` serve as funções; se não, adicionar `npx supabase functions serve --env-file supabase/functions/.env &` com espera até responder.

Commit: `feat(funcoes): definir senha com HIBP, convite e gestão de usuários pela Admin API`.

---

### Task 8: Logo do cliente (Storage)

**Files:** `supabase/config.toml` (`[storage.buckets.logos]` público = false, `file_size_limit = "500KiB"`, `allowed_mime_types = ["image/png", "image/webp"]`), migration `..._logos.sql` (políticas em `storage.objects`), testes de integração `tests/integracao/logos.test.ts`.

- Escrita (insert/update/delete) em `bucket_id = 'logos'` só com `app.pode_fazer('GERIR_EMPRESAS')` e caminho `<uuid da empresa>/logo.(png|webp)`.
- Leitura: equipe (ADM/MOTORISTA) qualquer; cliente só `(storage.foldername(name))[1] = empresa_id` do próprio perfil.
- Testes: cliente não grava; ADM grava; cliente da empresa A gera URL assinada do próprio logo; cliente de outra empresa não consegue; tipo `image/svg+xml` recusado pelo bucket.

Commit: `feat(storage): logo da empresa cliente com acesso por empresa`.

---

### Task 9: Base do front autenticado

**Files:** `src/lib/supabase.ts`, `src/lib/erros.ts`, `src/lib/sessao.tsx` (provider + hooks), `src/lib/funcoes.ts` (chamada das Edge Functions), `src/design/componentes/Turnstile.tsx`, `src/telas/MolduraAutenticada.tsx`, `src/rotas.tsx`, testes de unidade para `erros.ts`.

- `supabase.ts`: `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, { db: { schema: 'api' }, auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })`. Nenhuma outra chave.
- `sessao.tsx`: estado `carregando | anonimo | definir_senha | cadastrar_2fa | verificar_2fa | pronto | inativo`, derivado de `getSession`, `mfa.getAuthenticatorAssuranceLevel` e `api.meu_perfil`; reage a `onAuthStateChange`. Guardas: rotas protegidas redirecionam conforme o estado (`/entrar`, `/definir-senha`, `/seguranca/2fa`).
- `Turnstile.tsx`: carrega `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` uma vez (script externo, sem inline), renderiza explicitamente com `VITE_TURNSTILE_SITE_KEY`, expõe o token via callback; tema conforme modo.
- `MolduraAutenticada`: topo azul com `LogoIvo` (símbolo branco) à esquerda e, para cliente, logo da empresa (URL assinada) ou nome à direita; menu por perfil (ADM vê o grupo "Administração").
- `erros.ts`: mapa `codigo → mensagem pt-BR` (todas as negações das Tasks 3–8 + `ERRO_INESPERADO`), teste de unidade garantindo que todo código conhecido tem mensagem.
- Nenhuma ação financeira aqui; ações não financeiras podem ser otimistas.

Commit: `feat(front): sessão, guardas por estado, Turnstile e moldura autenticada`.

---

### Task 10: Telas de entrada (`/entrar`, `/definir-senha`, `/seguranca/2fa`)

Seguir os mockups aprovados (login e 2FA) com a identidade IVO. `/entrar`: e-mail, senha (mostrar/ocultar), Turnstile, erro genérico. `/definir-senha`: medidor de força (as mesmas regras do servidor, só como UX), resposta da função traduzida. `/seguranca/2fa`: `mfa.enroll` → QR (data URI SVG retornado pelo Supabase) + código manual copiável → 6 caixas → `verify`; em login posterior, só as 6 caixas (`challenge` + `verify`). Acessível (rótulos, foco, `autocomplete="one-time-code"`). Commit: `feat(front): login, definição de senha e 2FA`.

---

### Task 11: Início por perfil e Tabela de preços e regras

`/`: saudação, data, bloco "Pendências" (vazio por enquanto, com texto convidativo), atalhos por perfil; cliente com logo. `/parametros`: versão vigente em cartões por modalidade (valores com `Dinheiro`, percentuais formatados de pontos-base), faixas de cancelamento em lista, histórico (versão, vigência, quem publicou); botão "Publicar nova versão" só se `pode('EDITAR_PARAMETROS')` — formulário com todos os campos, valores em reais convertidos para centavos **só para envio** (conversão por string, sem ponto flutuante: helper `reaisParaCentavos('1.234,56') → 123456` com testes de unidade), data/hora de vigência (padrão agora + 5 min), confirmação mostrando o resumo. Sem tabela publicada: estado vazio com explicação. Commit: `feat(front): início por perfil e tabela de preços e regras`.

---

### Task 12: Telas de administração

`/adm/usuarios` (lista com status: ativo, senha pendente, 2FA; convidar → mostra link com "Copiar" e "Enviar no WhatsApp" (`https://wa.me/?text=` com o link — só abre o WhatsApp, nada é enviado sem a pessoa); gerar novo link; desativar/reativar com motivo; trocar perfil; resetar 2FA com confirmação), `/adm/empresas` (nome + envio de logo PNG/WebP ≤ 500 KB com pré-visualização), `/adm/permissoes` (3 chaves, cada uma com explicação e confirmação com motivo), `/adm/auditoria` (filtros data/usuário/ação/resultado, tabela no desktop e lista no celular). Remover `/vitrine` da build de produção (manter só em `import.meta.env.DEV`). Commit: `feat(front): administração de usuários, empresas, matriz e auditoria`.

---

### Task 13: E2E dos fluxos

Playwright contra `wrangler pages dev` apontando para o Supabase do CI (chaves de teste do Turnstile). Semente via helper Node (Admin API + `comBanco`) chamado em `globalSetup`. Casos do desenho §5 "E2E", incluindo cálculo do TOTP com `tests/integracao/totp.ts`. Manter os e2e da fase 0 (headers, CSP — agora com Turnstile carregado na tela de login —, PWA offline na tela de login, pickup na rota de desenvolvimento ou num estado de carregamento real). Commit: `test(e2e): convite, senha, 2FA, login e permissões de tela`.

---

### Task 14: Workflows manuais e RUNBOOK

- `.github/workflows/criar-primeiro-adm.yml` (`workflow_dispatch`, entradas `email`, `nome`; `environment: producao`): obtém a chave de serviço com `npx supabase projects api-keys --project-ref $REF -o json` usando `SUPABASE_ACCESS_TOKEN` (mascarar com `::add-mask::`), roda `node scripts/criar-primeiro-adm.ts` (chama `api.sistema_convite_primeiro_adm` e `generateLink` invite com `redirectTo` de produção) e escreve o link **só** em `$GITHUB_STEP_SUMMARY`.
- `.github/workflows/resetar-2fa-adm.yml` (`workflow_dispatch`, entrada `email`; `environment: producao`): remove fatores TOTP do usuário e audita via `api.sistema_registrar`.
- `docs/RUNBOOK.md` (início): primeiro acesso do ADM, resetar 2FA do ADM, gerar link de senha, desativar usuário, onde ficam os segredos (nomes, nunca valores).
- `docs/fases/fase-1-o-que-testar.md`: roteiro manual em produção (criar ADM pelo workflow → definir senha → 2FA → convidar motorista e cliente da Umi San → logo → publicar tabela → testar delegação → ver auditoria).

Commit: `feat(ops): workflows de primeiro ADM e reset de 2FA; RUNBOOK inicial`.

---

### Task 15: Revisão final da fase e PR

Revisão final de todo o diff `main...fase-1` (subagente revisor), correções, CI verde, PR `fase-1 → main` com resumo e pedido explícito de merge ao usuário (merge = deploy: `config push`, migrations, funções, front). Não fazer merge.

---

## Self-review

- **Cobertura do desenho:** §0 (T1, T2), §1 (T3, T4), §2 (T3, T5, T8), §3 (T5, T7, T9, T10, T14), §4 (T10–T12), §5 (T3–T8 pgTAP/integração, T13 e2e), §7 riscos (T2, T14 docs).
- **Nomes consistentes:** `app.pode_acessar`, `app.pode_fazer`, `interno.auditar`, `interno.negar`, `interno.checar_limite`, `api.preparar_convite`, `api.sistema_confirmar_senha`, `api.sistema_convite_primeiro_adm`, `api.sistema_registrar`, `api.autorizar_operacao_usuario`, `APP_ORIGENS`, `VITE_TURNSTILE_SITE_KEY`, `SUPABASE_AUTH_CAPTCHA_SECRET`, `TURNSTILE_SECRET_KEY`.
- **Riscos de versão** (CLI `remotes`/`config push`, funções no `supabase start`, `auth.mfa_factors` sob `security_invoker`) têm alternativa descrita na própria tarefa.
