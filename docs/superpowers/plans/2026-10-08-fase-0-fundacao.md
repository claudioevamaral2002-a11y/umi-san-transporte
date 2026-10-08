# Fase 0 — Fundação: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** esteira completa sem regra de negócio — PWA Vite/React publicada no Cloudflare Pages, Supabase com schemas `api`/`app`/`interno` e privilégios corretos, prova do Realtime privado, design system base, CI que bloqueia o deploy.

**Architecture:** front estático (Vite + React Router + Tailwind) servido pelo Cloudflare Pages com CSP rígida em `_headers`; toda regra no Postgres do Supabase, exposto apenas pelo schema `api`. Testes: pgTAP (catálogo e RLS), Vitest (unidade + integração real contra Supabase local), Playwright contra `wrangler pages dev` (que aplica o `_headers` de verdade).

**Tech Stack:** Node 24, Vite 8.3.4, React 19.3.0, React Router 8.4.0, Tailwind 4.3.3, vite-plugin-pwa 2.0.0, @supabase/supabase-js 2.117.3, Supabase CLI 2.120.0, wrangler 4.148.0, Vitest 5.0.3, Playwright 1.64.0, TypeScript 6.0.3 (typescript-eslint exige < 6.1), ESLint 10.

**Referências:** `docs/especificacao.md` (1, 9, 12, Adendo A) e `docs/fases/fase-0-desenho.md`.

**Convenções**
- Pasta do projeto: `C:\dev\umi-san-transporte` (todos os comandos rodam nela).
- Scripts utilitários em TypeScript executados direto pelo Node 24 (`node scripts/x.ts`, type stripping nativo): só sintaxe apagável (sem `enum`, sem parameter properties), imports com extensão `.ts`.
- Mensagens de commit terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Se uma API de biblioteca diferir do código abaixo (versões novas), o `typecheck`/teste da própria tarefa acusa: ajuste mantendo o comportamento e anote no commit.

---

### Task 1: Esqueleto do front, lint e typecheck

**Files:**
- Create: `.gitignore`, `.gitattributes`, `.nvmrc`, `.npmrc`, `.env.example`, `index.html`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `src/main.tsx`
- Create (gerado pelo npm): `package.json`, `package-lock.json`

- [ ] **Step 1: Identidade git local**

```bash
git config user.name "Claudio Evandro"
git config user.email "claudioevamaral2002@gmail.com"
```

- [ ] **Step 2: Arquivos de configuração do repositório**

`.gitignore`:
```
node_modules/
dist/
dev-dist/
.env.test
.env*.local
supabase/.temp/
supabase/.branches/
test-results/
playwright-report/
```

`.gitattributes`:
```
* text=auto eol=lf
*.png binary
*.ico binary
*.woff2 binary
```

`.nvmrc`:
```
24
```

`.npmrc`:
```
save-exact=true
engine-strict=true
```

`.env.example`:
```
# Front (públicos — vão para o navegador)
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# Local/CI: gerado por `node scripts/env-local.ts` em .env.test e .env.development.local
```

- [ ] **Step 3: package.json e dependências fixadas**

```bash
npm init -y
npm pkg set name=umi-san-transporte private=true version=0.0.0 type=module engines.node=">=24"
npm pkg delete main scripts.test keywords author license description
npm install --save-exact react@19.3.0 react-dom@19.3.0 react-router@8.4.0 @supabase/supabase-js@2.117.3 @fontsource-variable/manrope@5.3.0
npm install --save-exact -D vite@8.3.4 @vitejs/plugin-react@6.1.2 typescript@6.0.3 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@26.6.4 eslint@10.12.0 @eslint/js@10.0.1 typescript-eslint@8.71.1 eslint-plugin-react-hooks@7.1.1 globals@17.13.0
npm pkg set scripts.dev="vite" scripts.typecheck="tsc --noEmit" scripts.lint="eslint ."
```
Expected: instalação sem `ERESOLVE`. Em `package.json`, todas as versões sem `^`.

- [ ] **Step 4: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "scripts", "*.config.ts"]
}
```

- [ ] **Step 5: `index.html` (sem script ou estilo inline — CSP)**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0B2545" />
    <title>Umi San Transporte</title>
  </head>
  <body>
    <div id="raiz"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `vite.config.ts` inicial**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [react()],
})
```

- [ ] **Step 7: `src/main.tsx` provisório**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    <h1>Umi San Transporte</h1>
  </StrictMode>,
)
```

- [ ] **Step 8: `eslint.config.js`**

```js
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'playwright-report', 'test-results', 'supabase/functions'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Proibido: risco de XSS (SECURITY.md item 18).',
        },
      ],
    },
  },
  { files: ['scripts/**', 'tests/**', '*.config.*'], languageOptions: { globals: globals.node } },
)
```

- [ ] **Step 9: Verificar**

Run: `npm run typecheck; npm run lint; npx vite build`
Expected: os três sem erro; `dist/index.html` gerado. Abrir `dist/index.html` e confirmar que não há `<script>` sem `src` nem `<style>`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: esqueleto Vite + React + TS com lint e typecheck"
```

---

### Task 2: Supabase local e `config.toml`

**Files:**
- Create: `supabase/config.toml` (gerado pelo CLI e editado)
- Modify: `package.json` (devDependency + scripts)

- [ ] **Step 1: CLI fixado e init**

```bash
npm install --save-exact -D supabase@2.120.0
npx supabase init --force
npm pkg set scripts.db:start="supabase start" scripts.db:stop="supabase stop" scripts.db:reset="supabase db reset" scripts.db:test="supabase test db"
```
Responder "N" a perguntas sobre VS Code/Deno settings.

- [ ] **Step 2: Editar `supabase/config.toml`**

Ajustar as chaves abaixo nas seções existentes (manter o resto como gerado):

```toml
project_id = "umi-san-transporte"

[api]
# Só o schema api é servido pelo PostgREST (especificação 1.1).
schemas = ["api"]
extra_search_path = ["extensions"]

[auth]
site_url = "http://127.0.0.1:8788"
additional_redirect_urls = ["http://127.0.0.1:5173"]
# JWT curto (SECURITY item 14).
jwt_expiry = 900
enable_refresh_token_rotation = true
# Sem cadastro público: só convite do ADM (Adendo A3).
enable_signup = false
minimum_password_length = 10
password_requirements = "lower_upper_letters_digits"

[auth.email]
enable_signup = false
enable_confirmations = true
secure_password_change = true

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

- [ ] **Step 3: Subir o stack**

Run (Docker precisa estar rodando): `npx supabase start`
Expected: imprime `API URL: http://127.0.0.1:54321` e `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Se reclamar de chave desconhecida no `config.toml`, remover só aquela chave e anotar no commit.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Supabase local com API só no schema api, JWT 15 min e signup fechado"
```

---

### Task 3: Schemas e privilégios (pgTAP primeiro)

**Files:**
- Create: `supabase/tests/0001_privilegios.test.sql`
- Create: `supabase/migrations/20261008120000_schemas_privilegios.sql`

- [ ] **Step 1: Teste pgTAP que protege as regras de privilégio de todas as fases**

`supabase/tests/0001_privilegios.test.sql`:
```sql
-- Guarda permanente das regras 1.1 e Adendo A4 da especificação.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_schema('api');
select has_schema('app');
select has_schema('interno');

select ok(
  not has_schema_privilege('anon', 'api', 'USAGE')
  and not has_schema_privilege('anon', 'app', 'USAGE')
  and not has_schema_privilege('anon', 'interno', 'USAGE'),
  'anon sem USAGE em api, app e interno'
);

select ok(
  not has_schema_privilege('authenticated', 'interno', 'USAGE'),
  'authenticated sem USAGE em interno'
);

