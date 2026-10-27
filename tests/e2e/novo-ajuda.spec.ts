// v2.2 (Tarefa 5, especificação §5.5): a Ajuda real de cada perfil, com "Falar com a IVO" (link de telefone ou
// WhatsApp, ou "Contato ainda não cadastrado") e perguntas que abrem e fecham; e o contato na Carteira do Crédito
// (v2.2.1: só no Painel da empresa › Carteira, do Administrador).
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { FAIXAS_PADRAO, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { saldoFalso } from './apoio/dinheiroFalso.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const N3: PerfilFalso = { papel: 'CLIENTE', nivel: 3, nome: 'Paulo Reis', empresa_nome: 'Umi San' }
const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const TELA = { width: 390, height: 844 }

interface Opcoes {
  contato?: string | null
  forma?: 'CREDITO' | 'FATURADO'
}

async function abrir(page: Page, perfil: PerfilFalso, caminho: string, { contato = '(47) 99999-0000', forma = 'CREDITO' }: Opcoes = {}) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : { aal: 'aal2' })
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page)
  await simularPedidos(page, {})
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/saldo_empresa`, (r) => json(r, saldoFalso({ forma_cobranca: forma })))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/painel_empresa`, (r) =>
    json(r, {
      ok: true,
      resumo: {
        mes: '2026-10-01',
        gasto_cent: 0,
        reservado_cent: 0,
        disponivel_cent: 100000,
        total_mes_cent: 0,
        contato_recarga: contato,
        forma_cobranca: forma,
      },
      proximas: [],
      recentes: [],
      do_mes: [],
      pessoas: { sem_corridas: 0, convites_pendentes: 0 },
    }),
  )
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/contato_ivo`, (r) => json(r, { ok: true, contato }))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/ajuda_cliente`, (r) =>
    json(r, {
      ok: true,
      faixas_cancelamento: FAIXAS_PADRAO,
      prazo_orcar_horas: 12,
      validade_orcamento_horas: 48,
      forma_cobranca: forma,
    }),
  )
  await page.goto(caminho)
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test('cliente: o ☰ abre a Ajuda real, com o contato em link de telefone e as faixas do contrato', async ({ page }) => {
  await abrir(page, N2, '/')
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Ajuda' }).click()
  await expect(page).toHaveURL(/\/ajuda$/)
  await expect(page.getByRole('heading', { name: 'Ajuda', level: 1 })).toBeVisible()
  await expect(page.getByText('Esta tela chega em breve.')).toHaveCount(0)
  const falar = page.getByTestId('falar-com-ivo')
  await expect(falar.getByRole('heading', { name: 'Falar com a IVO' })).toBeVisible()
  await expect(falar.getByRole('link', { name: '(47) 99999-0000' })).toHaveAttribute('href', 'tel:+5547999990000')

  await page.getByText('Como funciona o orçamento?').click()
  await expect(page.getByText(/em até 12 horas/)).toBeVisible()
  await expect(page.getByText(/vale por 2 dias/)).toBeVisible()
  await page.getByText('Posso cancelar? Tem multa?').click()
  const faixas = page.getByTestId('faixas-cancelamento')
  await expect(faixas).toContainText('24 h ou mais antes: sem multa')
  await expect(faixas).toContainText('Menos de 6 h antes: multa de 100%')
  await expect(page.getByText('Como recarregar o saldo?')).toBeVisible()
  await expect(page.getByText('Como a empresa paga?')).toHaveCount(0)
  await page.getByText('Como recarregar o saldo?').click()
  await expect(page.getByText(/saldo e o extrato em Painel da empresa › Carteira/)).toBeVisible()
  expect(await semRolagemLateral(page)).toBe(false)
})

test('cliente no Faturado: fala da fatura em vez da recarga; WhatsApp vira link https', async ({ page }) => {
  await abrir(page, N2, '/ajuda', { forma: 'FATURADO', contato: 'wa.me/5547999990000' })
  await expect(page.getByRole('link', { name: 'wa.me/5547999990000' })).toHaveAttribute('href', 'https://wa.me/5547999990000')
  await expect(page.getByText('Como a empresa paga?')).toBeVisible()
  await expect(page.getByText('Como recarregar o saldo?')).toHaveCount(0)
})

test('sem contato cadastrado: "Contato ainda não cadastrado"', async ({ page }) => {
  await abrir(page, MOTORISTA, '/ajuda', { contato: null })
  await expect(page.getByTestId('falar-com-ivo')).toContainText('Contato ainda não cadastrado')
  await expect(page.getByText('Como orçar um pedido?')).toBeVisible()
  await page.getByText('Como concluo a corrida?').click()
  await expect(page.getByText(/toque em Concluir serviço/)).toBeVisible()
})

test('N3 (visualizador): sem as respostas de pedir e aprovar, só que acompanha os pedidos', async ({ page }) => {
  await abrir(page, N3, '/ajuda')
  await expect(page.getByText('O que eu vejo no app?')).toBeVisible()
  await expect(page.getByText('Como funciona o orçamento?')).toHaveCount(0)
  await expect(page.getByText('Como aprovo o orçamento?')).toHaveCount(0)
  await expect(page.getByText('Posso cancelar? Tem multa?')).toBeVisible()
})

test('Master: onde fica cada coisa', async ({ page }) => {
  await abrir(page, ADM, '/ajuda')
  for (const p of ['Onde ficam os contratos?', 'Onde mudo as categorias e os preços?', 'Onde ficam as faturas?', 'Onde vejo quem fez o quê?']) {
    await expect(page.getByText(p)).toBeVisible()
  }
})

test('Painel da empresa › Carteira no Crédito: "Para recarregar, fale com a IVO" com o link', async ({ page }) => {
  await abrir(page, N1, '/empresa/carteira')
  const contato = page.getByTestId('contato-recarga')
  await expect(contato).toContainText('Para recarregar, fale com a IVO:')
  await expect(contato.getByRole('link', { name: '(47) 99999-0000' })).toHaveAttribute('href', 'tel:+5547999990000')
  expect(await semRolagemLateral(page)).toBe(false)
})

test('Carteira no Faturado: vira Faturas, sem o contato de recarga', async ({ page }) => {
  await abrir(page, N1, '/empresa/carteira', { forma: 'FATURADO' })
  await expect(page).toHaveURL(/\/empresa\/faturas$/)
  await expect(page.getByTestId('contato-recarga')).toHaveCount(0)
})

test('Carteira sem contato: "Contato ainda não cadastrado"', async ({ page }) => {
  await abrir(page, N1, '/empresa/carteira', { contato: '' })
  await expect(page.getByTestId('contato-recarga')).toContainText('Contato ainda não cadastrado')
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })
    test('Ajuda aberta sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, N2, '/ajuda')
      await page.getByText('Posso cancelar? Tem multa?').click()
      await expect(page.getByTestId('faixas-cancelamento')).toBeVisible()
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
