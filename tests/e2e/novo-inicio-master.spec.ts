// v2.2 (Tarefa 6, especificação §5.6): o Início do Master. Em cima as pendências com atalho (aguardando orçamento,
// aguardando aprovação, em andamento, faturas a gerar e vencidas, empresas abaixo do alerta); embaixo o resumo do
// painel. Sem nada: "Nada pendente agora.". Também a nota dos km no contrato com tabela por categoria. Projeto `novo`.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, linhaContrato, simularApi, versaoFalsa } from './apoio/apiFalsa.ts'
import { painelFalso, simularDinheiro } from './apoio/dinheiroFalso.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const UMI = EMPRESA_UMI.id

const RESUMO = [
  {
    empresa_id: UMI,
    empresa_nome: 'Umi San',
    a_faturar_cent: 180000,
    em_aberto_cent: 250000,
    vencidas_cent: 250000,
    quinzena_pronta: { inicio: '2026-10-01', fim: '2026-10-15' },
  },
]

const PAINEL_VAZIO = painelFalso({
  corridas: { agendadas: 0, em_andamento: 0 },
  pendencias: { aguardando_orcamento: 0, aguardando_aprovacao: 0, empresas_abaixo_alerta: 0 },
})

async function abrir(
  page: Page,
  caminho: string,
  opcoes: { painel?: unknown; resumo?: unknown[]; resumoFalha?: boolean; categorias?: unknown[] } = {},
) {
  await comSessaoFalsa(page, ADM, AAL2)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page, {
    vigente: [versaoFalsa(3)],
    contratos: [linhaContrato(EMPRESA_UMI, versaoFalsa(2)), linhaContrato(EMPRESA_PORTO, null)],
    historicoEmpresas: { [UMI]: [versaoFalsa(2)] },
    empresas: [EMPRESA_UMI, EMPRESA_PORTO],
  })
  await simularPedidos(page)
  const dinheiro = await simularDinheiro(page, { painel: opcoes.painel })
  const categorias: Record<string, unknown>[] = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/faturas_resumo`, (r) =>
    json(r, opcoes.resumoFalha ? { ok: false, codigo: 'ERRO_INESPERADO' } : { ok: true, empresas: opcoes.resumo ?? RESUMO }),
  )
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_adm`, (r) => {
    categorias.push((r.request().postDataJSON() ?? {}) as Record<string, unknown>)
    return json(r, { ok: true, categorias: opcoes.categorias ?? [], precos: null })
  })
  await page.goto(caminho)
  return { dinheiro, categorias }
}

const pendencias = (page: Page) => page.getByTestId('pendencias-master')