select is_empty($$
  select c.relname || ':' || r.papel || ':' || p.priv
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(papel)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where n.nspname = 'app' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege(r.papel, c.oid, p.priv)
$$, 'app: nenhuma escrita direta para anon/authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'interno'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
$$, 'interno: nenhuma função executável por anon/authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not (p.proname like 'pode\_%' and p.prosecdef)))
$$, 'app: só funções pode_* SECURITY DEFINER executáveis por authenticated');

select is_empty($$
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'EXECUTE')
$$, 'api: nenhuma função executável por anon');

select is_empty($$
  select n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'app', 'interno') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
$$, 'toda função SECURITY DEFINER tem search_path fixo');

select is_empty($$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false)
$$, 'toda view de api é security_invoker (Adendo A4)');

select is_empty($$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'toda tabela de app tem RLS habilitado');

select * from finish();
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx supabase test db`
Expected: FAIL em `has_schema('api')`, `has_schema('app')`, `has_schema('interno')`.

- [ ] **Step 3: Migration**

`supabase/migrations/20261008120000_schemas_privilegios.sql`:
```sql
-- Schemas da especificação 1.1:
--   api     único exposto pelo PostgREST: RPCs e views por perfil
--   app     tabelas de negócio, não exposto
--   interno funções de sistema (cron, reconciliação, outbox), sem acesso de usuário
create schema api;
create schema app;
create schema interno;

revoke all on schema api, app, interno from public, anon, authenticated;

grant usage on schema api to authenticated, service_role;
-- USAGE em app só para as funções app.pode_* usadas em políticas e para SELECT sob RLS
-- pelas views security_invoker; escrita direta nunca (testado em 0001_privilegios).
grant usage on schema app to authenticated;

-- Objetos futuros nascem fechados; cada um recebe GRANT explícito na sua migration.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema api, app, interno revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema api, app, interno revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema api, app, interno revoke all on sequences from anon, authenticated;

-- Evidência do item 10 de segurança (sem Authorization → recusado) e keep-alive (fase 5).
create function api.ping()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select 'pong'::text $$;

revoke execute on function api.ping() from public, anon;
grant execute on function api.ping() to authenticated;
```

- [ ] **Step 4: Aplicar e testar**

Run: `npx supabase db reset; npx supabase test db`
Expected: `All tests successful.` (12 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): schemas api/app/interno com privilégios fechados e guarda pgTAP"
```

---

### Task 4: Prova do Realtime privado no banco

**Files:**
- Create: `supabase/tests/0002_prova_realtime.test.sql`
- Create: `supabase/migrations/20261008120100_prova_realtime.sql`

- [ ] **Step 1: Teste pgTAP**

`supabase/tests/0002_prova_realtime.test.sql`:
```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'prova_assinar'),
  'política prova_assinar existe em realtime.messages'
);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@teste.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@teste.local');

insert into app.prova_canal (id, dono)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select ok(app.pode_ver_prova('prova:00000000-0000-0000-0000-0000000000c1'), 'dono pode assinar o canal');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select ok(not app.pode_ver_prova('prova:00000000-0000-0000-0000-0000000000c1'), 'outro usuário não pode assinar');

select throws_ok(
  $$ insert into app.prova_canal (dono) values ('00000000-0000-0000-0000-0000000000b1') $$,
  '42501', null, 'authenticated não insere direto em app'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx supabase test db`
Expected: `0002_prova_realtime` falha (`relation "app.prova_canal" does not exist`).

- [ ] **Step 3: Migration**

`supabase/migrations/20261008120100_prova_realtime.sql`:
```sql
-- Prova do Realtime Broadcast em canal privado (fase 0, especificação 1.2).
-- Na fase 1 a política passa a usar a permissão real de pedido e esta tabela é removida.
create table app.prova_canal (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null references auth.users (id) on delete cascade,
  status text not null default 'SOLICITADA'
);
alter table app.prova_canal enable row level security;

create function app.pode_ver_prova(topico text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.prova_canal p
    where 'prova:' || p.id::text = topico
      and p.dono = (select auth.uid())
  )
$$;
revoke execute on function app.pode_ver_prova(text) from public, anon;
grant execute on function app.pode_ver_prova(text) to authenticated;

create policy prova_assinar on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and app.pode_ver_prova((select realtime.topic()))
  );

-- Payload mínimo: id, status e horário. Nenhum dado sensível no canal.
create function app.prova_canal_publicar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'status', new.status, 'em', now()),
    'status',
    'prova:' || new.id::text,
    true
  );
  return new;
end
$$;
revoke execute on function app.prova_canal_publicar() from public, anon, authenticated;

create trigger prova_canal_publicar
  after update of status on app.prova_canal
  for each row execute function app.prova_canal_publicar();
```

- [ ] **Step 4: Aplicar e testar**

Run: `npx supabase db reset; npx supabase test db`
Expected: `All tests successful.` (0001 e 0002).

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): prova de Realtime Broadcast privado autorizado por RLS"
```

---

### Task 5: Testes de integração — superfície da API

**Files:**
- Create: `scripts/env-local.ts`, `vitest.integracao.config.ts`, `tests/integracao/ajuda.ts`, `tests/integracao/api-exposta.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Dependências e script**

```bash
npm install --save-exact -D vitest@5.0.3 pg@8.23.1 @types/pg@8.23.1
npm pkg set scripts.test:integracao="vitest run --config vitest.integracao.config.ts"
```

- [ ] **Step 2: `scripts/env-local.ts`**

```ts
// Gera .env.test e .env.development.local a partir do Supabase local em execução.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const saida = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const status = JSON.parse(saida.slice(saida.indexOf('{'))) as Record<string, string | undefined>

const chavePublica = status.PUBLISHABLE_KEY ?? status.ANON_KEY
const chaveServico = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
if (!status.API_URL || !status.DB_URL || !chavePublica || !chaveServico) {
  throw new Error('supabase status incompleto — o stack local está rodando? (npx supabase start)')
}

const linhas = [
  `SUPABASE_URL=${status.API_URL}`,
  `SUPABASE_ANON_KEY=${chavePublica}`,
  `SUPABASE_SERVICE_KEY=${chaveServico}`,
  `SUPABASE_DB_URL=${status.DB_URL}`,
  `VITE_SUPABASE_URL=${status.API_URL}`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${chavePublica}`,
]
const conteudo = linhas.join('\n') + '\n'
writeFileSync('.env.test', conteudo)
writeFileSync('.env.development.local', conteudo)
console.log('Gerados .env.test e .env.development.local (Supabase local)')
```

- [ ] **Step 3: `vitest.integracao.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig({
  test: {
    include: ['tests/integracao/**/*.test.ts'],
    env: loadEnv('test', process.cwd(), ''),
    testTimeout: 20_000,
    fileParallelism: false,
  },
})
```

- [ ] **Step 4: `tests/integracao/ajuda.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

