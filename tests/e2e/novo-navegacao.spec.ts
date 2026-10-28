// Fase 4.1 (Tarefa 8, especificação §6.4 e §6.6, mockup 4): toda página tem "← Início" e o título, o ☰ marca a página
// atual, o cliente troca de página pela barra de baixo no celular e as listas de corrida mostram De → (Parada) → Para.
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { itemLista, pendenciaFalsa, simularPedidos, type PedidosFalsos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }

const COM_PARADA = itemLista({
  status: 'AGENDADA',
  origem: 'Umi San · Galpão 2',
  paradas: ['Marina Itajaí · Píer B'],
  destino: 'Porto de Itajaí · Portão 3',
})

async function abrir(page: Page, perfil: PerfilFalso, caminho: string, pedidos: PedidosFalsos = {}) {
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : AAL2)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page)
  await simularPedidos(page, pedidos)
  await page.goto(caminho)
}

const cabecalho = (page: Page) => page.getByRole('navigation', { name: 'Página' })
const barra = (page: Page) => page.getByRole('navigation', { name: 'Atalhos' })
/** Texto à vista no cabeçalho ou no conteúdo da página (fora da barra de atalhos, do ☰ e do que é só para leitores de tela). */
const aVista = (page: Page, texto: string) =>
  page
    .locator('main, [data-testid="cabecalho-pagina"]')
    .getByText(texto, { exact: true })
    .filter({ visible: true })
    .and(page.locator(':not(.sr-only)'))
const noInicio = (page: Page) => expect.poll(() => new URL(page.url()).pathname).toBe('/')

/** Rótulos e endereços de um percurso De → (Parada) → Para, na ordem da tela. */
async function percurso(rota: Locator) {
  const rotulos = await rota.locator('dt').allInnerTexts()
  const enderecos = await rota.locator('dd').allInnerTexts()
  return rotulos.map((r, i) => `${r.trim()}: ${enderecos[i]!.trim()}`)
}

test('cliente: "← Início" e o título em Minhas corridas; o Início é a tela de pedir corrida', async ({ page }) => {
  await abrir(page, N1, '/pedidos')
  const topo = cabecalho(page)
  const inicio = topo.getByRole('link', { name: 'Início', exact: true })
  await expect(inicio).toHaveText('← Início')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minhas corridas')
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
  await inicio.click()
  await noInicio(page)
  await expect(page.getByTestId('mapa-base')).toBeVisible()
  await expect(cabecalho(page)).toHaveCount(0)
})

const CASOS: Array<[PerfilFalso, string, string]> = [
  [N1, '/agenda', 'Agenda'],
  [N1, '/equipe', 'Equipe'],
  [N1, '/perfil', 'Perfil e segurança'],
  [N1, '/ajuda', 'Ajuda'],
  [MOTORISTA, '/veiculos', 'Meus veículos'],
  [MOTORISTA, '/corridas-do-mes', 'Corridas do mês'],
  // O rótulo do ☰ é uma descrição; o nome da página é o `titulo` do item.
  [MOTORISTA, '/pedidos', 'Minhas corridas'],
  [ADM, '/adm/painel', 'Painel'],
  [ADM, '/adm/contratos', 'Contratos'],
  [ADM, '/adm/categorias', 'Categorias e preços'],
]

for (const [perfil, caminho, titulo] of CASOS) {
  test(`${perfil.papel} em ${caminho}: "← Início" e o título "${titulo}", um nome só`, async ({ page }) => {
    await abrir(page, perfil, caminho)
    const topo = cabecalho(page)
    await expect(topo.getByRole('link', { name: 'Início', exact: true })).toHaveText('← Início')
    // O título fica no cabeçalho ou, se a tela tem o h1 de mesmo nome, só no h1: nunca dois nomes à vista.
    await expect(aVista(page, titulo)).toHaveCount(1)
  })
}

test('um nome só: em Minhas corridas, o título à vista é o h1 com o nome do menu', async ({ page }) => {
  for (const [caminho, nome, antigo] of [
    ['/pedidos', 'Minhas corridas', 'Pedidos'],
  ] as const) {
    await abrir(page, N1, caminho)
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toHaveText(nome)
    await expect(aVista(page, nome)).toHaveCount(1)
    await expect(aVista(page, antigo)).toHaveCount(0)
    // O cabeçalho não repete o nome (sem um segundo título nem para leitores de tela).
    await expect(cabecalho(page)).toHaveAccessibleName('Página')
    expect((await cabecalho(page).innerText()).replace(/\s+/g, ' ').trim()).toBe('← Início')
  }
})

test('motorista: "← Início" leva ao Início dele', async ({ page }) => {
  await abrir(page, MOTORISTA, '/veiculos')
  await cabecalho(page).getByRole('link', { name: 'Início', exact: true }).click()
  await noInicio(page)
  await expect(page.getByTestId('folha-mapa')).toBeVisible()
  await expect(barra(page)).toHaveCount(0)
})

test('o ☰ marca a página atual com aria-current', async ({ page }) => {
  await abrir(page, N1, '/agenda')
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page')
  await expect(menu.locator('[aria-current="page"]')).toHaveCount(1)
  // Troca direto pelo ☰: o destaque acompanha.
  await menu.getByRole('link', { name: 'Minhas corridas' }).click()
  await expect(page).toHaveURL(/\/pedidos$/)
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(menu.getByRole('link', { name: 'Minhas corridas' })).toHaveAttribute('aria-current', 'page')
  await expect(menu.getByRole('link', { name: 'Agenda' })).not.toHaveAttribute('aria-current', /.*/)
})

