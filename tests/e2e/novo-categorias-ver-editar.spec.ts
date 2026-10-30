// v2.1 (Tarefa 5, especificação §5.1): "Categorias e preços" abre só para ver; o lápis ("Editar <nome>") edita aquele
// cartão, com Cancelar (volta aos valores publicados) e Desativar ou Excluir (com confirmação). "Publicar tabela" só
// se ativa com diferença real; as inativas ficam recolhidas em "Inativas (N)", com Reativar. Sair com rascunho pede
// confirmação. Roda no projeto Playwright `novo` (dist-novo), com o banco simulado.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_UMI, linhaContrato, simularApi, versaoFalsa } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }

const ZERO = {
  taxa_fixa_cent: 0,
  km_cent: 0,
  hora_cent: 0,
  hora_espera_cent: 0,
  parada_cent: 0,
  retorno_bp: 0,
  reboque_cent: 0,
  hospedagem_diaria_cent: 0,
}
// Tabela já publicada (inicial: false): sem mudança, "Publicar tabela" fica desabilitado.
const PASSAGEIROS = { ...ZERO, km_cent: 350, retorno_bp: 5000 }
const LEVE = { ...ZERO, km_cent: 480, reboque_cent: 10000, hospedagem_diaria_cent: 40000 }
const MOTORISTA = { ...ZERO, hora_cent: 9000 }

const cat = (codigo: string, nome: string, ordem: number, extra: Record<string, unknown>) => ({
  codigo,
  nome,
  descricao_curta: `descrição de ${nome}`,
  ordem,
  ativa: true,
  carga: 'PESSOAS',
  reboque: 'NAO',
  veiculo_cliente: false,
  pode_excluir: false,
  ...extra,
})

const CATEGORIAS = [
  cat('PASSAGEIROS', 'IVO Passageiros', 1, { pessoas_max: 4, tarifa: { ...PASSAGEIROS, inicial: false } }),
  cat('CARGA_LEVE', 'IVO Carga Leve', 2, { carga: 'AMBOS', reboque: 'SIM', tarifa: { ...LEVE, inicial: false } }),
  cat('MOTORISTA', 'IVO Motorista', 3, { veiculo_cliente: true, tarifa: { ...MOTORISTA, inicial: false } }),
  cat('VAN', 'IVO Van', 4, { pode_excluir: true, tarifa: { ...ZERO, km_cent: 500, inicial: false } }),
  cat('CARGA_PESADA', 'IVO Carga Pesada', 5, { ativa: false, reboque: 'SIM', tarifa: { ...LEVE, inicial: false } }),
]

interface Chamada {
  rpc: string
  corpo: Record<string, unknown>
}

const cartao = (page: Page, nome: string) => page.getByRole('region', { name: nome, exact: true })
const editar = (page: Page, nome: string) => page.getByRole('button', { name: `Editar ${nome}`, exact: true }).click()

async function abrir(page: Page, opcoes: { categorias?: unknown[][]; excluir?: unknown; contratos?: unknown[] } = {}) {
  await comSessaoFalsa(page, ADM, AAL2)
  await simularMapas(page)
  await simularApi(page, { vigente: [versaoFalsa(3)], ...(opcoes.contratos ? { contratos: opcoes.contratos } : {}) })
  await simularPedidos(page)
  const chamadas: Chamada[] = []
  const listas = [...(opcoes.categorias ?? [CATEGORIAS])]
  const proxima = () => (listas.length > 1 ? listas.shift()! : listas[0]!)
  const rota = (nome: string, responder: () => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      chamadas.push({ rpc: nome, corpo: (route.request().postDataJSON() ?? {}) as Record<string, unknown> })
      return json(route, responder())
    })
  await rota('categorias_adm', () => ({ ok: true, categorias: proxima(), precos: null }))
  await rota('salvar_categoria', () => ({ ok: true, codigo: 'X' }))
  await rota('excluir_categoria', () => opcoes.excluir ?? { ok: true })
  await rota('publicar_tarifas', () => ({ ok: true, versao: 4 }))
  await page.goto('/adm/categorias')
  await expect(cartao(page, 'IVO Passageiros')).toBeVisible()
  return chamadas
}

