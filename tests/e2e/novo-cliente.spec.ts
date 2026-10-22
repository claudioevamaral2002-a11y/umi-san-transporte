// Fase 4 (Tarefa 8): o cliente pede por categoria, aguarda o Ivo e confirma com centro de custo (mockups 1 a 4).
// Roda no projeto Playwright `novo` (dist-novo). Dinheiro: nenhuma tela muda antes da resposta do servidor.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, diaSp, ID_PEDIDO, instanteSp, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const N3: PerfilFalso = { papel: 'CLIENTE', nivel: 3, nome: 'Carla Dias', empresa_nome: 'Umi San' }
const MIN = 60_000

/** Terça-feira passada (São Paulo) às `hora`: o relógio da página fica parado nela (a sessão falsa segue válida). */
function tercaPassada(hora: string): Date {
  for (let n = 2; n < 10; n++) {
    const dia = diaSp(-n)
    if (new Date(`${dia}T12:00:00-03:00`).getUTCDay() === 2) return new Date(`${dia}T${hora}:00-03:00`)
  }
  throw new Error('sem terça')
}

const diaDe = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)

/** "Encoded polyline" do Google (precisão 1e5), para a rota simulada. */
function codificar(pontos: Array<[number, number]>): string {
  const um = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    return s + String.fromCharCode(x + 63)
  }
  let lat = 0
  let lng = 0
  return pontos
    .map(([a, b]) => {
      const la = Math.round(a * 1e5)
      const ln = Math.round(b * 1e5)
      const s = um(la - lat) + um(ln - lng)
      lat = la
      lng = ln
      return s
    })
    .join('')
}
const POLYLINE = codificar([
  [-26.8986, -48.6542],
  [-26.903, -48.659],
  [-26.9078, -48.6619],
])

const linha = (codigo: string, descricao: string, quantidade: number | null, unitario: number | null, valor: number) => ({
  codigo,
  descricao,
  quantidade,
  unitario_cent: unitario,
  percentual_bp: null,
  base_cent: null,
  valor_cent: valor,
})

const LINHAS_TABELA = [linha('KM', 'Km rodados (trecho único)', 42, 300, 12600), linha('RETORNO', 'Retorno (50%)', null, null, 5400)]

function categoriasFalsas(pesadaDisponivel = true) {
  return {
    ok: true,
    categorias: [
      { codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'até 4 pessoas', disponivel: true, total_cent: 18000, linhas: LINHAS_TABELA },
      { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', disponivel: true, total_cent: 23000, linhas: [] },
      pesadaDisponivel
        ? { codigo: 'CARGA_PESADA', nome: 'IVO Carga Pesada', descricao_curta: 'com reboque', disponivel: true, total_cent: 41000, linhas: [] }
        : { codigo: 'CARGA_PESADA', nome: 'IVO Carga Pesada', descricao_curta: 'com reboque', disponivel: false, total_cent: null, linhas: null },
    ],
  }
}

/** Horários livres de qualquer dia: 08:30 a 17:30, de 30 em 30 min (São Paulo). */
async function horariosLivres(page: Page) {
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/horarios_livres`, (route: Route) => {
    const c = route.request().postDataJSON() as { p_dia: string; p_duracao_min: number }
    const horas: string[] = []
    for (let m = 8 * 60 + 30; m <= 17 * 60 + 30; m += 30) {
      horas.push(instanteSp(c.p_dia, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`))
    }
    return json(route, { ok: true, dia: c.p_dia, duracao_min: c.p_duracao_min, horarios: horas, dia_cheio: false })
  })
}

interface Abrir {
  perfil?: PerfilFalso
  agora?: Date
  detalhes?: unknown[]
  pesadaDisponivel?: boolean
  respostas?: Record<string, unknown[]>
  caminho?: string
  /** O Google não acha rota (km nulo). */
  semRota?: boolean
}

