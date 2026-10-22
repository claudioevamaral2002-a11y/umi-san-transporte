// Fase 4.1 (Tarefa 5): "Categorias e preços" do Master (mockup 5) com a tabela de cada categoria (8 campos, zerado =
// não cobra), "+ Nova categoria", "Publicar tabela" com a revisão do que muda, e o cadastro de veículo com os nomes
// das categorias vindos do banco. Roda no projeto Playwright `novo` (dist-novo). Nada muda antes da resposta.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, versaoFalsa } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
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
// Primeira abertura: nenhuma tarifa publicada; os valores são os preços de hoje (inicial: true).
const INI_PASSAGEIROS = { ...ZERO, km_cent: 350, hora_espera_cent: 5000, retorno_bp: 5000, hospedagem_diaria_cent: 18000 }
const INI_LEVE = { ...INI_PASSAGEIROS, reboque_cent: 15000 }
const INI_MOTORISTA = { ...ZERO, hospedagem_diaria_cent: 18000 }

const cat = (codigo: string, nome: string, ordem: number, extra: Record<string, unknown>) => ({
  codigo,
  nome,
  descricao_curta: `descrição de ${nome}`,
  ordem,
  ativa: true,
  carga: 'PESSOAS',
  reboque: 'NAO',
  veiculo_cliente: false,
  ...extra,
})

const CATEGORIAS = [
  cat('PASSAGEIROS', 'IVO Passageiros', 1, { tarifa: { ...INI_PASSAGEIROS, inicial: true } }),
  cat('CARGA_LEVE', 'IVO Carga Leve', 2, { carga: 'AMBOS', reboque: 'SIM', tarifa: { ...INI_LEVE, inicial: true } }),
  cat('MOTORISTA', 'IVO Motorista', 3, { veiculo_cliente: true, tarifa: { ...INI_MOTORISTA, inicial: true } }),
  cat('CARGA_PESADA', 'IVO Carga Pesada', 4, { ativa: false, reboque: 'SIM', tarifa: { ...INI_LEVE, inicial: true } }),
]

interface Chamada {
  rpc: string
  corpo: Record<string, unknown>
}

async function abrir(
  page: Page,
  perfil: PerfilFalso,
  caminho: string,
  opcoes: { categorias?: unknown[][]; publicar?: unknown; aal?: boolean } = {},
) {
  await comSessaoFalsa(page, perfil, opcoes.aal === false ? {} : AAL2)
  await simularMapas(page)
  await simularApi(page, { vigente: [versaoFalsa(3)] })
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
  await rota('categorias_veiculo', () => ({ ok: true, categorias: proxima() }))
  await rota('salvar_categoria', () => ({ ok: true, codigo: 'VAN_EXECUTIVA' }))
  await rota('publicar_tarifas', () => opcoes.publicar ?? { ok: true, versao: 4 })
  await rota('meus_veiculos', () => ({ ok: true, veiculos: [] }))
  await page.goto(caminho)
  return chamadas
}

const cartao = (page: Page, nome: string) => page.getByRole('region', { name: nome, exact: true })
const CAMPOS = ['Taxa fixa', 'Por km', 'Por hora', 'Hora de espera', 'Por parada', 'Retorno', 'Diária de hospedagem']

