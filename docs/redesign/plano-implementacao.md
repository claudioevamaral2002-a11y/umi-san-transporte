# Redesign mobile da IVO: plano de implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:subagent-driven-development` (recomendada) ou `superpowers:executing-plans`. Os passos usam caixas `- [ ]`.

**Objetivo:** aplicar o design aprovado em 13–14/10/2026 (mockups em `docs/redesign/mockups-mobile.html`) a todas as telas do celular, sem mudar regra de negócio.

**Arquitetura:** só front-end (Vite + React 19 + Tailwind 4). Os tokens de `src/design/tokens.css` continuam como fonte única de cor; os componentes em `src/design/componentes/` ganham a nova hierarquia de raios, seleção com contorno laranja e o triângulo da marca como marcador de "agora". A lógica nova (posição dos blocos na grade de horas e grade de horários com ocupados) fica em funções puras em `src/lib/`, com testes de unidade. Nenhuma migration, nenhuma RPC nova.

**Stack:** React 19, react-router 8, Tailwind 4 (`@theme inline`), Vitest 5, Playwright 1.64 (projetos `celular` = Pixel 7 e `iphone` = iPhone 15 só para `toque-*.spec.ts`).

**Especificação:** `docs/HANDOFF-redesign-mobile.md` §3 (plano aprovado), `docs/redesign/mockups-mobile.html` (telas aprovadas; carrinho opção A, barco), `docs/marca/TIPOGRAFIA.md`, `docs/especificacao.md` §12 e Adendo A7.

## Restrições globais

- Paleta, uma função por cor: Azul Profundo `#0A2540` (barras de comando, selecionado no claro); Off White `#F6F4EE` (fundo); Branco (folhas e cartões); **Laranja Sinal `#FF6A00` só na ação principal de cada tela e no marcador de "agora"**; Azul Maré `#1E4B7A` (agendado, seleção suave); Névoa `#E1E6ED` (linhas). Texto laranja só com `#C2410C` (claro) e `#FF8A4C` (escuro).
- Só Manrope, na escala de `TIPOGRAFIA.md`. Títulos 700 com espaçamento apertado; valores 700 com `tabular-nums`; nada de peso 300 em controles.
- Raios: folhas 24 px, cartões 16, campos 12, botões 14, pílulas 999.
- Seleção: cor cheia (`--cor-selecao`) com contorno laranja de 2 px afastado 2 px, **sem ícone de ✓**. No escuro, off-white cheio com texto marinho.
- Remover: sobretítulos em MAIÚSCULAS espaçadas fora de agrupamentos de lista; textos unidos por `" · "`; `→` em botões e rotas (usar o componente `Rota`).
- Marcadores do calendário: `src/telas/agenda/marcadores.tsx` continua a fonte única; `--cor-selecao` continua a fonte única da seleção.
- Status sempre com ícone e texto.
- Carrinho: SVG < 50 KB, em loop, sem dependência nova, só aparece após 400 ms, parado com `prefers-reduced-motion`.
- CSP: zero violações (nada de `style` inline gerado por string em `<style>`; atributos `style` do React são permitidos como hoje).
- Bundle inicial ≤ 150 KB gzip (`scripts/orcamento-bundle.ts`).
- Contraste AA de todos os pares nos dois modos (4,5:1 texto; 3:1 marcadores, contornos e controles).
- Nenhuma UI otimista em ação financeira; valores só depois da resposta do servidor (inalterado).
- Textos em pt-BR, voz ativa, sentence case; o botão diz o que acontece ("Enviar pedido", "Aprovar R$ 1.850,00").

## Foco de revisão

1. **Dia com muitos blocos sobrepostos** (pré-reserva + reserva no mesmo horário, vistos pela equipe): a grade da agenda precisa dividir a largura entre eles, não empilhar um sobre o outro → teste em `gradeAgenda.test.ts` (Tarefa 6).
2. **Bloco que atravessa a meia-noite ou começa antes da primeira hora da grade**: deve ser cortado nos limites da grade, sem altura negativa → teste em `gradeAgenda.test.ts` (Tarefa 6).
3. **Dia sem nenhum horário livre** no passo "Quando": a grade não pode inventar ocupados; mostra a mensagem de dia sem horário → teste em `horariosDoDia.test.ts` (Tarefa 5).
4. **Modo escuro + alto contraste do motorista**: `data-contraste="alto"` precisa vencer o escuro também nos tokens novos (`--cor-ocupado`, `--cor-livre`, `--cor-bloco`) → teste em `tokens.test.ts` (Tarefa 1).
5. **Fuso de São Paulo**: a linha do "agora" e a faixa de dias usam `hoje()`/`horaDe()` de `src/lib/tempo.ts` (America/Sao_Paulo), nunca `new Date().getHours()` → teste com `agora` injetado em `gradeAgenda.test.ts` (Tarefa 6).

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/design/tokens.css` (mod.) | Tokens novos: raios, ocupado, livre, bloco, seleção suave; correção do cinza ocupado |
| `src/design/estilos.css` (mod.) | `@theme` dos tokens novos, classe `.ivo-escolhido`, animações do carrinho |
| `src/design/contraste.ts` + `.test.ts` (novo) | Cálculo WCAG e leitura dos tokens para o teste de pares |
| `src/design/tokens.test.ts` (novo) | Todos os pares AA nos modos claro, escuro e alto contraste |
| `src/design/componentes/Botao.tsx`, `Cartao.tsx`, `Campo.tsx`, `Folha.tsx` (mod.) | Hierarquia de raios |
| `src/design/componentes/StatusBadge.tsx` (mod.) | Ícones SVG (no lugar de glifos) e pílula preenchida |
| `src/design/componentes/Segmentado.tsx` (novo) | Seletor em pílula (Dia/3 dias/Mês, filtros, Sim/Não) |
| `src/design/componentes/MarcaAgora.tsx` (novo) | Triângulo da marca (marcador de "agora" e destino da rota) |
| `src/design/componentes/CarregandoPickup.tsx` (mod.) | Novo carrinho (pickup + reboque com barco) |
| `src/telas/MolduraAutenticada.tsx` (mod.) | Topo com símbolo/empresa/avatar, barra inferior com pílula, botão "+" |
| `src/telas/Inicio.tsx`, `src/telas/saldo/CartaoSaldo.tsx` (mod.) | Início por perfil |
| `src/telas/pedidos/componentes.tsx`, `Pedidos.tsx`, `Pedido.tsx` (mod.) | Rota com triângulo, linha do tempo, lista |
| `src/lib/horariosDoDia.ts` + `.test.ts` (novo) | Grade de horários do passo "Quando" com livres e ocupados |
| `src/telas/pedidos/NovoPedido.tsx` (mod.) + `FaixaDias.tsx` (novo) | Barra de comando, passo "Quando" novo |
| `src/lib/gradeAgenda.ts` + `.test.ts` (novo) | Posição dos blocos na grade de horas, colunas sobrepostas, linha do agora |
| `src/telas/agenda/Agenda.tsx` (mod.), `GradeHoras.tsx`, `FaixaSemana.tsx` (novos) | Agenda estilo Lark (Dia, 3 dias, Mês) |
| `src/telas/pedidos/Orcar.tsx`, `src/telas/extrato/Extrato.tsx`, `src/telas/adm/Creditos.tsx`, `src/telas/adm/Painel.tsx`, `src/telas/entrada/*` (mod.) | Restilo das demais telas |
| `scripts/varrer-estilo.ts` + `.test.ts` (novo) | Guarda: proíbe `" · "` e `→` em texto de tela |
| `tests/e2e/toque-agenda.spec.ts` (novo), `toque-novo-pedido.spec.ts`, `design.spec.ts`, `legenda-calendario.spec.ts` (mod.) | Toque em Pixel e iPhone, claro e escuro |
| `tests/e2e/zz-capturas-redesign.spec.ts` (novo) | Capturas para o dono |

---

### Tarefa 1: tokens, contraste e classe de seleção

**Arquivos:**
- Criar: `src/design/contraste.ts`, `src/design/contraste.test.ts`, `src/design/tokens.test.ts`
- Modificar: `src/design/tokens.css`, `src/design/estilos.css`

**Interfaces:**
- Produz: `contraste(a: string, b: string): number` (hex `#rrggbb`), `lerTokens(css: string): Record<'claro' | 'escuro' | 'alto', Record<string, string>>`; tokens CSS `--cor-ocupado`, `--cor-livre`, `--cor-livre-fundo`, `--cor-bloco`, `--cor-bloco-texto`, `--cor-bloco-suave`, `--cor-selecao-suave`, `--cor-barra`, `--raio-folha: 24px`, `--raio-cartao: 16px`, `--raio-campo: 12px`, `--raio-botao: 14px`; utilitários Tailwind `bg-ocupado`, `text-livre`, `bg-bloco`, `rounded-folha`, `rounded-cartao`, `rounded-campo`, `rounded-botao`; classe `.ivo-escolhido`.

- [ ] **Passo 1: testes que falham**

`src/design/contraste.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { contraste, lerTokens } from './contraste.ts'

describe('contraste', () => {
  it('calcula pela fórmula WCAG', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#f6f4ee', '#0a2540')).toBeCloseTo(14.13, 1)
    expect(contraste('#ff6a00', '#0a2540')).toBeCloseTo(5.41, 1)
  })
})

describe('lerTokens', () => {
  it('separa claro, escuro e alto contraste', () => {
    const css = `:root { --a: #111111; --b: var(--a); }
@media (prefers-color-scheme: dark) { :root:not([data-tema="claro"]) { --a: #222222; } }
:root[data-contraste="alto"] { --a: #333333; }`
    const t = lerTokens(css)
    expect(t.claro['--b']).toBe('#111111')
    expect(t.escuro['--a']).toBe('#222222')
    expect(t.escuro['--b']).toBe('#222222')
    expect(t.alto['--a']).toBe('#333333')
  })
})
```

`src/design/tokens.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contraste, lerTokens } from './contraste.ts'

const tokens = lerTokens(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))

// [frente, fundo, mínimo]: 4,5 para texto; 3 para marcadores, contornos e controles.
const PARES: Array<[string, string, number]> = [
  ['--cor-texto', '--cor-fundo', 4.5],
  ['--cor-texto', '--cor-superficie', 4.5],
  ['--cor-texto-suave', '--cor-fundo', 4.5],
  ['--cor-texto-suave', '--cor-superficie', 4.5],
  ['--cor-selecao-texto', '--cor-selecao', 4.5],
  ['--cor-selecao', '--cor-fundo', 3],
  ['--cor-selecao', '--cor-superficie', 3],
  ['--cor-acao-texto', '--cor-acao', 4.5],
  ['--cor-alerta-texto', '--cor-fundo', 4.5],
  ['--cor-alerta-texto', '--cor-superficie', 4.5],
  ['--cor-livre', '--cor-livre-fundo', 4.5],
  ['--cor-ocupado', '--cor-fundo', 3],
  ['--cor-ocupado', '--cor-superficie', 3],
  ['--marcador-meu', '--cor-superficie', 3],
  ['--marcador-aguardando', '--cor-superficie', 3],
  ['--marcador-ocupado', '--cor-superficie', 3],
  ['--cor-bloco-texto', '--cor-bloco', 4.5],
  ['--cor-bloco-suave', '--cor-bloco', 4.5],
]

for (const modo of ['claro', 'escuro', 'alto'] as const) {
  describe(`pares AA no modo ${modo}`, () => {
    for (const [frente, fundo, minimo] of PARES) {
      it(`${frente} sobre ${fundo} ≥ ${minimo}`, () => {
        const t = tokens[modo]
        expect(contraste(t[frente]!, t[fundo]!)).toBeGreaterThanOrEqual(minimo)
      })
    }
  })
}

it('o laranja do contorno de seleção aparece no escuro (≥ 3:1 sobre o fundo)', () => {
  expect(contraste(tokens.escuro['--cor-laranja']!, tokens.escuro['--cor-fundo']!)).toBeGreaterThanOrEqual(3)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/design`
Esperado: FAIL (`contraste.ts` não existe).

- [ ] **Passo 3: implementar `contraste.ts`**

```ts
/** Contraste WCAG 2.x entre duas cores hex (#rrggbb). */
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