function lerEnv(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Variável ${nome} ausente — rode: node scripts/env-local.ts`)
  return valor
}

export const URL_SUPABASE = lerEnv('SUPABASE_URL')
export const CHAVE_PUBLICA = lerEnv('SUPABASE_ANON_KEY')

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }

export function clientePublico(): SupabaseClient {
  return createClient(URL_SUPABASE, CHAVE_PUBLICA, { ...semSessao, db: { schema: 'api' } })
}

function clienteServico(): SupabaseClient {
  return createClient(URL_SUPABASE, lerEnv('SUPABASE_SERVICE_KEY'), semSessao)
}

export interface UsuarioTeste {
  id: string
  token: string
  cliente: SupabaseClient
}

export async function criarUsuario(): Promise<UsuarioTeste> {
  const email = `teste-${randomUUID()}@teste.local`
  const senha = `Senha-${randomUUID()}`
  const criado = await clienteServico().auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (criado.error || !criado.data.user) throw criado.error ?? new Error('createUser não retornou usuário')

  const cliente = clientePublico()
  const login = await cliente.auth.signInWithPassword({ email, password: senha })
  if (login.error || !login.data.session) throw login.error ?? new Error('login sem sessão')
  return { id: criado.data.user.id, token: login.data.session.access_token, cliente }
}

/** Conexão direta como postgres, só para preparar cenários de teste. */
export async function comBanco<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: lerEnv('SUPABASE_DB_URL') })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}
```

- [ ] **Step 5: Teste**

`tests/integracao/api-exposta.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { CHAVE_PUBLICA, URL_SUPABASE, criarUsuario } from './ajuda.ts'

describe('superfície da API (especificação 1.1 e segurança item 10)', () => {
  let token = ''
  beforeAll(async () => {
    token = (await criarUsuario()).token
  })

  const autenticado = (extra: Record<string, string> = {}) => ({
    apikey: CHAVE_PUBLICA,
    Authorization: `Bearer ${token}`,
    ...extra,
  })

  it('api.ping responde para usuário autenticado', async () => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/ping`, {
      method: 'POST',
      headers: autenticado({ 'Content-Type': 'application/json', 'Content-Profile': 'api' }),
      body: '{}',
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toBe('pong')
  })

  it('sem header Authorization a RPC é recusada (CSRF não se aplica)', async () => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/ping`, {
      method: 'POST',
      headers: { apikey: CHAVE_PUBLICA, 'Content-Type': 'application/json', 'Content-Profile': 'api' },
      body: '{}',
    })
    expect(r.ok).toBe(false)
  })

  it.each(['app', 'interno', 'public'])('schema %s não é servido pela API', async (schema) => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/prova_canal?select=id`, {
      headers: autenticado({ 'Accept-Profile': schema }),
    })
    expect(r.status).toBe(406)
  })

  it.each([
    ['POST', ''],
    ['PATCH', '?id=not.is.null'],
    ['DELETE', '?id=not.is.null'],
  ])('escrita direta %s em app.prova_canal é recusada', async (metodo, filtro) => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/prova_canal${filtro}`, {
      method: metodo,
      headers: autenticado({ 'Content-Type': 'application/json', 'Content-Profile': 'app' }),
      body: metodo === 'DELETE' ? undefined : JSON.stringify({ status: 'X' }),
    })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 6: Rodar**

Run: `node scripts/env-local.ts; npm run test:integracao`
Expected: 9 testes PASS. (Estes testes validam regras já implementadas nas Tasks 2–4; se algum passar "por acaso" com status inesperado, conferir o motivo — p.ex. 401 em vez de 406 — e manter a asserção mais forte que for verdadeira.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(integracao): API expõe só o schema api e recusa escrita direta e chamada sem token"
```

---

### Task 6: Teste de integração — Realtime A recebe, B é recusado

**Files:**
- Create: `tests/integracao/realtime-privado.test.ts`

- [ ] **Step 1: Teste**

```ts
import type { RealtimeChannel } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { comBanco, criarUsuario } from './ajuda.ts'

function statusAssinatura(canal: RealtimeChannel): Promise<string> {
  return new Promise((resolve) => {
    const limite = setTimeout(() => resolve('SEM_RESPOSTA'), 8_000)
    canal.subscribe((status) => {
      if (status === 'CLOSED') return
      clearTimeout(limite)
      resolve(status)
    })
  })
}

describe('Realtime Broadcast privado (especificação 1.2)', () => {
  it('dono recebe o evento; outro usuário é recusado no mesmo canal', async () => {
    const a = await criarUsuario()
    const b = await criarUsuario()
    const id = await comBanco(async (db) => {
      const r = await db.query<{ id: string }>('insert into app.prova_canal (dono) values ($1) returning id', [a.id])
      return r.rows[0]!.id
    })
    const topico = `prova:${id}`
    await a.cliente.realtime.setAuth(a.token)
    await b.cliente.realtime.setAuth(b.token)

    const recebidos: unknown[] = []
    const canalA = a.cliente
      .channel(topico, { config: { private: true } })
      .on('broadcast', { event: 'status' }, (mensagem) => recebidos.push(mensagem.payload))
    expect(await statusAssinatura(canalA)).toBe('SUBSCRIBED')

    const canalB = b.cliente.channel(topico, { config: { private: true } })
    expect(await statusAssinatura(canalB)).not.toBe('SUBSCRIBED')

    await comBanco((db) => db.query("update app.prova_canal set status = 'ORCADA' where id = $1", [id]))

    await expect.poll(() => recebidos.length, { timeout: 8_000 }).toBe(1)
    expect(recebidos[0]).toMatchObject({ id, status: 'ORCADA' })

    await a.cliente.removeAllChannels()
    await b.cliente.removeAllChannels()
  })
})
```

- [ ] **Step 2: Rodar**

Run: `npm run test:integracao`
Expected: 10 testes PASS. Se `canalB` resultar `SUBSCRIBED`, a política está aberta demais — corrigir a migration da Task 4, nunca o teste.

- [ ] **Step 3: Commit**

```bash
git add tests
git commit -m "test(integracao): canal privado do Realtime entrega ao dono e recusa terceiros"
```

---

### Task 7: Varredura de segredos no bundle

**Files:**
- Create: `vitest.config.ts`, `scripts/varrer-segredos.ts`, `scripts/varrer-segredos.test.ts`, `.gitleaks.toml`
- Modify: `package.json`

- [ ] **Step 1: Config de testes de unidade**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
```
```bash
npm pkg set scripts.test:unit="vitest run"
```

- [ ] **Step 2: Teste que falha**

`scripts/varrer-segredos.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { encontrarSegredos } from './varrer-segredos.ts'

const jwt = (corpo: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(corpo)).toString('base64url')}.assinatura`

describe('encontrarSegredos', () => {
  it('aceita chave publishable e JWT anon', () => {
    expect(encontrarSegredos(`k="sb_publishable_abc123def456"; a="${jwt({ role: 'anon' })}"`)).toEqual([])
  })

  it('acusa chave secreta do Supabase', () => {
    expect(encontrarSegredos('x="sb_secret_ZZZZZZZZZZZZZZ"').map((a) => a.regra)).toEqual(['chave secreta Supabase'])
  })

  it('acusa JWT com papel service_role', () => {
    expect(encontrarSegredos(jwt({ role: 'service_role' })).map((a) => a.regra)).toEqual(['JWT com papel service_role'])
  })

  it('acusa chave privada PEM e chave age', () => {
    const texto = '-----BEGIN PRIVATE KEY-----\nAGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQ'
    expect(encontrarSegredos(texto).map((a) => a.regra)).toEqual(['chave privada PEM', 'chave age'])
  })

  it('não repete o segredo inteiro no relatório', () => {
    const [achado] = encontrarSegredos('sb_secret_0123456789abcdefghij')
    expect(achado?.trecho.length).toBeLessThan(15)
  })
})
```

Run: `npm run test:unit`
Expected: FAIL (`Cannot find module './varrer-segredos.ts'`).

- [ ] **Step 3: Implementação**

