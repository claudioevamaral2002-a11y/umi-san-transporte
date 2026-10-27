// v2.2 (Tarefa 6, especificação §2 e §5.6): o filtro da Auditoria. As opções de Ação vêm de `acoes_auditoria`, com
// nomes legíveis e agrupadas (<optgroup>); se a leitura falhar, as ações conhecidas. Data incompleta ou inexistente
// mostra "Data inválida", "De" depois de "Até" mostra "A data inicial é depois da final", e nenhum dos dois filtra.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const ADM = { papel: 'ADM' as const, tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }

const ACOES = [
  { acao: 'PUBLICAR_PARAMETROS', total: 2 },
  { acao: 'CRIAR_PEDIDO', total: 14 },
  { acao: 'ALTERAR_PERFIL', total: 3 },
  { acao: 'ACAO_NOVA_DO_BANCO', total: 1 },
]

async function abrir(page: Page, acoes: unknown = { ok: true, acoes: ACOES }) {
  await comSessaoFalsa(page, ADM, AAL2)
  const chamadas = await simularApi(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/acoes_auditoria`, (r) => json(r, acoes))
  await page.goto('/adm/auditoria')
  await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible()
  const filtros = () => chamadas.filter((c) => c.rpc === 'listar_auditoria')
  await expect.poll(() => filtros().length).toBe(1)
  return filtros
}

/** Os grupos do select de Ação: rótulo do grupo e os textos das opções. */
const grupos = (page: Page) =>
  page.getByLabel('Ação', { exact: true }).evaluate((s) =>
    [...s.querySelectorAll('optgroup')].map((g) => ({
      grupo: g.label,
      opcoes: [...g.querySelectorAll('option')].map((o) => o.textContent),
    })),
  )

test('as ações vêm do banco, agrupadas e com nome legível; a desconhecida aparece com o código', async ({ page }) => {
  const filtros = await abrir(page)
  await expect
    .poll(() => grupos(page))
    .toEqual([
      { grupo: 'Acesso', opcoes: ['Alterar perfil'] },
      { grupo: 'Pedidos', opcoes: ['Criar pedido'] },
      { grupo: 'Cadastros', opcoes: ['Publicar tabela de preços'] },
      { grupo: 'Outras', opcoes: ['ACAO_NOVA_DO_BANCO'] },
    ])
  await page.getByLabel('Ação', { exact: true }).selectOption('CRIAR_PEDIDO')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect.poll(() => filtros().length).toBe(2)
  expect(filtros()[1]!.corpo.p_acao).toBe('CRIAR_PEDIDO')
})

test('se a lista do banco falhar, usa as ações conhecidas', async ({ page }) => {
  await abrir(page, { ok: false, codigo: 'ERRO_INESPERADO' })
  await expect.poll(async () => (await grupos(page)).length).toBeGreaterThan(1)
  const opcoes = (await grupos(page)).flatMap((g) => g.opcoes)
  expect(opcoes).toContain('Publicar tabela de preços')
  expect(opcoes).toContain('Alterar perfil')
})

// No Pixel 7 emulado o campo de data só abre o seletor (não aceita digitação): a data incompleta é do computador.
test.describe('no computador (o campo de data aceita digitação)', () => {
  test.use({
    isMobile: false,
    hasTouch: false,
    viewport: { width: 1280, height: 900 },
  })

  test('data incompleta: "Data inválida" ligado ao campo e não filtra; invertida também não; a válida filtra e fica', async ({
    page,
  }) => {
    const filtros = await abrir(page)
    const de = page.getByLabel('De', { exact: true })
    const ate = page.getByLabel('Até', { exact: true })
    const filtrar = page.getByRole('button', { name: 'Filtrar' })

    // Incompleta (sem o ano): o campo nativo dá "" e o validity.badInput acusa.
    await de.click()
    await de.pressSequentially('31/02')
    await filtrar.click()
    await expect(page.getByText('Data inválida')).toBeVisible()
    await expect(de).toHaveAttribute('aria-invalid', 'true')
    const descritor = await de.getAttribute('aria-describedby')
    expect(descritor).toBeTruthy()
    await expect(page.locator(`[id="${descritor}"]`)).toHaveText('Data inválida')
    await expect(de).toBeFocused()
    await expect(ate).not.toHaveAttribute('aria-invalid', 'true')
    expect(filtros()).toHaveLength(1)

    // Mexer no campo apaga o erro dele.
    await de.fill('2026-10-08')
    await expect(page.getByText('Data inválida')).toHaveCount(0)
    await expect(de).not.toHaveAttribute('aria-invalid', 'true')

    // Invertida.
    await ate.fill('2026-10-01')
    await filtrar.click()
    await expect(page.getByText('A data inicial é depois da final')).toBeVisible()
    await expect(page.getByText('Data inválida')).toHaveCount(0)
    await expect(de).toHaveAttribute('aria-invalid', 'true')
    expect(filtros()).toHaveLength(1)

    // Válida: filtra, o erro some e as datas ficam no campo.
    await ate.fill('2026-10-09')
    await filtrar.click()
    await expect.poll(() => filtros().length).toBe(2)
    expect(filtros()[1]!.corpo).toMatchObject({
      p_de: '2026-10-08T03:00:00.000Z',
      p_ate: '2026-10-10T02:59:59.999Z',
    })
    await expect(page.getByText('A data inicial é depois da final')).toHaveCount(0)
    await expect(de).not.toHaveAttribute('aria-invalid', 'true')
    await expect(de).toHaveValue('2026-10-08')
    await expect(ate).toHaveValue('2026-10-09')
  })
})

test('390 px sem rolagem lateral, com o erro na tela', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await abrir(page)
  await page.getByLabel('De', { exact: true }).fill('2026-10-08')
  await page.getByLabel('Até', { exact: true }).fill('2026-10-01')
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await expect(page.getByText('A data inicial é depois da final')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const tema of ['light', 'dark'] as const) {
  test(`com o erro, sem violações do axe (tema ${tema === 'light' ? 'claro' : 'escuro'})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' })
    await abrir(page)
    await page.getByLabel('De', { exact: true }).fill('2026-10-08')
    await page.getByLabel('Até', { exact: true }).fill('2026-10-01')
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect(page.getByText('A data inicial é depois da final')).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
}