type Modo = 'claro' | 'escuro' | 'alto'

function declaracoes(bloco: string): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const m of bloco.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) saida[m[1]!] = m[2]!.trim()
  return saida
}

function resolver(mapa: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {}
  const valor = (k: string, n = 0): string => {
    const v = mapa[k] ?? ''
    const ref = /^var\((--[\w-]+)\)$/.exec(v)
    return ref && n < 10 ? valor(ref[1]!, n + 1) : v.toLowerCase()
  }
  for (const k of Object.keys(mapa)) r[k] = valor(k)
  return r
}

/** Lê tokens.css: base (:root), escuro (@media dark) e alto contraste (vence o escuro). */
export function lerTokens(css: string): Record<Modo, Record<string, string>> {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const base = declaracoes(/:root\s*\{([^}]*)\}/.exec(semComentarios)?.[1] ?? '')
  const escuro = declaracoes(/prefers-color-scheme:\s*dark\)\s*\{[^{]*\{([^}]*)\}/.exec(semComentarios)?.[1] ?? '')
  const alto = declaracoes(/\[data-contraste="alto"\]\s*\{([^}]*)\}/.exec(semComentarios)?.[1] ?? '')
  return {
    claro: resolver(base),
    escuro: resolver({ ...base, ...escuro }),
    alto: resolver({ ...base, ...escuro, ...alto }),
  }
}
```

- [ ] **Passo 4: atualizar `tokens.css`**

No `:root` (claro), acrescentar e trocar:
```css
  --cor-cinza-azulado: #74859c;   /* era #96a6bb (2,3:1 sobre o papel): ocupado precisa de 3:1 */
  --cor-ocupado: #74859c;
  --marcador-ocupado: var(--cor-ocupado);
  --cor-livre: #15803d;
  --cor-livre-fundo: #ecf7ef;
  --cor-bloco: #0a2540;           /* bloco do saldo */
  --cor-bloco-texto: #f6f4ee;
  --cor-bloco-suave: #a9b8cc;
  --cor-selecao-suave: #e6edf5;   /* seleção suave (Maré clara): frase de confirmação, avatar */
  --cor-barra: #ffffff;           /* barra inferior */
  --raio-folha: 24px;
  --raio-cartao: 16px;
  --raio-campo: 12px;
  --raio-botao: 14px;
  --raio: var(--raio-cartao);
  --sombra: 0 1px 2px rgb(10 37 64 / 0.06), 0 6px 20px rgb(10 37 64 / 0.07);
```
No bloco escuro:
```css
    --cor-superficie: #0c2a49;     /* era #0a2540: separa o cartão do fundo #061a30 */
    --cor-borda: #1b3d63;
    --cor-ocupado: #8094ad;
    --cor-livre: #4ade80;
    --cor-livre-fundo: #0d3326;
    --cor-bloco: #10365f;
    --cor-bloco-texto: #f6f4ee;
    --cor-bloco-suave: #b8c6d8;
    --cor-selecao-suave: #173f68;
    --cor-barra: #0a2540;
    --sombra: 0 0 0 1px #1b3d63;
```
No alto contraste:
```css
  --cor-ocupado: #374151;
  --cor-livre: #14532d;
  --cor-livre-fundo: #ffffff;
  --cor-bloco: #000000;
  --cor-bloco-texto: #ffffff;
  --cor-bloco-suave: #ffffff;
  --cor-selecao: #000000;
  --cor-selecao-texto: #ffffff;
  --cor-selecao-suave: #e5e7eb;
  --cor-barra: #ffffff;
  --marcador-meu: #1e3a8a;
  --marcador-aguardando: #9a3412;
```

- [ ] **Passo 5: `estilos.css`**

No `@theme inline`, acrescentar:
```css
  --color-ocupado: var(--cor-ocupado);
  --color-livre: var(--cor-livre);
  --color-livre-fundo: var(--cor-livre-fundo);
  --color-bloco: var(--cor-bloco);
  --color-bloco-texto: var(--cor-bloco-texto);
  --color-bloco-suave: var(--cor-bloco-suave);
  --color-selecao-suave: var(--cor-selecao-suave);
  --color-barra: var(--cor-barra);
  --color-laranja: var(--cor-laranja);
  --radius-folha: var(--raio-folha);
  --radius-cartao: var(--raio-cartao);
  --radius-campo: var(--raio-campo);
  --radius-botao: var(--raio-botao);
