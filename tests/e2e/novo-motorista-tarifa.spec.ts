// Fase 4.1 (Tarefa 7): o motorista com a tabela da categoria e as paradas. A calculadora só mostra os itens que a
// tarifa cobra (zerado = não cobra), a IVO Motorista (veículo do cliente) nunca pede veículo, as horas vão na
// contraproposta e a viagem passa pelas paradas, com o Waze na próxima parada ainda não passada (150 m).
// Roda no projeto Playwright `novo` (dist-novo). O preço é sempre do banco (aqui, uma tarifa simulada).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas, type ChamadaMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, orcamentoCliente, pedidoSolicitadoMotorista, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { codificarPolyline } from './apoio/polyline.ts'
import { simularRealtime } from './apoio/realtimeFalso.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const MIN = 60_000
const V_HILUX = '00000000-0000-4000-8000-0000000000c1'

interface Tarifa {
  taxa_fixa_cent: number
  km_cent: number
  hora_cent: number
  hora_espera_cent: number
  parada_cent: number
  retorno_bp: number
  reboque_cent: number
  hospedagem_diaria_cent: number
}

const ZERADA: Tarifa = {
  taxa_fixa_cent: 0,
  km_cent: 0,
  hora_cent: 0,
  hora_espera_cent: 0,
  parada_cent: 0,
  retorno_bp: 0,
  reboque_cent: 0,
  hospedagem_diaria_cent: 0,
}

/** IVO Motorista: só hora (R$ 90) e hospedagem (R$ 180); sem km, espera, parada nem reboque. */
const TARIFA_MOTORISTA: Tarifa = { ...ZERADA, hora_cent: 9000, hospedagem_diaria_cent: 18000 }
/** IVO Passageiros: km (R$ 3), parada (R$ 25) e taxa fixa (R$ 10); o resto zerado. */
const TARIFA_PASSAGEIROS: Tarifa = { ...ZERADA, taxa_fixa_cent: 1000, km_cent: 300, parada_cent: 2500 }

/**
 * O cálculo do banco (`interno.linhas_da_tarifa` por `interno.linhas_do_pedido`): só as linhas com valor e quantidade
 * maiores que zero; sem `horas`/`paradas` na entrada, valem as do pedido; `diarias` é recusado aqui (a calculadora nova
 * não pode depender de o banco ignorá-lo).
 */
function calcularPelaTarifa(t: Tarifa, pedido: { horas_estimadas?: number | null; paradas?: unknown[] }, e: Record<string, unknown>) {
  if ('diarias' in e) return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
  const linhas: Array<Record<string, unknown>> = []
  const linha = (codigo: string, descricao: string, quantidade: number | null, unitario: number | null, valor: number) =>
    linhas.push({ codigo, descricao, quantidade, unitario_cent: unitario, percentual_bp: null, base_cent: null, valor_cent: valor })
  const km = Number(e.km ?? 0)
  const horas = e.horas === undefined || e.horas === null ? Number(pedido.horas_estimadas ?? 0) : Number(e.horas)
  const espera = Number(e.espera_horas ?? 0)
  const paradas = e.paradas === undefined || e.paradas === null ? (pedido.paradas ?? []).length : Number(e.paradas)
  const pedagio = Number(e.pedagio_cent ?? 0)
  const hosp = Number(e.hospedagem_diarias ?? 0)
  if (t.taxa_fixa_cent > 0) linha('TAXA_FIXA', 'Taxa fixa', 1, t.taxa_fixa_cent, t.taxa_fixa_cent)
  if (km > 0 && t.km_cent > 0) linha('KM', 'Km rodados (trecho único)', km, t.km_cent, Math.round(km * t.km_cent))
  if (horas > 0 && t.hora_cent > 0) linha('HORAS', 'Horas', horas, t.hora_cent, Math.round(horas * t.hora_cent))
  if (espera > 0 && t.hora_espera_cent > 0) linha('ESPERA', 'Espera (horas)', espera, t.hora_espera_cent, Math.round(espera * t.hora_espera_cent))
  if (paradas > 0 && t.parada_cent > 0) linha('PARADAS', 'Paradas', paradas, t.parada_cent, paradas * t.parada_cent)
  if (pedagio > 0) linha('PEDAGIO', 'Pedágio/balsa (estimado)', 1, pedagio, pedagio)
  if (hosp > 0 && t.hospedagem_diaria_cent > 0) linha('HOSPEDAGEM', 'Hospedagem (diárias)', hosp, t.hospedagem_diaria_cent, hosp * t.hospedagem_diaria_cent)
  for (const o of (e.outros as Array<{ descricao: string; valor_cent: number }> | undefined) ?? []) {
    linha('OUTROS', `Outros: ${o.descricao}`, 1, o.valor_cent, o.valor_cent)
  }
  const total = linhas.reduce((s, l) => s + Number(l.valor_cent), 0)
  if (total <= 0) return { ok: false, codigo: 'VALOR_INVALIDO' }
  return { ok: true, modalidade: 'VEICULO_PROPRIO', linhas, total_cent: total, valido_ate: new Date(Date.now() + 24 * 60 * MIN).toISOString() }
}

