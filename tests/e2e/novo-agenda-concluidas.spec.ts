// v2.2 (Tarefa 5, especificação §2 e §5.4): a agenda mostra as corridas em andamento e concluídas da empresa em
// cartões cinza ("Concluída" / "Em andamento") que abrem a corrida; o número do mês bate com o dia; a "3 dias" tem três
// colunas. Sem `concluidas` na resposta (banco anterior), nada muda. Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { diaSp, diasDoMes, instanteSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const TELA = { width: 390, height: 844 }
const HOJE = diaSp(0)
const ID_A = '00000000-0000-4000-8000-0000000000c1'
const ID_B = '00000000-0000-4000-8000-0000000000c2'

const CONCLUIDAS = [
  {
    id: ID_A,
    numero: 18,
    inicio: instanteSp(HOJE, '08:00'),
    duracao_min: 90,
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    categoria_nome: 'IVO Passageiros',
    status: 'CONCLUIDA',
  },
  {
    id: ID_B,
    numero: 19,
    inicio: instanteSp(HOJE, '13:00'),
    duracao_min: 60,
    origem: 'Cais Sul',
    destino: 'Terminal Norte',
    categoria_nome: null,
    status: 'EM_ANDAMENTO',
  },
]

const diaDe = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )

async function abrir(page: Page, { comConcluidas = true, blocos = [] }: { comConcluidas?: boolean; blocos?: unknown[] } = {}) {
  await page.setViewportSize(TELA)
  await page.addInitScript(() => localStorage.removeItem('agenda-visao'))
  await comSessaoFalsa(page, N2)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page)
  await simularPedidos(page, {})
  // O mês conta as duas de hoje (dias_do_mes já conta EM_ANDAMENTO e CONCLUIDA).
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/dias_do_mes`, (r) => {
    const c = r.request().postDataJSON() as { p_mes: string; p_duracao_min: number }
    const dias = diasDoMes(c.p_mes).map((d) => (d.dia === HOJE ? { ...d, meus: comConcluidas ? 2 : 0 } : d))
    return json(r, { ok: true, mes: c.p_mes, duracao_min: c.p_duracao_min, dias })
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/agenda`, (r) => {
    const c = r.request().postDataJSON() as { p_de: string }
    const hoje = diaDe(c.p_de) === HOJE
    // Banco anterior: só `blocos`.
    return json(r, comConcluidas ? { ok: true, blocos: hoje ? blocos : [], concluidas: hoje ? CONCLUIDAS : [] } : { ok: true, blocos: [] })
  })
  await page.goto('/agenda')
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test('o dia mostra as duas corridas em cartões cinza com o selo, e o toque abre a corrida', async ({ page }) => {
  await abrir(page)
  const dia = page.getByTestId('agenda-dia')
  const cartoes = dia.getByTestId('bloco-concluida')
  await expect(cartoes).toHaveCount(2)
  await expect(cartoes.nth(0)).toContainText('Concluída')
  await expect(cartoes.nth(0)).toContainText('#0018')
  await expect(cartoes.nth(1)).toContainText('Em andamento')
  expect(await semRolagemLateral(page)).toBe(false)
  await expect(cartoes.nth(0)).toHaveAttribute('href', `/pedidos/${ID_A}`)
  // O detalhe simulado é um pedido qualquer: basta ver que o toque sai da agenda para a corrida.
  await cartoes.nth(0).click()
  await expect(page).not.toHaveURL(/\/agenda$/)
})

test('o mês diz "2 pedidos seus" e a lista do dia tem os 2 cartões', async ({ page }) => {
  await abrir(page)
  await page.getByRole('radio', { name: 'Mês' }).click()
  await expect(page.getByRole('button', { name: /2 pedidos seus/ }).first()).toBeVisible()
  const resumo = page.getByTestId('resumo-dia')
  await expect(resumo.getByTestId('cartao-concluida')).toHaveCount(2)
  await expect(resumo).toContainText('Concluída')
  await expect(resumo).toContainText('Em andamento')
  await expect(resumo).not.toContainText('Nenhum pedido neste dia')
  await expect(resumo.getByRole('link', { name: /Pedido #0019/ })).toHaveAttribute('href', `/pedidos/${ID_B}`)
  expect(await semRolagemLateral(page)).toBe(false)
})

test('a lista do dia junta ativos e concluídos pela hora de início', async ({ page }) => {
  const ativo = {
    inicio: instanteSp(HOJE, '10:00'),
    fim: instanteSp(HOJE, '11:00'),
    ocupado: true,
    tipo: 'RESERVA',
    atividade_id: '00000000-0000-4000-8000-0000000000c3',
    numero: 42,
    status: 'AGENDADA',
    origem: 'Base Navegantes',
    destino: 'Porto de Itajaí',
    propria_empresa: true,
    pode_abrir: true,
  }
  await abrir(page, { blocos: [ativo] })
  await page.getByRole('radio', { name: 'Mês' }).click()
  const itens = page.getByTestId('resumo-dia').getByRole('listitem')
  await expect(itens).toHaveCount(3)
  await expect(itens.nth(0)).toContainText('#0018')
  await expect(itens.nth(1)).toContainText('#0042')
  await expect(itens.nth(2)).toContainText('#0019')
})

test('"3 dias" mostra três colunas com cabeçalho, sem rolagem lateral', async ({ page }) => {
  await abrir(page)
  await page.getByRole('radio', { name: '3 dias' }).click()
  await expect(page.getByTestId('cabecalho-dia')).toHaveCount(3)
  await expect(page.locator('[data-coluna-dia]')).toHaveCount(3)
  await expect(page.locator(`[data-coluna-dia="${HOJE}"]`).getByTestId('bloco-concluida')).toHaveCount(2)
  const larguras = await page.locator('[data-coluna-dia]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  for (const l of larguras) expect(l).toBeGreaterThan(80)
  expect(await semRolagemLateral(page)).toBe(false)
})

test('banco anterior (sem concluidas): nada muda', async ({ page }) => {
  await abrir(page, { comConcluidas: false })
  await expect(page.getByTestId('grade-horas')).toBeVisible()
  await expect(page.getByTestId('bloco-concluida')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Mês' }).click()
  await expect(page.getByTestId('resumo-dia')).toContainText('Nenhum pedido neste dia.')
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })
    test('dia e mês com concluídas sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page)
      await expect(page.getByTestId('bloco-concluida')).toHaveCount(2)
      expect((await new AxeBuilder({ page }).include('[data-testid="agenda-dia"]').analyze()).violations).toEqual([])
      await page.getByRole('radio', { name: 'Mês' }).click()
      await expect(page.getByTestId('cartao-concluida')).toHaveCount(2)
      expect((await new AxeBuilder({ page }).include('[data-testid="resumo-dia"]').analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