```
Em `@layer components`:
```css
  /* Escolhido (dia, horário, opção, aba do seletor): cor cheia + contorno laranja afastado, sem ✓. */
  .ivo-escolhido {
    background: var(--cor-selecao);
    color: var(--cor-selecao-texto);
    border-color: transparent;
    box-shadow: 0 0 0 2px var(--cor-fundo), 0 0 0 4px var(--cor-laranja);
  }
```

- [ ] **Passo 6: rodar e ver passar**

Run: `npx vitest run src/design && npm run typecheck && npm run lint`
Esperado: PASS. Se algum par falhar, ajustar o token (nunca o limite).

- [ ] **Passo 7: commit**

```bash
git add src/design
git commit -m "feat(design): tokens do redesign, seleção com contorno laranja e teste AA dos pares"
```

---

### Tarefa 2: componentes base (raios, status, segmentado, marca do agora)

**Arquivos:**
- Criar: `src/design/componentes/Segmentado.tsx`, `src/design/componentes/MarcaAgora.tsx`
- Modificar: `Botao.tsx`, `Cartao.tsx`, `Campo.tsx`, `Folha.tsx`, `StatusBadge.tsx`, `src/telas/Vitrine.tsx`
- Teste: `tests/e2e/design.spec.ts`

**Interfaces:**
- Consome: classes da Tarefa 1.
- Produz:
  - `Segmentado<T extends string>({ opcoes: ReadonlyArray<{ valor: T; rotulo: string }>, valor: T, aoMudar: (v: T) => void, rotulo: string, testid?: string })` com `role="radiogroup"` e itens `role="radio"` + `aria-checked`.
  - `MarcaAgora({ tamanho?: number, className?: string })`: `<svg viewBox="0 0 14 12"><path d="M0 0H14L7 12Z" fill="var(--cor-laranja)"/></svg>`, `aria-hidden`.

- [ ] **Passo 1: testes e2e que falham** (acrescentar em `tests/e2e/design.spec.ts`)

```ts
test('raios seguem a hierarquia (folha 24, cartão 16, campo 12, pílula)', async ({ page }) => {
  await page.goto('/vitrine')
  const raio = (id: string) => page.getByTestId(id).evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
  expect(await raio('vitrine-cartao')).toBe('16px')
  expect(await raio('vitrine-campo')).toBe('12px')
  expect(await raio('vitrine-botao')).toBe('14px')
})

test('segmentado: um só escolhido, com contorno laranja e sem ✓', async ({ page }) => {
  await page.goto('/vitrine')
  const grupo = page.getByRole('radiogroup', { name: 'Visualização' })
  await grupo.getByRole('radio', { name: '3 dias' }).click()
  await expect(grupo.getByRole('radio', { checked: true })).toHaveText('3 dias')
  const sombra = await grupo.getByRole('radio', { name: '3 dias' }).evaluate((e) => getComputedStyle(e).boxShadow)
  expect(sombra).toContain('rgb(255, 106, 0)')
  await expect(grupo).not.toContainText('✓')
})