const PARADA_1 = { texto: 'Estaleiro Detroit', place_id: null, lat: -26.95, lng: -48.7 }
const PARADA_2 = { texto: 'Armazém Itajaí', place_id: null, lat: -27, lng: -48.75 }

const pedidoMotorista = (extra: Record<string, unknown> = {}) =>
  pedidoSolicitadoMotorista({
    categoria: 'MOTORISTA',
    categoria_nome: 'IVO Motorista',
    modalidade: 'VEICULO_CLIENTE',
    reboque: 'NAO',
    motorista_nome: 'Ivo Barbosa',
    origem: 'Estaleiro Navegantes',
    destino: 'Porto de Itajaí',
    origem_place_id: 'ChIJdef',
    destino_place_id: 'ChIJpor',
    trechos_km: 1,
    horas_estimadas: 4,
    paradas: [],
    ...extra,
  })

const pedidoPassageiros = (extra: Record<string, unknown> = {}) =>
  pedidoSolicitadoMotorista({
    categoria: 'PASSAGEIROS',
    categoria_nome: 'IVO Passageiros',
    motorista_nome: 'Ivo Barbosa',
    origem: 'Estaleiro Navegantes',
    destino: 'Porto de Itajaí',
    origem_place_id: 'ChIJdef',
    destino_place_id: 'ChIJpor',
    trechos_km: 1,
    horas_estimadas: null,
    paradas: [PARADA_1, PARADA_2],
    ...extra,
  })

const POLYLINE = codificarPolyline([
  [-26.8986, -48.6542],
  [-26.95, -48.7],
  [-27, -48.75],
  [-26.9078, -48.6619],
])

type Chamadas = Array<{ rpc: string; corpo: Record<string, unknown> }>

