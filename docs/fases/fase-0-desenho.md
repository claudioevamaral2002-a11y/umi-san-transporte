# Fase 0 — Fundação (desenho)

Referência: `docs/especificacao.md` seções 1, 9, 12 e Adendo A.

## Objetivo
Deixar pronta a esteira completa, sem regra de negócio: front PWA publicado, banco com schemas e privilégios corretos, CI que bloqueia deploy, prova do Realtime privado e design system. Ao fim da fase, toda fase seguinte só adiciona migrations, funções, telas e testes, sem precisar mexer na infraestrutura.

## Estrutura do repositório

```
umi-san-transporte/
├─ src/
│  ├─ main.tsx, App.tsx, rotas.tsx
│  ├─ lib/supabase.ts            # cliente único; só URL + anon key (VITE_*)
│  ├─ design/
│  │  ├─ tokens.css              # cores, espaçamento, raio, sombra, motion (CSS variables)
│  │  ├─ fontes/                 # Manrope self-hosted (woff2) — sem Google Fonts, CSP só 'self'
│  │  └─ componentes/            # Botao, Cartao, StatusBadge, Dinheiro, Skeleton, CarregandoPickup
│  └─ telas/
│     ├─ Inicio.tsx              # placeholder da tela inicial
│     └─ Vitrine.tsx             # catálogo do design system (usado pelo e2e)
├─ public/
│  ├─ _headers                   # CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy
│  └─ icones/                    # pickup com reboque, marinho + laranja (192, 512, maskable, apple-touch)
├─ supabase/
│  ├─ config.toml                # api.schemas = ["api"], jwt_expiry = 900, enable_signup = false, MFA TOTP on
│  ├─ migrations/
│  │  ├─ 0001_schemas_privilegios.sql
│  │  └─ 0002_prova_realtime.sql
│  ├─ tests/                     # pgTAP
│  └─ seed.sql                   # usuários de teste (só local/CI)
├─ tests/
│  ├─ integracao/                # Vitest + supabase-js contra Supabase local
│  └─ e2e/                       # Playwright contra `wrangler pages dev` (aplica o _headers de verdade)
├─ scripts/
│  └─ varrer-segredos.mjs        # falha se o bundle tiver service_role/JWT de serviço/chaves conhecidas
├─ .github/
│  ├─ workflows/ci.yml           # testes em todo push/PR
│  ├─ workflows/deploy.yml       # main: só roda após ci.yml verde; db push + pages deploy
│  └─ dependabot.yml
└─ docs/
```

Pacote único (sem monorepo). Versões exatas no `package.json` (`save-exact=true` no `.npmrc`); Supabase CLI e wrangler como devDependencies fixadas e chamados via `npx`, para o CI e qualquer máquina usarem a mesma versão.

## Banco (migration 0001)
- Cria os schemas `api`, `app`, `interno`.
- `anon` não recebe nada em nenhum dos três.
- `interno`: nenhum privilégio para `anon`/`authenticated`.
- `app`: `authenticated` recebe `USAGE` no schema, mas **nunca** INSERT/UPDATE/DELETE/TRUNCATE. SELECT em tabela só quando uma view `security_invoker` de `api` precisar (sempre filtrado por RLS) — o schema não é exposto, então a tabela nunca é lida direto pela API. Funções de autorização usadas em políticas (`app.pode_*`, `SECURITY DEFINER`, `search_path` fixo) recebem EXECUTE para `authenticated`; nenhuma outra função de `app`.
- `api`: `USAGE` para `authenticated` (não para `anon`). `ALTER DEFAULT PRIVILEGES` revoga `EXECUTE` de `public` em funções novas — cada RPC recebe GRANT explícito.
- `api.ping()` (retorna `'pong'`, só `authenticated`): serve de evidência do item 10 (sem Authorization → recusado) e, na fase 5, de keep-alive.
- `config.toml`: só `api` exposto pelo PostgREST (`public` deixa de ser exposto).
- A regra A4 (views `security_invoker`) é verificada por teste pgTAP no catálogo, não por função.

## Prova do Realtime (migration 0002)
Tabela mínima `app.prova_canal(id, dono uuid)` e política RLS em `realtime.messages` que só autoriza `SELECT` (assinar) no tópico `prova:<id>` quando `dono = auth.uid()`. Trigger publica `{id, status, em}` via `realtime.send` com `private = true`. Na fase 1, a política passa a usar a função real de permissão de pedido e a tabela de prova é removida.