`scripts/varrer-segredos.ts`:
```ts
// Falha o CI se o bundle publicado contiver segredo (SECURITY item 1).
// Uso: node scripts/varrer-segredos.ts [pasta=dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Achado {
  regra: string
  trecho: string
}

const REGRAS: Array<[string, RegExp]> = [
  ['chave secreta Supabase', /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ['chave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['chave age', /AGE-SECRET-KEY-1[0-9A-Z]{20,}/g],
  ['chave Resend', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g],
]
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const EXTENSOES = /\.(js|mjs|css|html|json|webmanifest|txt|map)$|_headers$/

const mascarar = (s: string) => `${s.slice(0, 12)}…`

function papelDoJwt(token: string): string | undefined {
  try {
    const corpo = token.split('.')[1] ?? ''
    return (JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { role?: string }).role
  } catch {
    return undefined
  }
}

export function encontrarSegredos(texto: string): Achado[] {
  const achados: Achado[] = []
  for (const [regra, padrao] of REGRAS) {
    for (const m of texto.matchAll(padrao)) achados.push({ regra, trecho: mascarar(m[0]) })
  }
  for (const m of texto.matchAll(JWT)) {
    const papel = papelDoJwt(m[0])
    if (papel && papel !== 'anon') achados.push({ regra: `JWT com papel ${papel}`, trecho: mascarar(m[0]) })
  }
  return achados
}

function* arquivos(pasta: string): Generator<string> {
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho)
    else yield caminho
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2] ?? 'dist'
  let total = 0
  for (const arquivo of arquivos(pasta)) {
    if (!EXTENSOES.test(arquivo)) continue
    for (const achado of encontrarSegredos(readFileSync(arquivo, 'utf8'))) {
      console.error(`${arquivo}: ${achado.regra} (${achado.trecho})`)
      total++
    }
  }
  if (total > 0) {
    console.error(`${total} segredo(s) encontrado(s) em ${pasta}`)
    process.exit(1)
  }
  console.log(`Nenhum segredo encontrado em ${pasta}`)
}
```

- [ ] **Step 4: Rodar**

Run: `npm run test:unit; npx vite build; node scripts/varrer-segredos.ts dist`
Expected: 5 PASS; `Nenhum segredo encontrado em dist`.

- [ ] **Step 5: Allowlist do gitleaks para as fixtures**

`.gitleaks.toml`:
```toml
[extend]
useDefault = true

[allowlist]
description = "Fixtures falsas do teste do varredor de segredos"
paths = ['''scripts/varrer-segredos\.test\.ts''']
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ci): varredura de segredos no bundle com testes"
```

---

### Task 8: Tokens de design, fonte, Tailwind e dinheiro

**Files:**
- Create: `src/design/tokens.css`, `src/design/estilos.css`, `src/design/dinheiro.ts`, `src/design/dinheiro.test.ts`, `src/design/componentes/Dinheiro.tsx`
- Modify: `vite.config.ts`, `src/main.tsx`

- [ ] **Step 1: Tailwind**

```bash
npm install --save-exact -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
```
`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 2: Teste do formatador (falha)**

`src/design/dinheiro.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatarCentavos } from './dinheiro.ts'

// Intl usa espaço não separável entre "R$" e o número.
const normal = (s: string) => s.replace(/\u00a0/g, ' ')

describe('formatarCentavos', () => {
  it('formata centavos em reais pt-BR', () => {
    expect(normal(formatarCentavos(0))).toBe('R$ 0,00')
    expect(normal(formatarCentavos(123456))).toBe('R$ 1.234,56')
    expect(normal(formatarCentavos(-5))).toBe('-R$ 0,05')
  })

  it('recusa valor que não é inteiro em centavos', () => {
    expect(() => formatarCentavos(1.5)).toThrow(TypeError)
    expect(() => formatarCentavos(Number.NaN)).toThrow(TypeError)
  })
})
```
Run: `npm run test:unit` → Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementação**

`src/design/dinheiro.ts`:
```ts
// O front só formata; nunca calcula valores financeiros (especificação 6 e SECURITY item 3).
const FORMATO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new TypeError(`Valor monetário deve ser inteiro em centavos: ${centavos}`)
  }
  return FORMATO.format(centavos / 100)
}
```

`src/design/componentes/Dinheiro.tsx`:
```tsx
import { formatarCentavos } from '../dinheiro.ts'

export function Dinheiro({ centavos, className = '' }: { centavos: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatarCentavos(centavos)}</span>
}
```
Run: `npm run test:unit` → Expected: PASS.

- [ ] **Step 4: Tokens**

`src/design/tokens.css`:
```css
/* Tokens da identidade marítima (especificação 12.1). Laranja só em ação principal e alerta. */
:root {
  --cor-marinho: #0b2545;
  --cor-papel: #f7f5f0;
  --cor-laranja: #ff6b1a;

  --cor-fundo: var(--cor-papel);
  --cor-superficie: #ffffff;
  --cor-texto: #0b2545;
  --cor-texto-suave: #4a5a70;
  --cor-borda: #dad6cc;
  --cor-acao: var(--cor-laranja);
  --cor-acao-texto: #0b2545; /* marinho sobre laranja: contraste ≥ 4,5:1 */

  --status-solicitada: #6b7280;
  --status-aguardando: #b45309;
  --status-agendada: #1d4ed8;
  --status-andamento: #e25a0c;
  --status-concluida: #15803d;
  --status-cancelada: #b91c1c;

  --raio: 14px;
  --raio-pequeno: 8px;
  --sombra: 0 1px 2px rgb(11 37 69 / 0.08), 0 4px 16px rgb(11 37 69 / 0.06);
  --duracao: 240ms;
  --curva: cubic-bezier(0.2, 0.8, 0.2, 1);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-tema="claro"]) {
    --cor-fundo: #06172b;
    --cor-superficie: #0b2545;
    --cor-texto: #f7f5f0;
    --cor-texto-suave: #a9b6c8;
    --cor-borda: #1e3a5f;
    --status-solicitada: #9ca3af;
    --status-aguardando: #f59e0b;
    --status-agendada: #60a5fa;
    --status-andamento: #ff8a4c;
    --status-concluida: #4ade80;
    --status-cancelada: #f87171;
    color-scheme: dark;
  }
}

/* Alto contraste para uso no sol (motorista). Vence o modo escuro. */
:root[data-contraste="alto"] {
  --cor-fundo: #ffffff;
  --cor-superficie: #ffffff;
  --cor-texto: #000000;
  --cor-texto-suave: #1f2937;
  --cor-borda: #000000;
  --cor-acao-texto: #000000;
  --status-solicitada: #374151;
  --status-aguardando: #78350f;
  --status-agendada: #1e3a8a;
  --status-andamento: #9a3412;
  --status-concluida: #14532d;
  --status-cancelada: #7f1d1d;
  color-scheme: light;
}
```

- [ ] **Step 5: Estilos globais**

`src/design/estilos.css`:
```css
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-fundo: var(--cor-fundo);
  --color-superficie: var(--cor-superficie);
  --color-texto: var(--cor-texto);
  --color-texto-suave: var(--cor-texto-suave);
  --color-borda: var(--cor-borda);
  --color-acao: var(--cor-acao);
  --color-acao-texto: var(--cor-acao-texto);
  --color-marinho: var(--cor-marinho);
  --color-papel: var(--cor-papel);
  --font-sans: "Manrope Variable", system-ui, sans-serif;
  --radius-cartao: var(--raio);
}

@layer base {
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--cor-fundo);
    color: var(--cor-texto);
    font-family: var(--font-sans);
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
  }
  button, a { touch-action: manipulation; }
}

/* Em @layer components para que utilitários (motion-reduce:animate-none) prevaleçam. */
@layer components {
  .pickup-roda { transform-box: fill-box; transform-origin: center; animation: pickup-girar 600ms linear infinite; }
  .pickup-balanco { animation: pickup-balancar 450ms ease-in-out infinite; }
  .pickup-estrada { animation: estrada-andar 400ms linear infinite; }
}