test('status usa ícone SVG e texto', async ({ page }) => {
  await page.goto('/vitrine')
  const selo = page.getByTestId('vitrine-status').getByText('Agendada')
  await expect(selo.locator('svg')).toHaveCount(1)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npm run build:test && npx playwright test design.spec.ts --project=celular`
Esperado: FAIL (testids e componente inexistentes).

- [ ] **Passo 3: implementar**

`Segmentado.tsx`:
```tsx
export function Segmentado<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  testid,
}: {
  opcoes: ReadonlyArray<{ valor: T; rotulo: string }>
  valor: T
  aoMudar: (v: T) => void
  rotulo: string
  testid?: string
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} data-testid={testid}
      className="flex gap-1 rounded-full border-[1.5px] border-borda bg-superficie p-1">
      {opcoes.map((o) => {
        const marcado = o.valor === valor
        return (
          <button key={o.valor} type="button" role="radio" aria-checked={marcado} onClick={() => aoMudar(o.valor)}
            className={`min-h-10 flex-1 rounded-full px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${
              marcado ? 'ivo-escolhido' : 'text-texto-suave'}`}>
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
```
`MarcaAgora.tsx`:
```tsx
/** Triângulo laranja do logo: marcador de "agora" (agenda, linha do tempo) e destino da rota. */
export function MarcaAgora({ tamanho = 14, className = '' }: { tamanho?: number; className?: string }) {
  return (
    <svg viewBox="0 0 14 12" width={tamanho} height={(tamanho * 12) / 14} aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M0 0H14L7 12Z" fill="var(--cor-laranja)" />
    </svg>
  )
}
```
Raios: `Botao` → `rounded-botao`; `Cartao` → `rounded-cartao border-0 shadow-[var(--sombra)]` (sem borda; a sombra do escuro já é um anel `#1b3d63`); `Campo` (`CAIXA`) → `rounded-campo border-[1.5px]`; `Folha` → `rounded-t-folha md:rounded-folha`.
`StatusBadge`: trocar `icone: string` por `icone: NomeIcone` usando ícones de `Icone.tsx` (`relogio` para SOLICITADA e ORCADA, `calendario` para AGENDADA, `play` para EM_ANDAMENTO, `check` dentro de círculo `checkCirculo` para CONCLUIDA, `fechar` para CANCELADA/RECUSADA/REPROVADA, `ampulheta` para EXPIRADA; acrescentar em `CAMINHOS` os que faltarem: `relogio: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 7.5V12l3 2'`, `play: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M10 8.5v7l5.5-3.5z'`, `checkCirculo: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M8 12.5l2.7 2.7L16 9.8'`, `ampulheta: 'M7 3.5h10 M7 20.5h10 M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5 M16 3.5c0 5-8 5-8 8.5'`). Classe: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold` com `style={{ color: s.cor, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}`; ícone com `tamanho={14}`; manter `animate-pulse motion-reduce:animate-none` só no EM_ANDAMENTO.
`Vitrine.tsx`: acrescentar `data-testid` `vitrine-cartao`, `vitrine-campo` (no `<input>` do Campo, via prop `data-testid` repassada por `...resto`), `vitrine-botao`, `vitrine-status` e um `<Segmentado rotulo="Visualização" opcoes={[{valor:'dia',rotulo:'Dia'},{valor:'tres',rotulo:'3 dias'},{valor:'mes',rotulo:'Mês'}]} …/>` com `useState`.

- [ ] **Passo 4: rodar e ver passar**

Run: `npm run build:test && npx playwright test design.spec.ts --project=celular && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 5: commit** — `feat(design): hierarquia de raios, status com ícone SVG, seletor em pílula e marca do agora`

---

### Tarefa 3: carrinho da tela de carregamento (opção A: barco)

**Arquivos:**
- Modificar: `src/design/componentes/CarregandoPickup.tsx`, `src/design/estilos.css`
- Teste: `tests/e2e/design.spec.ts`

**Interfaces:**
- Mantém: `CarregandoPickup({ ativo, rotulo })`, testids `carregando-pickup` e `pickup-roda` (3 rodas), `role="status"`.
- Produz: `DesenhoPickup({ className?: string })` exportado (o SVG sem a lógica de atraso), para a splash e a fase 3.

- [ ] **Passo 1: teste que falha**

```ts
test('carrinho novo: pickup com reboque e barco, 3 rodas, triângulo da marca, SVG pequeno', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  const carrinho = page.getByTestId('carregando-pickup')
  await expect(carrinho).toBeVisible()
  await expect(carrinho.getByTestId('pickup-roda')).toHaveCount(3)
  await expect(carrinho.locator('[data-parte="barco"]')).toHaveCount(1)
  await expect(carrinho.locator('[data-parte="selo"]')).toHaveCount(1)
  const bytes = await carrinho.locator('svg').evaluate((e) => new Blob([e.outerHTML]).size)
  expect(bytes).toBeLessThan(50 * 1024)
})
```
(Os testes existentes de 200 ms, 400 ms e movimento reduzido continuam valendo sem mudança.)

- [ ] **Passo 2: rodar e ver falhar** — Run: `npm run build:test && npx playwright test design.spec.ts --project=celular` — Esperado: FAIL em `data-parte`.

- [ ] **Passo 3: implementar** — copiar o desenho aprovado do mockup (`carrinho('barco')` em `docs/redesign/mockups-mobile.html`), convertendo para JSX:
  - `viewBox="0 0 320 120"`, `width="240"`, cores por `currentColor` (marinho no claro, off-white no escuro, via `text-texto`), `var(--cor-fundo)` nos recortes, `var(--cor-marinho-2)` no casco (no escuro `#7fb2e8` via novo token `--cor-casco` = `var(--marcador-meu)`), `var(--cor-laranja)` no selo triangular da porta (`data-parte="selo"`) e nas lanternas.
  - Grupos: `.pickup-onda` (2 ondas atrás do reboque), `.pickup-reboque` (com `data-parte="barco"` no casco), roda do reboque, `.pickup-corpo`, 2 rodas da pickup, `.pickup-estrada`.
  - Em `estilos.css`, substituir as animações antigas:
```css
  .pickup-roda { transform-box: fill-box; transform-origin: center; animation: pickup-girar 700ms linear infinite; }
  .pickup-corpo { animation: pickup-balancar 900ms ease-in-out infinite alternate; }
  .pickup-reboque { animation: pickup-balancar 900ms ease-in-out 220ms infinite alternate; }
  .pickup-estrada { animation: estrada-andar 700ms linear infinite; }
  .pickup-onda { animation: pickup-onda 1.4s ease-in infinite; }
  .pickup-onda + .pickup-onda { animation-delay: 700ms; }
@keyframes pickup-balancar { from { transform: translateY(0); } to { transform: translateY(-1.6px); } }
@keyframes estrada-andar { to { stroke-dashoffset: 40; } }
@keyframes pickup-onda { 0% { transform: translateX(8px); opacity: 0; } 30% { opacity: .55; } 100% { transform: translateX(-26px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .pickup-roda, .pickup-corpo, .pickup-reboque, .pickup-estrada, .pickup-onda { animation: none; }
}
```
  - Cada grupo animado mantém `motion-reduce:animate-none`, como hoje.

- [ ] **Passo 4: rodar e ver passar** — mesmo comando; Esperado: PASS (incluindo "com movimento reduzido as rodas não giram").

- [ ] **Passo 5: commit** — `feat(design): novo carrinho de carregamento (pickup com reboque e barco)`

---

### Tarefa 4: moldura (topo, barra inferior, botão "+")

**Arquivos:**
- Modificar: `src/telas/MolduraAutenticada.tsx`, `src/telas/pedidos/Pedidos.tsx` (`BotaoNovoPedido`)
- Teste: `tests/e2e/perfis.spec.ts`

**Interfaces:**
- Consome: `podeCriarPedido(perfil)`, `usePedidoIndisponivel(perfil)` de `Pedidos.tsx`; `MENU` (inalterado).
- Produz: `BotaoFlutuanteNovoPedido({ perfil })` (exportado de `Pedidos.tsx`), `data-testid="botao-novo-pedido-flutuante"`, `aria-label="Novo pedido"`.

- [ ] **Passo 1: testes que falham** (em `tests/e2e/perfis.spec.ts`, seguindo o padrão `comSessaoFalsa` + `simularApi` do arquivo)

```ts
test('cliente N2 vê o + laranja nas telas principais; N3 e motorista não', async ({ page }) => {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  for (const rota of ['/', '/pedidos', '/agenda']) {
    await page.goto(rota)
    await expect(page.getByTestId('botao-novo-pedido-flutuante')).toBeVisible()
  }
})

test('aba ativa fica numa pílula com a cor de seleção', async ({ page }) => {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await page.goto('/agenda')
  const aba = page.getByRole('navigation', { name: 'Abas' }).getByRole('link', { name: 'Agenda' })
  await expect(aba).toHaveAttribute('aria-current', 'page')
  const pilula = aba.getByTestId('aba-icone')
  const fundo = await pilula.evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(fundo).toBe('rgb(10, 37, 64)')
})
```
E para N3 e motorista: `await expect(page.getByTestId('botao-novo-pedido-flutuante')).toHaveCount(0)`.

- [ ] **Passo 2: rodar e ver falhar** — `npm run build:test && npx playwright test perfis.spec.ts --project=celular`.

- [ ] **Passo 3: implementar**
  - Topo (só celular, `md:hidden`): símbolo IVO (`LogoIvo` variante símbolo, 40×34) à esquerda; à direita `EmpresaCliente` (pílula branca 36 px, já existe) e avatar com iniciais em `bg-selecao-suave` (36 px, `rounded-full`) que abre o menu completo (o mesmo `Folha`/gaveta usada hoje pelo botão "Mais").
  - Barra inferior: `nav aria-label="Abas"`, `bg-barra border-t border-borda`, `pb-[calc(0.5rem+env(safe-area-inset-bottom))]`; cada aba: ícone dentro de `span data-testid="aba-icone"` de 52×30 `rounded-full`, que na ativa recebe `bg-selecao text-selecao-texto`; rótulo 12 px 600.
  - `BotaoFlutuanteNovoPedido`: só se `podeCriarPedido(perfil)`; posição `fixed right-[18px] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:hidden`; 60×60, `rounded-[20px] bg-acao text-acao-texto`, sombra `0 8px 20px -6px rgb(255 106 0 / .55)`; ícone `mais` 28 px. Se `usePedidoIndisponivel` devolver texto, o botão abre uma `Folha` "Novo pedido indisponível" com esse texto (sem navegar). Aparece nas rotas `/`, `/pedidos`, `/agenda`, `/extrato`; some em `/pedidos/novo` e nos detalhes.
  - Conteúdo da página ganha `pb-28` no celular para o "+" não cobrir o fim da lista.

- [ ] **Passo 4: rodar e ver passar** — mesmo comando + `npx playwright test abertura.spec.ts --project=celular`.

- [ ] **Passo 5: commit** — `feat(moldura): topo com símbolo e empresa, abas em pílula e botão + de novo pedido`

---

### Tarefa 5: Novo pedido (barra de comando e passo "Quando")

**Arquivos:**
- Criar: `src/lib/horariosDoDia.ts`, `src/lib/horariosDoDia.test.ts`, `src/telas/pedidos/FaixaDias.tsx`
- Modificar: `src/telas/pedidos/NovoPedido.tsx`, `src/telas/pedidos/componentes.tsx` (`Escolhas`, `Contador`)
- Teste: `tests/e2e/toque-novo-pedido.spec.ts`, `tests/e2e/pedidos-cliente.spec.ts`

**Interfaces:**
- Consome: `pedidos.horariosLivres(dia, duracaoMin)` → `{ horarios: string[]; dia_cheio: boolean }`; `pedidos.diasDoMes`; `horaDe`, `somarDias`, `nomeDoDia`, `faixaHorario`, `fimDe` de `tempo.ts`; `Calendario` (dentro de `Folha` "Ver mês inteiro").
- Produz:
  - `horariosDoDia(livres: string[], passoMin = 30): Array<{ inicio: string; livre: boolean }>`: do primeiro ao último horário livre, de `passoMin` em `passoMin`; o que não está em `livres` vira `livre: false`. Lista vazia → `[]`.
  - `fraseQuando(dia: string, inicio: string, duracaoMin: number): string` → `"Terça, 13 de outubro, das 07:30 às 09:30"`.
  - `FaixaDias({ inicio: string, quantos: number, selecionado: string | null, dias: DiaDoMes[] | undefined, hoje: string, aoSelecionar: (dia: string) => void })` com `data-testid="faixa-dias"` e botões `[data-dia]` + `aria-pressed`.

- [ ] **Passo 1: testes de unidade que falham** — `src/lib/horariosDoDia.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fraseQuando, horariosDoDia } from './horariosDoDia.ts'

const h = (hm: string) => `2026-10-13T${hm}:00-03:00`

describe('horariosDoDia', () => {
  it('preenche os buracos entre livres como ocupados', () => {
    const r = horariosDoDia([h('07:00'), h('07:30'), h('09:00')].map((x) => new Date(x).toISOString()))
    expect(r.map((x) => x.livre)).toEqual([true, true, false, false, true])
  })
  it('sem livres não inventa ocupados', () => {
    expect(horariosDoDia([])).toEqual([])
  })
  it('ordena entradas fora de ordem', () => {
    const r = horariosDoDia([h('08:00'), h('07:00')].map((x) => new Date(x).toISOString()))
    expect(r.map((x) => x.livre)).toEqual([true, false, true])
  })
})

describe('fraseQuando', () => {
  it('escreve o dia e a faixa no fuso de São Paulo', () => {
    expect(fraseQuando('2026-10-13', new Date(h('07:30')).toISOString(), 120)).toBe('Terça, 13 de outubro, das 07:30 às 09:30')
  })
})
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run src/lib/horariosDoDia.test.ts`.

- [ ] **Passo 3: implementar `horariosDoDia.ts`**
```ts
import { diaEMes, fimDe, horaDe, nomeDoDia } from './tempo.ts'

export function horariosDoDia(livres: string[], passoMin = 30): Array<{ inicio: string; livre: boolean }> {
  if (livres.length === 0) return []
  const ms = livres.map((l) => new Date(l).getTime()).sort((a, b) => a - b)
  const conjunto = new Set(ms)
  const saida: Array<{ inicio: string; livre: boolean }> = []
  for (let t = ms[0]!; t <= ms[ms.length - 1]!; t += passoMin * 60_000) {
    saida.push({ inicio: new Date(t).toISOString(), livre: conjunto.has(t) })
  }
  return saida
}

/** "Terça, 13 de outubro, das 07:30 às 09:30". */
export function fraseQuando(dia: string, inicio: string, duracaoMin: number): string {
  const semana = nomeDoDia(dia).split(',')[0]!
  return `${semana}, ${diaEMes(dia)}, das ${horaDe(inicio)} às ${horaDe(fimDe(inicio, duracaoMin))}`
}
```
Antes, conferir em `tempo.test.ts` o formato exato de `nomeDoDia` e `diaEMes` e ajustar o recorte para o teste passar; não mudar as funções existentes.

- [ ] **Passo 4: rodar e ver passar** — mesmo comando.

- [ ] **Passo 5: atualizar o e2e de toque** (`toque-novo-pedido.spec.ts`): `tocarDia` passa a procurar primeiro em `page.getByTestId('faixa-dias')`; se o dia não estiver na faixa, toca em "Ver mês inteiro" e escolhe no `calendario` da folha. Acrescentar:
```ts
    test('escolhido usa contorno laranja e nenhum ✓; ocupado aparece riscado', async ({ page }) => {
      await abrir(page)
      const dia = await tocarDia(page, DIA_PEDIDO)
      await expect(dia).toHaveAttribute('aria-pressed', 'true')
      const horarios = page.getByTestId('horarios-livres')
      await horarios.getByRole('radio', { name: '10:00' }).tap()
      const marcado = horarios.getByRole('radio', { name: '10:00' })
      expect(await marcado.evaluate((e) => getComputedStyle(e).boxShadow)).toContain('rgb(255, 106, 0)')
      await expect(page.getByTestId('passo-quando')).not.toContainText('✓')
      await expect(page.getByTestId('frase-quando')).toContainText('das 10:00 às')
    })
```
(E um caso com `simularPedidos` devolvendo buraco entre livres: o horário do buraco é `role="radio"` com `aria-disabled="true"` e `text-decoration-line: line-through`.)

- [ ] **Passo 6: implementar a tela**
  - Cabeçalho (`Cabecalho` já existe): fundo `bg-marinho` no claro e `#0c2a49` + borda inferior no escuro (`bg-[var(--cor-comando)]`, token novo `--cor-comando`: `#0a2540` claro / `#0c2a49` escuro, acrescentar ao teste de pares `['--cor-papel', '--cor-comando', 4.5]` com `--cor-papel` resolvido); "Passo N de 4" em 13 px 500 `#a9b8cc` (sem MAIÚSCULAS); título `ivo-h1` off-white; barra de progresso com 4 segmentos: feitos `bg-laranja`, atual `bg-papel`, futuros `bg-white/20`.
  - `PassoQuando` (`data-testid="passo-quando"`): linha "Outubro" (`ivo-h3`) + botão sublinhado "Ver mês inteiro" (abre `Folha` com o `Calendario` atual em modo `escolher`); `FaixaDias` com 14 dias a partir de hoje (dias cheios riscados e desabilitados, escolhido `ivo-escolhido`); "Início" com legenda "riscado = ocupado"; grade `grid grid-cols-4 gap-2` com `horariosDoDia(...)` — livres `role="radio"`, ocupados `role="radio" aria-disabled="true"` com `line-through text-texto-suave border-dashed bg-transparent`; escolhido `ivo-escolhido`; sem ✓ em lugar nenhum; `Contador` de duração em linha (rótulo à esquerda, − valor + à direita em caixa `rounded-campo`); `p data-testid="frase-quando"` em `bg-selecao-suave rounded-campo` com `fraseQuando(...)` quando houver dia e início.
  - `Escolhas` (passos 2 e 3): opção marcada usa `ivo-escolhido` (troca a classe atual), sem ✓.
  - Rodapé fixo com `Botao variante="principal"` "Continuar" / "Enviar pedido".

- [ ] **Passo 7: rodar** — `npm run build:test && npx playwright test toque-novo-pedido.spec.ts pedidos-cliente.spec.ts credito-pedido.spec.ts legenda-calendario.spec.ts` (os dois projetos). Esperado: PASS.

- [ ] **Passo 8: commit** — `feat(novo pedido): barra de comando, faixa de dias, horários em grade com ocupados e frase de confirmação`

---

### Tarefa 6: Agenda estilo Lark (Dia, 3 dias, Mês)

**Arquivos:**
- Criar: `src/lib/gradeAgenda.ts`, `src/lib/gradeAgenda.test.ts`, `src/telas/agenda/GradeHoras.tsx`, `src/telas/agenda/FaixaSemana.tsx`
- Modificar: `src/telas/agenda/Agenda.tsx`, `src/telas/agenda/Calendario.tsx` (estilo da célula escolhida e de hoje)
- Teste: `tests/e2e/toque-agenda.spec.ts` (novo), `tests/e2e/legenda-calendario.spec.ts`

**Interfaces:**
- Consome: `pedidos.agenda(de, ate)` → `Bloco[]`; `pedidos.horariosLivres`; `janelasLivres`; `intervaloDoDia`, `somarDias`, `hoje`, `horaDe` de `tempo.ts`; `Segmentado`, `MarcaAgora`, `Calendario`, `LegendaCalendario`.
- Produz:
  - `type ItemGrade = { chave: string; tipo: 'meu' | 'aguardando' | 'ocupado' | 'livre'; topo: number; altura: number; coluna: number; colunas: number; bloco?: Bloco; janela?: Janela }`
  - `posicionar(itens: Array<{ chave: string; tipo: ItemGrade['tipo']; inicio: string; fim: string; bloco?: Bloco; janela?: Janela }>, dia: string, horaIni: number, horaFim: number, pxPorHora: number): ItemGrade[]`
  - `faixaDeHoras(itens: Array<{ inicio: string; fim: string }>, dia: string): { horaIni: number; horaFim: number }` (padrão 06–20, alarga para caber tudo, limitado a 0–24).
  - `topoDoAgora(agora: Date, dia: string, horaIni: number, horaFim: number, pxPorHora: number): number | null` (null fora do dia ou da faixa).
  - `tipoDoBloco(b: Bloco): 'meu' | 'aguardando' | 'ocupado'` (sem `atividade_id` → ocupado; `status === 'ORCADA'` e cliente → aguardando; senão meu).

- [ ] **Passo 1: testes de unidade que falham** — `src/lib/gradeAgenda.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { faixaDeHoras, posicionar, topoDoAgora } from './gradeAgenda.ts'

const sp = (hm: string, dia = '2026-10-13') => new Date(`${dia}T${hm}:00-03:00`).toISOString()

describe('posicionar', () => {
  it('converte horário em topo e altura', () => {
    const [b] = posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('07:30'), fim: sp('09:30') }], '2026-10-13', 7, 15, 56)
    expect(b).toMatchObject({ topo: 28, altura: 112, coluna: 0, colunas: 1 })
  })
  it('divide a largura entre blocos sobrepostos', () => {
    const r = posicionar([
      { chave: 'a', tipo: 'meu', inicio: sp('08:00'), fim: sp('10:00') },
      { chave: 'b', tipo: 'aguardando', inicio: sp('09:00'), fim: sp('11:00') },
      { chave: 'c', tipo: 'livre', inicio: sp('12:00'), fim: sp('13:00') },
    ], '2026-10-13', 7, 15, 56)
    expect(r.find((x) => x.chave === 'a')).toMatchObject({ coluna: 0, colunas: 2 })
    expect(r.find((x) => x.chave === 'b')).toMatchObject({ coluna: 1, colunas: 2 })
    expect(r.find((x) => x.chave === 'c')).toMatchObject({ coluna: 0, colunas: 1 })
  })
  it('corta blocos que passam dos limites da grade ou da meia-noite', () => {
    const [b] = posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('22:00', '2026-10-12'), fim: sp('08:00') }], '2026-10-13', 7, 15, 56)
    expect(b).toMatchObject({ topo: 0, altura: 56 })
  })
  it('descarta o que fica todo fora da grade', () => {
    expect(posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('05:00'), fim: sp('06:00') }], '2026-10-13', 7, 15, 56)).toEqual([])
  })
})

describe('faixaDeHoras', () => {
  it('padrão 06–20 e alarga para caber', () => {
    expect(faixaDeHoras([], '2026-10-13')).toEqual({ horaIni: 6, horaFim: 20 })
    expect(faixaDeHoras([{ inicio: sp('05:30'), fim: sp('21:10') }], '2026-10-13')).toEqual({ horaIni: 5, horaFim: 22 })
  })
})

describe('topoDoAgora', () => {
  it('usa o horário de São Paulo e some fora do dia', () => {
    expect(topoDoAgora(new Date(sp('10:20')), '2026-10-13', 7, 15, 56)).toBeCloseTo(186.67, 1)
    expect(topoDoAgora(new Date(sp('10:20')), '2026-10-14', 7, 15, 56)).toBeNull()
    expect(topoDoAgora(new Date(sp('06:00')), '2026-10-13', 7, 15, 56)).toBeNull()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run src/lib/gradeAgenda.test.ts`.

- [ ] **Passo 3: implementar `gradeAgenda.ts`**
```ts
import type { Bloco } from './pedidos.ts'
import { diaDe, intervaloDoDia, type Janela } from './tempo.ts'

export type TipoItem = 'meu' | 'aguardando' | 'ocupado' | 'livre'
export interface ItemGrade { chave: string; tipo: TipoItem; topo: number; altura: number; coluna: number; colunas: number; bloco?: Bloco; janela?: Janela }
type Entrada = { chave: string; tipo: TipoItem; inicio: string; fim: string; bloco?: Bloco; janela?: Janela }

/** Horas (fracionárias) desde a meia-noite de `dia` em São Paulo. */
function horasNoDia(instante: string | Date, dia: string): number {
  return (new Date(instante).getTime() - intervaloDoDia(dia).de.getTime()) / 3_600_000
}

export function tipoDoBloco(b: Bloco, cliente: boolean): Exclude<TipoItem, 'livre'> {
  if (b.atividade_id === undefined) return 'ocupado'
  return cliente && b.status === 'ORCADA' ? 'aguardando' : 'meu'
}

export function faixaDeHoras(itens: Array<{ inicio: string; fim: string }>, dia: string) {
  let horaIni = 6
  let horaFim = 20
  for (const it of itens) {
    horaIni = Math.min(horaIni, Math.floor(Math.max(0, horasNoDia(it.inicio, dia))))
    horaFim = Math.max(horaFim, Math.ceil(Math.min(24, horasNoDia(it.fim, dia))))
  }
  return { horaIni, horaFim }
}

export function posicionar(itens: Entrada[], dia: string, horaIni: number, horaFim: number, pxPorHora: number): ItemGrade[] {
  const cortados = itens
    .map((it) => ({ it, ini: Math.max(horaIni, horasNoDia(it.inicio, dia)), fim: Math.min(horaFim, horasNoDia(it.fim, dia)) }))
    .filter((x) => x.fim > x.ini)
    .sort((a, b) => a.ini - b.ini || b.fim - a.fim)
  // Agrupa sobreposições encadeadas e distribui colunas dentro de cada grupo.
  const saida: ItemGrade[] = []
  let grupo: Array<{ x: (typeof cortados)[number]; coluna: number }> = []
  let fimGrupo = -Infinity
  const fechar = () => {
    const colunas = Math.max(1, ...grupo.map((g) => g.coluna + 1))
    for (const g of grupo) {
      saida.push({ ...g.x.it, topo: (g.x.ini - horaIni) * pxPorHora, altura: (g.x.fim - g.x.ini) * pxPorHora, coluna: g.coluna, colunas })
    }
    grupo = []
  }
  for (const x of cortados) {
    if (x.ini >= fimGrupo && grupo.length) fechar()
    const ocupadas = new Set(grupo.filter((g) => g.x.fim > x.ini).map((g) => g.coluna))
    let coluna = 0
    while (ocupadas.has(coluna)) coluna++
    grupo.push({ x, coluna })
    fimGrupo = Math.max(fimGrupo === -Infinity ? x.fim : fimGrupo, x.fim)
  }
  if (grupo.length) fechar()
  return saida.map(({ inicio: _i, fim: _f, ...resto }) => resto as ItemGrade)
}

export function topoDoAgora(agora: Date, dia: string, horaIni: number, horaFim: number, pxPorHora: number): number | null {
  if (diaDe(agora) !== dia) return null
  const h = horasNoDia(agora, dia)
  return h < horaIni || h > horaFim ? null : (h - horaIni) * pxPorHora
}
```
(Se `intervaloDoDia` devolver strings em vez de `Date`, ajustar `horasNoDia` com `new Date(...)`; conferir a assinatura em `tempo.ts:87`.)

- [ ] **Passo 4: rodar e ver passar** — mesmo comando.

- [ ] **Passo 5: e2e de toque que falha** — `tests/e2e/toque-agenda.spec.ts` (Pixel e iPhone, claro e escuro, mesmo padrão de `toque-novo-pedido.spec.ts`, reaproveitando `luminancia/contraste/esperarDestacado` — extrair essas três funções para `tests/e2e/apoio/contraste.ts` e importar nos dois arquivos):
```ts
for (const tema of ['light', 'dark'] as const) {
  test.describe(`agenda, tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema, hasTouch: true })

    test('Dia: grade de horas, livre abre o pedido, agora com o triângulo', async ({ page }) => {
      await abrirAgenda(page) // comSessaoFalsa CLIENTE N2 + simularApi + simularPedidos; page.clock.setFixedTime(sp('10:20'))
      await expect(page.getByRole('radiogroup', { name: 'Visualização' }).getByRole('radio', { checked: true })).toHaveText('Dia')
      await expect(page.getByTestId('linha-agora')).toBeVisible()
      await expect(page.getByTestId('linha-agora').locator('svg path')).toHaveAttribute('fill', 'var(--cor-laranja)')
      await page.getByTestId('janela-livre').first().tap()
      await expect(page).toHaveURL(/\/pedidos\/novo\?inicio=/)
    })

    test('seletor e dia escolhido se destacam nos dois modos', async ({ page }) => {
      await abrirAgenda(page)
      const grupo = page.getByRole('radiogroup', { name: 'Visualização' })
      await grupo.getByRole('radio', { name: '3 dias' }).tap()
      await esperarDestacado(grupo.getByRole('radio', { name: '3 dias' }))
      await expect(page.getByTestId('grade-horas').locator('[data-coluna-dia]')).toHaveCount(3)
      const faixa = page.getByTestId('faixa-semana')
      await faixa.locator('[data-dia]').nth(4).tap()
      await expect(faixa.locator('[data-dia]').nth(4)).toHaveAttribute('aria-pressed', 'true')
      await esperarDestacado(faixa.locator('[data-dia]').nth(4))
    })

    test('Mês: legenda fixa logo abaixo e resumo do dia tocado', async ({ page }) => {
      await abrirAgenda(page)
      await page.getByRole('radiogroup', { name: 'Visualização' }).getByRole('radio', { name: 'Mês' }).tap()
      await expect(page.getByTestId('legenda-calendario')).toBeVisible()
      await page.getByTestId('calendario').locator(`[data-dia="${DIA_PEDIDO}"]`).tap()
      await expect(page.getByTestId('resumo-dia')).toBeVisible()
    })
  })
}
```
Acrescentar `/toque-.*\.spec\.ts$/` já cobre o projeto `iphone` (nada a mudar no config).

- [ ] **Passo 6: implementar a tela**
  - `Agenda.tsx`: estado `visao: 'dia' | 'tres' | 'mes'` (lembrado em `localStorage` com `try/catch`, chave `agenda-visao`), `dia` e `mes` como hoje. Topo: botão com o nome do mês (`ivo-h2` + ícone `baixo`) que muda para a visão Mês; botão "Hoje" (pílula com borda) que volta `dia` e `mes` para hoje. `Segmentado rotulo="Visualização"`. Some a `CabecalhoTela` com sobretítulo no celular (fica só no desktop `md:`).
  - `FaixaSemana` (`data-testid="faixa-semana"`): domingo a sábado da semana de `dia`, deslizável com `overflow-x-auto snap-x`; botões `[data-dia]` 36×36 `rounded-[12px]`, escolhido `ivo-escolhido`, hoje com número em `text-alerta-texto font-extrabold` quando não escolhido; ponto `--marcador-meu` embaixo de dias com pedido (dados de `diasDoMes`).
  - `GradeHoras` (`data-testid="grade-horas"`): props `dias: string[]` (1 ou 3), `itensPorDia: Record<string, Entrada[]>`, `pedir: boolean`, `agora: Date`. Calcula `faixaDeHoras` sobre todos os itens, `PX_HORA = 56`; coluna de horas 52 px com rótulos 12 px 500; uma coluna por dia (`data-coluna-dia={dia}`) com linhas de hora `border-t border-borda`; itens absolutos com `top/height` de `posicionar` e `left/width` por `coluna/colunas`:
    - meu: `bg-[color-mix(in_srgb,var(--status-agendada)_12%,var(--cor-superficie))] border-l-[3px] border-l-[var(--status-agendada)] rounded-[10px]` (a cor da borda segue o status do bloco: `--status-*` correspondente), título "Pedido 1036" 14 px 700, faixa horária e `Rota` compacta; `Link` quando `pode_abrir` (`data-testid="bloco-proprio"`).
    - aguardando: igual com `--status-aguardando`.
    - ocupado: `repeating-linear-gradient(135deg, …)` via classe CSS `.bloco-ocupado` em `estilos.css` (sem string de estilo inline), ícone `cadeado` 16 px, "Ocupado" (`data-testid="bloco-ocupado"`).
    - livre: `border-[1.5px] border-dashed border-livre bg-livre-fundo text-livre font-bold`, "Livre, 12:00 às 14:00" + "Pedir" com ícone `mais` (`data-testid="janela-livre"`, `aria-label` atual mantido); só `Link` se `pedir`.
    - linha do agora (`data-testid="linha-agora"`): `h-[2px] bg-laranja` absoluta em `topoDoAgora(...)`, só na coluna de hoje; `MarcaAgora` à esquerda (tocando a linha pela ponta) e a hora `horaDe(agora)` em 11 px 700 `text-alerta-texto` sobre `bg-fundo` na coluna de horas; atualiza a cada 60 s (`setInterval` limpo no unmount).
    - Rolagem inicial: centraliza o agora (ou o primeiro item) com `scrollIntoView({ block: 'center' })` uma vez por troca de dia.
  - Dados de 3 dias: `pedidos.agenda(de do 1º dia, ate do 3º)` + `horariosLivres` de cada dia `>= hoje` em `Promise.all`; chave `agenda-3-${dia}`.
  - Visão Mês: `Calendario` atual (sem `grande` no celular), `LegendaCalendario` logo abaixo da grade (já é assim), e `section data-testid="resumo-dia"` com o nome do dia e os blocos do dia em `CartaoPedido` compacto.
  - `Calendario.tsx`: escolhido passa de `bg-selecao text-selecao-texto` para `ivo-escolhido`; hoje deixa de ser anel azul e passa a número `text-alerta-texto font-extrabold`. Manter `aria-pressed`, `data-dia`, `aria-label` e as marcas.

- [ ] **Passo 7: rodar** — `npm run build:test && npx playwright test toque-agenda.spec.ts legenda-calendario.spec.ts pedidos-equipe.spec.ts` (os dois projetos). Esperado: PASS.

- [ ] **Passo 8: commit** — `feat(agenda): visões Dia, 3 dias e Mês no estilo Lark com linha do agora`

---

### Tarefa 7: Início, Pedidos e Detalhe

**Arquivos:**
- Modificar: `src/telas/Inicio.tsx`, `src/telas/saldo/CartaoSaldo.tsx`, `src/telas/pedidos/componentes.tsx` (`Rota`, `CartaoPedido`, `LinhaDoTempo`, `BarraInferior`), `src/telas/pedidos/Pedidos.tsx`, `src/telas/pedidos/Pedido.tsx`
- Teste: `tests/e2e/pedidos-cliente.spec.ts`, `tests/e2e/dinheiro.spec.ts`, `tests/e2e/perfis.spec.ts`

**Interfaces:**
- Consome: `MarcaAgora`, `Segmentado`, `StatusBadge`; dados atuais (`pendencias`, `useSaldo`, `ItemPedido`, `RespostaPedido.historico`).
- Produz: `Rota({ origem, destino, quandoOrigem?, quandoDestino?, compacta? })` com trilho círculo (`border-[2.5px] border-marinho-2`, no escuro `--marcador-meu`) → pontilhado → `MarcaAgora`; `LinhaDoTempo` com `MarcaAgora` na etapa atual (`data-testid="etapa-atual"`).

- [ ] **Passo 1: testes que falham**
```ts
test('início do cliente: saldo num bloco marinho único e só "Aguardando você" com borda laranja', async ({ page }) => {
  // padrão de dinheiro.spec.ts: CLIENTE N1 com saldo simulado e 1 pendência ORCADA
  await expect(page.getByTestId('saldo-bloco')).toHaveCSS('background-color', 'rgb(10, 37, 64)')
  const laranjas = await page.locator('main *').evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).borderTopColor === 'rgb(255, 106, 0)' && getComputedStyle(e).borderTopWidth !== '0px').length)
  expect(laranjas).toBe(1)
})

