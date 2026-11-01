// Fase 4 (Tarefa 7): moldura do app novo. Mapa de tela cheia, folha inferior com alça e o menu ☰ por perfil (§6.7).
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { comSessaoFalsa, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const AAL2 = { aal: 'aal2' as const }
const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }

/** PNG transparente 1×1 para os blocos do mapa. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Map Tiles API simulada: as `falhas` primeiras createSession dão 500; depois, sessão `s1`. */
async function blocosDoMapa(page: Page, falhas = 0) {
  const pedidos = { sessao: 0 }
  await page.route('https://tile.googleapis.com/**', (route: Route) => {
    if (route.request().url().includes('/v1/createSession')) {
      pedidos.sessao++
      if (pedidos.sessao <= falhas) return route.fulfill({ status: 500, body: '' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: 's1', expiry: '9999999999' }) })
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  return pedidos
}

async function abrir(page: Page, perfil: PerfilFalso, opcoes: { aal?: 'aal1' | 'aal2'; falhas?: number } = {}) {
  await comSessaoFalsa(page, perfil, opcoes.aal ? { aal: opcoes.aal } : {})
  await simularMapas(page)
  const pedidos = await blocosDoMapa(page, opcoes.falhas ?? 0)
  await page.goto('/')
  return pedidos
}

async function abrirMenu(page: Page) {
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu).toBeVisible()
  return menu
}

/** Rótulos dos itens do menu, na ordem (links e o interruptor). */
const itens = (menu: ReturnType<Page['getByRole']>) =>
  menu.getByRole('list', { name: 'Itens do menu' }).getByRole('listitem').allInnerTexts()

test('mapa de tela cheia, botão ☰ no canto e a folha com alça', async ({ page }) => {
  await abrir(page, N2)
  const mapa = page.getByTestId('mapa-base')
  await expect(mapa).toHaveAttribute('data-pronto', 'sim')
  const vp = page.viewportSize()!
  const caixa = (await mapa.boundingBox())!
  expect(caixa.width).toBe(vp.width)
  expect(caixa.height).toBe(vp.height)
  // Alternativa em texto para o mapa.
  await expect(page.getByRole('region', { name: 'Mapa' })).toBeVisible()
  const botao = page.getByRole('button', { name: 'Abrir menu' })
  const b = (await botao.boundingBox())!
  expect(b.x).toBeLessThan(40)
  expect(b.y).toBeLessThan(80)
  const folha = page.getByTestId('folha-mapa')
  await expect(folha).toBeVisible()
  await expect(folha.getByTestId('alca')).toBeVisible()
  await expect(folha).toContainText('Diego')
})