@keyframes pickup-girar { to { transform: rotate(360deg); } }
@keyframes pickup-balancar { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
@keyframes estrada-andar { to { stroke-dashoffset: 30; } }

/* Transição de tela (View Transitions). Sem preferência de movimento reduzido apenas. */
@media (prefers-reduced-motion: no-preference) {
  ::view-transition-old(root) { animation: var(--duracao) var(--curva) both tela-sair; }
  ::view-transition-new(root) { animation: var(--duracao) var(--curva) both tela-entrar; }
}
@keyframes tela-sair { to { transform: translateX(-30%); opacity: 0; } }
@keyframes tela-entrar { from { transform: translateX(30%); opacity: 0; } }
```

- [ ] **Step 6: Fonte e estilos no `src/main.tsx`**

Adicionar no topo de `src/main.tsx`:
```tsx
import '@fontsource-variable/manrope'
import './design/estilos.css'
```

- [ ] **Step 7: Verificar**

Run: `npm run typecheck; npm run lint; npm run test:unit; npx vite build`
Expected: tudo verde; `dist/assets/` contém `.woff2` e um `.css`; nenhum `data:font` no CSS (`Select-String -Path dist/assets/*.css -Pattern 'data:font'` sem resultado).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(design): tokens marítimos, modo escuro, alto contraste, Manrope e formatação de centavos"
```

---

### Task 9: Componentes base

**Files:**
- Create: `src/design/componentes/Botao.tsx`, `Cartao.tsx`, `StatusBadge.tsx`, `Skeleton.tsx`, `CarregandoPickup.tsx`, `src/design/useAtrasoVisivel.ts`

- [ ] **Step 1: `Botao.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variante = 'principal' | 'secundario' | 'perigo'

const ESTILOS: Record<Variante, string> = {
  principal: 'bg-acao text-acao-texto',
  secundario: 'bg-superficie text-texto border border-borda',
  perigo: 'bg-[var(--status-cancelada)] text-white',
}

export function Botao({
  variante = 'secundario',
  className = '',
  onClick,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...resto}
      onClick={(evento) => {
        if (variante === 'principal') navigator.vibrate?.(10)
        onClick?.(evento)
      }}
      className={`min-h-12 rounded-cartao px-5 font-semibold transition-transform duration-75 active:scale-[0.97] active:brightness-95 disabled:opacity-50 ${ESTILOS[variante]} ${className}`}
    />
  )
}
```

- [ ] **Step 2: `Cartao.tsx`**

```tsx
import type { HTMLAttributes } from 'react'

export function Cartao({ className = '', ...resto }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...resto}
      className={`rounded-cartao border border-borda bg-superficie p-4 shadow-[var(--sombra)] ${className}`}
    />
  )
}
```

- [ ] **Step 3: `StatusBadge.tsx`**

```tsx
// Status sempre com ícone + texto, nunca só cor (especificação 12.1).
export type Status =
  | 'SOLICITADA' | 'ORCADA' | 'AGENDADA' | 'EM_ANDAMENTO' | 'CONCLUIDA'
  | 'CANCELADA' | 'EXPIRADA' | 'RECUSADA' | 'REPROVADA'

const MAPA: Record<Status, { rotulo: string; cor: string; icone: string; pulsa?: boolean }> = {
  SOLICITADA: { rotulo: 'Solicitada', cor: 'var(--status-solicitada)', icone: '○' },
  ORCADA: { rotulo: 'Aguardando aprovação', cor: 'var(--status-aguardando)', icone: '◔' },
  AGENDADA: { rotulo: 'Agendada', cor: 'var(--status-agendada)', icone: '▣' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', cor: 'var(--status-andamento)', icone: '▶', pulsa: true },
  CONCLUIDA: { rotulo: 'Concluída', cor: 'var(--status-concluida)', icone: '✓' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'var(--status-cancelada)', icone: '✕' },
  EXPIRADA: { rotulo: 'Expirada', cor: 'var(--status-cancelada)', icone: '⌛' },
  RECUSADA: { rotulo: 'Recusada', cor: 'var(--status-cancelada)', icone: '✕' },
  REPROVADA: { rotulo: 'Reprovada', cor: 'var(--status-cancelada)', icone: '✕' },
}

export function StatusBadge({ status }: { status: Status }) {
  const s = MAPA[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold"
      style={{ color: s.cor, borderColor: s.cor }}
    >
      <span aria-hidden="true" className={s.pulsa ? 'animate-pulse motion-reduce:animate-none' : ''}>
        {s.icone}
      </span>
      {s.rotulo}
    </span>
  )
}
```

- [ ] **Step 4: `Skeleton.tsx`**

```tsx
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--raio-pequeno)] bg-borda motion-reduce:animate-none ${className}`}
    />
  )
}
```

- [ ] **Step 5: `useAtrasoVisivel.ts`**

```ts
import { useEffect, useState } from 'react'

/** Carregamentos abaixo de 400 ms não mostram nada (especificação 12.2). */
export const ATRASO_CARREGAMENTO_MS = 400

export function useAtrasoVisivel(ativo: boolean, atrasoMs = ATRASO_CARREGAMENTO_MS): boolean {
  const [venceu, setVenceu] = useState(false)
  useEffect(() => {
    if (!ativo) return
    const temporizador = setTimeout(() => setVenceu(true), atrasoMs)
    return () => {
      clearTimeout(temporizador)
      setVenceu(false)
    }
  }, [ativo, atrasoMs])
  return ativo && venceu
}
```

- [ ] **Step 6: `CarregandoPickup.tsx`**

```tsx
import { useAtrasoVisivel } from '../useAtrasoVisivel.ts'

const RODAS = [49, 118, 182] as const

export function CarregandoPickup({ ativo, rotulo = 'Carregando…' }: { ativo: boolean; rotulo?: string }) {
  const visivel = useAtrasoVisivel(ativo)
  if (!visivel) return null
  return (
    <div role="status" aria-live="polite" data-testid="carregando-pickup" className="flex flex-col items-center gap-3 py-8">
      <svg viewBox="0 0 240 90" width="240" height="90" aria-hidden="true" className="text-texto">
        <g className="pickup-balanco motion-reduce:animate-none">
          <rect x="18" y="38" width="62" height="26" rx="4" fill="currentColor" />
          <rect x="80" y="52" width="14" height="4" fill="currentColor" />
          <path d="M94 40h46V24h34l18 18h14a6 6 0 0 1 6 6v14H94z" fill="currentColor" />
          <path d="M176 28h-30v14h44z" fill="var(--cor-fundo)" opacity="0.85" />
          <rect x="198" y="50" width="10" height="5" rx="2" fill="var(--cor-laranja)" />
        </g>
        {RODAS.map((cx) => (
          <g key={cx} data-testid="pickup-roda" className="pickup-roda motion-reduce:animate-none">
            <circle cx={cx} cy="66" r="10" fill="var(--cor-marinho)" stroke="var(--cor-papel)" strokeWidth="2" />
            <path d={`M${cx - 6} 66h12M${cx} 60v12`} stroke="var(--cor-laranja)" strokeWidth="2.5" />
          </g>
        ))}
        <line
          x1="0" y1="84" x2="240" y2="84"
          stroke="currentColor" strokeWidth="3" strokeDasharray="18 12" opacity="0.35"
          className="pickup-estrada motion-reduce:animate-none"
        />
      </svg>
      <span className="font-medium text-texto-suave">{rotulo}</span>
    </div>
  )
}
```

- [ ] **Step 7: Verificar**

Run: `npm run typecheck; npm run lint`
Expected: sem erros. (Comportamento visual e de tempo é testado no e2e da Task 14.)

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(design): componentes base e animação de carregamento da pickup"
```

---

### Task 10: Rotas, moldura, início e vitrine

**Files:**
- Create: `src/rotas.tsx`, `src/telas/Moldura.tsx`, `src/telas/Inicio.tsx`, `src/telas/Vitrine.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: `src/telas/Moldura.tsx`**

```tsx
import { Outlet, useNavigation } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'

export function Moldura() {
  const carregando = useNavigation().state === 'loading'
  return (
    <div className="min-h-dvh">
      <header className="bg-marinho px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-papel">
        <span className="text-lg font-bold">Umi San</span>
      </header>
      <CarregandoPickup ativo={carregando} />
      {!carregando && <Outlet />}
    </div>
  )
}
```

- [ ] **Step 2: `src/telas/Inicio.tsx`**

```tsx
import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'

export function Inicio() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <Cartao>
        <h1 className="text-2xl font-bold">Umi San Transporte</h1>
        <p className="text-texto-suave">Fundação do aplicativo — fase 0.</p>
      </Cartao>
      <Link to="/vitrine" viewTransition className="block font-semibold underline underline-offset-4">
        Ver design system
      </Link>
    </main>
  )
}
```

- [ ] **Step 3: `src/telas/Vitrine.tsx`**

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { Dinheiro } from '../design/componentes/Dinheiro.tsx'
import { Skeleton } from '../design/componentes/Skeleton.tsx'
import { StatusBadge, type Status } from '../design/componentes/StatusBadge.tsx'

const STATUS: Status[] = ['SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA']

function alternarContraste() {
  const raiz = document.documentElement
  if (raiz.dataset.contraste === 'alto') delete raiz.dataset.contraste
  else raiz.dataset.contraste = 'alto'
}

export function Vitrine() {
  const [carregando, setCarregando] = useState(false)
  function simular(ms: number) {
    setCarregando(true)
    setTimeout(() => setCarregando(false), ms)
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-2xl font-bold">Design system</h1>

      <Cartao className="space-y-2">
        <h2 className="font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS.map((s) => <StatusBadge key={s} status={s} />)}
        </div>
      </Cartao>

      <Cartao className="space-y-1">
        <h2 className="font-semibold">Valores</h2>
        <p className="text-2xl font-bold"><Dinheiro centavos={123456} /></p>
        <p><Dinheiro centavos={-5000} className="text-[var(--status-cancelada)]" /></p>
      </Cartao>

      <Cartao className="space-y-3">
        <h2 className="font-semibold">Botões</h2>
        <Botao variante="principal" className="w-full">Ação principal</Botao>
        <Botao className="w-full" onClick={alternarContraste}>Alternar alto contraste</Botao>
        <Botao variante="perigo" className="w-full">Cancelar</Botao>
      </Cartao>

      <Cartao className="space-y-3">
        <h2 className="font-semibold">Carregamento</h2>
        <div className="flex gap-2">
          <Botao onClick={() => simular(200)}>Simular 200 ms</Botao>
          <Botao onClick={() => simular(1500)}>Simular 1500 ms</Botao>
        </div>
        <CarregandoPickup ativo={carregando} />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </Cartao>

      <Link to="/" viewTransition className="block font-semibold underline underline-offset-4">Voltar</Link>
    </main>
  )
}
```

