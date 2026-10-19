// Fase 4 (Tarefa 9): o cliente acompanha a corrida no mapa de tela cheia (mockup 10) e vê o fim, com avaliação e
// "Pedir de novo" (mockup 11). Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, instanteSp, orcamentoCliente, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { codificarPolyline } from './apoio/polyline.ts'
import { simularRealtime } from './apoio/realtimeFalso.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const MIN = 60_000
const VEICULO = { modelo: 'Hilux', cor: 'branca', placa: 'ABC1D23' }
const TOPICO = `rastreio:${ID_PEDIDO}`

const hhmm = (iso: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

function emAndamento(extra: Record<string, unknown> = {}, posicao: { lat: number; lng: number; em: string } | null = null) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'EM_ANDAMENTO',
      categoria: 'PASSAGEIROS',
      categoria_nome: 'IVO Passageiros',
      motorista_nome: 'Ivo Barbosa',
      veiculo: VEICULO,
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      saiu_em: new Date(Date.now() - 30 * MIN).toISOString(),
      pode_ver_rastreio: true,
      ultima_posicao: posicao,
      ...extra,
    }),
    historico: [],
    orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 22000 }),
    acoes: { ...SEM_ACOES },
  }
}

/** A corrida terminou há 33 min, depois de 57 min de viagem (fixo para a página inteira do teste). */
const SAIU = new Date(Date.now() - 90 * MIN)
const CONCLUIU = new Date(SAIU.getTime() + 57 * MIN)

function concluida(extra: Record<string, unknown> = {}, acoes: Record<string, boolean> = { avaliar: true }) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'CONCLUIDA',
      categoria: 'CARGA_LEVE',
      categoria_nome: 'IVO Carga Leve',
      motorista_nome: 'Ivo Barbosa',
      veiculo: VEICULO,
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      levar: true,
      trazer: false,
      saiu_em: SAIU.toISOString(),
      concluiu_em: CONCLUIU.toISOString(),
      km_rodados: 41.4,
      centro_custo: 'Operações 4.100',
      avaliacao: null,
      fotos_qtd: 2,
      ...extra,
    }),
    historico: [],
    orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 22000 }),
    acoes: { ...SEM_ACOES, ...acoes },
  }
}

interface Abrir {
  detalhes: unknown[]
  perfil?: PerfilFalso
  /** A rota do Google chega só depois deste atraso (ms). */
  atrasoRota?: number
  /** Resposta de `avaliar`. */
  avaliar?: Record<string, unknown>
}

async function abrir(page: Page, o: Abrir) {
  await comSessaoFalsa(page, o.perfil ?? N2)
  await simularApi(page)
  const realtime = await simularRealtime(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes })
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: POLYLINE, atrasoRota: o.atrasoRota })
  await simularBlocosDoMapa(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/avaliar`, (route: Route) => {
    chamadas.push({ rpc: 'avaliar', corpo: (route.request().postDataJSON() ?? {}) as Record<string, unknown> })
    return json(route, o.avaliar ?? { ok: true })
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/fotos_do_pedido`, (route: Route) =>
    json(route, {
      ok: true,
      fotos: [
        { id: 'f1', caminho: 'a/1.jpg', enviada_em: new Date().toISOString() },
        { id: 'f2', caminho: 'a/2.jpg', enviada_em: new Date().toISOString() },
      ],
    }),
  )
  await page.route(`${URL_SUPABASE}/storage/v1/object/sign/fotos/**`, (route: Route) =>
    json(route, { signedURL: '/object/sign/fotos/a/1.jpg?token=t' }),
  )
  await page.goto(`/corrida/${ID_PEDIDO}`)
  return { chamadas, realtime }
}

const POLYLINE = codificarPolyline([
  [-26.8986, -48.6542],
  [-26.903, -48.659],
  [-26.9078, -48.6619],
])

const carro = (page: Page) => page.getByTestId('mapa-base')