test('o cartão não mostra "Com reboque" nem "Leva:"; "Veículo do cliente" continua', async ({ page }) => {
  await abrir(page)
  const lista = page.getByRole('list', { name: 'Categorias' })
  await expect(lista).not.toContainText('Com reboque')
  await expect(lista).not.toContainText('Leva:')
  await expect(cartao(page, 'IVO Motorista').getByRole('list', { name: 'Marcações' })).toContainText('Veículo do cliente')
  await expect(cartao(page, 'IVO Carga Leve').getByRole('list', { name: 'Marcações' })).toHaveCount(0)
})

test('abre só para ver: nenhum campo editável e só os valores maiores que zero', async ({ page }) => {
  await abrir(page)
  await expect(page.locator('main input')).toHaveCount(0)
  await expect(cartao(page, 'IVO Carga Leve').getByTestId('valores')).toHaveText(
    'Km R$ 4,80 · Reboque R$ 100,00 · Diária R$ 400,00',
  )
  await expect(cartao(page, 'IVO Passageiros').getByTestId('valores')).toHaveText('Km R$ 3,50 · Retorno 50%')
  await expect(cartao(page, 'IVO Motorista').getByTestId('valores')).toHaveText('Hora R$ 90,00')
  await expect(page.getByRole('button', { name: 'Editar IVO Carga Leve', exact: true })).toBeVisible()
})

test('o lápis abre os campos daquele cartão; Cancelar volta aos valores publicados', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Carga Leve')
  const leve = cartao(page, 'IVO Carga Leve')
  // O foco vai ao primeiro campo do cartão aberto.
  await expect(leve.getByLabel('Nome', { exact: true })).toBeFocused()
  await expect(leve.getByRole('group', { name: 'Tabela de preço de IVO Carga Leve' })).toBeVisible()
  const km = leve.getByLabel('Por km', { exact: true })
  await expect(km).toHaveValue('4,80')
  await expect(leve.getByLabel('Reboque', { exact: true })).toHaveValue('100,00')
  // Só aquele cartão.
  await expect(cartao(page, 'IVO Passageiros').locator('input')).toHaveCount(0)
  await expect(leve.getByRole('button', { name: 'Editar IVO Carga Leve' })).toHaveCount(0)

  await km.fill('5,20')
  await leve.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(leve.locator('input')).toHaveCount(0)
  // Cancelar devolve o foco ao lápis.
  await expect(page.getByRole('button', { name: 'Editar IVO Carga Leve', exact: true })).toBeFocused()
  await expect(leve.getByTestId('valores')).toContainText('Km R$ 4,80')
  await editar(page, 'IVO Carga Leve')
  await expect(leve.getByLabel('Por km', { exact: true })).toHaveValue('4,80')
})

test('dois cartões em edição ao mesmo tempo', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Carga Leve')
  await editar(page, 'IVO Passageiros')
  await expect(cartao(page, 'IVO Carga Leve').getByLabel('Por km', { exact: true })).toBeVisible()
  await expect(cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true })).toBeVisible()
})

test('"Publicar tabela" só se ativa com diferença real; a revisão continua igual', async ({ page }) => {
  const chamadas = await abrir(page)
  const publicar = page.getByRole('button', { name: 'Publicar tabela' })
  await expect(publicar).toBeDisabled()
  await editar(page, 'IVO Passageiros')
  await expect(publicar).toBeDisabled()
  const km = cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true })
  // Mesmo valor escrito de outro jeito não é diferença.
  await km.fill('3,5')
  await expect(publicar).toBeDisabled()
  await km.fill('3,80')
  await expect(publicar).toBeEnabled()
  await km.fill('3,50')
  await expect(publicar).toBeDisabled()
  await km.fill('3,80')

  await publicar.click()
  const folha = page.getByRole('dialog', { name: /Publicar tabela/ })
  const revisao = folha.getByTestId('revisao-tabela')
  await expect(revisao).toContainText('Por km: R$ 3,50 → R$ 3,80')
  await expect(revisao.locator(':scope > li').filter({ hasText: 'IVO Carga Leve' })).toContainText('Nada muda.')
  await expect(revisao).not.toContainText('IVO Carga Pesada')
  await folha.getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(page.getByText(/Tabela publicada: versão 4/)).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'publicar_tarifas')!.corpo.p_tarifas).toEqual({
    PASSAGEIROS: { ...PASSAGEIROS, km_cent: 380 },
    CARGA_LEVE: LEVE,
    MOTORISTA,
    VAN: { ...ZERO, km_cent: 500 },
  })
  // Publicado: os cartões voltam ao modo de ver.
  await expect(page.locator('main input')).toHaveCount(0)
})