- [ ] **Step 4: `src/rotas.tsx`**

```tsx
import { createBrowserRouter } from 'react-router'
import { Moldura } from './telas/Moldura.tsx'

export const roteador = createBrowserRouter([
  {
    path: '/',
    Component: Moldura,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./telas/Inicio.tsx')).Inicio }) },
      { path: 'vitrine', lazy: async () => ({ Component: (await import('./telas/Vitrine.tsx')).Vitrine }) },
    ],
  },
])
```

- [ ] **Step 5: `src/main.tsx` final**

```tsx
import '@fontsource-variable/manrope'
import './design/estilos.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { roteador } from './rotas.tsx'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={roteador} />
  </StrictMode>,
)
```

- [ ] **Step 6: Verificar no navegador**

Run: `npm run typecheck; npm run lint; npm run dev`
Abrir `http://localhost:5173`, navegar Início → Vitrine → Voltar; clicar "Simular 1500 ms" (pickup aparece, rodas giram) e "Alternar alto contraste". Parar o servidor.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(front): rotas com lazy, moldura com carregamento e vitrine do design system"
```

---

### Task 11: PWA — manifest, ícones e service worker

**Files:**
- Create: `public/icone.svg`, `pwa-assets.config.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Dependências**

```bash
npm install --save-exact -D vite-plugin-pwa@2.0.0 @vite-pwa/assets-generator@2.0.0 workbox-window@7.4.1
```

- [ ] **Step 2: `public/icone.svg` (pickup com reboque, marinho + laranja)**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0B2545"/>
  <g transform="translate(36 150)">
    <rect x="0" y="70" width="120" height="70" rx="10" fill="#F7F5F0"/>
    <rect x="120" y="118" width="26" height="10" fill="#F7F5F0"/>
    <path d="M146 80h104V36h86l44 46h22a14 14 0 0 1 14 14v52H146z" fill="#F7F5F0"/>
    <path d="M330 50h-70v32h102z" fill="#0B2545"/>
    <rect x="398" y="108" width="18" height="10" rx="3" fill="#FF6B1A"/>
    <circle cx="60" cy="150" r="30" fill="#FF6B1A"/><circle cx="60" cy="150" r="12" fill="#0B2545"/>
    <circle cx="210" cy="150" r="30" fill="#FF6B1A"/><circle cx="210" cy="150" r="12" fill="#0B2545"/>
    <circle cx="364" cy="150" r="30" fill="#FF6B1A"/><circle cx="364" cy="150" r="12" fill="#0B2545"/>
  </g>
  <rect x="64" y="350" width="384" height="10" rx="5" fill="#FF6B1A"/>
</svg>
```

- [ ] **Step 3: `pwa-assets.config.ts`**

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const fundo = { background: '#0B2545' }

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: fundo },
    apple: { ...minimal2023Preset.apple, resizeOptions: fundo },
  },
  images: ['public/icone.svg'],
})
```

- [ ] **Step 4: `vite.config.ts` final**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registro por arquivo externo (registerSW.js): nenhum script inline.
      injectRegister: 'script',
      pwaAssets: { config: true },
      manifest: {
        name: 'Umi San Transporte',
        short_name: 'Umi San',
        description: 'Agendamento, orçamento e execução de transportes.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B2545',
        theme_color: '#0B2545',
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
      },
    }),
  ],
})
```

- [ ] **Step 5: Verificar**

Run: `npx vite build`
Expected: `dist/manifest.webmanifest`, `dist/sw.js`, `dist/registerSW.js`, PNGs `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. Em `dist/index.html`: `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">` e nenhum script inline.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(pwa): manifest, ícones gerados e service worker com cache do app shell"
```

---

### Task 12: `_headers` com CSP gerada no build

**Files:**
- Create: `public/_headers`, `scripts/gerar-headers.ts`, `scripts/gerar-headers.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Teste que falha**

`scripts/gerar-headers.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { montarCsp } from './gerar-headers.ts'

describe('montarCsp', () => {
  it('produção: https e wss do projeto Supabase, sem unsafe-*', () => {
    const csp = montarCsp('https://abc.supabase.co')
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co")
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com")
    expect(csp).toContain("style-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toMatch(/unsafe-(inline|eval)/)
  })

  it('local: http e ws com porta', () => {
    expect(montarCsp('http://127.0.0.1:54321')).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    )
  })
})
```
Run: `npm run test:unit` → Expected: FAIL (módulo inexistente).

- [ ] **Step 2: `scripts/gerar-headers.ts`**

