// Fase 4 (Tarefa 10): o lado do motorista no app novo. Início com a próxima corrida e "Deslize para sair", a chamada
// (mockup 5), a contraproposta na calculadora (mockup 6, ajustada em 19/10, Ruling R11) e a viagem com a rota desenhada
// (mockup 7). Roda no projeto Playwright `novo` (dist-novo). Dinheiro: nada muda na tela antes da resposta do servidor.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import {
  detalheFalso,
  ID_PEDIDO,
  orcamentoCliente,
  pendenciaFalsa,
  pedidoSolicitadoMotorista,
  SEM_ACOES,
  simularPedidos,
} from './apoio/pedidosFalsos.ts'
import { codificarPolyline } from './apoio/polyline.ts'
import { simularRealtime } from './apoio/realtimeFalso.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const MIN = 60_000
const V_HILUX = '00000000-0000-4000-8000-0000000000c1'
const V_REBOQUE = '00000000-0000-4000-8000-0000000000c2'
const V_SPRINTER = '00000000-0000-4000-8000-0000000000c3'

const veiculo = (id: string, modelo: string, cor: string, placa: string, categorias: string[], situacao = 'ATIVO', dias = 10) => ({
  id,
  motorista_id: '00000000-0000-4000-8000-000000000001',
  modelo,
  cor,
  placa,
  lugares: 4,
  carga_max_kg: 800,
  reboque_desc: null,
  categorias,
  situacao,
  criado_em: new Date(Date.now() - dias * 24 * 60 * MIN).toISOString(),
})

/** A Sprinter (a mais antiga) está em manutenção e o reboque só atende Carga Pesada: o sugerido é a Hilux. */
const VEICULOS = [
  veiculo(V_SPRINTER, 'Sprinter', 'prata', 'XYZ9K87', ['PASSAGEIROS'], 'MANUTENCAO', 30),
  veiculo(V_REBOQUE, 'Hilux + reboque', 'branca', 'REB4E56', ['CARGA_PESADA'], 'ATIVO', 20),
  veiculo(V_HILUX, 'Hilux', 'branca', 'ABC1D23', ['PASSAGEIROS', 'CARGA_LEVE'], 'ATIVO', 10),
  veiculo('00000000-0000-4000-8000-0000000000c4', 'Strada', 'vermelha', 'STR1A22', ['PASSAGEIROS'], 'ATIVO', 5),
]

const POLYLINE = codificarPolyline([
  [-26.8986, -48.6542],
  [-26.903, -48.659],
  [-26.9078, -48.6619],
])

/** Cálculo de mentira do contrato: km × R$ 3,00 + retorno fixo de R$ 54 (42 km = R$ 180), espera R$ 22/h... */
function calcular(e: Record<string, unknown>) {
  const linhas: Array<Record<string, unknown>> = []
  const linha = (codigo: string, descricao: string, quantidade: number | null, unitario: number | null, valor: number) =>
    linhas.push({ codigo, descricao, quantidade, unitario_cent: unitario, percentual_bp: null, base_cent: null, valor_cent: valor })
  const km = Number(e.km ?? 0)
  linha('KM', 'Km rodados (trecho único)', km, 300, Math.round(km * 300))
  linha('RETORNO', 'Retorno (50%)', null, null, 5400)
  const espera = Number(e.espera_horas ?? 0)
  if (espera > 0) linha('ESPERA', 'Espera (horas)', espera, 2200, Math.round(espera * 2200))
  const pedagio = Number(e.pedagio_cent ?? 0)
  if (pedagio > 0) linha('PEDAGIO', 'Pedágio/balsa (estimado)', 1, pedagio, pedagio)
  const hosp = Number(e.hospedagem_diarias ?? 0)
  if (hosp > 0) linha('HOSPEDAGEM', 'Hospedagem (diárias)', hosp, 18000, hosp * 18000)
  for (const o of (e.outros as Array<{ descricao: string; valor_cent: number }> | undefined) ?? []) {
    linha('OUTROS', `Outros: ${o.descricao}`, 1, o.valor_cent, o.valor_cent)
  }
  return {
    ok: true,
    modalidade: 'VEICULO_PROPRIO',
    linhas,
    total_cent: linhas.reduce((s, l) => s + Number(l.valor_cent), 0),
    valido_ate: new Date(Date.now() + 24 * 60 * MIN).toISOString(),
  }
}