async function abrir(page: Page, o: Abrir = {}) {
  if (o.agora) await page.clock.setFixedTime(o.agora)
  await comSessaoFalsa(page, o.perfil ?? N2)
  await simularApi(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes, respostas: o.respostas })
  const mapas = await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: POLYLINE, semRota: o.semRota })
  await simularBlocosDoMapa(page)
  await horariosLivres(page)
  const categorias: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) => {
    categorias.push((route.request().postDataJSON() as { p: Record<string, unknown> }).p)
    return json(route, categoriasFalsas(o.pesadaDisponivel ?? true))
  })
  await page.goto(o.caminho ?? '/')
  return { chamadas, mapas, categorias }
}

/** Do início até as categorias: origem já vem da empresa; o destino é o Porto de Itajaí (Google). */
async function escolherDestino(page: Page) {
  await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue('Estaleiro Navegantes')
  const destino = page.getByRole('combobox', { name: 'Destino' })
  await expect(destino).toHaveAttribute('placeholder', 'Para onde?')
  await destino.fill('Porto')
  await page.getByRole('option', { name: /Porto de Itajaí/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
}

test.describe('pedir', () => {
  test('origem e destino desenham a rota e listam as 3 categorias com o preço estimado', async ({ page }) => {
    const { categorias } = await abrir(page, { agora: tercaPassada('08:02') })
    await expect(page.getByTestId('folha-mapa')).toContainText('Bom dia, Diego')
    await escolherDestino(page)
    await expect(page.locator('path.rota-mapa')).toHaveCount(1)
    const lista = page.getByRole('radiogroup', { name: 'Categorias' })
    await expect(lista.getByRole('radio')).toHaveCount(3)
    await expect(lista.getByRole('radio', { name: /IVO Passageiros/ })).toContainText('~R$ 180')
    await expect(lista.getByRole('radio', { name: /IVO Carga Leve/ })).toContainText('~R$ 230')
    await expect(lista.getByRole('radio', { name: /IVO Carga Pesada/ })).toContainText('~R$ 410')
    await expect(lista.getByRole('radio', { name: /IVO Passageiros/ })).toContainText('55 min')
    await expect(page.getByTestId('folha-mapa')).toContainText('42 km')
    // Preço do banco para os km da rota (só ida, por padrão).
    expect(categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false })
  })

  test('categoria indisponível: "Indisponível no momento" e sem botão de pedir', async ({ page }) => {
    await abrir(page, { agora: tercaPassada('08:02'), pesadaDisponivel: false })
    await escolherDestino(page)
    const pesada = page.getByRole('radio', { name: /IVO Carga Pesada/ })
    await expect(pesada).toContainText('Indisponível no momento')
    await expect(pesada).not.toContainText('R$')
    await expect(pesada).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Pedir IVO Carga Pesada/ })).toHaveCount(0)
  })

  test('"Agendar" é o padrão e o pedido é enviado; depois aparece "Enviado ao Ivo" com o prazo', async ({ page }) => {
    const agora = tercaPassada('08:02')
    const solicitada = {
      ok: true,
      pedido: detalheFalso({
        status: 'SOLICITADA',
        categoria: 'PASSAGEIROS',
        categoria_nome: 'IVO Passageiros',
        motorista_nome: 'Ivo Barbosa',
        inicio: instanteSp(diaDe(new Date(agora.getTime() + 24 * 60 * MIN)), '08:30'),
        origem: 'Estaleiro Navegantes',
        destino: 'Porto de Itajaí',
        origem_place_id: 'ChIJdef',
        destino_place_id: 'ChIJpor',
        prazo_orcar_ate: new Date(agora.getTime() + 4 * 60 * MIN).toISOString(),
      }),
      historico: [],
      orcamento: null,
      acoes: { ...SEM_ACOES, cancelar: true },
    }
    const { chamadas } = await abrir(page, { agora, detalhes: [solicitada] })
    await escolherDestino(page)
    await expect(page.getByRole('button', { name: /^Agendar · qua \d\d\/\d\d, 08:30/ })).toBeVisible()
    const pedir = page.getByRole('button', { name: 'Pedir IVO Passageiros · qua 08:30' })
    await pedir.click()
    await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
    await expect(page.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible()
    await expect(page.getByTestId('folha-mapa')).toContainText('Ele responde até hoje, 12:02')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    const criar = chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
    expect(criar).toMatchObject({
      categoria: 'PASSAGEIROS',
      carga: 'PESSOAS',
      reboque: 'NAO',
      modalidade: 'VEICULO_PROPRIO',
      levar: true,
      trazer: false,
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      pessoas_qtd: 1,
      inicio: instanteSp(diaDe(new Date(agora.getTime() + 24 * 60 * MIN)), '08:30'),
    })
    expect(criar.agora).toBeUndefined()
  })

  test('"Agora": envia agora:true e o primeiro horário livre a partir de +60 min (dentro da janela do banco)', async ({ page }) => {
    const agora = tercaPassada('08:02')
    const { chamadas } = await abrir(page, { agora })
    await escolherDestino(page)
    await page.getByRole('button', { name: /^Agendar · / }).click()
    await page.getByRole('radio', { name: 'Agora' }).click()
    const pedir = page.getByRole('button', { name: 'Pedir IVO Passageiros · ter 09:30' })
    await expect(pedir).toBeVisible()
    await pedir.click()
    await expect(page).toHaveURL(/\/corrida\//)
    const criar = chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
    expect(criar.agora).toBe(true)
    expect(criar.inicio).toBe(instanteSp(diaDe(agora), '09:30'))
    // Janela que o banco aceita para o "Agora": de agora + 55 min a agora + 36 h.
    const folga = Date.parse(String(criar.inicio)) - agora.getTime()
    expect(folga).toBeGreaterThanOrEqual(55 * MIN)
    expect(folga).toBeLessThanOrEqual(36 * 60 * MIN)
  })

  test('"Agora" às 23h30: o primeiro horário livre cai no dia seguinte', async ({ page }) => {
    const agora = tercaPassada('23:30')
    const { chamadas } = await abrir(page, { agora })
    await escolherDestino(page)
    await page.getByRole('button', { name: /^Agendar · / }).click()
    await page.getByRole('radio', { name: 'Agora' }).click()
    await page.getByRole('button', { name: 'Pedir IVO Passageiros · qua 08:30' }).click()
    await expect(page).toHaveURL(/\/corrida\//)
    const criar = chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
    expect(criar.agora).toBe(true)
    expect(criar.inicio).toBe(instanteSp(diaDe(new Date(agora.getTime() + 24 * 60 * MIN)), '08:30'))
  })

  test('o N3 não vê o botão de pedir', async ({ page }) => {
    await abrir(page, { perfil: N3 })
    await expect(page.getByTestId('folha-mapa')).toContainText('Carla')
    await expect(page.getByRole('combobox', { name: 'Destino' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Pedir/ })).toHaveCount(0)
  })
})

// ------------------------------------------------------------------------------------------------
// Confirmação da contraproposta (mockup 4)
// ------------------------------------------------------------------------------------------------

const LINHAS_IVO = [
  linha('KM', 'Km rodados (trecho único)', 48, 300, 14400),
  linha('RETORNO', 'Retorno (50%)', null, null, 4800),
  linha('ESPERA', 'Espera (horas)', 1, 2000, 2000),
  linha('PEDAGIO', 'Pedágio/balsa (estimado)', 1, 800, 800),
]

function orcada(acoes: Record<string, boolean> = { aprovar: true, pedir_revisao: true, reprovar: true, cancelar: true }) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'ORCADA',
      categoria: 'PASSAGEIROS',
      categoria_nome: 'IVO Passageiros',
      motorista_nome: 'Ivo Barbosa',
      veiculo: { modelo: 'Hilux', cor: 'branca', placa: 'ABC1D23' },
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      carga: 'PESSOAS',
      centro_custo: null,
      agora: false,
    }),
    historico: [],
    orcamento: {
      id: '00000000-0000-4000-8000-0000000000b1',
      versao: 2,
      status: 'PENDENTE',
      modalidade: 'VEICULO_PROPRIO',
      valido_ate: new Date(Date.now() + 20 * 60 * MIN).toISOString(),
      horario_sugerido: null,
      enviado_em: new Date(Date.now() - 60 * MIN).toISOString(),
      linhas: LINHAS_IVO,
      total_cent: 22000,
      hash: 'b'.repeat(64),
    },
    acoes: { ...SEM_ACOES, ...acoes },
  }
}