```ts
// Substitui __CSP__ em dist/_headers pela CSP do projeto Supabase alvo (SECURITY itens 18 e 19).
// Uso: node scripts/gerar-headers.ts [modo=production]
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

export function montarCsp(urlSupabase: string): string {
  const url = new URL(urlSupabase)
  const websocket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  const diretivas: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", 'https://challenges.cloudflare.com']],
    ['frame-src', ['https://challenges.cloudflare.com']],
    ['connect-src', ["'self'", url.origin, websocket]],
    ['img-src', ["'self'", 'data:', 'blob:', url.origin]],
    ['style-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ]
  return diretivas.map(([nome, valores]) => `${nome} ${valores.join(' ')}`).join('; ')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const modo = process.argv[2] ?? 'production'
  const urlSupabase = process.env.VITE_SUPABASE_URL ?? loadEnv(modo, process.cwd(), 'VITE_').VITE_SUPABASE_URL
  if (!urlSupabase) {
    console.error('VITE_SUPABASE_URL ausente')
    process.exit(1)
  }
  const caminho = 'dist/_headers'
  const original = readFileSync(caminho, 'utf8')
  if (!original.includes('__CSP__')) {
    console.error(`${caminho} sem o marcador __CSP__`)
    process.exit(1)
  }
  writeFileSync(caminho, original.replace('__CSP__', montarCsp(urlSupabase)))
  console.log(`CSP gravada em ${caminho} para ${new URL(urlSupabase).host}`)
}
```
Run: `npm run test:unit` → Expected: PASS.

- [ ] **Step 3: `public/_headers`**

```
/*
  Content-Security-Policy: __CSP__
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), geolocation=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
```

- [ ] **Step 4: Scripts de build**

```bash
npm pkg set scripts.build="vite build && node scripts/gerar-headers.ts production" scripts.build:test="vite build --mode test && node scripts/gerar-headers.ts test"
```
Run: `npm run build:test; Get-Content dist/_headers -TotalCount 2`
Expected: segunda linha com `Content-Security-Policy: default-src 'self'; ... connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321; ...`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(seguranca): headers do Pages com CSP rígida gerada por ambiente"
```

---

### Task 13: Orçamento de bundle

**Files:**
- Create: `scripts/orcamento-bundle.ts`, `scripts/orcamento-bundle.test.ts`

- [ ] **Step 1: Teste que falha**

`scripts/orcamento-bundle.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { arquivosIniciais } from './orcamento-bundle.ts'

describe('arquivosIniciais', () => {
  it('lista JS e CSS referenciados pelo index.html, inclusive modulepreload', () => {
    const html = `
      <script type="module" crossorigin src="/assets/index-a1.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-b2.js">
      <link rel="stylesheet" crossorigin href="/assets/index-c3.css">
      <link rel="icon" href="/favicon.ico">
      <script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>`
    expect(arquivosIniciais(html)).toEqual(['assets/index-a1.js', 'assets/vendor-b2.js', 'assets/index-c3.css'])
  })
})
```
Run: `npm run test:unit` → Expected: FAIL.

- [ ] **Step 2: Implementação**

`scripts/orcamento-bundle.ts`:
```ts
// Falha se JS + CSS da carga inicial passarem de 150 KB gzip (meta: tela < 1 s em 4G).
// Uso: node scripts/orcamento-bundle.ts [pasta=dist]
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const LIMITE_BYTES = 150 * 1024

export function arquivosIniciais(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1] ?? '')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2] ?? 'dist'
  const arquivos = arquivosIniciais(readFileSync(join(pasta, 'index.html'), 'utf8'))
  let total = 0
  for (const arquivo of arquivos) {
    const tamanho = gzipSync(readFileSync(join(pasta, arquivo))).length
    total += tamanho
    console.log(`${(tamanho / 1024).toFixed(1).padStart(7)} KB  ${arquivo}`)
  }
  console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total gzip (limite ${LIMITE_BYTES / 1024} KB)`)
  if (total > LIMITE_BYTES) process.exit(1)
}
```

- [ ] **Step 3: Rodar**

Run: `npm run test:unit; npm run build:test; node scripts/orcamento-bundle.ts`
Expected: PASS; total abaixo de 150 KB.

- [ ] **Step 4: Commit**

```bash
git add scripts
git commit -m "feat(ci): orçamento de 150 KB gzip para a carga inicial"
```

---

### Task 14: Testes e2e (Playwright contra `wrangler pages dev`)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/seguranca.spec.ts`, `tests/e2e/pwa.spec.ts`, `tests/e2e/design.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Dependências**

```bash
npm install --save-exact -D @playwright/test@1.64.0 wrangler@4.148.0
npx playwright install chromium
npm pkg set scripts.preview="wrangler pages dev dist --port 8788 --ip 127.0.0.1" scripts.test:e2e="playwright test"
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test'

const URL_BASE = 'http://127.0.0.1:8788'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: URL_BASE, trace: 'retain-on-failure' },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
  // wrangler pages dev aplica o _headers igual ao Cloudflare Pages.
  webServer: {
    command: 'npx wrangler pages dev dist --port 8788 --ip 127.0.0.1',
    url: URL_BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
})
```

- [ ] **Step 3: `tests/e2e/seguranca.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('headers de segurança presentes (SECURITY item 19)', async ({ request }) => {
  const h = (await request.get('/')).headers()
  expect(h['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com")
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['content-security-policy']).not.toMatch(/unsafe-(inline|eval)/)
  expect(h['strict-transport-security']).toContain('max-age=63072000')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(h['permissions-policy']).toContain('geolocation=()')
})

test('CSP bloqueia script inline injetado (SECURITY item 18)', async ({ page }) => {
  await page.goto('/')
  const resultado = await page.evaluate(
    () =>
      new Promise<{ executou: boolean; diretiva: string }>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (e) =>
            resolve({
              executou: Boolean((window as unknown as { __injetado?: boolean }).__injetado),
              diretiva: e.violatedDirective,
            }),
          { once: true },
        )
        const script = document.createElement('script')
        script.textContent = 'window.__injetado = true'
        document.body.appendChild(script)
      }),
  )
  expect(resultado.executou).toBe(false)
  expect(resultado.diretiva).toMatch(/^script-src/)
})

test('nenhuma violação de CSP ao navegar', async ({ page }) => {
  const violacoes: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(m.text())
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Ver design system' }).click()
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible()
  expect(violacoes).toEqual([])
})
```

- [ ] **Step 4: `tests/e2e/pwa.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('manifest instalável', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ name: 'Umi San Transporte', display: 'standalone', lang: 'pt-BR', start_url: '/' })
  const icones = manifest.icons as Array<{ sizes: string; purpose?: string }>
  expect(icones.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(icones.some((i) => i.purpose === 'maskable')).toBe(true)
})

test('service worker controla a página e o app abre offline', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Umi San Transporte' })).toBeVisible()
})
```

- [ ] **Step 5: `tests/e2e/design.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('carregamento curto (200 ms) nunca mostra a pickup', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 200 ms' }).click()
  const apareceu = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const fim = performance.now() + 600
        const olhar = () => {
          if (document.querySelector('[data-testid="carregando-pickup"]')) return resolve(true)
          if (performance.now() > fim) return resolve(false)
          requestAnimationFrame(olhar)
        }
        olhar()
      }),
  )
  expect(apareceu).toBe(false)
})

test('carregamento longo mostra a pickup só depois de 400 ms', async ({ page }) => {
  await page.goto('/vitrine')
  const inicio = Date.now()
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  await expect(page.getByTestId('carregando-pickup')).toBeVisible()
  expect(Date.now() - inicio).toBeGreaterThanOrEqual(380)
  await expect(page.getByTestId('carregando-pickup')).toBeHidden({ timeout: 3_000 })
})

test('com movimento reduzido as rodas não giram', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  const roda = page.getByTestId('pickup-roda').first()
  await expect(roda).toBeAttached()
  expect(await roda.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

test('valores monetários usam números tabulares', async ({ page }) => {
  await page.goto('/vitrine')
  await expect(page.getByText(/1\.234,56/)).toHaveCSS('font-variant-numeric', 'tabular-nums')
})
```