test('"Excluir" só na categoria que pode ser excluída, com confirmação, chamando excluir_categoria', async ({ page }) => {
  const semVan = CATEGORIAS.filter((c) => c.codigo !== 'VAN')
  const chamadas = await abrir(page, { categorias: [CATEGORIAS, semVan] })
  await editar(page, 'IVO Passageiros')
  const passageiros = cartao(page, 'IVO Passageiros')
  await expect(passageiros.getByRole('button', { name: 'Excluir' })).toHaveCount(0)
  await expect(passageiros.getByRole('button', { name: 'Desativar' })).toBeVisible()

  await editar(page, 'IVO Van')
  const van = cartao(page, 'IVO Van')
  await expect(van.getByRole('button', { name: 'Desativar' })).toHaveCount(0)
  await van.getByRole('button', { name: 'Excluir', exact: true }).click()
  const folha = page.getByRole('dialog', { name: 'Excluir IVO Van?' })
  await expect(folha).toBeVisible()
  expect(chamadas.filter((c) => c.rpc === 'excluir_categoria')).toHaveLength(0)
  await folha.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(page.getByText('IVO Van excluída.')).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'excluir_categoria')!.corpo).toEqual({ p_codigo: 'VAN' })
  await expect(cartao(page, 'IVO Van')).toHaveCount(0)
  // O cartão que tinha o foco sumiu: o foco vai ao vizinho da lista.
  await expect(page.getByRole('button', { name: 'Editar IVO Motorista', exact: true })).toBeFocused()
})

test('excluir uma categoria já usada mostra CATEGORIA_EM_USO, relê a lista e passa a oferecer Desativar', async ({
  page,
}) => {
  const usada = CATEGORIAS.map((c) => (c.codigo === 'VAN' ? { ...c, pode_excluir: false } : c))
  const chamadas = await abrir(page, { excluir: { ok: false, codigo: 'CATEGORIA_EM_USO' }, categorias: [CATEGORIAS, usada] })
  await editar(page, 'IVO Van')
  await cartao(page, 'IVO Van').getByRole('button', { name: 'Excluir', exact: true }).click()
  const folha = page.getByRole('dialog', { name: 'Excluir IVO Van?' })
  await folha.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(folha.getByText('Esta categoria já foi usada e não pode ser excluída. Use Desativar.')).toBeVisible()
  await expect.poll(() => chamadas.filter((c) => c.rpc === 'categorias_adm').length).toBe(2)
  await folha.getByRole('button', { name: 'Voltar' }).click()
  const van = cartao(page, 'IVO Van')
  await expect(van.getByRole('button', { name: 'Desativar', exact: true })).toBeVisible()
  await expect(van.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0)
})

test('"Desativar" pede confirmação e salva a categoria inativa', async ({ page }) => {
  const desativada = CATEGORIAS.map((c) => (c.codigo === 'PASSAGEIROS' ? { ...c, ativa: false } : c))
  const chamadas = await abrir(page, { categorias: [CATEGORIAS, desativada] })
  await editar(page, 'IVO Passageiros')
  await cartao(page, 'IVO Passageiros').getByRole('button', { name: 'Desativar', exact: true }).click()
  const folha = page.getByRole('dialog', { name: 'Desativar IVO Passageiros?' })
  expect(chamadas.filter((c) => c.rpc === 'salvar_categoria')).toHaveLength(0)
  await folha.getByRole('button', { name: 'Desativar', exact: true }).click()
  await expect(page.getByText('IVO Passageiros desativada.')).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'salvar_categoria')!.corpo).toEqual({
    p: { codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'descrição de IVO Passageiros', ordem: 1, ativa: false },
  })
  await expect(page.getByRole('button', { name: 'Inativas (2)' })).toBeVisible()
})