test('cada categoria em cartão com a tabela; Reboque só na categoria com reboque; a primeira abertura vem preenchida', async ({
  page,
}) => {
  await abrir(page, ADM, '/adm/categorias')
  await expect(page.getByRole('heading', { level: 1, name: 'Categorias e preços' })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Nova categoria' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publicar tabela' })).toBeVisible()

  for (const nome of ['IVO Passageiros', 'IVO Carga Leve', 'IVO Motorista', 'IVO Carga Pesada']) {
    const c = cartao(page, nome)
    for (const campo of CAMPOS) await expect(c.getByLabel(campo, { exact: true })).toBeVisible()
    await expect(c.getByText('Deixe zerado se não cobra.').first()).toBeVisible()
  }
  await expect(cartao(page, 'IVO Carga Leve').getByLabel('Reboque', { exact: true })).toBeVisible()
  await expect(cartao(page, 'IVO Passageiros').getByLabel('Reboque', { exact: true })).toHaveCount(0)
  await expect(cartao(page, 'IVO Motorista').getByLabel('Reboque', { exact: true })).toHaveCount(0)

  // Preenchida com os preços de hoje.
  const passageiros = cartao(page, 'IVO Passageiros')
  await expect(passageiros.getByLabel('Por km', { exact: true })).toHaveValue('3,50')
  await expect(passageiros.getByLabel('Retorno', { exact: true })).toHaveValue('50')
  await expect(passageiros.getByLabel('Por hora', { exact: true })).toHaveValue('0,00')
  await expect(cartao(page, 'IVO Carga Leve').getByLabel('Reboque', { exact: true })).toHaveValue('150,00')
  await expect(cartao(page, 'IVO Motorista').getByLabel('Diária de hospedagem', { exact: true })).toHaveValue('180,00')
  await expect(page.getByText(/preenchida com os preços de hoje/).first()).toBeVisible()
  // Veículo do cliente e inativa à vista no cartão.
  await expect(cartao(page, 'IVO Motorista').getByRole('list', { name: 'Marcações' })).toContainText('Veículo do cliente')
  await expect(cartao(page, 'IVO Carga Leve').getByRole('list', { name: 'Marcações' })).toContainText('Com reboque')
  await expect(cartao(page, 'IVO Carga Pesada').getByRole('switch', { name: 'IVO Carga Pesada ativa' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

test('"+ Nova categoria" abre um cartão em branco e salvar envia salvar_categoria sem código', async ({ page }) => {
  const nova = cat('VAN_EXECUTIVA', 'IVO Van Executiva', 5, { tarifa: { ...ZERO, km_cent: 350, inicial: true } })
  const chamadas = await abrir(page, ADM, '/adm/categorias', { categorias: [CATEGORIAS, [...CATEGORIAS, nova]] })
  await page.getByRole('button', { name: '+ Nova categoria' }).click()
  const form = page.getByRole('form', { name: 'Nova categoria' })
  await expect(form.getByLabel('Nome')).toHaveValue('')
  await expect(form.getByLabel('Nome')).toBeFocused()
  // Sem nome: não envia.
  await form.getByRole('button', { name: 'Criar categoria' }).click()
  await expect(form.getByText('De 2 a 40 caracteres.')).toBeVisible()
  expect(chamadas.filter((c) => c.rpc === 'salvar_categoria')).toHaveLength(0)

  await form.getByLabel('Nome').fill('  IVO Van Executiva ')
  await form.getByLabel('Descrição').fill('até 12 pessoas')
  await form.getByRole('button', { name: 'Criar categoria' }).click()
  await expect(page.getByText('IVO Van Executiva criada. Preencha a tabela e publique.')).toBeVisible()
  const envio = chamadas.find((c) => c.rpc === 'salvar_categoria')!
  expect(envio.corpo).toEqual({
    p: {
      nome: 'IVO Van Executiva',
      descricao_curta: 'até 12 pessoas',
      ordem: 5,
      ativa: true,
      veiculo_cliente: false,
      reboque: 'NAO',
      carga: 'PESSOAS',
    },
  })
  expect(envio.corpo.p).not.toHaveProperty('codigo')
  await expect(cartao(page, 'IVO Van Executiva')).toBeVisible()
  await expect(page.getByRole('form', { name: 'Nova categoria' })).toHaveCount(0)
})

test('editar nome e "ativa" chama salvar_categoria com o código', async ({ page }) => {
  const chamadas = await abrir(page, ADM, '/adm/categorias')
  const leve = cartao(page, 'IVO Carga Leve')
  await leve.getByLabel('Nome', { exact: true }).fill('IVO Carga Leve Plus')
  await leve.getByRole('switch', { name: 'IVO Carga Leve ativa' }).click()
  await leve.getByRole('button', { name: 'Salvar categoria' }).click()
  await expect(page.getByText('IVO Carga Leve Plus salva.')).toBeVisible()
  expect(chamadas.find((c) => c.rpc === 'salvar_categoria')!.corpo).toEqual({
    p: {
      codigo: 'CARGA_LEVE',
      nome: 'IVO Carga Leve Plus',
      descricao_curta: 'descrição de IVO Carga Leve',
      ordem: 2,
      ativa: false,
    },
  })
})

test('"Publicar tabela": a revisão mostra o que muda e publicar_tarifas leva TODAS as ativas', async ({ page }) => {
  const chamadas = await abrir(page, ADM, '/adm/categorias')
  await cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true }).fill('3,80')
  await cartao(page, 'IVO Motorista').getByLabel('Por hora', { exact: true }).fill('90,00')
  await page.getByRole('button', { name: 'Publicar tabela' }).click()

  const folha = page.getByRole('dialog', { name: /Publicar tabela/ })
  const revisao = folha.getByTestId('revisao-tabela')
  await expect(revisao).toContainText('IVO Passageiros')
  await expect(revisao).toContainText('Por km: R$ 3,50 → R$ 3,80')
  // A Carga Leve passa a cobrar o reboque (hoje não cobra): o aumento aparece.
  await expect(revisao).toContainText('Reboque: R$ 0,00 → R$ 150,00')
  // IVO Motorista é nova na tabela: o que passa a cobrar.
  await expect(revisao).toContainText('Por hora: — → R$ 90,00')
  // Inativa não entra.
  await expect(revisao).not.toContainText('IVO Carga Pesada')
  expect(chamadas.filter((c) => c.rpc === 'publicar_tarifas')).toHaveLength(0)

  await folha.getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(page.getByText(/Tabela publicada: versão 4/)).toBeVisible()
  const envio = chamadas.find((c) => c.rpc === 'publicar_tarifas')!
  expect(envio.corpo.p_empresa).toBeNull()
  expect(typeof envio.corpo.p_vigente_desde).toBe('string')
  expect(envio.corpo.p_tarifas).toEqual({
    PASSAGEIROS: { ...INI_PASSAGEIROS, km_cent: 380 },
    CARGA_LEVE: INI_LEVE,
    MOTORISTA: { ...INI_MOTORISTA, hora_cent: 9000 },
  })
})

test('valor ilegível fica no campo e não abre a revisão', async ({ page }) => {
  const chamadas = await abrir(page, ADM, '/adm/categorias')
  const campo = cartao(page, 'IVO Passageiros').getByLabel('Por km', { exact: true })
  await campo.fill('abc')
  await page.getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(campo).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('dialog', { name: /Publicar tabela/ })).toHaveCount(0)
  expect(chamadas.filter((c) => c.rpc === 'publicar_tarifas')).toHaveLength(0)
})