test('cliente no celular: a barra Pedir · Corridas · Agenda fica fixa e alterna sem recarregar', async ({ page }) => {
  await abrir(page, N1, '/pedidos')
  const nav = barra(page)
  // v2.2.1: sem a Carteira (o saldo e o extrato ficam no Painel da empresa).
  await expect(nav.getByRole('link')).toHaveText(['Pedir', 'Corridas', 'Agenda'])
  await expect(nav.getByRole('link', { name: 'Corridas' })).toHaveAttribute('aria-current', 'page')
  await expect(nav).toHaveCSS('position', 'fixed')
  const vp = page.viewportSize()!
  const caixa = (await nav.boundingBox())!
  expect(Math.round(caixa.y + caixa.height)).toBe(vp.height)
  expect(caixa.width).toBe(vp.width)

  // Marca a página: se recarregar, a marca some.
  await page.evaluate(() => ((window as unknown as { __semRecarregar: boolean }).__semRecarregar = true))
  const semRecarregar = () => page.evaluate(() => (window as unknown as { __semRecarregar?: boolean }).__semRecarregar === true)

  await nav.getByRole('link', { name: 'Agenda' }).click()
  await expect(page).toHaveURL(/\/agenda$/)
  await expect(nav.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: 'Corridas' }).click()
  await expect(page).toHaveURL(/\/pedidos$/)
  expect(await semRecarregar()).toBe(true)

  // O último item da lista não fica escondido atrás da barra.
  const ultimo = page.getByTestId('lista-pedidos').locator('li').last()
  await expect(ultimo).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const topoDaBarra = (await nav.boundingBox())!.y
  await expect
    .poll(async () => {
      const caixa = await ultimo.boundingBox()
      return caixa ? caixa.y + caixa.height : Number.POSITIVE_INFINITY
    })
    .toBeLessThanOrEqual(topoDaBarra + 1)

  await nav.getByRole('link', { name: 'Pedir' }).click()
  await noInicio(page)
  expect(await semRecarregar()).toBe(true)
  await expect(barra(page)).toHaveCount(0)
})

test('a barra do cliente não aparece no computador nem para o motorista', async ({ browser }) => {
  const contexto = await browser.newContext({ ...test.info().project.use, viewport: { width: 1280, height: 800 }, isMobile: false })
  const page = await contexto.newPage()
  await abrir(page, N1, '/pedidos')
  await expect(cabecalho(page)).toBeVisible()
  await expect(barra(page)).toBeHidden()
  await contexto.close()

  const outro = await browser.newContext({ ...test.info().project.use })
  const motorista = await outro.newPage()
  await abrir(motorista, MOTORISTA, '/pedidos')
  await expect(cabecalho(motorista)).toBeVisible()
  await expect(barra(motorista)).toHaveCount(0)
  await outro.close()
})

test('Minhas corridas do cliente: De, Parada e Para nessa ordem', async ({ page }) => {
  await abrir(page, N1, '/pedidos?filtro=agendados', { lista: [COM_PARADA, itemLista({ status: 'AGENDADA', id: 'b' })] })
  const rotas = page.getByTestId('lista-pedidos').getByTestId('rota-de-para')
  await expect(rotas).toHaveCount(2)
  expect(await percurso(rotas.first())).toEqual([
    'De: Umi San · Galpão 2',
    'Parada: Marina Itajaí · Píer B',
    'Para: Porto de Itajaí · Portão 3',
  ])
  // Sem parada: só De e Para.
  expect(await percurso(rotas.nth(1))).toEqual(['De: Porto de Itajaí', 'Para: Base Navegantes'])
})

test('motorista: a próxima corrida mostra De, Parada e Para nessa ordem', async ({ page }) => {
  const proxima = pendenciaFalsa({
    status: 'AGENDADA',
    empresa_nome: 'Umi San',
    origem: 'Umi San · Galpão 2',
    paradas: ['Marina Itajaí · Píer B'],
    destino: 'Porto de Itajaí · Portão 3',
  })
  await abrir(page, MOTORISTA, '/', { pendencias: { proximos: [proxima] } })
  const rota = page.getByTestId('folha-mapa').getByTestId('rota-de-para')
  await expect(rota).toBeVisible()
  expect(await percurso(rota)).toEqual([
    'De: Umi San · Galpão 2',
    'Parada: Marina Itajaí · Píer B',
    'Para: Porto de Itajaí · Portão 3',
  ])
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('cabeçalho, barra e De → Para sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, N1, '/pedidos?filtro=agendados', { lista: [COM_PARADA] })
      await expect(page.getByTestId('rota-de-para')).toBeVisible()
      await expect(barra(page)).toBeVisible()
      // A etiqueta de status da lista de hoje (StatusBadge do app atual) tem a exceção de contraste já anotada na
      // Tarefa 11 da fase 4: o contraste do cabeçalho, da barra e do percurso é conferido à parte.
      expect((await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()).violations).toEqual([])
      const contraste = await new AxeBuilder({ page })
        .include('[data-testid="cabecalho-pagina"]')
        .include('nav[aria-label="Atalhos"]')
        .include('[data-testid="rota-de-para"]')
        .withRules(['color-contrast'])
        .analyze()
      expect(contraste.violations).toEqual([])
      await page.getByRole('button', { name: 'Abrir menu' }).click()
      await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
      expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