test('rota termina no triângulo da marca, sem seta', async ({ page }) => {
  // abrir /pedidos/<id> com simularPedidos
  const rota = page.getByTestId('rota')
  await expect(rota.locator('svg path[fill="var(--cor-laranja)"]')).toHaveCount(1)
  await expect(rota).not.toContainText('→')
})

test('detalhe: etapa atual marcada pelo triângulo e botão principal com o valor', async ({ page }) => {
  await expect(page.getByTestId('etapa-atual').locator('svg')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Aprovar R\$ / })).toBeVisible()
})
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar** conforme os mockups (seções 3 e 4):
  - Início do cliente: saudação `ivo-h2` "Bom dia, {primeiro nome}" (bom dia/boa tarde/boa noite por `horaDe(new Date())`); `CartaoSaldo` vira bloco `bg-bloco text-bloco-texto rounded-folha p-[18px]` (`data-testid="saldo-bloco"`) com "Disponível para novos pedidos", `ivo-valor`, barra (disponível off-white, reservado `--marcador-meu`) e duas colunas Reservado/Limite de crédito; "Aguardando você" em `Cartao` com `border-2 border-laranja` (único); "Próximo serviço" com `Rota` completa. Remove os atalhos em grade (o "+" substitui "Novo pedido"; os outros já estão nas abas).
  - Motorista: "Você tem N serviços hoje"; "Aguardando seu orçamento" com borda laranja; grupo "Hoje" com `CartaoPedido` (sobretítulo de grupo mantido, é agrupamento).
  - ADM: bloco marinho "Aprovado em {mês}" + reconciliação; pendências com a de maior prioridade (contrato não publicado) com borda laranja.
  - `Pedidos`: `ivo-h1` "Pedidos" + `Segmentado` "Abertos / Agendados / Histórico" (mapeia os filtros atuais); `CartaoPedido` com número 700, `StatusBadge`, `Rota compacta`, data e valor tabular; o que espera o usuário tem borda laranja.
  - `Pedido`: voltar "Pedidos" com `setaEsquerda`; `ivo-h1` "Pedido 1042"; status; cartão com `Rota`; cartão de valores; "Andamento" com `LinhaDoTempo`; `BarraInferior` com secundário "Pedir revisão" e principal "Aprovar {valor formatado}".
  - Trocar todo `" · "` por vírgula ou quebra de linha e todo `→` por `Rota` nestes arquivos.