test.describe('acompanhar', () => {
  test('motorista parado há 10 min: a última posição aparece na hora, com o carro cinza e o sinal perdido', async ({ page }) => {
    const parada = { lat: -26.9, lng: -48.655, em: new Date(Date.now() - 10 * MIN).toISOString() }
    await abrir(page, { detalhes: [emAndamento({}, parada)] })
    await expect(carro(page)).toHaveAttribute('data-carro', '-26.900000,-48.655000')
    await expect(page.locator('.marcador-carro.perdido')).toHaveCount(1)
    const sinal = page.getByTestId('sinal-motorista')
    await expect(sinal).toContainText('Sinal do motorista perdido')
    // Sem sinal e sem chegada do motorista, a estimativa (saída + rota) some: nada inventado.
    await expect(page.getByTestId('chegada-cliente')).toHaveText('—')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  test('a transmissão nova move o carro, tira o cinza e mostra "atualizado agora" com a chegada do motorista', async ({ page }) => {
    const parada = { lat: -26.9, lng: -48.655, em: new Date(Date.now() - 10 * MIN).toISOString() }
    const { realtime } = await abrir(page, { detalhes: [emAndamento({}, parada)] })
    await expect(page.locator('.marcador-carro.perdido')).toHaveCount(1)
    await expect.poll(() => realtime.assinou(TOPICO)).toBe(true)
    const eta = new Date(Date.now() + 18 * MIN)
    realtime.transmitir(TOPICO, 'posicao', { lat: -26.905, lng: -48.658, seq: 7, eta: eta.toISOString(), ts: new Date().toISOString() })
    await expect(carro(page)).toHaveAttribute('data-carro', '-26.905000,-48.658000')
    await expect(page.locator('.marcador-carro.perdido')).toHaveCount(0)
    await expect(page.getByTestId('sinal-motorista')).toContainText('Atualizado agora')
    await expect(page.getByTestId('chegada-cliente')).toHaveText(`~${hhmm(eta)}`)
    // Posição velha (seq menor) não volta o carro.
    realtime.transmitir(TOPICO, 'posicao', { lat: -26.9, lng: -48.655, seq: 3, ts: new Date().toISOString() })
    await page.waitForTimeout(300)
    await expect(carro(page)).toHaveAttribute('data-carro', '-26.905000,-48.658000')
  })

  test('mostra o veículo e a placa, copia o texto de "Compartilhar" e não tem o link de rastreio', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { realtime } = await abrir(page, {
      detalhes: [emAndamento({}, { lat: -26.9, lng: -48.655, em: new Date().toISOString() })],
    })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Ivo Barbosa')
    await expect(folha).toContainText('Hilux branca')
    await expect(folha).toContainText('ABC1D23')
    await expect.poll(() => realtime.assinou(TOPICO)).toBe(true)
    const eta = new Date(Date.now() + 25 * MIN)
    realtime.transmitir(TOPICO, 'posicao', { lat: -26.9, lng: -48.656, seq: 2, eta: eta.toISOString(), ts: new Date().toISOString() })
    await expect(page.getByTestId('chegada-cliente')).toHaveText(`~${hhmm(eta)}`)
    await page.getByRole('button', { name: 'Compartilhar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Texto copiado' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`IVO a caminho, chegada ~${hhmm(eta)}`)
  })
})

test.describe('ligar para o motorista (Tarefa 10)', () => {
  test('com o telefone do motorista no pedido, "Ligar" abre a discagem; sem ele, o botão não aparece', async ({ page }) => {
    const agora = { lat: -26.9, lng: -48.655, em: new Date().toISOString() }
    await abrir(page, { detalhes: [emAndamento({ motorista_telefone: '(47) 98888-7777' }, agora)] })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha.getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:47988887777')
    await expect(folha.getByRole('button', { name: 'Compartilhar' })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  test('sem telefone (perfil vazio ou antes de AGENDADA): sem "Ligar"', async ({ page }) => {
    const agora = { lat: -26.9, lng: -48.655, em: new Date().toISOString() }
    await abrir(page, { detalhes: [emAndamento({ motorista_telefone: null }, agora)] })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha.getByRole('button', { name: 'Compartilhar' })).toBeVisible()
    await expect(folha.getByRole('link', { name: 'Ligar' })).toHaveCount(0)
  })
})

test.describe('chegada estimada e enquadramento', () => {
  test('sem chegada do motorista, a estimativa aparece rotulada, não vai no Compartilhar e some se já passou', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await abrir(page, { detalhes: [emAndamento({}, { lat: -26.9, lng: -48.655, em: new Date().toISOString() })] })
    const chegada = page.getByTestId('chegada-cliente')
    await expect(chegada).toHaveText(/^Estimativa ~[0-9]{2}:[0-9]{2}$/)
    await expect(page.getByTestId('folha-mapa')).toContainText('Chegada estimada')
    await page.getByRole('button', { name: 'Compartilhar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Texto copiado' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('IVO a caminho')
  })

  test('estimativa já no passado (motorista atrasado): mostra "—", não um horário que passou', async ({ page }) => {
    const saiu = new Date(Date.now() - 120 * MIN).toISOString()
    await abrir(page, { detalhes: [emAndamento({ saiu_em: saiu }, { lat: -26.9, lng: -48.655, em: new Date().toISOString() })] })
    await expect(page.getByTestId('sinal-motorista')).toContainText('Atualizado agora')
    await expect(page.getByTestId('chegada-cliente')).toHaveText('—')
  })

  test('o carro fora do trajeto continua no mapa depois que a rota chega (o enquadramento inclui o carro)', async ({ page }) => {
    // Posição gravada a ~25 km ao norte do trajeto; a rota só chega 2 s depois do carro.
    await abrir(page, {
      detalhes: [emAndamento({}, { lat: -26.68, lng: -48.62, em: new Date().toISOString() })],
      atrasoRota: 2000,
    })
    await expect(page.locator('.marcador-carro')).toHaveCount(1)
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)
    const dentro = async () => {
      const mapa = await page.getByTestId('mapa-base').boundingBox()
      const marca = await page.locator('.marcador-carro').boundingBox()
      if (!mapa || !marca) return false
      return (
        marca.x >= mapa.x && marca.y >= mapa.y && marca.x + marca.width <= mapa.x + mapa.width && marca.y + marca.height <= mapa.y + mapa.height
      )
    }
    await expect.poll(dentro).toBe(true)
  })
})

test.describe('fim', () => {
  test('mostra o valor, o centro de custo, o km e as fotos', async ({ page }) => {
    await abrir(page, { detalhes: [concluida()] })
    await expect(page.getByRole('heading', { name: 'Corrida concluída' })).toBeVisible()
    const resumo = page.getByTestId('resumo-corrida')
    await expect(resumo).toContainText('R$ 220,00')
    await expect(resumo).toContainText('Operações 4.100')
    await expect(resumo).toContainText('~41 km')
    await expect(resumo).toContainText('Fotos')
    await expect(page.getByTestId('folha-mapa')).toContainText(`${hhmm(SAIU)} → ${hhmm(CONCLUIU)}`)
    await resumo.getByRole('button', { name: /Fotos/ }).click()
    await expect(page.getByRole('img', { name: 'Foto do serviço' })).toHaveCount(2)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  test('tocar a 4ª estrela e enviar chama avaliar com nota 4; depois as estrelas ficam somente leitura', async ({ page }) => {
    const depois = concluida({ avaliacao: 4 }, { avaliar: false })
    const { chamadas } = await abrir(page, { detalhes: [concluida(), depois] })
    const estrelas = page.getByRole('radiogroup', { name: 'Como foi com o Ivo?' })
    await expect(estrelas.getByRole('radio')).toHaveCount(5)
    await estrelas.getByRole('radio', { name: '4 estrelas' }).click()
    await expect(estrelas.getByRole('radio', { name: '4 estrelas' })).toBeChecked()
    await page.getByRole('textbox', { name: /Comentário/ }).fill('Pontual e educado')
    await page.getByRole('button', { name: 'Enviar avaliação' }).click()
    await expect(page.getByText('Obrigado pela avaliação')).toBeVisible()
    expect(chamadas.filter((c) => c.rpc === 'avaliar').map((c) => c.corpo)).toEqual([
      { p_atividade: ID_PEDIDO, p_nota: 4, p_comentario: 'Pontual e educado' },
    ])
    // Somente leitura: sem rádios, sem botão; a nota continua à vista.
    await expect(page.getByRole('radiogroup', { name: 'Como foi com o Ivo?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enviar avaliação' })).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'Sua avaliação: 4 de 5 estrelas' })).toBeVisible()
  })

  test('as estrelas são um grupo de rádio com teclado (setas)', async ({ page }) => {
    await abrir(page, { detalhes: [concluida()] })
    const estrelas = page.getByRole('radiogroup', { name: 'Como foi com o Ivo?' })
    await estrelas.getByRole('radio', { name: '1 estrela' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(estrelas.getByRole('radio', { name: '3 estrelas' })).toBeChecked()
    await expect(estrelas.getByRole('radio', { name: '3 estrelas' })).toBeFocused()
  })

  test('já avaliada: só leitura, sem pedir nota', async ({ page }) => {
    await abrir(page, { detalhes: [concluida({ avaliacao: 5 }, { avaliar: false })] })
    await expect(page.getByRole('img', { name: 'Sua avaliação: 5 de 5 estrelas' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Como foi com o Ivo?' })).toHaveCount(0)
  })

  test('"Pedir de novo" abre as categorias com a mesma origem, destino e categoria, sem data', async ({ page }) => {
    await abrir(page, { detalhes: [concluida()] })
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/horarios_livres`, (route: Route) => {
      const c = route.request().postDataJSON() as { p_dia: string; p_duracao_min: number }
      return json(route, {
        ok: true,
        dia: c.p_dia,
        duracao_min: c.p_duracao_min,
        horarios: [instanteSp(c.p_dia, '08:30'), instanteSp(c.p_dia, '09:00')],
        dia_cheio: false,
      })
    })
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) =>
      json(route, {
        ok: true,
        categorias: [
          { codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'até 4 pessoas', disponivel: true, total_cent: 18000, linhas: [] },
          { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', disponivel: true, total_cent: 23000, linhas: [] },
        ],
      }),
    )
    await page.getByRole('button', { name: 'Pedir de novo' }).click()
    await expect(page).toHaveURL(/\/$/)
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Estaleiro Navegantes')
    await expect(folha).toContainText('até Porto de Itajaí')
    await expect(page.getByRole('radio', { name: /IVO Carga Leve/ })).toBeChecked()
    // Sem data: nenhum horário escolhido e nada de "Pedir" até a pessoa escolher.
    await expect(page.getByRole('button', { name: /^Agendar · escolha/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Pedir IVO/ })).toHaveCount(0)
    await page.getByRole('radio', { name: '08:30' }).click()
    await expect(page.getByRole('button', { name: /^Pedir IVO Carga Leve · \w{3} 08:30$/ })).toBeVisible()
  })
})

for (const esquema of ['light', 'dark'] as const) {
  test.describe(`tema ${esquema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: esquema })

    test('acompanhando (sinal perdido) e fim com avaliação sem violações do axe', async ({ page }) => {
      const parada = { lat: -26.9, lng: -48.655, em: new Date(Date.now() - 10 * MIN).toISOString() }
      await abrir(page, { detalhes: [emAndamento({}, parada), concluida()] })
      await expect(page.getByTestId('sinal-motorista')).toContainText('Sinal do motorista perdido')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.goto(`/corrida/${ID_PEDIDO}`)
      await expect(page.getByRole('heading', { name: 'Corrida concluída' })).toBeVisible()
      await page.getByRole('radio', { name: '2 estrelas' }).click()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  })
}