function agendada() {
  const o = orcada({})
  return { ...o, pedido: { ...o.pedido, status: 'AGENDADA', centro_custo: 'Obra Norte' }, orcamento: { ...o.orcamento, status: 'APROVADO' } }
}

/** confirmar_corrida que só responde quando o teste mandar (para ver o botão ocupado). */
async function confirmarControlado(page: Page) {
  const corpos: Array<Record<string, unknown>> = []
  let responder: (r: unknown) => void = () => {}
  const resposta = new Promise<unknown>((r) => (responder = r))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/confirmar_corrida`, async (route: Route) => {
    corpos.push(route.request().postDataJSON() as Record<string, unknown>)
    await json(route, await resposta)
  })
  return { corpos, responder: (r: unknown) => responder(r) }
}

async function abrirConfirmacao(page: Page, detalhes: unknown[], centro?: string, extra: Partial<Abrir> = {}) {
  if (centro !== undefined) {
    await page.addInitScript((v) => localStorage.setItem('ivo:ultimo-centro-custo', v), centro)
  }
  return abrir(page, { detalhes, caminho: `/corrida/${ID_PEDIDO}`, ...extra })
}

test.describe('confirmar', () => {
  test('contraproposta de verdade (+6 km e 1 h de espera): "Pela tabela" × "Proposta do Ivo", o resumo e "Ver o cálculo"', async ({ page }) => {
    const { categorias } = await abrirConfirmacao(page, [orcada()])
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Ivo Barbosa')
    await expect(folha).toContainText('Hilux branca')
    await expect(folha).toContainText('ABC1D23')
    await expect(folha).toContainText('Pela tabela R$ 180,00')
    await expect(folha).toContainText('Proposta do Ivo R$ 220,00')
    await expect(folha).toContainText('48 km')
    await expect(folha).toContainText('1 h de espera')
    await expect(folha).toContainText('pedágio')
    // "Pela tabela" é a estimativa da mesma categoria para a mesma rota.
    expect(categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false })
    await expect(page.getByTestId('memorial')).toHaveCount(0)
    const ver = page.getByRole('button', { name: 'Ver o cálculo' })
    await expect(ver).toHaveAttribute('aria-expanded', 'false')
    await ver.click()
    await expect(ver).toHaveAttribute('aria-expanded', 'true')
    const memorial = page.getByTestId('memorial')
    await expect(memorial.getByRole('listitem')).toHaveCount(4)
    await expect(memorial).toContainText('Espera (horas)')
    await expect(memorial).toContainText('Pedágio/balsa (estimado)')
    await expect(folha).toContainText('Disponível no saldo: R$ 2.490,00')
  })

  test('sem rota: nenhuma comparação, só o valor e "Ver o cálculo"', async ({ page }) => {
    const { categorias } = await abrirConfirmacao(page, [orcada()], undefined, { semRota: true })
    const folha = page.getByTestId('folha-mapa')
    await expect(page.getByRole('button', { name: 'Ver o cálculo' })).toBeVisible()
    await expect(folha).toContainText('R$ 220,00')
    await expect(folha).not.toContainText('Pela tabela')
    await expect(folha).not.toContainText('Proposta do')
    expect(categorias).toEqual([])
  })

  test('o Ivo aceitou pela tabela com a rota diferente em menos de 1 km: nenhuma comparação', async ({ page }) => {
    // Rota de hoje: 42 km (tabela R$ 180,00). O Ivo orçou 42,6 km pela tabela: total diferente, sem contraproposta.
    const aceitou = orcada()
    aceitou.orcamento = {
      ...aceitou.orcamento,
      linhas: [linha('KM', 'Km rodados (trecho único)', 42.6, 300, 12780), linha('RETORNO', 'Retorno (50%)', null, null, 5480)],
      total_cent: 18260,
    }
    const { categorias } = await abrirConfirmacao(page, [aceitou])
    const folha = page.getByTestId('folha-mapa')
    await expect(page.getByRole('button', { name: 'Confirmar corrida · R$ 182,60' })).toBeVisible()
    await expect.poll(() => categorias.length).toBeGreaterThan(0)
    // A tabela já chegou (e foi comparada) antes de conferir que a comparação não aparece.
    await expect(page.getByTestId('comparacao')).toHaveAttribute('data-tabela', 'sim')
    await expect(page.getByRole('button', { name: 'Ver o cálculo' })).toBeVisible()
    await expect(folha).not.toContainText('Pela tabela')
    await expect(folha).not.toContainText('Proposta do')
  })

  test('centro de custo vem com o último usado; confirmar só muda a tela depois da resposta', async ({ page }) => {
    const controle = await confirmarControlado(page)
    await abrirConfirmacao(page, [orcada(), agendada()], 'Operações 4.100')
    const centro = page.getByRole('textbox', { name: 'Centro de custo' })
    await expect(centro).toHaveValue('Operações 4.100')
    await centro.fill('Obra Norte')
    const confirmar = page.getByRole('button', { name: 'Confirmar corrida · R$ 220' })
    await confirmar.click()
    // Sem UI otimista: o botão fica ocupado e nada mais muda até a resposta.
    await expect(confirmar).toBeDisabled()
    await expect(confirmar).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toHaveCount(0)
    await expect.poll(() => controle.corpos.length).toBe(1)
    expect(controle.corpos[0]).toMatchObject({
      p_atividade: ID_PEDIDO,
      p_versao: 2,
      p_hash: 'b'.repeat(64),
      p_centro_custo: 'Obra Norte',
    })
    expect(String(controle.corpos[0]!.p_chave)).toMatch(/^[0-9a-f-]{36}$/)
    controle.responder({ ok: true, atividade_id: ID_PEDIDO, reservado_cent: 22000, disponivel_cent: 227000 })
    await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('ivo:ultimo-centro-custo'))).toBe('Obra Norte')
  })

  test('SALDO_INSUFICIENTE mostra a mensagem de hoje', async ({ page }) => {
    const controle = await confirmarControlado(page)
    await abrirConfirmacao(page, [orcada()])
    const confirmar = page.getByRole('button', { name: 'Confirmar corrida · R$ 220' })
    await confirmar.click()
    await expect(confirmar).toBeDisabled()
    controle.responder({ ok: false, codigo: 'SALDO_INSUFICIENTE' })
    await expect(page.getByRole('alert')).toContainText('Saldo insuficiente para aprovar este orçamento.')
    await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toHaveCount(0)
    // O centro de custo só fica guardado quando a confirmação dá certo.
    expect(await page.evaluate(() => localStorage.getItem('ivo:ultimo-centro-custo'))).toBeNull()
  })

  test('"Pedir outro valor" chama pedir_revisao; "Recusar" chama reprovar_orcamento', async ({ page }) => {
    const { chamadas } = await abrirConfirmacao(page, [orcada()])
    await page.getByRole('button', { name: 'Pedir outro valor' }).click()
    const revisao = page.getByRole('dialog', { name: 'Pedir outro valor' })
    await revisao.getByRole('textbox', { name: 'Motivo' }).fill('O valor ficou acima do combinado')
    await revisao.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'pedir_revisao').length).toBe(1)
    expect(chamadas.find((c) => c.rpc === 'pedir_revisao')!.corpo).toEqual({
      p_atividade: ID_PEDIDO,
      p_motivo: 'O valor ficou acima do combinado',
    })

    await page.getByRole('button', { name: 'Recusar' }).click()
    const recusar = page.getByRole('dialog', { name: 'Recusar a proposta' })
    await recusar.getByRole('button', { name: 'Recusar a proposta' }).click()
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'reprovar_orcamento').length).toBe(1)
    expect(chamadas.find((c) => c.rpc === 'reprovar_orcamento')!.corpo).toEqual({ p_atividade: ID_PEDIDO, p_motivo: null })
  })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('categorias e confirmação sem violações do axe', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, { agora: tercaPassada('08:02') })
      await escolherDestino(page)
      const superficie = tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(12, 42, 73)'
      await expect(page.getByTestId('folha-mapa')).toHaveCSS('background-color', superficie)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

      await page.goto(`/corrida/${ID_PEDIDO}`)
      await expect(page.getByRole('button', { name: /^Confirmar corrida/ })).toBeVisible()
      await page.getByRole('button', { name: 'Ver o cálculo' }).click()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  })
}