const solicitado = (extra: Record<string, unknown> = {}) =>
  pedidoSolicitadoMotorista({
    categoria: 'PASSAGEIROS',
    categoria_nome: 'IVO Passageiros',
    motorista_nome: 'Ivo Barbosa',
    origem: 'Estaleiro Navegantes',
    destino: 'Porto de Itajaí',
    origem_place_id: 'ChIJdef',
    destino_place_id: 'ChIJpor',
    trechos_km: 1,
    ...extra,
  })

function emAndamento(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'EM_ANDAMENTO',
      categoria: 'PASSAGEIROS',
      categoria_nome: 'IVO Passageiros',
      motorista_nome: 'Ivo Barbosa',
      veiculo: { modelo: 'Hilux', cor: 'branca', placa: 'ABC1D23' },
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: null,
      destino_lat: -26.9078,
      destino_lng: -48.6619,
      inicio: new Date(Date.now() - 10 * MIN).toISOString(),
      saiu_em: new Date(Date.now() - 20 * MIN).toISOString(),
      fim_previsto: new Date(Date.now() + 100 * MIN).toISOString(),
      saida_liberada_em: new Date(Date.now() - 70 * MIN).toISOString(),
      pode_ver_rastreio: true,
      fotos_qtd: 0,
      ...extra,
    }),
    historico: [],
    orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 22000 }),
    acoes: { ...SEM_ACOES, informar_previsao: true, concluir: true, enviar_fotos: true },
  }
}

interface Abrir {
  detalhes?: unknown[]
  /** Respostas de `pendencias` em sequência (a última se repete). */
  pendencias?: Array<{ aguardando_orcamento?: unknown[]; proximos?: unknown[] }>
  disponivel?: boolean
  /** Já viu o aviso de localização (LGPD) antes. */
  ciente?: boolean
  caminho: string
}

