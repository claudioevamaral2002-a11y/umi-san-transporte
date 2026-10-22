// Fase 4 (Tarefa 11): veículos do motorista (mockups 8 e 9), "Corridas do mês" e as telas novas do ADM ("Categorias e
// preços" e "Veículos"). Roda no projeto Playwright `novo` (dist-novo). Nada muda na tela antes da resposta do servidor.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, versaoFalsa, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { itemLista, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const AAL2 = { aal: 'aal2' as const }
const V_HILUX = '00000000-0000-4000-8000-0000000000c1'
const V_SPRINTER = '00000000-0000-4000-8000-0000000000c3'

const veiculo = (id: string, modelo: string, cor: string, placa: string, categorias: string[], situacao = 'ATIVO') => ({
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
  criado_em: '2026-10-01T12:00:00Z',
  motorista_nome: 'Ivo Barbosa',
})

const HILUX = veiculo(V_HILUX, 'Hilux', 'branca', 'ABC1D23', ['PASSAGEIROS', 'CARGA_LEVE'])
const SPRINTER = veiculo(V_SPRINTER, 'Sprinter', 'prata', 'XYZ9K87', ['PASSAGEIROS'], 'MANUTENCAO')

const CATEGORIAS = [
  { codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'até 4 pessoas', ordem: 1, ativa: true },
  { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', ordem: 2, ativa: true },
  { codigo: 'CARGA_PESADA', nome: 'IVO Carga Pesada', descricao_curta: 'com reboque', ordem: 3, ativa: false },
]

/** RPCs das telas novas: as respostas de escrita na ordem; leituras fixas (ou a lista de veículos por rodada). */
async function simularTelasNovas(
  page: Page,
  opcoes: { veiculos?: unknown[][]; salvar?: unknown[]; situacao?: unknown[] } = {},
) {
  const chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }> = []
  const listas = [...(opcoes.veiculos ?? [[HILUX, SPRINTER]])]
  const respostas: Record<string, unknown[]> = {
    salvar_veiculo: [...(opcoes.salvar ?? [])],
    mudar_situacao_veiculo: [...(opcoes.situacao ?? [])],
  }
  const rota = (nome: string, responder: (c: Record<string, unknown>) => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      const corpo = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
      chamadas.push({ rpc: nome, corpo })
      return json(route, responder(corpo))
    })
  await rota('meus_veiculos', () => ({ ok: true, veiculos: listas.length > 1 ? listas.shift() : listas[0] }))
  for (const nome of ['salvar_veiculo', 'mudar_situacao_veiculo']) {
    await rota(nome, () => respostas[nome]!.shift() ?? { ok: true, id: V_HILUX })
  }
  await rota('categorias_adm', (c) => ({
    ok: true,
    categorias: CATEGORIAS,
    precos: c.p_versao === 3 ? { PASSAGEIROS: { km_cent: 300, taxa_fixa_cent: 0 }, CARGA_LEVE: { km_cent: 400, taxa_fixa_cent: 0 }, CARGA_PESADA: { km_cent: 600, taxa_fixa_cent: 15000 } } : null,
  }))
  await rota('salvar_categoria', () => ({ ok: true }))
  await rota('publicar_contrato_categorias', () => ({ ok: true, versao: 4 }))
  return chamadas
}

async function abrir(page: Page, perfil: PerfilFalso, caminho: string, aal = true) {
  await comSessaoFalsa(page, perfil, aal ? AAL2 : {})
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  const api = await simularApi(page, { vigente: [versaoFalsa(3)] })
  await simularPedidos(page)
  const novas = await simularTelasNovas(page)
  await page.goto(caminho)
  return { api, novas }
}

test('Meus veículos: cartões com placa, situação e as categorias como etiquetas (mockup 8)', async ({ page }) => {
  await abrir(page, MOTORISTA, '/veiculos')
  await expect(page.getByRole('heading', { name: 'Meus veículos' })).toBeVisible()
  const lista = page.getByRole('list', { name: 'Veículos' })
  await expect(lista.getByRole('listitem').filter({ hasText: 'ABC1D23' }).first()).toContainText('Ativo · 4 lugares · 800 kg')
  const hilux = lista.locator(':scope > li').filter({ hasText: 'ABC1D23' })
  await expect(hilux.getByRole('list', { name: 'Categorias que atende' })).toHaveText(/Passageiros\s*Carga Leve/)
  const sprinter = lista.locator(':scope > li').filter({ hasText: 'XYZ9K87' })
  await expect(sprinter).toContainText('Em manutenção, o veículo não aparece na chamada.')
  await expect(page.getByRole('link', { name: 'Cadastrar veículo' })).toHaveAttribute('href', '/veiculos/novo')
})