- [ ] **Passo 4: rodar** — `npm run build:test && npx playwright test pedidos-cliente.spec.ts pedidos-equipe.spec.ts dinheiro.spec.ts perfis.spec.ts abertura.spec.ts --project=celular`. Esperado: PASS (ajustar seletores de testes antigos que dependiam de texto removido, sem afrouxar o que verificam).

- [ ] **Passo 5: commit** — `feat(telas): início por perfil, lista e detalhe do pedido no novo design`

---

### Tarefa 8: Orçar, Extrato, Créditos, Painel, Entrar e 2FA

**Arquivos:**
- Modificar: `src/telas/pedidos/Orcar.tsx`, `src/telas/extrato/Extrato.tsx`, `src/telas/adm/Creditos.tsx`, `src/telas/adm/Painel.tsx`, `src/telas/entrada/Entrar.tsx`, `src/telas/entrada/Seguranca2fa.tsx`, `src/telas/entrada/CabecalhoEntrada.tsx`, `src/design/componentes/CodigoSeisDigitos.tsx`
- Criar: `scripts/varrer-estilo.ts`, `scripts/varrer-estilo.test.ts`
- Teste: `tests/e2e/entrada.spec.ts`, `tests/e2e/adm.spec.ts`, `tests/e2e/dinheiro.spec.ts`