test('cobrar por hora em Passageiros avisa (sem bloquear) que o app antigo não manda as horas', async ({ page }) => {
  const chamadas = await abrir(page, ADM, '/adm/categorias')
  await cartao(page, 'IVO Passageiros').getByLabel('Por hora', { exact: true }).fill('50,00')
  await page.getByRole('button', { name: 'Publicar tabela' }).click()
  const folha = page.getByRole('dialog', { name: /Publicar tabela/ })
  await expect(folha.getByText(/IVO Passageiros passa a cobrar por hora/)).toBeVisible()
  await folha.getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(page.getByText(/Tabela publicada: versão 4/)).toBeVisible()
  expect((chamadas.find((c) => c.rpc === 'publicar_tarifas')!.corpo.p_tarifas as Record<string, { hora_cent: number }>).PASSAGEIROS!.hora_cent).toBe(5000)
})

test('erro do servidor ao publicar fica na revisão', async ({ page }) => {
  await abrir(page, ADM, '/adm/categorias', { publicar: { ok: false, codigo: 'VIGENCIA_NO_PASSADO' } })
  await page.getByRole('button', { name: 'Publicar tabela' }).click()
  const folha = page.getByRole('dialog', { name: /Publicar tabela/ })
  await folha.getByRole('button', { name: 'Publicar tabela' }).click()
  await expect(folha.getByText('A vigência precisa começar agora ou no futuro.')).toBeVisible()
})

test('cadastro de veículo: nomes do banco, sem a de veículo do cliente nem as inativas', async ({ page }) => {
  const renomeadas = CATEGORIAS.map((c) => (c.codigo === 'PASSAGEIROS' ? { ...c, nome: 'IVO Passageiros VIP' } : c))
  const chamadas = await abrir(page, MOTORISTA, '/veiculos/novo', { categorias: [renomeadas] })
  const grupo = page.getByRole('group', { name: 'Atende quais categorias?' })
  await expect(grupo.getByRole('checkbox')).toHaveCount(2)
  await expect(grupo.getByRole('checkbox', { name: 'IVO Passageiros VIP', exact: true })).toBeVisible()
  await expect(grupo.getByRole('checkbox', { name: 'IVO Carga Leve', exact: true })).toBeVisible()
  await expect(grupo.getByText('IVO Motorista')).toHaveCount(0)
  await expect(grupo.getByText('IVO Carga Pesada')).toHaveCount(0)
  expect(chamadas.some((c) => c.rpc === 'categorias_veiculo')).toBe(true)
  // O motorista não lê a tela do Master.
  expect(chamadas.some((c) => c.rpc === 'categorias_adm')).toBe(false)
})

test('Meus veículos: as etiquetas usam os nomes do banco', async ({ page }) => {
  await comSessaoFalsa(page, MOTORISTA, AAL2)
  await simularApi(page)
  await simularPedidos(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_veiculo`, (r) =>
    json(r, { ok: true, categorias: CATEGORIAS.map((c) => (c.codigo === 'CARGA_LEVE' ? { ...c, nome: 'IVO Leve' } : c)) }),
  )
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meus_veiculos`, (r) =>
    json(r, {
      ok: true,
      veiculos: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          motorista_id: '00000000-0000-4000-8000-000000000001',
          modelo: 'Hilux',
          cor: 'branca',
          placa: 'ABC1D23',
          lugares: 4,
          carga_max_kg: 800,
          reboque_desc: null,
          categorias: ['PASSAGEIROS', 'CARGA_LEVE'],
          situacao: 'ATIVO',
          criado_em: '2026-10-01T12:00:00Z',
        },
      ],
    }),
  )
  await page.goto('/veiculos')
  await expect(page.getByRole('list', { name: 'Categorias que atende' })).toHaveText(/IVO Passageiros\s*IVO Leve/)
})

test('o N1 não acessa /adm/categorias', async ({ page }) => {
  await abrir(page, N1, '/adm/categorias', { aal: false })
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Categorias e preços' })).toHaveCount(0)
})

for (const tema of ['light', 'dark'] as const) {
  test(`Categorias e preços sem violações do axe (tema ${tema === 'light' ? 'claro' : 'escuro'}), com a revisão aberta`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' })
    await abrir(page, ADM, '/adm/categorias')
    await expect(cartao(page, 'IVO Passageiros')).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Publicar tabela' }).click()
    await expect(page.getByTestId('revisao-tabela')).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
}
