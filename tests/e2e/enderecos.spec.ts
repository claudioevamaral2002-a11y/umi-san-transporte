import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { simularMapas, simularPrevia, type MapasFalsos } from './apoio/mapasFalsos.ts'
import { DIA_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const CLIENTE_N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const AVISO_FORA = 'Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km.'

/** Abre o novo pedido e vai até o passo "Onde?". */
async function irParaOnde(page: Page, mapas: MapasFalsos = {}) {
  await comSessaoFalsa(page, CLIENTE_N2)
  await simularApi(page)
  const pedidos = await simularPedidos(page)
  const chamadas = await simularMapas(page, mapas)
  await page.goto('/pedidos/novo')
  await escolherDiaNoPedido(page, DIA_PEDIDO)
  await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Onde?' })).toBeVisible()
  return { chamadas, pedidos }
}

test.describe('endereços no novo pedido', () => {
  test('digitar mostra locais da empresa primeiro, depois Google; escolher preenche nome e endereço na mesma sessão', async ({ page }) => {
    const csp = await vigiarCsp(page)
    const { chamadas } = await irParaOnde(page)
    const destino = page.getByRole('combobox', { name: 'Destino' })
    await destino.fill('estaleiro nav')
    const lista = page.getByRole('listbox', { name: 'Sugestões para Destino' })
    const daEmpresa = lista.getByRole('group', { name: 'Locais da empresa' }).getByRole('option')
    await expect(daEmpresa).toHaveCount(1)
    await expect(daEmpresa.first()).toContainText('Estaleiro Navegantes')
    // O Google não repete o local que a empresa já tem.
    const google = lista.getByRole('group', { name: 'Sugestões' }).getByRole('option')
    await expect(google).toHaveCount(1)
    await expect(google.first()).toContainText('Estaleiro Navship')
    await expect(lista.getByRole('option', { name: 'Não achou? Marcar no mapa' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'sugestões' })).toHaveText('2 sugestões')

    await google.first().click()
    await expect(destino).toHaveValue('Estaleiro Navship')
    await expect(page.getByTestId('endereco-destino')).toHaveText('Rua Prefeito José Juvenal Mafra, Navegantes, SC')
    await expect(lista).toHaveCount(0)
    const sugerir = chamadas.filter((c) => c.acao === 'sugerir')
    const detalhar = chamadas.filter((c) => c.acao === 'detalhar')
    expect(sugerir.length).toBeGreaterThan(0)
    expect(new Set(sugerir.map((c) => c.sessao)).size).toBe(1)
    expect(detalhar).toHaveLength(1)
    expect(detalhar[0]!.sessao).toBe(sugerir[0]!.sessao)
    expect(csp).toEqual([])
  })

  test('local da empresa não chama o Google para detalhar; a próxima busca usa sessão nova', async ({ page }) => {
    const { chamadas } = await irParaOnde(page)
    const origem = page.getByRole('combobox', { name: 'Origem' })
    await origem.fill('porto')
    await page.getByRole('listbox', { name: 'Sugestões para Origem' }).getByRole('option', { name: /Porto de Itajaí/ }).click()
    await expect(page.getByTestId('endereco-origem')).toHaveText('Av. Min. Victor Konder, Itajaí, SC')
    const destino = page.getByRole('combobox', { name: 'Destino' })
    await destino.click()
    // Locais da empresa aparecem ao focar, antes de digitar.
    await page.getByRole('listbox', { name: 'Sugestões para Destino' }).getByRole('option', { name: /Estaleiro Navegantes/ }).click()
    await expect(destino).toHaveValue('Estaleiro Navegantes')
    expect(chamadas.filter((c) => c.acao === 'detalhar')).toHaveLength(1)
    await destino.fill('estaleiro det')
    await expect(page.getByRole('listbox', { name: 'Sugestões para Destino' }).getByRole('option', { name: /Estaleiro Detroit/ })).toBeVisible()
    const sessoes = new Set(chamadas.filter((c) => c.acao === 'sugerir').map((c) => c.sessao))
    expect(sessoes.size).toBe(2)
  })

  test('Google fora do ar: campo vira texto livre com aviso e o pedido segue', async ({ page }) => {
    await irParaOnde(page, { fora: true })
    await page.getByRole('combobox', { name: 'Origem' }).fill('Porto de Itajaí, portão 3')
    await expect(page.getByText(AVISO_FORA)).toBeVisible()
    await page.getByRole('combobox', { name: 'Destino' }).fill('Marina do Saco da Fazenda')
    await expect(page.getByText(AVISO_FORA)).toHaveCount(2)
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'O que vamos levar?' })).toBeVisible()
  })

  test('resposta atrasada de uma digitação antiga não substitui a nova', async ({ page }) => {
    await irParaOnde(page, { atrasoSugestao: { texto: 'estal', ms: 1500 } })
    const destino = page.getByRole('combobox', { name: 'Destino' })
    await destino.fill('estal')
    await page.waitForTimeout(400)
    await destino.fill('estaleiro det')
    const lista = page.getByRole('listbox', { name: 'Sugestões para Destino' })
    await expect(lista.getByRole('option', { name: /Estaleiro Detroit/ })).toBeVisible()
    await page.waitForTimeout(1600)
    await expect(lista.getByRole('option', { name: /Estaleiro Navship/ })).toHaveCount(0)
    await expect(lista.getByRole('option', { name: /Estaleiro Detroit/ })).toBeVisible()
  })

  test('teclado: setas e Enter escolhem; Esc fecha; aria-activedescendant acompanha', async ({ page }) => {
    await irParaOnde(page)
    const destino = page.getByRole('combobox', { name: 'Destino' })
    await destino.fill('estaleiro')
    const lista = page.getByRole('listbox', { name: 'Sugestões para Destino' })
    await expect(lista.getByRole('option', { name: /Estaleiro Detroit/ })).toBeVisible()
    await destino.press('ArrowDown')
    await destino.press('ArrowDown')
    const ativo = await destino.getAttribute('aria-activedescendant')
    expect(ativo).toBeTruthy()
    await expect(page.locator(`[id="${ativo}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator(`[id="${ativo}"]`)).toContainText('Estaleiro Navship')
    await destino.press('Enter')
    await expect(destino).toHaveValue('Estaleiro Navship')
    await expect(destino).toHaveAttribute('aria-expanded', 'false')
    await destino.fill('estaleiro')
    await expect(lista).toBeVisible()
    await destino.press('Escape')
    await expect(lista).toHaveCount(0)
    await expect(destino).toHaveValue('estaleiro')
  })

  test('com os dois pontos: rota no Onde e prévia no Confira (N2), com reboque Sim e Não sei; o pedido leva o km', async ({ page }) => {
    const csp = await vigiarCsp(page)
    const { chamadas, pedidos } = await irParaOnde(page)
    const previas = await simularPrevia(page)
    await escolherPontos(page)
    const rota = page.getByTestId('rota-estimada')
    await expect(rota).toContainText('38 km pela rota')
    await expect(rota).toContainText('cerca de 45 min')
    expect(chamadas.filter((c) => c.acao === 'rota')).toHaveLength(1)
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('radio', { name: 'Sim' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()

    const previa = page.getByTestId('previa-orcamento')
    await expect(previa.getByRole('heading', { name: 'Prévia do orçamento' })).toBeVisible()
    await expect(previa).toContainText(/R\$\s?423,60/)
    await expect(previa).toContainText('Estimativa pela tabela do contrato. O valor final vem no orçamento do motorista.')
    await expect(previa.getByText('Taxa fixa do reboque')).toBeVisible()
    await previa.getByRole('button', { name: 'Ocultar as linhas' }).click()
    await expect(previa.getByText('Taxa fixa do reboque')).toHaveCount(0)
    expect(previas.at(-1)).toEqual({ km: 38.2, usa_reboque: true, levar: true, trazer: false, modalidade: 'VEICULO_PROPRIO' })
    await expect(page.getByTestId('resumo-pedido')).toContainText('38 km pela rota, cerca de 45 min')

    // "Não sei": os dois valores lado a lado.
    await page.getByRole('button', { name: 'Editar modalidade' }).click()
    await page.getByRole('radio', { name: 'Não sei' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(previa.getByTestId('previa-sem-reboque')).toContainText(/Sem reboque\s*R\$\s?199,50/)
    await expect(previa.getByTestId('previa-com-reboque')).toContainText(/Com reboque\s*R\$\s?423,60/)

    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByTestId('pedido-enviado')).toBeVisible()
    const criar = pedidos.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
    expect(criar).toMatchObject({
      origem: 'Porto de Itajaí',
      origem_place_id: 'ChIJpor',
      destino: 'Estaleiro Navship',
      destino_place_id: 'ChIJnav',
    })
    // Termos do Google: coordenadas, endereço e km do Google não são guardados no pedido.
    for (const chave of ['origem_lat', 'destino_lat', 'origem_endereco', 'km_estimado', 'minutos_estimados']) {
      expect(criar).not.toHaveProperty(chave)
    }
    expect(csp).toEqual([])
  })

  test('sem rota de carro (mesmo ponto, ilha): sem km nem prévia, e o pedido segue', async ({ page }) => {
    const { pedidos } = await irParaOnde(page, { semRota: true })
    const previas = await simularPrevia(page)
    await escolherPontos(page)
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await expect(page.getByTestId('rota-estimada')).toHaveCount(0)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Confira o pedido' })).toBeVisible()
    await expect(page.getByTestId('previa-orcamento')).toHaveCount(0)
    expect(previas).toHaveLength(0)
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByTestId('pedido-enviado')).toBeVisible()
    expect(pedidos.find((c) => c.rpc === 'criar_pedido')!.corpo.p).not.toHaveProperty('km_estimado')
  })

  test('empresa sem contrato ou veículo do cliente: sem prévia', async ({ page }) => {
    await irParaOnde(page)
    const previas = await simularPrevia(page, { ok: false, codigo: 'SEM_CONTRATO' })
    await escolherPontos(page)
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Confira o pedido' })).toBeVisible()
    await expect.poll(() => previas.length).toBeGreaterThan(0)
    await expect(page.getByTestId('previa-orcamento')).toHaveCount(0)
    await page.getByRole('button', { name: 'Editar modalidade' }).click()
    await page.getByRole('radio', { name: 'Veículo do cliente' }).click()
    const antes = previas.length
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Confira o pedido' })).toBeVisible()
    await expect(page.getByTestId('previa-orcamento')).toHaveCount(0)
    expect(previas.length).toBe(antes)
  })
})

/** Origem e destino escolhidos pelo Google (com coordenadas). */
async function escolherPontos(page: Page) {
  const origem = page.getByRole('combobox', { name: 'Origem' })
  await origem.fill('porto')
  await page.getByRole('listbox', { name: 'Sugestões para Origem' }).getByRole('option', { name: /Porto de Itajaí/ }).click()
  await expect(page.getByTestId('endereco-origem')).toBeVisible()
  const destino = page.getByRole('combobox', { name: 'Destino' })
  await destino.fill('estaleiro navs')
  await page.getByRole('listbox', { name: 'Sugestões para Destino' }).getByRole('option', { name: /Estaleiro Navship/ }).click()
  await expect(page.getByTestId('endereco-destino')).toBeVisible()
}
