// v2.1 (Tarefa 8, especificação §5.3): a empresa no Faturado (NF). O painel troca o saldo por "A faturar", "Em aberto"
// e "Vencidas"; a aba Carteira vira Faturas (o "A faturar" com as corridas e a lista de faturas com a NF e o CSV); o
// endereço antigo /extrato leva o N1 às Faturas (v2.2.1: sem "Carteira da empresa" no ☰). No Crédito, nada muda (os
// specs novo-painel-* continuam valendo). Roda no projeto Playwright `novo` (dist-novo), contra o banco simulado.
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { saldoFalso } from './apoio/dinheiroFalso.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { diaSp, instanteSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = {
  papel: 'CLIENTE',
  nivel: 1,
  nome: 'Marina Souza',
  empresa_nome: 'Umi San',
}
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const COMPUTADOR = {
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
}

const ID_FATURA_ABERTA = '00000000-0000-4000-8000-0000000000f7'
const CAMINHO_NF = `${EMPRESA_UMI.id}/00000000-0000-4000-8000-0000000000aa.pdf`

type Forma = 'CREDITO' | 'FATURADO' | null

function corrida(extra: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    numero: 41,
    solicitante_nome: 'Marina Souza',
    inicio: instanteSp(diaSp(2), '08:30'),
    fim_previsto: instanteSp(diaSp(2), '09:25'),
    origem: 'Umi San · Rua Araguaia, 49',
    destino: 'Porto de Itajaí · Portão 3',
    paradas: [],
    horas_estimadas: 2,
    categoria_nome: 'IVO Passageiros',
    centro_custo: 'Operações 4.100',
    status: 'AGENDADA',
    valor_cent: 22000,
    estimado: false,
    ...extra,
  }
}

function painel(forma: Forma) {
  return {
    ok: true,
    resumo: {
      mes: '2026-10-01',
      gasto_cent: 438000,
      reservado_cent: 62000,
      disponivel_cent: 782000,
      total_mes_cent: 1152600,
      contato_recarga: '(47) 99999-0000',
      ...(forma ? { forma_cobranca: forma } : {}),
      ...(forma === 'FATURADO'
        ? {
            a_faturar_cent: 185000,
            em_aberto_cent: 320000,
            vencidas_cent: 99000,
          }
        : {}),
    },
    proximas: [corrida()],
    recentes: [],
    do_mes: [],
    pessoas: { sem_corridas: 0, convites_pendentes: 0 },
  }
}

function item(extra: Record<string, unknown>) {
  return {
    lancamento_id: 501,
    criado_em: '2026-10-03T14:00:00Z',
    tipo: 'DEBITO',
    valor_cent: -22000,
    numero: 41,
    solicitante_nome: 'Marina Souza',
    origem: 'Umi San · Rua Araguaia, 49',
    paradas: ['Posto Shell · BR-101'],
    destino: 'Porto de Itajaí · Portão 3',
    categoria_nome: 'IVO Passageiros',
    centro_custo: 'Operações 4.100',
    ...extra,
  }
}

const A_FATURAR = [
  item({
    lancamento_id: 601,
    criado_em: '2026-10-17T12:00:00Z',
    valor_cent: -120000,
    numero: 50,
    paradas: [],
  }),
  item({
    lancamento_id: 602,
    criado_em: '2026-10-18T12:00:00Z',
    valor_cent: -65000,
    numero: 51,
    solicitante_nome: 'Paulo Lima',
    paradas: [],
  }),
]