test('as inativas ficam recolhidas em "Inativas (N)", com "Reativar" no lápis', async ({ page }) => {
  const reativada = CATEGORIAS.map((c) => (c.codigo === 'CARGA_PESADA' ? { ...c, ativa: true } : c))
  const chamadas = await abrir(page, { categorias: [CATEGORIAS, reativada] })
  const botao = page.getByRole('button', { name: 'Inativas (1)' })
  await expect(botao).toHaveAttribute('aria-expanded', 'false')
  await expect(cartao(page, 'IVO Carga Pesada')).toHaveCount(0)
  await botao.click()
  await expect(botao).toHaveAttribute('aria-expanded', 'true')
  const pesada = cartao(page, 'IVO Carga Pesada')
  await expect(pesada.getByRole('list', { name: 'Marcações' })).toContainText('Inativa')
  await expect(pesada.getByRole('button', { name: 'Reativar' })).toHaveCount(0)
  await editar(page, 'IVO Carga Pesada')
  await pesada.getByRole('button', { name: 'Reativar', exact: true }).click()
  await expect(page.getByText('IVO Carga Pesada reativada.')).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'salvar_categoria')!.corpo).toEqual({
    p: { codigo: 'CARGA_PESADA', nome: 'IVO Carga Pesada', descricao_curta: 'descrição de IVO Carga Pesada', ordem: 5, ativa: true },
  })
  await expect(page.getByRole('button', { name: /^Inativas/ })).toHaveCount(0)
})

test('sair com rascunho pede confirmação', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  await cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true }).fill('3,80')
  await page.getByRole('link', { name: 'Início' }).click()
  const folha = page.getByRole('dialog', { name: 'Sair sem publicar?' })
  await expect(folha).toBeVisible()
  await folha.getByRole('button', { name: 'Continuar editando' }).click()
  await expect(folha).toHaveCount(0)
  await expect(page).toHaveURL(/\/adm\/categorias$/)
  await expect(cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true })).toHaveValue('3,80')

  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('dialog', { name: 'Sair sem publicar?' }).getByRole('button', { name: 'Descartar e sair' }).click()
  await expect(page).not.toHaveURL(/\/adm\/categorias$/)
})

test('o nome mudado e não salvo também conta como rascunho', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  await cartao(page, 'IVO Passageiros').getByLabel('Nome', { exact: true }).fill('IVO Passageiros VIP')
  await page.getByRole('link', { name: 'Início' }).click()
  await expect(page.getByRole('dialog', { name: 'Sair sem publicar?' })).toBeVisible()
})

test('trocar de contrato com rascunho pergunta', async ({ page }) => {
  await abrir(page, { contratos: [linhaContrato(EMPRESA_UMI, versaoFalsa(2))] })
  await editar(page, 'IVO Passageiros')
  await cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true }).fill('3,80')
  await page.getByRole('combobox', { name: 'Contrato', exact: true }).selectOption({ label: 'Umi San' })
  const folha = page.getByRole('dialog', { name: 'Trocar de contrato sem publicar?' })
  await folha.getByRole('button', { name: 'Continuar editando' }).click()
  await expect(cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true })).toHaveValue('3,80')
})

test('publicar mantém aberto o cartão com nome ainda não salvo', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  await editar(page, 'IVO Motorista')
  await cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true }).fill('3,80')
  await cartao(page, 'IVO Motorista').getByLabel('Nome', { exact: true }).fill('IVO Motorista Plus')
  await page.getByRole('button', { name: 'Publicar tabela' }).click()
  await page.getByRole('dialog', { name: /Publicar tabela/ }).getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(page.getByText(/Tabela publicada: versão 4/)).toBeVisible()
  await expect(cartao(page, 'IVO Passageiros').locator('input')).toHaveCount(0)
  await expect(cartao(page, 'IVO Motorista').getByLabel('Nome', { exact: true })).toHaveValue('IVO Motorista Plus')
})

test('nome inválido leva o foco ao campo', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  const nome = cartao(page, 'IVO Passageiros').getByLabel('Nome', { exact: true })
  await nome.fill('X')
  await cartao(page, 'IVO Passageiros').getByLabel('Descrição', { exact: true }).focus()
  await cartao(page, 'IVO Passageiros').getByRole('button', { name: 'Salvar categoria' }).click()
  await expect(nome).toBeFocused()
})

test('sem rascunho, sai sem perguntar', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  await page.getByRole('link', { name: 'Início' }).click()
  await expect(page).not.toHaveURL(/\/adm\/categorias$/)
})