test('cadastrar com a placa "abc-1d23" envia "ABC1D23" e as categorias marcadas', async ({ page }) => {
  const { novas } = await abrir(page, MOTORISTA, '/veiculos/novo')
  await expect(page.getByRole('heading', { name: 'Novo veículo' })).toBeVisible()
  await page.getByLabel('Modelo').fill('Toyota Hilux')
  await page.getByLabel('Cor').fill('Branca')
  await page.getByLabel('Placa').fill('abc-1d23')
  await page.getByLabel('Lugares').fill('4')
  await page.getByLabel('Carga máx.').fill('800')
  // Sem categoria marcada: o formulário não envia.
  await page.getByRole('button', { name: 'Salvar veículo' }).click()
  await expect(page.getByText('Marque pelo menos uma categoria.')).toBeVisible()
  expect(novas.filter((c) => c.rpc === 'salvar_veiculo')).toHaveLength(0)

  await page.getByRole('checkbox', { name: 'Carga Leve' }).check()
  await page.getByRole('checkbox', { name: 'Passageiros' }).check()
  await page.getByRole('button', { name: 'Salvar veículo' }).click()
  await expect(page).toHaveURL(/\/veiculos$/)
  await expect(page.getByText('Toyota Hilux ABC1D23 salvo.')).toBeVisible()
  const envio = novas.find((c) => c.rpc === 'salvar_veiculo')!
  expect(envio.corpo).toEqual({
    p: {
      modelo: 'Toyota Hilux',
      cor: 'Branca',
      placa: 'ABC1D23',
      lugares: 4,
      carga_max_kg: 800,
      reboque_desc: null,
      categorias: ['PASSAGEIROS', 'CARGA_LEVE'],
    },
  })
})

test('PLACA_DUPLICADA mostra a mensagem no campo da placa e fica no formulário', async ({ page }) => {
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  await simularPedidos(page)
  await simularTelasNovas(page, { salvar: [{ ok: false, codigo: 'PLACA_DUPLICADA' }] })
  await page.goto('/veiculos/novo')
  await page.getByLabel('Modelo').fill('Hilux')
  await page.getByLabel('Cor').fill('Branca')
  await page.getByLabel('Placa').fill('ABC1D23')
  await page.getByLabel('Lugares').fill('4')
  await page.getByLabel('Carga máx.').fill('800')
  await page.getByRole('checkbox', { name: 'Passageiros' }).check()
  await page.getByRole('button', { name: 'Salvar veículo' }).click()
  await expect(page.getByText('Já existe um veículo com esta placa.')).toBeVisible()
  await expect(page.getByLabel('Placa')).toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/\/veiculos\/novo$/)
})