function fatura(numero: number, situacao: string, extra: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-0000000000f${numero}`,
    numero,
    inicio: '2026-10-01',
    fim: '2026-10-15',
    total_cent: 320000,
    nf_numero: `NF-${numero}`,
    nf_emitida_em: '2026-10-16',
    nf_pdf_caminho: CAMINHO_NF,
    vencimento: '2026-11-15',
    status: situacao === 'VENCIDA' ? 'ABERTA' : situacao,
    situacao,
    paga_em: situacao === 'PAGA' ? '2026-10-01' : null,
    ...extra,
  }
}

const FATURAS = {
  ok: true,
  forma_cobranca: 'FATURADO',
  a_faturar: { total_cent: 185000, itens: A_FATURAR },
  em_aberto_cent: 320000,
  vencidas_cent: 99000,
  faturas: [
    fatura(7, 'ABERTA'),
    fatura(6, 'VENCIDA', {
      inicio: '2026-09-16',
      fim: '2026-09-30',
      total_cent: 99000,
      vencimento: '2026-10-01',
    }),
    fatura(5, 'PAGA', {
      inicio: '2026-09-01',
      fim: '2026-09-15',
      total_cent: 45000,
    }),
    fatura(4, 'CANCELADA', {
      inicio: '2026-08-16',
      fim: '2026-08-31',
      total_cent: 12000,
      nf_pdf_caminho: null,
    }),
  ],
}

const DETALHE_FATURA = {
  ok: true,
  fatura: fatura(7, 'ABERTA', { total_cent: 18700 }),
  itens: [
    item({}),
    item({
      lancamento_id: 502,
      criado_em: '2026-10-05T14:00:00Z',
      tipo: 'ESTORNO',
      valor_cent: 3300,
      solicitante_nome: '=Paulo',
      paradas: [],
      centro_custo: 'Obra; Galpão 2',
    }),
  ],
}

interface Chamadas {
  painel: Array<Record<string, unknown>>
  faturas: Array<Record<string, unknown>>
  fatura: Array<Record<string, unknown>>
  assinaturas: string[]
}

async function abrir(page: Page, perfil: PerfilFalso, caminho: string, forma: Forma = 'FATURADO') {
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : { aal: 'aal2' })
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
  await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
  await simularPedidos(page, {})
  const chamadas: Chamadas = {
    painel: [],
    faturas: [],
    fatura: [],
    assinaturas: [],
  }
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/painel_empresa`, (r) => {
    chamadas.painel.push(r.request().postDataJSON() as Record<string, unknown>)
    return json(r, painel(forma))
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/faturas`, (r) => {
    chamadas.faturas.push(r.request().postDataJSON() as Record<string, unknown>)
    return json(r, forma === 'FATURADO' ? FATURAS : { ...FATURAS, forma_cobranca: 'CREDITO', faturas: [] })
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/fatura`, (r) => {
    chamadas.fatura.push(r.request().postDataJSON() as Record<string, unknown>)
    return json(r, DETALHE_FATURA)
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/saldo_empresa`, (r) =>
    json(
      r,
      saldoFalso(
        forma === 'FATURADO'
          ? {
              forma_cobranca: 'FATURADO',
              saldo_contabil_cent: -505000,
              reservado_cent: 22000,
              disponivel_cent: -527000,
            }
          : {},
      ),
    ),
  )
  // Link assinado da NF: um novo a cada toque (vale 60 s). O GET é o PDF, como anexo (o `download` do link).
  await page.context().route(`${URL_SUPABASE}/storage/v1/object/sign/**`, (r) => {
    if (r.request().method() === 'POST') {
      chamadas.assinaturas.push(r.request().url())
      const caminho = r.request().url().split('/object/sign/')[1]!
      return json(r, {
        signedURL: `/object/sign/${caminho}?token=assinado-${chamadas.assinaturas.length}`,
      })
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="nf.pdf"' },
      body: '%PDF-1.4 falso',
    })
  })
  await page.goto(caminho)
  return chamadas
}

const abas = (page: Page) => page.getByRole('navigation', { name: 'Painel da empresa' })
const listaFaturas = (page: Page) => page.getByRole('list', { name: 'Faturas', exact: true }).getByRole('listitem')

test.describe('no computador', () => {
  test.use(COMPUTADOR)

  test('o painel no Faturado mostra A faturar, Em aberto e Vencidas, sem saldo nem recarga', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa')
    const resumo = page.getByTestId('resumo-mes')
    await expect(resumo.getByTestId('a-faturar')).toContainText('ainda sem fatura')
    await expect(resumo.getByTestId('a-faturar')).not.toContainText('quinzena atual')
    await expect(resumo.getByTestId('em-aberto')).toContainText('faturas emitidas não pagas')
    // Uma leitura só do painel na primeira abertura (o cabeçalho e a aba dividem a mesma).
    await page.waitForTimeout(500)
    expect(chamadas.painel).toEqual([{ p_empresa: null, p_mes: null }])
    await expect(resumo).toContainText('Gasto no mês')
    await expect(resumo).toContainText('R$ 4.380')
    await expect(resumo.getByTestId('a-faturar')).toContainText('A faturar')
    await expect(resumo.getByTestId('a-faturar')).toContainText('R$ 1.850')
    await expect(resumo.getByTestId('em-aberto')).toContainText('Em aberto')
    await expect(resumo.getByTestId('em-aberto')).toContainText('R$ 3.200')
    await expect(resumo.getByTestId('vencidas')).toContainText('Vencidas')
    await expect(resumo.getByTestId('vencidas')).toContainText('R$ 990')
    await expect(resumo).not.toContainText(/dispon[ií]vel/i)
    await expect(resumo).not.toContainText(/reservado/i)
    await expect(resumo).not.toContainText('Para recarregar')
    await expect(resumo).not.toContainText('Total do mês')
    await expect(page.getByRole('link', { name: /Falar com a IVO/ })).toHaveCount(0)
    await expect(resumo.getByRole('meter')).toHaveCount(0)
    // O atalho do resumo leva às Faturas, não ao Extrato.
    await expect(page.locator('main').getByRole('link', { name: /^Faturas/ })).toHaveAttribute('href', '/empresa/faturas')
    await expect(page.locator('main').getByRole('link', { name: /^Extrato/ })).toHaveCount(0)

    // A aba Carteira vira Faturas.
    await expect(abas(page).getByRole('link')).toHaveCount(4)
    await expect(abas(page).getByRole('link', { name: 'Faturas' })).toHaveAttribute('href', '/empresa/faturas')
    await expect(abas(page).getByRole('link', { name: 'Carteira' })).toHaveCount(0)
  })

  test('voltar ao Painel de outra aba relê os valores', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa')
    await expect(page.getByTestId('a-faturar')).toBeVisible()
    await abas(page).getByRole('link', { name: 'Corridas' }).click()
    await expect(page).toHaveURL(/\/empresa\/corridas$/)
    await page.waitForTimeout(500)
    const antes = chamadas.painel.length
    await abas(page).getByRole('link', { name: 'Painel' }).click()
    await expect(page.getByTestId('a-faturar')).toBeVisible()
    // Voltar ao Painel relê os valores do banco, uma vez.
    await expect.poll(() => chamadas.painel.length).toBe(antes + 1)
    await page.waitForTimeout(500)
    expect(chamadas.painel).toHaveLength(antes + 1)
  })

  test('a aba Faturas mostra o "A faturar" com as corridas e as faturas com a etiqueta', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa')
    await abas(page).getByRole('link', { name: 'Faturas' }).click()
    await expect(page).toHaveURL(/\/empresa\/faturas$/)
    await expect(abas(page).getByRole('link', { name: 'Faturas' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    await expect(page.getByRole('heading', { level: 2, name: 'A faturar' })).toBeVisible()
    const aFaturar = page.getByTestId('cartao-a-faturar')
    await expect(aFaturar).toContainText('R$ 1.850,00')
    const corridas = aFaturar.getByRole('list', { name: 'Corridas a faturar' }).getByRole('listitem')
    await expect(corridas).toHaveCount(2)
    await expect(corridas.nth(0)).toContainText('Marina Souza')
    await expect(corridas.nth(0)).toContainText('R$ 1.200,00')
    await expect(corridas.nth(0).getByTestId('rota-de-para')).toContainText('DeUmi San · Rua Araguaia, 49')
    await expect(corridas.nth(1)).toContainText('Paulo Lima')
    await expect(corridas.nth(1)).toContainText('R$ 650,00')

    const lista = listaFaturas(page)
    await expect(lista).toHaveCount(4)
    const [aberta, vencida, paga, cancelada] = [0, 1, 2, 3].map((i) => lista.nth(i))
    await expect(aberta!).toContainText('Fatura nº 7')
    await expect(aberta!).toContainText('01/10 a 15/10/2026')
    await expect(aberta!).toContainText('R$ 3.200,00')
    await expect(aberta!).toContainText('NF NF-7')
    await expect(aberta!).toContainText('Vence em 15/11/2026')
    await expect(aberta!.getByTestId('etiqueta-fatura')).toHaveText('Aberta')
    await expect(vencida!.getByTestId('etiqueta-fatura')).toHaveText('Vencida')
    await expect(paga!.getByTestId('etiqueta-fatura')).toHaveText('Paga')
    await expect(paga!).toContainText('Paga em 01/10/2026')
    await expect(cancelada!.getByTestId('etiqueta-fatura')).toHaveText('Cancelada')
    // Sem PDF (a cancelada do exemplo), sem o botão da NF; o CSV continua.
    await expect(cancelada!.getByRole('button', { name: /Baixar NF/ })).toHaveCount(0)
    await expect(cancelada!.getByRole('button', { name: /CSV da fatura/ })).toBeVisible()
    await expect(aberta!.getByRole('button', { name: 'Baixar NF (PDF) da fatura nº 7' })).toBeVisible()

    // O N1 não escolhe empresa: o banco usa a dele.
    expect(chamadas.faturas[0]).toEqual({ p_empresa: null })
  })

  test('"Baixar NF (PDF)" pede um link assinado novo a cada toque e baixa o PDF, sem pop-up', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa/faturas')
    const botao = page.getByRole('button', {
      name: 'Baixar NF (PDF) da fatura nº 7',
    })
    await expect(botao).toBeVisible()
    // O link não é pedido antes do toque (vale só 60 s).
    expect(chamadas.assinaturas).toHaveLength(0)

    const janelas: unknown[] = []
    page.on('popup', (p) => janelas.push(p))
    const baixando = page.waitForEvent('download')
    await botao.click()
    const pdf = await baixando
    expect(pdf.url()).toContain(`/storage/v1/object/sign/notas-fiscais/${CAMINHO_NF}?token=assinado-1&download=`)
    expect(pdf.suggestedFilename()).toBe('nf.pdf')
    expect(chamadas.assinaturas).toHaveLength(1)
    expect(chamadas.assinaturas[0]).toContain(`/object/sign/notas-fiscais/${CAMINHO_NF}`)
    // A tela continua nas Faturas.
    await expect(page).toHaveURL(/\/empresa\/faturas$/)
    await expect(botao).toBeEnabled()

    const deNovo = page.waitForEvent('download')
    await botao.click()
    expect((await deNovo).url()).toContain('token=assinado-2&download=')
    expect(chamadas.assinaturas).toHaveLength(2)
    expect(janelas).toHaveLength(0)
  })

  test('"CSV da fatura" baixa fatura-<número>.csv com as colunas do CSV do mês e o total', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa/faturas')
    const baixando = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV da fatura nº 7' }).click()
    const arquivo = await baixando
    expect(arquivo.suggestedFilename()).toBe('fatura-7.csv')
    expect(chamadas.fatura).toEqual([{ p_fatura: ID_FATURA_ABERTA }])
    const texto = (await readFile((await arquivo.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '')
    const linhas = texto.split('\r\n')
    expect(linhas[0]).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
    expect(linhas[1]).toBe(
      '03/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;Posto Shell · BR-101;Porto de Itajaí · Portão 3;IVO Passageiros;;Operações 4.100;220,00',
    )
    expect(linhas[2]).toBe(
      '05/10/2026;\'=Paulo;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;"Obra; Galpão 2";-33,00',
    )
    expect(linhas[3]).toBe('Total;;;;;;;;187,00')
    expect(linhas).toHaveLength(5)
  })

  test('no Faturado, /empresa/carteira leva às Faturas', async ({ page }) => {
    await abrir(page, N1, '/empresa/carteira')
    await expect(page).toHaveURL(/\/empresa\/faturas$/)
    await expect(page.getByTestId('cartao-a-faturar')).toBeVisible()
    await expect(page.getByText('Disponível para novos pedidos')).toHaveCount(0)
  })

  test('no Crédito, /empresa/faturas leva à Carteira e tudo fica como hoje', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa/faturas', 'CREDITO')
    await expect(page).toHaveURL(/\/empresa\/carteira$/)
    await expect(page.getByText('Disponível para novos pedidos')).toBeVisible()
    await expect(abas(page).getByRole('link', { name: 'Carteira' })).toHaveAttribute('aria-current', 'page')
    await expect(abas(page).getByRole('link', { name: 'Faturas' })).toHaveCount(0)
    await abas(page).getByRole('link', { name: 'Painel' }).click()
    const resumo = page.getByTestId('resumo-mes')
    await expect(resumo).toContainText('Para recarregar, fale com a IVO')
    await expect(resumo).toContainText('reservado em corridas confirmadas')
    await expect(resumo.getByTestId('a-faturar')).toHaveCount(0)
    // O Crédito nunca lê as faturas.
    expect(chamadas.faturas).toHaveLength(0)
  })

  test('sem a forma na resposta (banco anterior), o painel é o do Crédito', async ({ page }) => {
    await abrir(page, N1, '/empresa', null)
    await expect(page.getByTestId('resumo-mes')).toContainText('Para recarregar, fale com a IVO')
    await expect(abas(page).getByRole('link', { name: 'Carteira' })).toBeVisible()
    await expect(abas(page).getByRole('link', { name: 'Faturas' })).toHaveCount(0)
  })

  test('o Master vê as Faturas da empresa escolhida', async ({ page }) => {
    const chamadas = await abrir(page, ADM, `/empresa/faturas?empresa=${EMPRESA_PORTO.id}`)
    await expect(page.getByRole('combobox', { name: 'Empresa' })).toHaveValue(EMPRESA_PORTO.id)
    await expect(page.getByTestId('cartao-a-faturar')).toBeVisible()
    expect(chamadas.faturas.at(-1)).toEqual({ p_empresa: EMPRESA_PORTO.id })
    await expect(abas(page).getByRole('link', { name: 'Painel' })).toHaveAttribute('href', `/empresa?empresa=${EMPRESA_PORTO.id}`)
  })

  // v2.2.1: sai a "Carteira da empresa" do ☰; o endereço antigo leva o N1 ao Painel da empresa.
  test('no Faturado, o endereço antigo /extrato leva o N1 às Faturas', async ({ page }) => {
    await abrir(page, N1, '/extrato')
    await expect(page).toHaveURL(/\/empresa\/faturas$/)
    await expect(page.getByTestId('cartao-a-faturar')).toBeVisible()
  })

  test('no Crédito, o endereço antigo /extrato leva o N1 à Carteira do painel, com o saldo', async ({ page }) => {
    await abrir(page, N1, '/extrato', 'CREDITO')
    await expect(page).toHaveURL(/\/empresa\/carteira$/)
    await expect(page.getByText('Disponível para novos pedidos')).toBeVisible()
  })
})

test.describe('no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Painel e Faturas cabem sem rolar para o lado', async ({ page }) => {
    await abrir(page, N1, '/empresa')
    await expect(page.getByTestId('a-faturar')).toBeVisible()
    for (const aba of ['Faturas', 'Painel']) {
      await abas(page).getByRole('link', { name: aba }).click()
      if (aba === 'Faturas') await expect(listaFaturas(page)).toHaveCount(4)
      else await expect(page.getByTestId('a-faturar')).toBeVisible()
      const largura = await page.evaluate(() => ({
        conteudo: document.documentElement.scrollWidth,
        tela: window.innerWidth,
      }))
      expect(largura.conteudo).toBeLessThanOrEqual(largura.tela)
    }
  })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('Painel e Faturas sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await abrir(page, N1, '/empresa')
      await expect(page.getByTestId('a-faturar')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await abas(page).getByRole('link', { name: 'Faturas' }).click()
      await expect(listaFaturas(page)).toHaveCount(4)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
