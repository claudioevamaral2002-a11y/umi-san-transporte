// v2.2 (Tarefa 4, especificação §5.2): as telas da corrida mostram o número do pedido (#0042) e "Detalhes do pedido",
// recolhido, com só o que existe (pessoas ou carga, paradas, diárias, outros custos, observações, centro de custo e
// contato). A agendada passa a abrir a corrida nova (`/corrida/{id}`). Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, HISTORICO_ORCADO, ID_PEDIDO, pedidoOrcadoCliente, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }

/** Pedido aguardando o Ivo com tudo preenchido (carga "Ambos", uma parada, diárias, outros custos e centro de custo). */
function solicitada(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'SOLICITADA',
      categoria: 'PASSAGEIROS',
      categoria_nome: 'IVO Passageiros',
      paradas: [{ texto: 'Marina Itajaí · Píer B', place_id: null, lat: null, lng: null }],
      diarias_estimadas: 2,
      outros_custos: 'Balsa na volta',
      centro_custo: 'Obra Norte',
      ...extra,
    }),
    historico: [HISTORICO_ORCADO[0]],
    orcamento: null,
    acoes: { ...SEM_ACOES, cancelar: true },
  }
}

async function abrir(page: Page, caminho: string, detalhes: unknown[]) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page, { detalhes })
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  await page.goto(caminho)
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** Rótulo → valor de cada linha de "Detalhes do pedido", na ordem da tela. */
async function linhas(page: Page) {
  const detalhes = page.getByTestId('detalhes-pedido')
  const rotulos = await detalhes.locator('dt').allInnerTexts()
  const valores = await detalhes.locator('dd').allInnerTexts()
  return rotulos.map((r, i) => `${r.trim()}: ${valores[i]!.trim().replace(/\s+/g, ' ')}`)
}

test('aguardando o Ivo: o número no topo e "Detalhes do pedido" recolhido, com só o que existe', async ({ page }) => {
  await abrir(page, `/corrida/${ID_PEDIDO}`, [solicitada()])
  await expect(page.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible()
  await expect(page.getByTestId('numero-pedido')).toHaveText('Pedido #0042')

  const detalhes = page.getByTestId('detalhes-pedido')
  const resumo = detalhes.locator('summary')
  await expect(resumo).toHaveText('Detalhes do pedido')
  // Recolhido: o conteúdo só aparece ao abrir.
  await expect(detalhes.getByText('Obra Norte')).toBeHidden()
  await resumo.click()
  await expect(detalhes.getByText('Obra Norte')).toBeVisible()
  expect(await linhas(page)).toEqual([
    'Pessoas: 2 pessoas',
    'Carga: Bomba d’água · 85,5 kg · 1 × 1 × 1 m',
    'Parada: Marina Itajaí · Píer B',
    'Diárias: 2 diárias',
    'Outros custos: Balsa na volta',
    // A observação é texto (nunca HTML).
    'Observações: <b>portão 3</b>',
    'Centro de custo: Obra Norte',
    'Contato: Rui · (47) 99999-1234',
  ])
  expect(await semRolagemLateral(page)).toBe(true)
})

test('só pessoas, sem extras: os detalhes não inventam linhas', async ({ page }) => {
  await abrir(page, `/corrida/${ID_PEDIDO}`, [
    solicitada({
      carga: 'PESSOAS',
      pessoas_qtd: 1,
      equipamento_desc: null,
      peso_kg: null,
      dimensoes: null,
      paradas: [],
      diarias_estimadas: 0,
      outros_custos: null,
      observacoes: null,
      centro_custo: null,
      contato_nome: null,
      contato_telefone: null,
    }),
  ])
  await page.getByTestId('detalhes-pedido').locator('summary').click()
  expect(await linhas(page)).toEqual(['Pessoas: 1 pessoa'])
})

test('confirmar a proposta: o número e os detalhes', async ({ page }) => {
  await abrir(page, `/corrida/${ID_PEDIDO}`, [pedidoOrcadoCliente()])
  await expect(page.getByRole('button', { name: /^Confirmar corrida/ })).toBeVisible()
  await expect(page.getByTestId('numero-pedido')).toHaveText('Pedido #0042')
  await page.getByTestId('detalhes-pedido').locator('summary').click()
  await expect(page.getByTestId('detalhes-pedido')).toContainText('Bomba d’água')
  expect(await semRolagemLateral(page)).toBe(true)
})

test('agendada: /pedidos/{id} abre a corrida nova, com o número e os detalhes', async ({ page }) => {
  const o = pedidoOrcadoCliente()
  const agendada = {
    ...o,
    pedido: { ...o.pedido, status: 'AGENDADA', centro_custo: 'Obra Norte' },
    orcamento: { ...o.orcamento, status: 'APROVADO' },
    acoes: { ...SEM_ACOES, cancelar_agendado: true },
  }
  await abrir(page, `/pedidos/${ID_PEDIDO}`, [agendada])
  await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible()
  await expect(page.getByTestId('numero-pedido')).toHaveText('Pedido #0042')
  await page.getByTestId('detalhes-pedido').locator('summary').click()
  await expect(page.getByTestId('detalhes-pedido')).toContainText('Obra Norte')
  // O cancelamento do agendamento (antes no detalhe de hoje) abre a folha com a multa calculada no servidor.
  await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
  await expect(page.getByRole('dialog', { name: 'Cancelar agendamento' })).toBeVisible()
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('aguardando com os detalhes abertos: sem violações do axe nem de CSP, 390 px sem rolagem lateral', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, `/corrida/${ID_PEDIDO}`, [solicitada()])
      await page.getByTestId('detalhes-pedido').locator('summary').click()
      await expect(page.getByTestId('detalhes-pedido').getByText('Obra Norte')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(await semRolagemLateral(page)).toBe(true)
      expect(csp).toEqual([])
    })
  })
}