## Front
- Vite + React + React Router (data router, rotas com lazy) + Tailwind (tokens via CSS variables). Motion entra na fase em que surge a primeira interação que precisa dele (deslizar para confirmar, recibo); nesta fase as transições são View Transitions + CSS.
- A prova do Realtime é feita por teste de integração (não há tela de login ainda).
- `vite-plugin-pwa` (Workbox): precache do app shell, `manifest` com `display: standalone`, cores marinho/off-white, ícones e splash.
- Tokens: tema claro, escuro automático (`prefers-color-scheme`) e alto contraste (`[data-contraste="alto"]`, alternável pelo motorista). Laranja só em ação principal e alerta.
- `font-variant-numeric: tabular-nums` no componente `Dinheiro` (recebe centavos, formata `Intl.NumberFormat('pt-BR', {currency: 'BRL'})`; nunca faz conta).
- `CarregandoPickup`: SVG inline animado com CSS (rodas girando, faixa tracejada, balanço), < 10 KB. Sem Lottie: evita dependência e mantém a CSP simples. Aparece só se o carregamento passar de 400 ms; com `prefers-reduced-motion`, vira indicador estático com texto.
- Transições de tela: View Transitions API (`<Link viewTransition>` do React Router) com deslize push/pop em CSS; onde não houver suporte, a troca é instantânea; desligadas com `prefers-reduced-motion`.
- Estado pressionado imediato nos botões (`:active` + `touch-action: manipulation`), vibração curta via `navigator.vibrate` onde existir.

## CSP inicial (`public/_headers`)
```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
connect-src 'self' https://<projeto>.supabase.co wss://<projeto>.supabase.co;
img-src 'self' data: blob: https://<projeto>.supabase.co;
style-src 'self';
font-src 'self';
worker-src 'self';
manifest-src 'self';
frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
```
`<projeto>` é substituído no build a partir de `VITE_SUPABASE_URL`. Motion e a prop `style` do React escrevem via CSSOM, o que a CSP permite sem `unsafe-inline`; o que é proibido é `<style>` e atributo `style=` no HTML — o build não pode gerar nenhum dos dois. O `vite-plugin-pwa` usa `injectRegister: 'script'` (arquivo externo, sem script inline). `style-src` rígido é testado no e2e.

## Testes da fase
**pgTAP**
- os três schemas existem; `anon` sem USAGE em nenhum; `interno` sem USAGE para `authenticated`
- nenhuma tabela de `app` com INSERT/UPDATE/DELETE/TRUNCATE para `anon`/`authenticated`
- nenhuma função de `interno` tem EXECUTE para `anon`/`authenticated`; em `app`, só `pode_*` `SECURITY DEFINER`
- toda função `SECURITY DEFINER` dos três schemas tem `search_path` fixo
- toda view de `api` tem `security_invoker = true` (passa vazio agora; protege as fases seguintes)
- toda tabela de `app` tem RLS habilitado

**Vitest (integração, Supabase local)**
- PostgREST não serve `app` nem `interno` (Accept-Profile `app` → erro)
- INSERT/UPDATE/DELETE direto em `app.prova_canal` via API → recusado, com qualquer usuário
- RPC sem header Authorization → recusada (evidência do item 10 / CSRF)
- usuário A assina `prova:<id de A>` e recebe o broadcast; usuário B é recusado no mesmo canal

**Playwright (e2e contra `wrangler pages dev dist`)**
- app abre; manifest válido; service worker registrado; segunda carga offline mostra o shell
- headers de segurança presentes com os valores esperados
- script inline injetado é bloqueado pela CSP (evento `securitypolicyviolation`)
- `CarregandoPickup` não aparece abaixo de 400 ms e aparece acima; com reduced motion, sem animação
- valores monetários com números tabulares; nenhuma violação de CSP ao navegar

**Orçamento de bundle** (script no CI): JS + CSS da carga inicial < 150 KB gzip.

**Gates do CI (todos bloqueiam deploy)**
- os três conjuntos acima
- `npm audit --audit-level=high`
- `scripts/varrer-segredos.mjs` no `dist/` + gitleaks no repositório
- `tsc --noEmit` e lint

## Deploy
- `ci.yml`: push e PR em qualquer branch → sobe Supabase local (Docker no runner), `db reset`, roda testes, build, e2e.
- `deploy.yml`: dispara com `workflow_run` do CI concluído com sucesso na `main`:
  1. `supabase db push` no projeto remoto (secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`)
  2. `wrangler pages deploy dist` (secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
- Ordem banco → front, para o front novo nunca chamar RPC que ainda não existe. Migrations sempre retrocompatíveis com o front anterior.

## O que depende de você (checklist)
1. Instalar GitHub CLI e fazer login: `winget install GitHub.cli` e depois `gh auth login`. Com isso eu crio o repositório privado `umi-san-transporte` e configuro os secrets.
2. Criar a conta Cloudflare e um API token com permissão "Cloudflare Pages: Edit". Você cadastra o token direto como secret no GitHub, nunca pelo chat.
3. No Supabase: criar o projeto em **South America (São Paulo)** e me informar o *project ref* (não é segredo). Você gera o access token e a senha do banco e cadastra como secrets no GitHub.
4. Docker rodando na máquina (já está instalado) para o Supabase local.

Os itens 2 e 3 não bloqueiam o começo: tudo roda localmente até o primeiro deploy.

## Fora desta fase
Perfis, auth/2FA/HIBP, Turnstile, qualquer tabela de negócio (fase 1 em diante). O `config.toml` já nasce com MFA e signup fechado, mas os fluxos de tela de login entram na fase 1.

## Critério de pronto
CI verde na `main` com todos os gates; app publicado no `*.pages.dev`, instalável no celular; vitrine do design system navegável; prova do Realtime mostrando A recebe / B recusado.