async function abrir(page: Page, o: Abrir) {
  await page.addInitScript(
    ([disponivel, ciente]) => {
      const w = window as unknown as { __tocou: number; __vigias: number }
      w.__tocou = 0
      w.__vigias = 0
      HTMLMediaElement.prototype.play = function () {
        w.__tocou += 1
        return Promise.resolve()
      }
      if (navigator.geolocation) {
        const original = navigator.geolocation.watchPosition.bind(navigator.geolocation)
        navigator.geolocation.watchPosition = (...args: Parameters<Geolocation['watchPosition']>) => {
          w.__vigias += 1
          return original(...args)
        }
      }
      if (!disponivel) localStorage.setItem('ivo:disponivel', '0')
      if (ciente) localStorage.setItem('ivo:aviso-localizacao', '1')
    },
    [o.disponivel ?? true, o.ciente ?? false] as const,
  )
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  const realtime = await simularRealtime(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes ?? [solicitado()] })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/calcular_orcamento`, (route: Route) => {
    const corpo = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    chamadas.push({ rpc: 'calcular_orcamento', corpo })
    return json(route, calcular((corpo.p ?? {}) as Record<string, unknown>))
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meus_veiculos`, (route: Route) => json(route, { ok: true, veiculos: VEICULOS }))
  const pendencias = [...(o.pendencias ?? [{}])]
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/pendencias`, (route: Route) => {
    chamadas.push({ rpc: 'pendencias', corpo: {} })
    const p = pendencias.length > 1 ? pendencias.shift()! : pendencias[0]!
    return json(route, {
      ok: true,
      aguardando_orcamento: p.aguardando_orcamento ?? [],
      aguardando_aprovacao: [],
      proximos: p.proximos ?? [],
    })
  })
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: POLYLINE })
  await simularBlocosDoMapa(page)
  await page.goto(o.caminho)
  return { chamadas, realtime }
}

const tocou = (page: Page) => page.evaluate(() => (window as unknown as { __tocou: number }).__tocou)
const vigias = (page: Page) => page.evaluate(() => (window as unknown as { __vigias: number }).__vigias)
const envios = (chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }>) =>
  chamadas.filter((c) => c.rpc === 'enviar_orcamento')
const ultimoCalculo = (chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }>) =>
  chamadas.filter((c) => c.rpc === 'calcular_orcamento').at(-1)?.corpo.p as Record<string, unknown> | undefined

test.describe('chamada', () => {
  test('mostra o valor pela tabela (calcular_orcamento), o prazo e o veículo sugerido; aceitar envia sem ajuste', async ({ page }) => {
    const csp = await vigiarCsp(page)
    const { chamadas } = await abrir(page, { caminho: `/chamada/${ID_PEDIDO}` })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Nova chamada')
    await expect(folha).toContainText('IVO Passageiros')
    await expect(folha).toContainText('Umi San')
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 180,00')
    await expect(folha).toContainText('42 km · ~55 min')
    await expect(folha).toContainText('pela tabela')
    // O preço vem do banco: o km da rota (uma casa) com o veículo próprio, sem nenhuma chave da corrida.
    expect(ultimoCalculo(chamadas)).toMatchObject({ modalidade: 'VEICULO_PROPRIO', km: 42, espera_horas: 0 })
    expect(ultimoCalculo(chamadas)).not.toHaveProperty('ajuste_cent')
    await expect(page.getByTestId('prazo-chamada')).toBeVisible()
    await expect(folha).toContainText(/Responda até/)
    // Sugerido: o mais antigo ATIVO que atende a categoria (a Sprinter está em manutenção; o reboque, noutra categoria).
    const escolha = page.getByLabel('Veículo')
    await expect(escolha).toHaveValue(V_HILUX)
    await expect(escolha.locator('option')).toHaveText(['Hilux branca · ABC1D23', 'Strada vermelha · STR1A22'])
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await page.getByRole('button', { name: 'Aceitar por R$ 180' }).click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    const enviados = envios(chamadas)
    expect(enviados).toHaveLength(1)
    const p = enviados[0]!.corpo.p as Record<string, unknown>
    expect(enviados[0]!.corpo.p_atividade).toBe(ID_PEDIDO)
    expect(p).toMatchObject({ modalidade: 'VEICULO_PROPRIO', km: 42, espera_horas: 0, pedagio_cent: 0, veiculo_id: V_HILUX })
    expect(p).not.toHaveProperty('ajuste_cent')
    expect(p).not.toHaveProperty('ajuste_motivo')
    expect(csp).toEqual([])
  })

  test('trocar o veículo vale para o aceite; sem resposta do servidor a tela não muda (nada otimista)', async ({ page }) => {
    const { chamadas } = await abrir(page, { caminho: `/chamada/${ID_PEDIDO}` })
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 180,00')
    await page.getByLabel('Veículo').selectOption('00000000-0000-4000-8000-0000000000c4')
    let liberar: () => void = () => undefined
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/enviar_orcamento`, async (route: Route) => {
      chamadas.push({ rpc: 'enviar_orcamento', corpo: route.request().postDataJSON() as Record<string, unknown> })
      await new Promise<void>((r) => (liberar = r))
      return json(route, { ok: false, codigo: 'PRAZO_VENCIDO' })
    })
    await page.getByRole('button', { name: 'Aceitar por R$ 180' }).click()
    await expect(page.getByRole('button', { name: 'Aceitar por R$ 180' })).toBeDisabled()
    await expect(page.getByText('Proposta enviada')).toHaveCount(0)
    liberar()
    await expect(page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: /prazo/i })).toBeVisible()
    expect((envios(chamadas)[0]!.corpo.p as Record<string, unknown>).veiculo_id).toBe('00000000-0000-4000-8000-0000000000c4')
  })

  test('VEICULO_INVALIDO no aceite: mensagem do veículo da categoria (não a do cadastro)', async ({ page }) => {
    await abrir(page, { caminho: `/chamada/${ID_PEDIDO}` })
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 180,00')
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/enviar_orcamento`, (route: Route) =>
      json(route, { ok: false, codigo: 'VEICULO_INVALIDO' }),
    )
    await page.getByRole('button', { name: 'Aceitar por R$ 180' }).click()
    await expect(
      page
        .getByRole('alert')
        .or(page.getByRole('status'))
        .filter({ hasText: 'Nenhum veículo ativo atende esta categoria. Cadastre ou reative um veículo.' }),
    ).toBeVisible()
    await expect(page.getByText('Proposta enviada')).toHaveCount(0)
  })

  test('com a tela aberta, chega um status no tópico equipe: toca o som e mostra a chamada', async ({ page }) => {
    const { realtime } = await abrir(page, {
      caminho: '/',
      pendencias: [{}, { aguardando_orcamento: [pendenciaFalsa({ empresa_nome: 'Umi San', categoria_nome: 'IVO Passageiros' })] }],
    })
    await expect(page.getByTestId('inicio-motorista')).toBeVisible()
    await expect.poll(() => realtime.assinou('equipe')).toBe(true)
    expect(await tocou(page)).toBe(0)
    realtime.transmitir('equipe', 'status', { id: ID_PEDIDO, status: 'SOLICITADA', em: new Date().toISOString() })
    await expect(page).toHaveURL(new RegExp(`/chamada/${ID_PEDIDO}$`))
    await expect(page.getByTestId('folha-mapa')).toContainText('Nova chamada')
    expect(await tocou(page)).toBeGreaterThan(0)
  })

  test('"Disponível para chamadas" desligado: a chamada não toca, fica na lista e nenhum watchPosition começa', async ({ page }) => {
    const { realtime } = await abrir(page, {
      caminho: '/',
      disponivel: false,
      pendencias: [{}, { aguardando_orcamento: [pendenciaFalsa({ empresa_nome: 'Umi San', categoria_nome: 'IVO Passageiros' })] }],
    })
    await expect(page.getByTestId('inicio-motorista')).toBeVisible()
    await expect(page.getByTestId('inicio-motorista')).toContainText('Indisponível no momento')
    await expect.poll(() => realtime.assinou('equipe')).toBe(true)
    realtime.transmitir('equipe', 'status', { id: ID_PEDIDO, status: 'SOLICITADA', em: new Date().toISOString() })
    await expect(page.getByRole('link', { name: /Responder a chamada/ })).toBeVisible()
    await page.waitForTimeout(500)
    expect(await tocou(page)).toBe(0)
    await expect(page).toHaveURL(/\/$/)
    expect(await vigias(page)).toBe(0)
  })
})

test.describe('propor outro valor (calculadora)', () => {
  test('itens do contrato, recálculo a cada mudança, reboque fixo e envio com as quantidades, sem ajuste', async ({ page }) => {
    const { chamadas } = await abrir(page, { caminho: `/chamada/${ID_PEDIDO}` })
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 180,00')
    await page.getByRole('link', { name: 'Propor outro valor' }).click()
    await expect(page.getByRole('heading', { name: 'Propor outro valor' })).toBeVisible()

    const km = page.getByRole('group', { name: 'Km rodados' })
    await expect(km).toContainText('rota: 42 km')
    await expect(km.locator('output')).toHaveText('42')
    await expect(page.getByRole('group', { name: 'Espera (horas)' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Hospedagem (diárias)' })).toBeVisible()
    await expect(page.getByLabel('Pedágio / balsa')).toBeVisible()
    await expect(page.getByText('Reboque: não cobrado pela tabela da categoria')).toBeVisible()
    await expect(page.getByRole('main').getByRole('switch')).toHaveCount(0)
    // Nenhum teclado de valor livre: o único campo de valor é o pedágio (e os "Outros", quando houver).
    await expect(page.getByRole('main').locator('input')).toHaveCount(1)
    await expect(page.getByTestId('pela-tabela')).toHaveText('Pela tabela R$ 180,00')
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 180,00')

    const antes = chamadas.filter((c) => c.rpc === 'calcular_orcamento').length
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Aumentar km rodados' }).click()
    await expect(km.locator('output')).toHaveText('48')
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 198,00')
    await page.getByRole('button', { name: 'Aumentar espera (horas)' }).click()
    await page.getByRole('button', { name: 'Aumentar espera (horas)' }).click()
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 220,00')
    await expect(page.getByTestId('diferenca')).toHaveText('+ R$ 40,00')
    await expect(page.getByTestId('pela-tabela')).toHaveText('Pela tabela R$ 180,00')
    expect(chamadas.filter((c) => c.rpc === 'calcular_orcamento').length).toBeGreaterThanOrEqual(antes + 2)
    expect(ultimoCalculo(chamadas)).toMatchObject({ km: 48, espera_horas: 1 })
    expect(envios(chamadas)).toHaveLength(0)

    // "Outros": até 5 itens.
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Adicionar item' }).click()
    await expect(page.getByRole('button', { name: 'Adicionar item' })).toHaveCount(0)
    await expect(page.getByText('5 de 5')).toBeVisible()
    for (let i = 5; i >= 1; i--) await page.getByRole('button', { name: `Remover item ${i}` }).click()

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Enviar proposta · R$ 220' }).click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    const enviados = envios(chamadas)
    expect(enviados).toHaveLength(1)
    const p = enviados[0]!.corpo.p as Record<string, unknown>
    expect(p).toEqual({
      modalidade: 'VEICULO_PROPRIO',
      km: 48,
      usa_reboque: false,
      espera_horas: 1,
      pedagio_cent: 0,
      hospedagem_diarias: 0,
      veiculo_id: V_HILUX,
    })
  })

  test('durante o recálculo o envio fica travado: o que vai ao banco é a entrada do total mostrado', async ({ page }) => {
    const { chamadas } = await abrir(page, { caminho: `/chamada/${ID_PEDIDO}/propor?veiculo=${V_HILUX}` })
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 180,00')
    // O banco demora: a janela do debounce + resposta fica larga.
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/calcular_orcamento`, async (route: Route) => {
      const corpo = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
      chamadas.push({ rpc: 'calcular_orcamento', corpo })
      await new Promise((r) => setTimeout(r, 800))
      return json(route, calcular((corpo.p ?? {}) as Record<string, unknown>))
    })
    const enviar = page.getByRole('button', { name: /^Enviar proposta/ })
    await expect(enviar).toBeEnabled()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Aumentar km rodados' }).click()
    // Logo depois dos toques: nada do total antigo, botão travado, e tocar nele não envia nada.
    await enviar.click({ force: true })
    await page.waitForTimeout(200)
    expect(envios(chamadas)).toHaveLength(0)
    await expect(enviar).toBeDisabled()
    await expect(enviar).toHaveText('Enviar proposta')
    await expect(page.getByTestId('total-proposta')).toHaveCount(0)
    // Chega o total dos 45 km: só então o envio, com os mesmos 45 km.
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 189,00')
    await expect(enviar).toHaveText('Enviar proposta · R$ 189')
    await enviar.click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    expect(envios(chamadas)).toHaveLength(1)
    expect(envios(chamadas)[0]!.corpo.p).toMatchObject({ km: 45, veiculo_id: V_HILUX })
    expect(calcular(envios(chamadas)[0]!.corpo.p as Record<string, unknown>).total_cent).toBe(18900)
  })

  test('diminuir abaixo da tabela mostra a diferença negativa; pedágio e outros entram no cálculo', async ({ page }) => {
    const { chamadas } = await abrir(page, { caminho: `/chamada/${ID_PEDIDO}/propor?veiculo=${V_HILUX}` })
    await expect(page.getByTestId('pela-tabela')).toHaveText('Pela tabela R$ 180,00')
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Diminuir km rodados' }).click()
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 174,00')
    await expect(page.getByTestId('diferenca')).toHaveText('− R$ 6,00')
    await page.getByLabel('Pedágio / balsa').fill('12,40')
    await page.getByRole('button', { name: 'Adicionar item' }).click()
    await page.getByLabel('Descrição 1').fill('Balsa extra')
    await page.getByLabel('Valor 1').fill('20')
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 206,40')
    expect(ultimoCalculo(chamadas)).toMatchObject({ km: 40, pedagio_cent: 1240, outros: [{ descricao: 'Balsa extra', valor_cent: 2000 }] })
    await page.getByRole('button', { name: /Ver o cálculo/ }).click()
    await expect(page.getByTestId('memorial')).toContainText('Balsa extra')
  })
})