test('"Em manutenção" chama mudar_situacao_veiculo e a situação só muda com a resposta do servidor', async ({ page }) => {
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  await simularPedidos(page)
  const novas = await simularTelasNovas(page, { veiculos: [[HILUX], [{ ...HILUX, situacao: 'MANUTENCAO' }]] })
  // Resposta lenta: até ela chegar, a Hilux continua "Ativo".
  let liberar: () => void = () => {}
  const segura = new Promise<void>((r) => (liberar = r))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/mudar_situacao_veiculo`, async (route) => {
    novas.push({ rpc: 'mudar_situacao_veiculo', corpo: route.request().postDataJSON() as Record<string, unknown> })
    await segura
    await json(route, { ok: true })
  })
  await page.goto('/veiculos')
  const grupo = page.getByRole('radiogroup', { name: 'Situação de Hilux ABC1D23' })
  await expect(grupo.getByRole('radio', { name: 'Ativo', exact: true })).toHaveAttribute('aria-checked', 'true')
  await grupo.getByRole('radio', { name: 'Em manutenção' }).click()
  await expect.poll(() => novas.filter((c) => c.rpc === 'mudar_situacao_veiculo').length).toBe(1)
  expect(novas.find((c) => c.rpc === 'mudar_situacao_veiculo')!.corpo).toEqual({ p_id: V_HILUX, p_situacao: 'MANUTENCAO' })
  await expect(grupo.getByRole('radio', { name: 'Ativo', exact: true })).toHaveAttribute('aria-checked', 'true')
  liberar()
  await expect(grupo.getByRole('radio', { name: 'Em manutenção' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Hilux ABC1D23: em manutenção.')).toBeVisible()
})

test('Corridas do mês: quantas e o total cobrado, por mês, das concluídas', async ({ page }) => {
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  const agora = new Date()
  const esteMes = new Date(agora.getFullYear(), agora.getMonth(), 10, 12).toISOString()
  const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 10, 12).toISOString()
  const chamadas = await simularPedidos(page, {
    lista: [
      itemLista({ id: 'a', status: 'CONCLUIDA', inicio: esteMes, total_cent: 18000 }),
      itemLista({ id: 'b', status: 'CONCLUIDA', inicio: esteMes, total_cent: 22050 }),
      itemLista({ id: 'c', status: 'CONCLUIDA', inicio: mesPassado, total_cent: 10000 }),
    ],
  })
  await page.goto('/corridas-do-mes')
  await expect(page.getByRole('heading', { name: 'Corridas do mês' })).toBeVisible()
  const atual = page.getByTestId('mes-atual')
  await expect(atual).toContainText('R$ 400,50')
  await expect(atual).toContainText('2 corridas')
  await expect(page.getByRole('region', { name: 'Meses anteriores' })).toContainText('R$ 100,00')
  await expect(page.getByText('Não é o repasse ao motorista.')).toBeVisible()
  const leitura = chamadas.find((c) => c.rpc === 'meus_pedidos')!
  expect(leitura.corpo).toEqual({ p_filtro: { status: ['CONCLUIDA'], limite: 500 } })
})

test('o ADM publica categorias com km "5,00": p_categorias.CARGA_LEVE.km_cent = 500, só pela RPC nova', async ({ page }) => {
  const { api, novas } = await abrir(page, ADM, '/adm/categorias')
  await expect(page.getByRole('heading', { name: 'Categorias e preços' })).toBeVisible()
  // Lista as categorias (nome, descrição, ativa), também a inativa.
  const pesada = page.getByRole('form', { name: 'IVO Carga Pesada' })
  await expect(pesada.getByRole('switch', { name: 'IVO Carga Pesada ativa' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('form', { name: 'IVO Carga Leve' }).getByLabel('Descrição')).toHaveValue('até 800 kg')
  // Tabela modelo v3 com preço por categoria; a taxa fixa só na Carga Pesada.
  await expect(page.getByRole('row', { name: /IVO Carga Leve/ })).toContainText('R$ 4,00')
  await expect(page.getByRole('row', { name: /IVO Passageiros/ })).toContainText('Não se aplica')
  await expect(page.getByText('A taxa fixa só vale para a Carga Pesada (com reboque).').first()).toBeVisible()

  await page.getByRole('button', { name: 'Publicar nova versão' }).click()
  const folha = page.getByRole('dialog', { name: /Publicar nova versão/ })
  await expect(folha.getByLabel('IVO Passageiros: quilômetro')).toHaveValue('3,00')
  await expect(folha.getByLabel('IVO Passageiros: taxa fixa')).toHaveCount(0)
  await expect(folha.getByLabel('IVO Carga Pesada: taxa fixa')).toHaveValue('150,00')
  await folha.getByLabel('IVO Carga Leve: quilômetro').fill('5,00')
  await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
  await expect(folha.getByTestId('confirmacao-contrato')).toContainText('IVO Carga Leve: quilômetro')
  await folha.getByRole('button', { name: 'Publicar versão' }).click()
  await expect(page.getByText(/Versão 4 publicada/)).toBeVisible()

  const envio = novas.find((c) => c.rpc === 'publicar_contrato_categorias')!
  expect(envio.corpo.p_empresa).toBeNull()
  expect(envio.corpo.p_categorias).toEqual({
    PASSAGEIROS: { km_cent: 300, taxa_fixa_cent: 0 },
    CARGA_LEVE: { km_cent: 500, taxa_fixa_cent: 0 },
    CARGA_PESADA: { km_cent: 600, taxa_fixa_cent: 15000 },
  })
  expect((envio.corpo.p as Record<string, unknown>).km_sem_reboque_cent).toBe(350)
  expect(api.filter((c) => c.rpc === 'publicar_contrato')).toHaveLength(0)
})

test('na tela Contratos de hoje, dentro do app novo, a versão nova também sai com o preço por categoria', async ({ page }) => {
  const { api, novas } = await abrir(page, ADM, '/adm/contratos/modelo')
  await page.getByRole('button', { name: 'Publicar nova versão' }).click()
  const folha = page.getByRole('dialog', { name: /Publicar nova versão/ })
  // Partida: a tabela modelo v3, com o preço de cada categoria dela.
  await expect(folha.getByLabel('IVO Carga Leve: quilômetro')).toHaveValue('4,00')
  await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
  await folha.getByRole('button', { name: 'Publicar versão' }).click()
  await expect(page.getByText(/Versão 4 publicada/)).toBeVisible()
  expect(novas.find((c) => c.rpc === 'publicar_contrato_categorias')!.corpo.p_categorias).toEqual({
    PASSAGEIROS: { km_cent: 300, taxa_fixa_cent: 0 },
    CARGA_LEVE: { km_cent: 400, taxa_fixa_cent: 0 },
    CARGA_PESADA: { km_cent: 600, taxa_fixa_cent: 15000 },
  })
  expect(api.filter((c) => c.rpc === 'publicar_contrato')).toHaveLength(0)
})

test('o ADM desativa uma categoria pelo salvar_categoria', async ({ page }) => {
  const { novas } = await abrir(page, ADM, '/adm/categorias')
  const leve = page.getByRole('form', { name: 'IVO Carga Leve' })
  await leve.getByRole('switch', { name: 'IVO Carga Leve ativa' }).click()
  await leve.getByRole('button', { name: 'Salvar categoria' }).click()
  await expect(page.getByText('IVO Carga Leve salva.')).toBeVisible()
  expect(novas.find((c) => c.rpc === 'salvar_categoria')!.corpo).toEqual({
    p: { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', ordem: 2, ativa: false },
  })
})

test('Veículos do ADM: todos, com o motorista; cadastrar pede o motorista', async ({ page }) => {
  const { novas } = await abrir(page, ADM, '/adm/veiculos')
  await expect(page.getByRole('heading', { name: 'Veículos', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Veículos' })).toContainText('Motorista: Ivo Barbosa')
  await page.getByRole('link', { name: 'Cadastrar veículo' }).click()
  await expect(page).toHaveURL(/\/adm\/veiculos\/novo$/)
  await page.getByLabel('Modelo').fill('Strada')
  await page.getByLabel('Cor').fill('Vermelha')
  await page.getByLabel('Placa').fill('STR1A22')
  await page.getByLabel('Lugares').fill('2')
  await page.getByLabel('Carga máx.').fill('650')
  await page.getByRole('checkbox', { name: 'Carga Leve' }).check()
  await page.getByRole('button', { name: 'Salvar veículo' }).click()
  await expect(page.getByText('Escolha o motorista.')).toBeVisible()
  await page.getByLabel('Motorista').selectOption({ label: 'Bruno Lima' })
  await page.getByRole('button', { name: 'Salvar veículo' }).click()
  await expect(page).toHaveURL(/\/adm\/veiculos$/)
  expect(novas.find((c) => c.rpc === 'salvar_veiculo')!.corpo.p).toMatchObject({
    motorista_id: '00000000-0000-4000-8000-000000000002',
    placa: 'STR1A22',
    categorias: ['CARGA_LEVE'],
  })
})

test('o N1 não acessa /adm/categorias', async ({ page }) => {
  await abrir(page, N1, '/adm/categorias', false)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Categorias e preços' })).toHaveCount(0)
})

test('o motorista não abre /adm/veiculos', async ({ page }) => {
  await abrir(page, MOTORISTA, '/adm/veiculos')
  await expect(page).toHaveURL(/\/$/)
})

test('o cliente não abre Meus veículos', async ({ page }) => {
  await abrir(page, N1, '/veiculos', false)
  await expect(page).toHaveURL(/\/$/)
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('veículos, cadastro, corridas do mês e categorias sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, MOTORISTA, '/veiculos')
      await expect(page.getByRole('list', { name: 'Veículos' })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.goto('/veiculos/novo')
      await page.getByRole('checkbox', { name: 'Passageiros' }).check()
      await page.getByRole('button', { name: 'Salvar veículo' }).click()
      await expect(page.getByText('Informe o modelo (até 60 caracteres).')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.goto('/corridas-do-mes')
      await expect(page.getByRole('heading', { name: 'Corridas do mês' })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })

    test('Categorias e preços sem violações do axe', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, ADM, '/adm/categorias')
      await expect(page.getByRole('row', { name: /IVO Carga Leve/ })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  })
}