async function abrir(
  page: Page,
  o: { caminho: string; detalhe: { pedido: Record<string, unknown> } & Record<string, unknown>; tarifa: Tarifa; veiculos?: unknown[]; ciente?: boolean },
) {
  await page.addInitScript((ciente) => {
    if (ciente) localStorage.setItem('ivo:aviso-localizacao', '1')
  }, o.ciente ?? false)
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  await simularRealtime(page)
  const chamadas: Chamadas = await simularPedidos(page, { detalhes: [o.detalhe] })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/calcular_orcamento`, (route: Route) => {
    const corpo = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    chamadas.push({ rpc: 'calcular_orcamento', corpo })
    return json(route, calcularPelaTarifa(o.tarifa, o.detalhe.pedido, (corpo.p ?? {}) as Record<string, unknown>))
  })
  const veiculos = o.veiculos ?? []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meus_veiculos`, (route: Route) => json(route, { ok: true, veiculos }))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/pendencias`, (route: Route) =>
    json(route, { ok: true, aguardando_orcamento: [], aguardando_aprovacao: [], proximos: [] }),
  )
  const mapas = await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: POLYLINE })
  await simularBlocosDoMapa(page)
  await page.goto(o.caminho)
  return { chamadas, mapas }
}

const envios = (chamadas: Chamadas) => chamadas.filter((c) => c.rpc === 'enviar_orcamento')
const rotas = (mapas: ChamadaMapas[]) => mapas.filter((c) => c.acao === 'rota')

test.describe('IVO Motorista (veículo do cliente, cobrada por hora)', () => {
  test('a chamada não pede veículo; aceitar envia veiculo_id nulo e nenhuma diária', async ({ page }) => {
    const csp = await vigiarCsp(page)
    const { chamadas } = await abrir(page, {
      caminho: `/chamada/${ID_PEDIDO}`,
      detalhe: pedidoMotorista(),
      tarifa: TARIFA_MOTORISTA,
    })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('IVO Motorista')
    // 4 h × R$ 90: as horas do pedido (o banco usa as horas estimadas quando a entrada não traz).
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 360,00')
    await expect(page.getByLabel('Veículo')).toHaveCount(0)
    await expect(folha.getByText(/Nenhum veículo ativo/)).toHaveCount(0)
    await expect(folha.getByText('Orce este pedido no app atual')).toHaveCount(0)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await page.getByRole('button', { name: 'Aceitar por R$ 360' }).click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    const enviados = envios(chamadas)
    expect(enviados).toHaveLength(1)
    const p = enviados[0]!.corpo.p as Record<string, unknown>
    expect(p).toHaveProperty('veiculo_id', null)
    expect(p).not.toHaveProperty('diarias')
    expect(p).not.toHaveProperty('ajuste_cent')
    expect(csp).toEqual([])
  })

  test('calculadora: só Horas, Hospedagem, Pedágio e Outros (sem Km); a contraproposta envia as horas', async ({ page }) => {
    const { chamadas } = await abrir(page, {
      caminho: `/chamada/${ID_PEDIDO}`,
      detalhe: pedidoMotorista(),
      tarifa: TARIFA_MOTORISTA,
    })
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 360,00')
    await page.getByRole('link', { name: 'Propor outro valor' }).click()
    await expect(page.getByRole('heading', { name: 'Propor outro valor' })).toBeVisible()

    const itens = page.getByTestId('itens-proposta')
    const horas = itens.getByRole('group', { name: 'Horas', exact: true })
    await expect(horas.locator('output')).toHaveText('4')
    await expect(itens.getByRole('group', { name: 'Hospedagem (diárias)' })).toBeVisible()
    await expect(page.getByLabel('Pedágio / balsa')).toBeVisible()
    await expect(page.getByTestId('outros')).toBeVisible()
    await expect(itens.getByRole('group', { name: 'Km rodados' })).toHaveCount(0)
    await expect(itens.getByRole('group', { name: 'Espera (horas)' })).toHaveCount(0)
    await expect(itens.getByText(/Paradas/)).toHaveCount(0)
    await expect(itens.getByText(/Reboque/)).toHaveCount(0)
    await expect(page.getByTestId('pela-tabela')).toHaveText('Pela tabela R$ 360,00')
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 360,00')

    await page.getByRole('button', { name: 'Aumentar horas', exact: true }).click()
    await expect(horas.locator('output')).toHaveText('4,5')
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 405,00')
    await expect(page.getByTestId('diferenca')).toHaveText('+ R$ 45,00')
    await page.getByRole('button', { name: 'Aumentar hospedagem (diárias)' }).click()
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 585,00')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await page.getByRole('button', { name: 'Enviar proposta · R$ 585' }).click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    const enviados = envios(chamadas)
    expect(enviados).toHaveLength(1)
    const p = enviados[0]!.corpo.p as Record<string, unknown>
    expect(p).toMatchObject({ horas: 4.5, hospedagem_diarias: 1, pedagio_cent: 0, veiculo_id: null })
    expect(p).not.toHaveProperty('diarias')
    // O que foi enviado dá o mesmo total que o motorista viu.
    expect(calcularPelaTarifa(TARIFA_MOTORISTA, pedidoMotorista().pedido, p).total_cent).toBe(58500)
  })
})

test.describe('paradas', () => {
  test('chamada com paradas: De → Parada → Parada → Para, rota pelas paradas e a calculadora com a linha de paradas', async ({ page }) => {
    const { chamadas, mapas } = await abrir(page, {
      caminho: `/chamada/${ID_PEDIDO}`,
      detalhe: pedidoPassageiros(),
      tarifa: TARIFA_PASSAGEIROS,
      veiculos: [
        {
          id: V_HILUX,
          motorista_id: '00000000-0000-4000-8000-000000000001',
          modelo: 'Hilux',
          cor: 'branca',
          placa: 'ABC1D23',
          lugares: 4,
          carga_max_kg: 800,
          reboque_desc: null,
          categorias: ['PASSAGEIROS'],
          situacao: 'ATIVO',
          criado_em: new Date(Date.now() - 10 * 24 * 60 * MIN).toISOString(),
        },
      ],
    })
    const folha = page.getByTestId('folha-mapa')
    const percurso = folha.getByTestId('rota-de-para')
    await expect(percurso.locator('dt')).toHaveText(['De', 'Parada', 'Parada', 'Para'])
    await expect(percurso.locator('dd')).toHaveText(['Estaleiro Navegantes', 'Estaleiro Detroit', 'Armazém Itajaí', 'Porto de Itajaí'])
    // Taxa fixa R$ 10 + 42 km × R$ 3 + 2 paradas × R$ 25 = R$ 186.
    await expect(page.getByTestId('valor-tabela')).toHaveText('R$ 186,00')
    await expect.poll(() => rotas(mapas).length).toBeGreaterThan(0)
    expect(rotas(mapas)[0]).toMatchObject({
      origem: { place_id: 'ChIJdef' },
      destino: { place_id: 'ChIJpor' },
      paradas: [
        { lat: -26.95, lng: -48.7 },
        { lat: -27, lng: -48.75 },
      ],
    })
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)

    await page.getByRole('link', { name: 'Propor outro valor' }).click()
    const itens = page.getByTestId('itens-proposta')
    await expect(itens.getByRole('group', { name: 'Km rodados' })).toBeVisible()
    await expect(itens).toContainText('Paradas: 2')
    await expect(itens.getByRole('group', { name: 'Horas', exact: true })).toHaveCount(0)
    await expect(itens.getByRole('group', { name: 'Espera (horas)' })).toHaveCount(0)
    await expect(itens.getByRole('group', { name: 'Hospedagem (diárias)' })).toHaveCount(0)
    await expect(page.getByTestId('total-proposta')).toHaveText('R$ 186,00')
    await page.getByRole('button', { name: 'Enviar proposta · R$ 186' }).click()
    await expect(page.getByText('Proposta enviada')).toBeVisible()
    const p = envios(chamadas)[0]!.corpo.p as Record<string, unknown>
    expect(p).toMatchObject({ km: 42, veiculo_id: V_HILUX })
    expect(p).not.toHaveProperty('horas')
    expect(p).not.toHaveProperty('diarias')
  })
})

test.describe('viagem com paradas', () => {
  test.use({ geolocation: { latitude: -26.9, longitude: -48.655, accuracy: 8 }, permissions: ['geolocation'] })

  const emAndamento = () => ({
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
      paradas: [PARADA_1, PARADA_2],
    }),
    historico: [],
    orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 22000 }),
    acoes: { ...SEM_ACOES, informar_previsao: true, concluir: true, enviar_fotos: true },
  })

  test('desenha origem → paradas → destino e o Waze vai para a próxima parada não passada (150 m conta)', async ({ page, context }) => {
    const { mapas } = await abrir(page, {
      caminho: `/viagem/${ID_PEDIDO}`,
      detalhe: emAndamento(),
      tarifa: TARIFA_PASSAGEIROS,
      ciente: true,
    })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha.getByTestId('selo-localizacao')).toHaveText('Compartilhando sua localização')
    const percurso = folha.getByTestId('rota-de-para')
    await expect(percurso.locator('dt')).toHaveText(['De', 'Parada', 'Parada', 'Para'])
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)
    // A rota desenhada passa pelas duas paradas, na ordem.
    await expect
      .poll(() => rotas(mapas).some((r) => JSON.stringify(r.paradas) === JSON.stringify([{ lat: -26.95, lng: -48.7 }, { lat: -27, lng: -48.75 }])))
      .toBe(true)

    const waze = folha.getByRole('link', { name: 'Abrir no Waze' })
    await expect(waze).toHaveAttribute('href', 'https://waze.com/ul?ll=-26.95,-48.7&navigate=yes')
    await expect(folha).toContainText('Próxima parada')
    await expect(folha).toContainText('Estaleiro Detroit')

    // A 200 m da 1ª parada: ainda não passou.
    await context.setGeolocation({ latitude: -26.9518, longitude: -48.7, accuracy: 8 })
    await page.waitForTimeout(800)
    await expect(waze).toHaveAttribute('href', 'https://waze.com/ul?ll=-26.95,-48.7&navigate=yes')
    // A 140 m: conta como passada; o Waze vai para a 2ª parada e a rota segue só por ela.
    await context.setGeolocation({ latitude: -26.95126, longitude: -48.7, accuracy: 8 })
    await expect(waze).toHaveAttribute('href', 'https://waze.com/ul?ll=-27,-48.75&navigate=yes')
    await expect(folha).toContainText('Armazém Itajaí')
    await expect
      .poll(() => rotas(mapas).some((r) => JSON.stringify(r.paradas) === JSON.stringify([{ lat: -27, lng: -48.75 }])))
      .toBe(true)

    // Passou da 2ª: o Waze vai para o destino.
    await context.setGeolocation({ latitude: -27.0005, longitude: -48.75, accuracy: 8 })
    await expect(waze).toHaveAttribute('href', 'https://waze.com/ul?ll=-26.9078,-48.6619&navigate=yes')
    await expect(folha).toContainText('Chegada ao destino')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
})