**Interfaces:**
- Produz: `varrerEstilo(arquivos: Array<{ caminho: string; texto: string }>): string[]` (lista de `caminho:linha` com `" · "` ou `→` dentro de texto JSX/strings de tela).

- [ ] **Passo 1: teste da guarda que falha** — `scripts/varrer-estilo.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { varrerEstilo } from './varrer-estilo.ts'

function arquivos(pasta: string): Array<{ caminho: string; texto: string }> {
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n)
    return statSync(c).isDirectory() ? arquivos(c) : c.endsWith('.tsx') ? [{ caminho: c, texto: readFileSync(c, 'utf8') }] : []
  })
}

describe('varrerEstilo', () => {
  it('acha separador " · " e seta em texto de tela', () => {
    expect(varrerEstilo([{ caminho: 'a.tsx', texto: "<p>Livre · 10:00</p>\n<b>Ir →</b>\n// comentário · ok" }])).toEqual(['a.tsx:1', 'a.tsx:2'])
  })
  it('telas do app não usam " · " nem "→"', () => {
    expect(varrerEstilo(arquivos('src/telas'))).toEqual([])
  })
})
```

- [ ] **Passo 2: rodar e ver falhar** — `npx vitest run scripts/varrer-estilo.test.ts`.

- [ ] **Passo 3: implementar `varrer-estilo.ts`**
```ts
/** Guarda do redesign: nada de " · " para juntar textos nem "→" em telas (usar vírgula e o componente Rota). */
export function varrerEstilo(arquivos: Array<{ caminho: string; texto: string }>): string[] {
  const achados: string[] = []
  for (const { caminho, texto } of arquivos) {
    texto.split('\n').forEach((linha, i) => {
      const codigo = linha.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
      if (codigo.includes(' · ') || codigo.includes('→')) achados.push(`${caminho}:${i + 1}`)
    })
  }
  return achados
}
```