test.describe('início e viagem', () => {
  test.use({ geolocation: { latitude: -26.9, longitude: -48.655, accuracy: 8 }, permissions: ['geolocation'] })

  test('próxima corrida no início com "Deslize para sair": só depois do servidor abre a viagem', async ({ page }) => {
    const proximo = pendenciaFalsa({
      status: 'AGENDADA',
      inicio: new Date(Date.now() + 30 * MIN).toISOString(),
      empresa_nome: 'Umi San',
      categoria_nome: 'IVO Passageiros',
    })
    const { chamadas } = await abrir(page, {
      caminho: '/',
      ciente: true,
      pendencias: [{ proximos: [proximo] }],
      detalhes: [emAndamento()],
    })
    const inicio = page.getByTestId('inicio-motorista')
    await expect(inicio).toContainText('Próxima corrida')
    await expect(inicio).toContainText('Porto de Itajaí')
    expect(await vigias(page)).toBe(0)
    const trilho = page.getByRole('slider', { name: 'Deslize para sair' })
    await trilho.focus()
    await page.keyboard.press('End')
    await expect(page).toHaveURL(new RegExp(`/viagem/${ID_PEDIDO}$`))
    expect(chamadas.filter((c) => c.rpc === 'registrar_saida')).toHaveLength(1)
  })

  test('viagem: rota desenhada, chegada grande, Waze com o aviso, sem "Nova previsão", e Concluir abre a folha', async ({ page }) => {
    const csp = await vigiarCsp(page)
    const { chamadas } = await abrir(page, { caminho: `/viagem/${ID_PEDIDO}`, detalhes: [emAndamento()] })
    const folha = page.getByTestId('folha-mapa')
    // Antes da primeira viagem, o aviso de localização (LGPD); nada de GPS antes de aceitar.
    await expect(folha.getByTestId('aviso-localizacao')).toBeVisible()
    expect(await vigias(page)).toBe(0)
    await folha.getByRole('button', { name: 'Começar a compartilhar' }).click()
    await expect(folha.getByTestId('selo-localizacao')).toHaveText('Compartilhando sua localização')
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'enviar_posicao').length).toBeGreaterThan(0)
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)
    await expect(page.getByTestId('mapa-base')).toHaveAttribute('data-carro', '-26.900000,-48.655000')
    const chegada = page.getByTestId('chegada-prevista')
    await expect(chegada).toHaveText(/^~\d{2}:\d{2}$/)
    await expect(chegada).toHaveClass(/ivo-valor/)
    await expect(folha).toContainText('Chegada ao destino')
    await expect(folha).toContainText('42 km')

    await expect(page.getByRole('button', { name: /Nova previsão/ })).toHaveCount(0)
    await expect(page.getByText(/Nova previsão/)).toHaveCount(0)
    const waze = folha.getByRole('link', { name: 'Abrir no Waze' })
    await expect(waze).toHaveAttribute('href', /waze\.com/)
    await expect(folha).toContainText('No Waze, o cliente vê "sinal perdido". Volte ao IVO quando puder.')
    await expect(folha.getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:47999991234')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await folha.getByRole('button', { name: 'Concluir serviço' }).click()
    await expect(page.getByRole('dialog', { name: 'Concluir serviço' })).toBeVisible()
    expect(csp).toEqual([])
  })
})

for (const esquema of ['light', 'dark'] as const) {
  test.describe(`tema ${esquema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: esquema })

    test('início, chamada e calculadora sem violações do axe', async ({ page }) => {
      await abrir(page, {
        caminho: '/',
        pendencias: [{ aguardando_orcamento: [pendenciaFalsa({ empresa_nome: 'Umi San' })] }],
      })
      await expect(page.getByRole('link', { name: /Responder a chamada/ })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.getByRole('link', { name: /Responder a chamada/ }).click()
      await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 180,00')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.getByRole('link', { name: 'Propor outro valor' }).click()
      await expect(page.getByTestId('total-proposta')).toHaveText('R$ 180,00')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  })
}
