// Fase 4 (Tarefa 14, especificação §6.9, Rulings R13 e R17): o "Painel da empresa" do Administrador (N1) e do Master
// (ADM), no computador: resumo do mês, próximas corridas, recentes e pessoas, com o CSV do mês. No celular, as tabelas
// viram cartões. Roda no projeto Playwright `novo` (dist-novo).
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, diaSp, ID_PEDIDO, instanteSp, orcamentoCliente, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Paulo Lima', empresa_nome: 'Umi San' }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const COMPUTADOR = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }

function corrida(extra: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    numero: 41,
    solicitante_nome: 'Marina Souza',
    inicio: instanteSp(diaSp(2), '08:30'),
    fim_previsto: instanteSp(diaSp(2), '09:25'),
    origem: 'Umi San · Rua Araguaia, 49',
    destino: 'Porto de Itajaí · Portão 3',
    categoria_nome: 'IVO Passageiros',
    centro_custo: 'Operações 4.100',
    status: 'AGENDADA',
    valor_cent: 22000,
    estimado: false,
    ...extra,
  }
}

const A_CAMINHO = corrida({
  id: ID_PEDIDO,
  numero: 42,
  inicio: new Date(Date.now() - 20 * 60_000).toISOString(),
  fim_previsto: new Date(Date.now() + 35 * 60_000).toISOString(),
  status: 'EM_ANDAMENTO',
})

const PAINEL = {
  ok: true,
  resumo: {
    mes: '2026-10-01',
    gasto_cent: 438000,
    reservado_cent: 62000,
    disponivel_cent: 782000,
    total_mes_cent: 1152600,
    contato_recarga: '(47) 99999-0000',
  },
  proximas: [
    corrida({}),
    corrida({
      id: '00000000-0000-4000-8000-0000000000b2',
      numero: 43,
      solicitante_nome: 'Paulo Lima',
      inicio: instanteSp(diaSp(3), '14:00'),
      fim_previsto: instanteSp(diaSp(3), '14:40'),
      categoria_nome: 'IVO Carga Pesada',
      centro_custo: 'Manutenção',
      status: 'SOLICITADA',
      valor_cent: null,
      estimado: true,
    }),
    corrida({
      id: '00000000-0000-4000-8000-0000000000b3',
      numero: 44,
      inicio: instanteSp(diaSp(4), '06:00'),
      fim_previsto: instanteSp(diaSp(4), '06:35'),
      centro_custo: 'Diretoria',
      status: 'ORCADA',
      valor_cent: 16500,
    }),
  ],
  recentes: [
    A_CAMINHO,
    corrida({
      id: '00000000-0000-4000-8000-0000000000b4',
      numero: 39,
      solicitante_nome: 'Paulo Lima',
      inicio: instanteSp(diaSp(-1), '10:00'),
      fim_previsto: instanteSp(diaSp(-1), '10:52'),
      categoria_nome: 'IVO Carga Leve',
      centro_custo: 'Manutenção',
      status: 'CONCLUIDA',
      valor_cent: 23000,
    }),
    corrida({
      id: '00000000-0000-4000-8000-0000000000b5',
      numero: 38,
      inicio: instanteSp(diaSp(-2), '07:30'),
      fim_previsto: instanteSp(diaSp(-2), '08:05'),
      centro_custo: 'Diretoria',
      status: 'CANCELADA',
      valor_cent: 3300,
    }),
  ],
  do_mes: [
    corrida({ inicio: '2026-10-02T11:30:00Z', centro_custo: 'Obra; Galpão 2', status: 'CONCLUIDA' }),
    corrida({ inicio: '2026-10-05T11:30:00Z', status: 'CANCELADA', valor_cent: 3300 }),
  ],
  pessoas: { sem_corridas: 3, convites_pendentes: 1 },
}