test('390 px sem rolagem lateral, no modo de ver e de editar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await abrir(page)
  const semRolagem = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(await semRolagem()).toBe(true)
  await editar(page, 'IVO Carga Leve')
  await page.getByRole('button', { name: 'Inativas (1)' }).click()
  await editar(page, 'IVO Carga Pesada')
  expect(await semRolagem()).toBe(true)
})

// v2.2 (especificação §5.6): "Até quantas pessoas" no lápis, salvo com o nome e a descrição em salvar_categoria.
test('v2.2: o cartão mostra "até N pessoas" só quando preenchido', async ({ page }) => {
  await abrir(page)
  await expect(cartao(page, 'IVO Passageiros').getByTestId('pessoas-max')).toHaveText('até 4 pessoas')
  await expect(cartao(page, 'IVO Carga Leve').getByTestId('pessoas-max')).toHaveCount(0)
})

test('v2.2: "Até quantas pessoas" vai em salvar_categoria; vazio tira o limite; fora de 1–99 não salva', async ({ page }) => {
  const com5 = CATEGORIAS.map((c) => (c.codigo === 'PASSAGEIROS' ? { ...c, pessoas_max: 5 } : c))
  const chamadas = await abrir(page, { categorias: [CATEGORIAS, com5] })
  await editar(page, 'IVO Passageiros')
  const passageiros = cartao(page, 'IVO Passageiros')
  const campo = passageiros.getByLabel('Até quantas pessoas', { exact: true })
  await expect(campo).toHaveValue('4')
  const salvar = passageiros.getByRole('button', { name: 'Salvar categoria' })
  await expect(salvar).toBeDisabled()

  await campo.fill('0')
  await salvar.click()
  await expect(campo).toHaveAttribute('aria-invalid', 'true')
  await expect(campo).toBeFocused()
  expect(chamadas.filter((c) => c.rpc === 'salvar_categoria')).toHaveLength(0)

  await campo.fill('5')
  await salvar.click()
  await expect(page.getByText('IVO Passageiros salva.')).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'salvar_categoria')!.corpo).toEqual({
    p: {
      codigo: 'PASSAGEIROS',
      nome: 'IVO Passageiros',
      descricao_curta: 'descrição de IVO Passageiros',
      ordem: 1,
      ativa: true,
      pessoas_max: 5,
    },
  })
  // Relida a lista, o campo mostra o valor salvo e continua editando.
  await expect(passageiros.getByLabel('Até quantas pessoas', { exact: true })).toHaveValue('5')

  await passageiros.getByLabel('Até quantas pessoas', { exact: true }).fill('')
  await passageiros.getByRole('button', { name: 'Salvar categoria' }).click()
  await expect.poll(() => chamadas.filter((c) => c.rpc === 'salvar_categoria').length).toBe(2)
  expect((chamadas.filter((c) => c.rpc === 'salvar_categoria')[1]!.corpo.p as Record<string, unknown>).pessoas_max).toBeNull()
})

test('v2.2: o limite de pessoas não salvo é rascunho; Cancelar volta ao publicado', async ({ page }) => {
  await abrir(page)
  await editar(page, 'IVO Passageiros')
  const passageiros = cartao(page, 'IVO Passageiros')
  await passageiros.getByLabel('Até quantas pessoas', { exact: true }).fill('6')
  await page.getByRole('link', { name: 'Início' }).click()
  const folha = page.getByRole('dialog', { name: 'Sair sem publicar?' })
  await expect(folha).toBeVisible()
  await folha.getByRole('button', { name: 'Continuar editando' }).click()
  await passageiros.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(passageiros.getByTestId('pessoas-max')).toHaveText('até 4 pessoas')
  await editar(page, 'IVO Passageiros')
  await expect(passageiros.getByLabel('Até quantas pessoas', { exact: true })).toHaveValue('4')
})

for (const tema of ['light', 'dark'] as const) {
  test(`ver e editar sem violações do axe (tema ${tema === 'light' ? 'claro' : 'escuro'})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' })
    await abrir(page)
    await page.getByRole('button', { name: 'Inativas (1)' }).click()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await editar(page, 'IVO Van')
    await editar(page, 'IVO Carga Pesada')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await cartao(page, 'IVO Van').getByRole('button', { name: 'Excluir', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Excluir IVO Van?' })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
}