test('as pendências com atalho em cima e o resumo do painel embaixo; sem o texto provisório', async ({ page }) => {
  const { dinheiro } = await abrir(page, '/')
  await expect(page.getByRole('heading', { level: 1, name: /^(Bom dia|Boa tarde|Boa noite), Ana$/ })).toBeVisible()
  const lista = pendencias(page).getByRole('list', { name: 'Pendências do painel' })
  await expect(lista.getByRole('link', { name: /Aguardando orçamento/ })).toHaveAttribute('href', '/pedidos')
  await expect(lista.getByRole('link', { name: /Aguardando orçamento/ })).toContainText('2')
  await expect(lista.getByRole('link', { name: /Aguardando aprovação/ })).toHaveAttribute('href', '/pedidos')
  await expect(lista.getByRole('link', { name: /Em andamento/ })).toHaveAttribute('href', '/pedidos?filtro=agendados')
  await expect(lista.getByRole('link', { name: /Empresas abaixo do alerta/ })).toHaveAttribute('href', '/adm/creditos')
  const faturas = pendencias(page).getByTestId('pendencias-faturas')
  await expect(faturas.getByRole('link', { name: 'Quinzena fechada: Umi San pronta para faturar' })).toHaveAttribute(
    'href',
    `/adm/faturas/${UMI}`,
  )
  await expect(faturas).toContainText('Faturas vencidas')
  await expect(page.getByTestId('painel-resumo')).toBeVisible()
  await expect(page.getByText('As telas novas chegam em breve', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Nada pendente agora.')).toHaveCount(0)
  // Uma leitura só do painel (a do resumo, sem período) serve às pendências e ao resumo.
  const painel = () => dinheiro.filter((c) => c.rpc === 'painel_adm')
  await expect.poll(() => painel().length).toBe(1)
  expect(painel()[0]!.corpo).toEqual({ p_de: null, p_ate: null })

  // O atalho leva à tela que resolve.
  await lista.getByRole('link', { name: /Empresas abaixo do alerta/ }).click()
  await expect(page).toHaveURL(/\/adm\/creditos$/)
})

test('sem nada pendente: "Nada pendente agora."', async ({ page }) => {
  await abrir(page, '/', {
    painel: PAINEL_VAZIO,
    resumo: [{ ...RESUMO[0], quinzena_pronta: null, vencidas_cent: 0 }],
  })
  await expect(pendencias(page)).toContainText('Nada pendente agora.')
  await expect(pendencias(page).getByRole('link')).toHaveCount(0)
  await expect(page.getByTestId('pendencias-faturas')).toHaveCount(0)
})

test('se as faturas não responderem, não afirma "Nada pendente agora."', async ({ page }) => {
  await abrir(page, '/', { painel: PAINEL_VAZIO, resumoFalha: true })
  await expect(page.getByTestId('painel-resumo')).toBeVisible()
  await expect(page.getByText('Nada pendente agora.')).toHaveCount(0)
})

test('só as faturas pendentes: não diz "Nada pendente agora."', async ({ page }) => {
  await abrir(page, '/', { painel: PAINEL_VAZIO })
  await expect(page.getByTestId('pendencias-faturas')).toBeVisible()
  await expect(page.getByText('Nada pendente agora.')).toHaveCount(0)
})

test('390 px sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await abrir(page, '/')
  await expect(page.getByTestId('painel-resumo')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const tema of ['light', 'dark'] as const) {
  test(`sem violações do axe (tema ${tema === 'light' ? 'claro' : 'escuro'})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' })
    await abrir(page, '/')
    await expect(page.getByTestId('painel-resumo')).toBeVisible()
    await expect(page.getByTestId('pendencias-faturas')).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
}

// ------------------------------------------------------------------------------------------------
// Contrato: a nota dos km (especificação §2)
// ------------------------------------------------------------------------------------------------

const NOTA =
  'Pedidos por categoria usam os preços de Categorias e preços. Estes valores valem para pedidos sem categoria (app v1).'
const TARIFA = { taxa_fixa_cent: 0, km_cent: 350, hora_cent: 0, hora_espera_cent: 0, parada_cent: 0, retorno_bp: 0, reboque_cent: 0, hospedagem_diaria_cent: 0 }
const categoria = (inicial: boolean) => ({
  codigo: 'PASSAGEIROS',
  nome: 'IVO Passageiros',
  descricao_curta: '',
  ordem: 1,
  ativa: true,
  tarifa: { ...TARIFA, inicial },
})

test('contrato com tabela por categoria: a nota dos km com o link para Categorias e preços', async ({ page }) => {
  const { categorias } = await abrir(page, `/adm/contratos/${UMI}`, { categorias: [categoria(false)] })
  const nota = page.getByTestId('cartao-proprio').getByTestId('nota-km-categorias')
  await expect(nota).toHaveText(NOTA)
  await expect(nota.getByRole('link', { name: 'Categorias e preços' })).toHaveAttribute('href', '/adm/categorias')
  // A mesma leitura do Publicar contrato: a empresa e a versão vigente.
  expect(categorias[0]).toEqual({ p_empresa: UMI, p_versao: 2 })
  await nota.getByRole('link', { name: 'Categorias e preços' }).click()
  await expect(page).toHaveURL(/\/adm\/categorias$/)
})

test('contrato sem tabela por categoria (só valores iniciais): sem a nota', async ({ page }) => {
  const { categorias } = await abrir(page, `/adm/contratos/${UMI}`, { categorias: [categoria(true)] })
  await expect(page.getByTestId('cartao-proprio')).toContainText('Quilômetro sem reboque')
  await expect.poll(() => categorias.length).toBeGreaterThan(0)
  await expect(page.getByTestId('nota-km-categorias')).toHaveCount(0)
})