async function abrir(page: Page, perfil: PerfilFalso, caminho = '/empresa') {
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : { aal: 'aal2' })
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
  await simularPedidos(page, {
    detalhes: [
      {
        ok: true,
        pedido: detalheFalso({ status: 'EM_ANDAMENTO', categoria: 'PASSAGEIROS', categoria_nome: 'IVO Passageiros', motorista_nome: 'Ivo Barbosa' }),
        historico: [],
        orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 22000 }),
        acoes: { ...SEM_ACOES },
      },
    ],
  })
  const chamadas: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/painel_empresa`, (r) => {
    chamadas.push(r.request().postDataJSON() as Record<string, unknown>)
    return json(r, PAINEL)
  })
  await page.goto(caminho)
  return chamadas
}

test.describe('no computador', () => {
  test.use(COMPUTADOR)

  test('o Administrador vê os 4 blocos com os valores do servidor', async ({ page }) => {
    const chamadas = await abrir(page, N1)
    // Menu no topo: Painel (atual), Corridas, Pessoas e Carteira; a empresa à direita.
    const menu = page.getByRole('navigation', { name: 'Painel da empresa' })
    await expect(menu.getByRole('link', { name: 'Painel' })).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByRole('link', { name: 'Corridas' })).toHaveAttribute('href', '/empresa/corridas')
    await expect(menu.getByRole('link', { name: 'Pessoas' })).toHaveAttribute('href', '/empresa/pessoas')
    await expect(menu.getByRole('link', { name: 'Carteira' })).toHaveAttribute('href', '/empresa/carteira')
    await expect(page.getByText('Umi San', { exact: true })).toBeVisible()

    // 1. Resumo do mês.
    await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()
    const resumo = page.getByTestId('resumo-mes')
    await expect(resumo).toContainText('Gasto no mês')
    await expect(resumo).toContainText('R$ 4.380')
    await expect(resumo).toContainText('Total do mês')
    await expect(resumo).toContainText('R$ 11.526')
    await expect(resumo.getByRole('meter', { name: 'Gasto do total do mês' })).toHaveAttribute('aria-valuenow', '38')
    await expect(resumo).toContainText('R$ 7.820 disponível')
    await expect(resumo).toContainText('R$ 620 reservado em corridas confirmadas')
    await expect(resumo).toContainText('Para recarregar, fale com a IVO')
    await expect(resumo.getByRole('link', { name: /Falar com a IVO/ })).toHaveAttribute('href', 'tel:+5547999990000')

    // 2. Próximas corridas.
    const proximas = page.getByRole('table', { name: 'Próximas corridas' })
    await expect(proximas.getByRole('row')).toHaveCount(4)
    const [agendada, aguardando, confirmar] = [1, 2, 3].map((i) => proximas.getByRole('row').nth(i))
    await expect(agendada!).toContainText('Marina Souza')
    await expect(agendada!).toContainText('08:30')
    await expect(agendada!).toContainText('09:25')
    await expect(agendada!).toContainText('DeUmi San · Rua Araguaia, 49ParaPorto de Itajaí · Portão 3')
    await expect(agendada!).toContainText('Passageiros')
    await expect(agendada!).not.toContainText('IVO Passageiros')
    await expect(agendada!).toContainText('Operações 4.100')
    await expect(agendada!).toContainText('Agendada')
    await expect(agendada!).toContainText('R$ 220,00')
    await expect(aguardando!).toContainText('Aguardando o Ivo')
    await expect(aguardando!).toContainText('a orçar')
    await expect(confirmar!).toContainText('Para confirmar')
    await expect(confirmar!).toContainText('R$ 165,00')

    // 3. Corridas recentes.
    const recentes = page.getByRole('table', { name: 'Corridas recentes' })
    await expect(recentes.getByRole('row')).toHaveCount(4)
    await expect(recentes.getByRole('row').nth(1)).toContainText('A caminho')
    await expect(recentes.getByRole('row').nth(1)).toContainText('hoje')
    await expect(recentes.getByRole('row').nth(2)).toContainText('Concluída')
    await expect(recentes.getByRole('row').nth(3)).toContainText('Cancelada')
    await expect(recentes.getByRole('row').nth(3)).toContainText('R$ 33,00multa')

    // 4. Pessoas.
    const pessoas = page.getByTestId('bloco-pessoas')
    await expect(pessoas).toContainText('3 pessoasainda não fizeram corridas')
    await expect(pessoas).toContainText('1 convitenão aceito')
    await expect(pessoas.getByRole('link', { name: 'Reenviar convite' })).toHaveAttribute('href', '/empresa/pessoas')
    await expect(pessoas.getByRole('button', { name: 'Exportar CSV do mês' })).toBeVisible()

    // O N1 não escolhe empresa: o banco usa a dele.
    expect(chamadas[0]).toEqual({ p_empresa: null, p_mes: null })
    await expect(page.getByRole('combobox', { name: 'Empresa' })).toHaveCount(0)
  })

  test('tocar numa corrida "A caminho" abre o acompanhamento', async ({ page }) => {
    await abrir(page, N1)
    await page.getByRole('table', { name: 'Corridas recentes' }).getByRole('row').nth(1).getByText('Porto de Itajaí').click()
    await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  })

  test('"Exportar CSV do mês" baixa o arquivo com o cabeçalho exato', async ({ page }) => {
    await abrir(page, N1)
    const baixando = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar CSV do mês' }).click()
    const arquivo = await baixando
    expect(arquivo.suggestedFilename()).toBe('corridas-2026-10.csv')
    const texto = (await readFile((await arquivo.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '')
    const linhas = texto.split('\r\n')
    expect(linhas[0]).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
    expect(linhas[1]).toBe(
      '02/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;"Obra; Galpão 2";220,00',
    )
    expect(linhas[2]).toBe('05/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;Operações 4.100;33,00')
  })

  test('o Master escolhe a empresa no topo', async ({ page }) => {
    const chamadas = await abrir(page, ADM)
    const seletor = page.getByRole('combobox', { name: 'Empresa' })
    await expect(seletor).toHaveValue(EMPRESA_UMI.id)
    await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()
    expect(chamadas.at(-1)).toEqual({ p_empresa: EMPRESA_UMI.id, p_mes: null })
    const menu = page.getByRole('navigation', { name: 'Painel da empresa' })
    await expect(menu.getByRole('link', { name: 'Pessoas' })).toHaveAttribute('href', `/empresa/pessoas?empresa=${EMPRESA_UMI.id}`)
    await expect(menu.getByRole('link', { name: 'Carteira' })).toHaveAttribute('href', `/empresa/carteira?empresa=${EMPRESA_UMI.id}`)

    await seletor.selectOption(EMPRESA_PORTO.id)
    await expect(page).toHaveURL(new RegExp(`/empresa\\?empresa=${EMPRESA_PORTO.id}$`))
    await expect.poll(() => chamadas.at(-1)).toEqual({ p_empresa: EMPRESA_PORTO.id, p_mes: null })
    // O Master abre a corrida no detalhe (o acompanhamento no mapa é do cliente).
    await expect(
      page.getByRole('table', { name: 'Corridas recentes' }).getByRole('link', { name: /Corrida #0042/ }),
    ).toHaveAttribute('href', `/pedidos/${ID_PEDIDO}`)
  })

  test('o Master edita o contato de recarga em Configurações', async ({ page }) => {
    await abrir(page, ADM, '/adm/configuracoes')
    const cartao = page.getByTestId('cartao-contato-recarga')
    await expect(cartao).toContainText('Não informado')
    await cartao.getByRole('button', { name: 'Alterar contato' }).click()
    const pedido = page.waitForRequest(`${URL_SUPABASE}/rest/v1/rpc/definir_contato_recarga`)
    await cartao.getByLabel('Telefone ou WhatsApp', { exact: true }).fill('(47) 99999-0000 · WhatsApp')
    await cartao.getByRole('button', { name: 'Salvar' }).click()
    expect((await pedido).postDataJSON()).toEqual({ p_texto: '(47) 99999-0000 · WhatsApp' })
    await expect(page.getByText('O painel das empresas mostra "(47) 99999-0000 · WhatsApp" para recarregar.')).toBeVisible()
  })
})

test('o Solicitante não vê "Painel da empresa" no menu nem abre /empresa', async ({ page }) => {
  await abrir(page, N2, '/')
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu.getByRole('link', { name: 'Minhas corridas' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Painel da empresa' })).toHaveCount(0)
  await page.goto('/empresa')
  await expect(page).toHaveURL(/127\.0\.0\.1:8789\/$/)
})

test('o Administrador chega ao painel pelo menu ☰', async ({ page }) => {
  await abrir(page, N1, '/')
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Painel da empresa' }).click()
  await expect(page).toHaveURL(/\/empresa$/)
  await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()
})

test.describe('no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('as tabelas viram cartões, sem rolagem para o lado', async ({ page }) => {
    await abrir(page, N1)
    await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Próximas corridas' }).getByTestId('cartao-corrida')).toHaveCount(3)
    await expect(page.getByRole('list', { name: 'Corridas recentes' }).getByTestId('cartao-corrida')).toHaveCount(3)
    await expect(page.getByRole('list', { name: 'Corridas recentes' }).getByTestId('cartao-corrida').first()).toContainText('A caminho')
    const largura = await page.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, tela: window.innerWidth }))
    expect(largura.conteudo).toBeLessThanOrEqual(largura.tela)

    // O cartão em andamento também abre o acompanhamento.
    await page.getByRole('list', { name: 'Corridas recentes' }).getByTestId('cartao-corrida').first().click()
    await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('painel sem violações do axe nem de CSP, no computador e no celular', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await abrir(page, N1)
      await expect(page.getByRole('table', { name: 'Próximas corridas' })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByRole('list', { name: 'Próximas corridas' })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