- [ ] **Passo 4: restilizar as telas** conforme a seção 8 e a seção 2 dos mockups e zerar a guarda:
  - Orçar: barra de comando marinho ("Pedido 1047, Umi San" em 13 px + `ivo-h1` "Orçamento"); cada linha com nome 600, preço unitário em legenda, `Contador` compacto à direita e subtotal tabular; total fixo no rodapé (`ivo-valor` 26 px) acima de "Enviar orçamento".
  - Extrato: `ivo-h1` + "Exportar" (abre a folha atual de CSV/PDF); `Segmentado` "7 dias / {Mês} / Período"; saldo da data em `bg-selecao-suave rounded-campo`; cada lançamento com ícone em quadrado 36 px (`setaCima` crédito em `--status-concluida`, `setaBaixo` débito, `desfazer` estorno), título, legenda e valor com sinal `+`/`−` e saldo corrente abaixo.
  - Créditos: cartão por empresa com disponível, barra, limite e "Lançar"; abaixo do alerta com borda laranja e selo "Abaixo do alerta".
  - Painel: `Segmentado` de período; 4 indicadores em grade 2×2; cartão de reconciliação com selo; barras por semana com a semana atual em laranja (agora) e as demais em `--status-agendada`.
  - Entrar: logotipo completo (`LogoIvo` azul/branco por tema) 92 px; `ivo-h1` "Entrar" + "Use o e-mail do seu convite."; campos; Turnstile; botão principal "Entrar"; "Esqueci a senha" sublinhado. Sem sobretítulo "ENTRAR".
  - 2FA: símbolo; `ivo-h1` "Código do autenticador"; 6 casas 58 px `rounded-campo` 26 px 700, casa atual com borda 2 px `--cor-texto`; "O código muda a cada 30 segundos."; botão "Confirmar código" desabilitado até 6 dígitos.

- [ ] **Passo 5: rodar** — `npx vitest run && npm run build:test && npx playwright test entrada.spec.ts adm.spec.ts dinheiro.spec.ts sessao-2fa.spec.ts --project=celular`. Esperado: PASS.

- [ ] **Passo 6: commit** — `feat(telas): orçar, extrato, créditos, painel e entrada no novo design; guarda contra " · " e →`

---

### Tarefa 9: verificação final, capturas e PR

**Arquivos:**
- Criar: `tests/e2e/zz-capturas-redesign.spec.ts`
- Modificar: `docs/HANDOFF-redesign-mobile.md` (estado), `HANDOFF.md` (linha sobre o redesign)

- [ ] **Passo 1: capturas** — `zz-capturas-redesign.spec.ts` no padrão de `zz-capturas.spec.ts`: Início (cliente, motorista, ADM), Pedidos, Detalhe, Novo pedido (4 passos), Agenda (Dia, 3 dias, Mês), Orçar, Extrato, Créditos, Painel, Entrar, 2FA e a pickup, cada uma em `colorScheme` claro e escuro, salvando em `test-results/capturas-redesign/<tela>-<tema>.png`. Só roda com `CAPTURAS=1`.

- [ ] **Passo 2: suíte local completa**

```bash
npm run lint && npm run typecheck && npm run test:unit && npm run build:test && npx playwright test
```
Esperado: tudo verde. `npm run build` deve imprimir o total gzip ≤ 150 KB (`orcamento-bundle`). O `seguranca.spec.ts` existente garante zero violações de CSP; conferir que continua verde.

- [ ] **Passo 3: push e CI** — `git push -u origin redesign-mobile`; acompanhar com `"/c/Program Files/GitHub CLI/gh.exe" run watch <id> --exit-status` (pgTAP, integração e e2e real).

- [ ] **Passo 4: capturas para o dono** — `CAPTURAS=1 npx playwright test zz-capturas-redesign.spec.ts --project=celular` e enviar as imagens.

- [ ] **Passo 5: PR sem merge** — base `main` (depois que o PR #24 entrar) com resumo, capturas e checklist; o merge é do dono e dispara o deploy.

- [ ] **Passo 6: atualizar os handoffs** e commitar: `docs: estado do redesign mobile`.
