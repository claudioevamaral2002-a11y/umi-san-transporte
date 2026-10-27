// v2.2 (auditoria A02): o contador de pessoas para no limite da categoria ("até N pessoas"), desce ao trocar para uma
// categoria menor, o banco recusa acima (ACIMA_DA_CAPACIDADE) e "Ver cálculo" mostra as linhas da prévia.
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const linha = (codigo: string, descricao: string, quantidade: number | null, unitario: number | null, valor: number) => ({
  codigo,
  descricao,
  quantidade,
  unitario_cent: unitario,
  percentual_bp: null,
  base_cent: null,
  valor_cent: valor,
})

/** Passageiros leva até 4; Carga Leve (pessoas e carga) não tem limite. */
const CATEGORIAS = {
  ok: true,
  categorias: [
    {
      codigo: 'PASSAGEIROS',
      nome: 'IVO Passageiros',
      descricao_curta: 'Carro executivo',
      disponivel: true,
      total_cent: 22050,
      linhas: [linha('KM', 'Km rodados', 42, 350, 14700), linha('RETORNO', 'Retorno (50%)', null, null, 7350)],
      carga: 'PESSOAS',
      reboque: 'NAO',
      veiculo_cliente: false,
      cobra_hora: false,
      cobra_parada: true,
      pessoas_max: 4,
    },
    {
      codigo: 'CARGA_LEVE',
      nome: 'IVO Carga Leve',
      descricao_curta: 'Pessoas e carga',
      disponivel: true,
      total_cent: 31424,
      linhas: [linha('KM_COM_REBOQUE', 'Km rodados', 42, 480, 20160), linha('REBOQUE', 'Taxa fixa do reboque', 1, 11264, 11264)],
      carga: 'AMBOS',
      reboque: 'SIM',
      veiculo_cliente: false,
      cobra_hora: false,
      cobra_parada: true,
      pessoas_max: null,
    },
  ],
}

async function abrir(page: Page, o: { respostas?: Record<string, unknown[]> } = {}) {
  await page.setViewportSize({ width: 390, height: 844 })
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page, { respostas: o.respostas })
  await simularMapas(page, { rota: { km: 42, minutos: 55 } })
  await simularBlocosDoMapa(page)
  const categorias: unknown[] = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) => {
    categorias.push(route.request().postDataJSON())
    return json(route, CATEGORIAS)
  })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'De', exact: true }).fill('Estaleiro Navegantes')
  await page.getByRole('option', { name: /Estaleiro Navegantes/ }).first().click()
  await page.getByRole('combobox', { name: 'Para', exact: true }).fill('Porto')
  await page.getByRole('option', { name: /Porto de Itajaí/ }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
  return { chamadas, categorias }
}

const abrirDetalhes = (page: Page) => page.getByText('Detalhes da corrida (pessoas, carga, contato)').click()
const pessoas = (page: Page) => page.getByRole('group', { name: 'Pessoas' })
const mais = (page: Page) => page.getByRole('button', { name: 'Aumentar pessoas' })

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function pedidoEnviado(chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }>) {
  await expect.poll(() => chamadas.filter((c) => c.rpc === 'criar_pedido').length).toBe(1)
  return chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
}

test.describe('v2.2: limite de pessoas e Ver cálculo', () => {
  test('Passageiros: o "+" para em 4, com "até 4 pessoas"; o pedido vai com 4', async ({ page }) => {
    const { chamadas } = await abrir(page)
    await abrirDetalhes(page)
    await expect(pessoas(page)).toContainText('até 4 pessoas')
    for (let i = 0; i < 3; i++) await mais(page).click()
    await expect(pessoas(page).locator('output')).toHaveText('4')
    await expect(mais(page)).toBeDisabled()
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    expect(await pedidoEnviado(chamadas)).toMatchObject({ categoria: 'PASSAGEIROS', pessoas_qtd: 4 })
  })

  test('Carga Leve (sem limite) com 6, troca para Passageiros: desce a 4 com o aviso', async ({ page }) => {
    const { chamadas } = await abrir(page)
    await page.getByRole('radio', { name: /IVO Carga Leve/ }).click()
    await abrirDetalhes(page)
    await expect(pessoas(page)).not.toContainText('até')
    for (let i = 0; i < 5; i++) await mais(page).click()
    await expect(pessoas(page).locator('output')).toHaveText('6')
    await page.getByRole('radio', { name: /IVO Passageiros/ }).click()
    await expect(pessoas(page).locator('output')).toHaveText('4')
    await expect(page.getByRole('status').filter({ hasText: 'ajustamos para 4' })).toContainText('até 4 pessoas')
    await expect(mais(page)).toBeDisabled()
    expect(await semRolagemLateral(page)).toBe(true)
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    expect(await pedidoEnviado(chamadas)).toMatchObject({ categoria: 'PASSAGEIROS', pessoas_qtd: 4 })
  })

  test('o banco recusa com ACIMA_DA_CAPACIDADE: a tela mostra o erro e relê as categorias', async ({ page }) => {
    const { categorias } = await abrir(page, {
      respostas: { criar_pedido: [{ ok: false, codigo: 'ACIMA_DA_CAPACIDADE', detalhe: { pessoas_max: 4 } }] },
    })
    const lidas = categorias.length
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    const erro = page.getByRole('alert')
    await expect(erro).toBeVisible()
    await expect(erro).not.toHaveText('')
    await expect(page).not.toHaveURL(/\/corrida\//)
    await expect.poll(() => categorias.length).toBeGreaterThan(lidas)
  })

  test('"Ver cálculo" abre as linhas da prévia da categoria escolhida; 390 px sem rolagem lateral e sem violações', async ({ page }) => {
    await abrir(page)
    const calculo = page.getByTestId('ver-calculo')
    await expect(calculo.getByTestId('memorial')).toBeHidden()
    await calculo.getByText('Ver cálculo').click()
    await expect(calculo.getByTestId('memorial')).toContainText('Km rodados')
    await expect(calculo.getByTestId('memorial')).toContainText('Retorno (50%)')
    await expect(calculo).toContainText('R$ 220,50')
    // Outra categoria: as linhas dela.
    await page.getByRole('radio', { name: /IVO Carga Leve/ }).click()
    await page.getByTestId('ver-calculo').getByText('Ver cálculo').click()
    await expect(page.getByTestId('memorial')).toContainText('Taxa fixa do reboque')
    expect(await semRolagemLateral(page)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    // Escuro, com o aviso de pessoas na tela.
    await page.emulateMedia({ colorScheme: 'dark' })
    await abrirDetalhes(page)
    for (let i = 0; i < 5; i++) await mais(page).click()
    await page.getByRole('radio', { name: /IVO Passageiros/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'ajustamos para 4' })).toBeVisible()
    expect(await semRolagemLateral(page)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
})