test('cliente N1: Minhas corridas, Agenda, Equipe, Painel da empresa, Perfil e segurança, Ajuda', async ({
  page,
}) => {
  await abrir(page, N1)
  const menu = await abrirMenu(page)
  await expect(menu).toContainText('Marina Souza')
  await expect(menu).toContainText('Umi San')
  expect(await itens(menu)).toEqual([
    'Minhas corridas',
    'Agenda',
    'Equipe',
    'Painel da empresa',
    'Perfil e segurança',
    'Ajuda',
  ])
  // As telas de hoje abrem dentro do app novo, na mesma origem (Ruling R12).
  await expect(menu.getByRole('link', { name: 'Equipe' })).toHaveAttribute('href', '/equipe')
  await expect(menu.getByRole('button', { name: 'Sair' })).toBeVisible()

  // Diálogo de verdade: Esc fecha e o foco volta ao botão ☰.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused()

  // "Painel da empresa" fica no app novo (/empresa; a tela chega na Tarefa 14).
  await abrirMenu(page)
  await page.getByRole('link', { name: 'Painel da empresa' }).click()
  await expect(page).toHaveURL(/\/empresa$/)
  await expect(page.getByRole('heading', { name: 'Painel da empresa' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden()
})

test('cliente N2 não vê Equipe nem Painel da empresa', async ({ page }) => {
  await abrir(page, N2)
  const menu = await abrirMenu(page)
  expect(await itens(menu)).toEqual([
    'Minhas corridas',
    'Agenda',
    'Perfil e segurança',
    'Ajuda',
  ])
})

test('sair da conta apaga o último centro de custo do aparelho (a categoria fica)', async ({ page }) => {
  await abrir(page, N1)
  await page.evaluate(() => {
    localStorage.setItem('ivo:ultimo-centro-custo', 'Obra 12')
    localStorage.setItem('ivo:ultima-categoria', 'PASSAGEIROS')
  })
  const menu = await abrirMenu(page)
  await menu.getByRole('button', { name: 'Sair' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ivo:ultimo-centro-custo'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('ivo:ultima-categoria'))).toBe('PASSAGEIROS')
})

test('motorista: "Disponível para chamadas" (só no aparelho), Meus veículos e "Corridas do mês"', async ({ page }) => {
  const funcoes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/') || r.url().includes('/functions/v1/')) funcoes.push(r.url())
  })
  await page.addInitScript(() => {
    ;(navigator.geolocation as unknown as { watchPosition: unknown }).watchPosition = () => {
      ;(window as unknown as { __gps: boolean }).__gps = true
      return 0
    }
    ;(navigator.geolocation as unknown as { getCurrentPosition: unknown }).getCurrentPosition = () => {
      ;(window as unknown as { __gps: boolean }).__gps = true
    }
  })
  await abrir(page, MOTORISTA, AAL2)
  const menu = await abrirMenu(page)
  expect(await itens(menu)).toEqual([
    expect.stringContaining('Disponível para chamadas'),
    'Minhas corridas e Pendências',
    'Agenda',
    'Meus veículos',
    'Corridas do mês',
    'Perfil e segurança',
    'Ajuda',
  ])
  await expect(menu.getByText('Ganhos')).toHaveCount(0)

  const chave = menu.getByRole('switch', { name: 'Disponível para chamadas' })
  // Ligado por padrão; desligar fica gravado só no aparelho.
  await expect(chave).toHaveAttribute('aria-checked', 'true')
  const antes = funcoes.length
  await chave.click()
  await expect(chave).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => localStorage.getItem('ivo:disponivel'))).toBe('0')
  // Preferência local: nada vai ao banco e nenhuma localização é pedida.
  expect(funcoes.length).toBe(antes)
  expect(await page.evaluate(() => (window as unknown as { __gps?: boolean }).__gps ?? false)).toBe(false)

  await page.reload()
  await expect(page.getByTestId('mapa-base')).toBeVisible()
  const denovo = await abrirMenu(page)
  await expect(denovo.getByRole('switch', { name: 'Disponível para chamadas' })).toHaveAttribute('aria-checked', 'false')

  await denovo.getByRole('link', { name: 'Meus veículos' }).click()
  await expect(page).toHaveURL(/\/veiculos$/)
  await expect(page.getByRole('heading', { name: 'Meus veículos' })).toBeVisible()
})

test('ADM: "Categorias e preços", "Veículos" e as telas de hoje, todas no app novo', async ({ page }) => {
  await abrir(page, ADM, AAL2)
  const menu = await abrirMenu(page)
  await expect(menu.getByRole('link', { name: 'Categorias e preços' })).toHaveAttribute('href', '/adm/categorias')
  await expect(menu.getByRole('link', { name: 'Veículos', exact: true })).toHaveAttribute('href', '/adm/veiculos')
  await expect(menu.getByRole('link', { name: 'Painel da empresa' })).toHaveAttribute('href', '/empresa')
  for (const [rotulo, caminho] of [
    ['Painel e Corridas em andamento', '/adm/painel'],
    ['Contratos', '/adm/contratos'],
    ['Créditos', '/adm/creditos'],
    ['Usuários', '/adm/usuarios'],
    ['Empresas', '/adm/empresas'],
    ['Configurações', '/adm/configuracoes'],
    ['Auditoria', '/adm/auditoria'],
  ] as const) {
    await expect(menu.getByRole('link', { name: rotulo })).toHaveAttribute('href', caminho)
  }
  await menu.getByRole('link', { name: 'Categorias e preços' }).click()
  await expect(page).toHaveURL(/\/adm\/categorias$/)
  await expect(page.getByRole('heading', { name: 'Categorias e preços' })).toBeVisible()
  // Nas telas de página o ☰ continua no canto.
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
})

test('o cliente não abre as telas do ADM', async ({ page }) => {
  await abrir(page, N1)
  await page.goto('/adm/categorias')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('folha-mapa')).toBeVisible()
})

test('a primeira createSession dá 500: o mapa tenta de novo e aparece depois de 15 s', async ({ page }) => {
  await page.clock.install()
  const pedidos = await abrir(page, N2, { falhas: 1 })
  const mapa = page.getByTestId('mapa-base')
  await expect(mapa).toHaveAttribute('data-pronto', 'nao')
  await expect(page.getByTestId('mapa-aviso')).toContainText('Tentando de novo')
  expect(pedidos.sessao).toBe(1)
  await page.clock.runFor(14_000)
  await expect(mapa).toHaveAttribute('data-pronto', 'nao')
  await page.clock.runFor(1_000)
  await expect(mapa).toHaveAttribute('data-pronto', 'sim')
  expect(pedidos.sessao).toBe(2)
  await expect(page.getByTestId('mapa-aviso')).toHaveCount(0)
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('folha e menu seguem o tema, e o axe não acha violações', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, N1)
      await expect(page.getByTestId('mapa-base')).toHaveAttribute('data-pronto', 'sim')
      const superficie = tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(20, 55, 71)'
      await expect(page.getByTestId('folha-mapa')).toHaveCSS('background-color', superficie)
      await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCSS('background-color', superficie)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

      const menu = await abrirMenu(page)
      await expect(menu).toHaveCSS('background-color', superficie)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  })
}