- [ ] **Step 6: Rodar**

Run: `npm run build:test; npm run test:e2e`
Expected: 9 testes PASS no projeto `celular`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(e2e): headers, CSP, PWA offline e regras de animação contra wrangler pages dev"
```

---

### Task 15: CI no GitHub Actions e Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  testes:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      WRANGLER_SEND_METRICS: 'false'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Dependências sem vulnerabilidade alta/crítica (SECURITY item 13)
        run: npm audit --audit-level=high
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - name: Supabase local
        run: npx supabase start -x studio,imgproxy,vector,logflare
      - name: pgTAP
        run: npx supabase test db
      - run: node scripts/env-local.ts
      - run: npm run test:integracao
      - run: npm run build:test
      - name: Nenhum segredo no bundle (SECURITY item 1)
        run: node scripts/varrer-segredos.ts dist
      - run: node scripts/orcamento-bundle.ts
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7

  segredos-repositorio:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      timezone: America/Sao_Paulo
    open-pull-requests-limit: 5
    groups:
      menores:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Escopo `workflow` no gh e alertas do Dependabot**

O token atual do `gh` não tem o escopo `workflow` (necessário para enviar arquivos em `.github/workflows`). Rodar em segundo plano e pedir ao usuário que autorize o código exibido em https://github.com/login/device:
```bash
"/c/Program Files/GitHub CLI/gh.exe" auth refresh -h github.com -s workflow
```
Depois:
```bash
"/c/Program Files/GitHub CLI/gh.exe" api -X PUT repos/claudioevamaral2002-a11y/umi-san-transporte/vulnerability-alerts
```

- [ ] **Step 4: Commit e push**

```bash
git add .github
git commit -m "ci: pipeline com pgTAP, integração, e2e, auditoria e varredura de segredos"
git push
```

- [ ] **Step 5: Acompanhar a execução**

Run: `"/c/Program Files/GitHub CLI/gh.exe" run watch --exit-status`
Expected: jobs `testes` e `segredos-repositorio` verdes. Falhou → `gh run view --log-failed`, corrigir, novo commit.

---

### Task 16: Deploy condicionado ao CI verde

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Ambiente `producao` no GitHub**

```bash
"/c/Program Files/GitHub CLI/gh.exe" api -X PUT repos/claudioevamaral2002-a11y/umi-san-transporte/environments/producao
```

- [ ] **Step 2: `.github/workflows/deploy.yml`**

```yaml
name: Deploy

# Só roda depois do CI concluído com sucesso num push na main.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read

concurrency:
  group: deploy-producao
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-24.04
    environment: producao
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
      VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}
      WRANGLER_SEND_METRICS: 'false'
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      # Banco antes do front: o front novo nunca chama RPC que ainda não existe.
      - name: Migrations no Supabase
        run: |
          npx supabase link --project-ref "${{ vars.SUPABASE_PROJECT_REF }}"
          npx supabase db push
      - run: npm run build
      - name: Nenhum segredo no bundle
        run: node scripts/varrer-segredos.ts dist
      - name: Publicar no Cloudflare Pages
        run: |
          npx wrangler pages project create umi-san-transporte --production-branch main || echo "Projeto Pages já existe"
          npx wrangler pages deploy dist --project-name umi-san-transporte --branch main --commit-hash "${{ github.event.workflow_run.head_sha }}"
```

- [ ] **Step 3: Conferir secrets antes do push**

Run: `"/c/Program Files/GitHub CLI/gh.exe" secret list -R claudioevamaral2002-a11y/umi-san-transporte`
Expected: `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Se faltar algum, parar e pedir ao usuário (passo a passo já entregue na conversa); não prosseguir com o push do deploy.

- [ ] **Step 4: Commit, push e acompanhar**

```bash
git add .github
git commit -m "ci: deploy (migrations + Pages) somente após CI verde na main"
git push
"/c/Program Files/GitHub CLI/gh.exe" run watch --exit-status
```
Expected: CI verde e, em seguida, `Deploy` verde. URL publicada aparece no log do passo "Publicar no Cloudflare Pages" (`https://umi-san-transporte.pages.dev`).

- [ ] **Step 5: Verificação em produção**

```bash
curl -sI https://umi-san-transporte.pages.dev | grep -iE "content-security-policy|strict-transport|x-content-type"
```
Expected: os três headers presentes, CSP com `connect-src 'self' https://eoczqrpvhfeulfhjblaw.supabase.co wss://eoczqrpvhfeulfhjblaw.supabase.co`.

---

### Task 17: Fechamento da fase

**Files:**
- Create: `docs/fases/fase-0-o-que-testar.md`

- [ ] **Step 1: Lista do que testar (especificação 14)**

`docs/fases/fase-0-o-que-testar.md`:
```markdown
# Fase 0 — o que testar

## Automático (CI, bloqueia o deploy)
- pgTAP: schemas, privilégios, funções SECURITY DEFINER com search_path, views security_invoker, RLS em app, política do Realtime
- Integração: API só serve `api`; escrita direta recusada; RPC sem Authorization recusada; Realtime A recebe / B recusado
- E2E: headers de segurança; CSP bloqueia script injetado; zero violações navegando; manifest; offline; pickup só após 400 ms; movimento reduzido; números tabulares
- Auditoria npm (alto/crítico), varredura de segredos (bundle + repositório), orçamento de 150 KB gzip

## Manual (no celular)
1. Abrir https://umi-san-transporte.pages.dev no Chrome (Android) ou Safari (iPhone).
2. Instalar: Android → menu ⋮ → "Instalar app"; iPhone → Compartilhar → "Adicionar à Tela de Início".
3. Abrir pelo ícone: abre em tela cheia, ícone da pickup com reboque, barra no azul-marinho.
4. Ir em "Ver design system": a tela desliza; status com ícone + texto; valores alinhados.
5. "Simular 1500 ms": pickup andando na estrada, rodas girando. "Simular 200 ms": nada aparece.
6. "Alternar alto contraste": tudo legível sob o sol.
7. Modo avião e abrir o app de novo: a tela inicial abre.
8. Celular em modo escuro: cores mudam automaticamente.
```

- [ ] **Step 2: Commit e push**

```bash
git add docs
git commit -m "docs: checklist do que testar na fase 0"
git push
```

---

## Self-review (feito pelo autor do plano)

- **Cobertura do desenho da fase 0:** estrutura (T1–T14), schemas/REVOKE/default privileges/api.ping (T3), prova do Realtime (T4, T6), testes pgTAP (T3, T4), integração (T5, T6), e2e (T14), gates do CI (T7, T13, T15), deploy banco → front (T16), design system/PWA/animação (T8–T11), CSP (T12), checklist (T17).
- **Adiado de propósito (registrado no desenho):** Motion e bottom sheet (entram com a primeira interação que precisa deles); direção push/pop distinta nas transições (fase 3, com a navegação real); `supabase config push` do Auth para o remoto (fase 1, junto com Turnstile e `site_url` por ambiente); schemas expostos no projeto remoto passam a `api` na fase 1 (o front da fase 0 não chama a API).
- **Consistência de nomes:** `formatarCentavos`, `useAtrasoVisivel`, `ATRASO_CARREGAMENTO_MS`, `encontrarSegredos`, `montarCsp`, `arquivosIniciais`, `criarUsuario`, `comBanco`, `clientePublico`, `app.pode_ver_prova`, `app.prova_canal`, `api.ping` — usados igual em todas as tarefas.
