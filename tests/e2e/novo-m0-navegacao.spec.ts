import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { comSessaoFalsa, type PerfilFalso } from './apoio/sessaoFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N2: PerfilFalso = { ...N1, nivel: 2 }
const N3: PerfilFalso = { ...N1, nivel: 3 }
const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const lateral = (page: Page) => page.getByRole('complementary', { name: 'Navegação do aplicativo' })

async function abrir(page: Page, perfil: PerfilFalso, largura = 1440) {
  await page.setViewportSize({ width: largura, height: 900 })
  await comSessaoFalsa(page, perfil, perfil.tem_2fa ? { aal: 'aal2' } : {})
  await simularMapas(page)
  await simularApi(page)
  await simularPedidos(page)
  await page.route('https://tile.googleapis.com/**', r => r.fulfill({ status: 503, body: '' }))
  await page.goto('/')
  await expect(page.getByTestId('folha-mapa')).toBeVisible()
}

for (const [nome, perfil, links] of [
  ['N1', N1, ['Início', 'Minhas corridas', 'Agenda', 'Equipe', 'Painel da empresa', 'Perfil e segurança', 'Ajuda']],
  ['N2', N2, ['Início', 'Minhas corridas', 'Agenda', 'Perfil e segurança', 'Ajuda']],
  ['N3', N3, ['Início', 'Minhas corridas', 'Agenda', 'Perfil e segurança', 'Ajuda']],
  ['motorista', MOTORISTA, ['Início', 'Minhas corridas e Pendências', 'Agenda', 'Meus veículos', 'Corridas do mês', 'Perfil e segurança', 'Ajuda']],
  ['Master', ADM, ['Início', 'Painel e Corridas em andamento', 'Contratos', 'Créditos', 'Faturas', 'Usuários', 'Empresas', 'Configurações', 'Auditoria', 'Categorias e preços', 'Veículos', 'Painel da empresa', 'Perfil e segurança', 'Ajuda']],
] as const) {
  test(`lateral de ${nome}: preserva a lista autorizada e o destino dos links`, async ({ page }) => {
    await abrir(page, perfil)
    await expect(lateral(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeHidden()
    const menu = lateral(page).getByRole('navigation', { name: 'Menu principal' })
    await expect(menu.getByRole('link')).toHaveText([...links])
    await expect(menu.locator('[aria-current="page"]')).toHaveText('Início')
    await menu.getByRole('link', { name: 'Perfil e segurança' }).click()
    await expect(page).toHaveURL(/\/perfil$/)
    await expect(menu.locator('[aria-current="page"]')).toHaveText('Perfil e segurança')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perfil e segurança')
  })
}

for (const largura of [360, 390, 768, 1440]) {
  test(`moldura em ${largura}px: mapa, painel e conteúdo sem transbordamento`, async ({ page }) => {
    await abrir(page, N2, largura)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(largura)
    const mapa = (await page.getByRole('region', { name: 'Mapa', exact: true }).boundingBox())!
    const folha = (await page.getByTestId('folha-mapa').boundingBox())!
    if (largura >= 1024) {
      const nav = (await lateral(page).boundingBox())!
      expect(nav.x + nav.width).toBeLessThanOrEqual(folha.x)
      expect(folha.x + folha.width).toBeLessThanOrEqual(mapa.x)
      expect(mapa.width).toBeGreaterThan(300)
      await expect(page.getByTestId('alca')).toBeHidden()
    } else {
      await expect(lateral(page)).toBeHidden()
      await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
      expect(folha.x).toBeGreaterThanOrEqual(0)
      expect(folha.x + folha.width).toBeLessThanOrEqual(largura)
      const marca = (await page.locator('.ivo-topo-mapa').boundingBox())!
      const zoom = (await page.locator('.leaflet-control-zoom').boundingBox())!
      expect(marca.x + marca.width).toBeLessThanOrEqual(zoom.x)
    }
  })
}

test('tela baixa: o menu longo do Master rola sem esconder a conta', async ({ page }) => {
  await abrir(page, ADM)
  await page.setViewportSize({ width: 1280, height: 560 })
  const ajuda = lateral(page).getByRole('link', { name: 'Ajuda', exact: true })
  await ajuda.scrollIntoViewIfNeeded()
  const item = (await ajuda.boundingBox())!
  const conta = (await lateral(page).locator('.ivo-lateral-rodape').boundingBox())!
  expect(item.y + item.height).toBeLessThanOrEqual(conta.y)
  await expect(lateral(page).getByRole('button', { name: 'Sair', exact: true })).toBeInViewport()
  await ajuda.click()
  await expect(page).toHaveURL(/\/ajuda$/)
})

test('troca de página na lateral sem recarregar e sem reconstruir a moldura', async ({ page }) => {
  await abrir(page, N1)
  await page.evaluate(() => document.documentElement.setAttribute('data-m0-navegacao', 'presente'))
  const menu = lateral(page).getByRole('navigation')
  await menu.getByRole('link', { name: 'Minhas corridas', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minhas corridas')
  await menu.getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page).toHaveURL(/\/agenda$/)
  await expect(menu.locator('[aria-current="page"]')).toHaveText('Agenda')
  await menu.getByRole('link', { name: 'Início', exact: true }).click()
  await expect(page.getByLabel('De', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-m0-navegacao', 'presente')
})

test('preferência do motorista acompanha desktop e menu móvel; redimensionar libera o diálogo', async ({ page }) => {
  await abrir(page, MOTORISTA)
  const chave = lateral(page).getByRole('switch', { name: 'Disponível para chamadas' })
  await expect(chave).toHaveAttribute('aria-checked', 'true')
  await chave.click()
  await expect(chave).toHaveAttribute('aria-checked', 'false')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true })
  await expect(menu.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await menu.getByRole('switch').click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(menu).toBeHidden()
  await expect(chave).toHaveAttribute('aria-checked', 'true')
  await lateral(page).getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page).toHaveURL(/\/agenda$/)
})

for (const tema of ['light', 'dark'] as const) {
  test(`desktop ${tema}: contraste, semântica, CSP e redução de movimento`, async ({ page }) => {
    const csp = await vigiarCsp(page)
    await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' })
    await abrir(page, N2)
    await expect(lateral(page)).toBeVisible()
    const resultado = await new AxeBuilder({ page }).include('.ivo-lateral').include('.ivo-topo-mapa').analyze()
    expect(resultado.violations).toEqual([])
    await expect(lateral(page).getByRole('link', { name: 'Agenda', exact: true })).toHaveCSS('transition-duration', '0s')
    expect(csp).toEqual([])
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#ivo-conteudo')).toBeFocused()
  })
}
