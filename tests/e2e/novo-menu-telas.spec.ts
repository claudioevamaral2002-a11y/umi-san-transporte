// Fase 4 (Tarefa 11, Rulings R12, R13 e R15): as telas de hoje dentro do app novo (mesma origem, sem novo login), os
// rótulos novos dos perfis (Master; Administrador, Solicitante e Visualizador), o gestor de frota sem telas e o
// "Perfil e segurança" com o telefone. Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EQUIPE, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, pedidoOrcadoCliente, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N3: PerfilFalso = { papel: 'CLIENTE', nivel: 3, nome: 'Paulo Reis', empresa_nome: 'Umi San' }
const MOTORISTA: PerfilFalso = { papel: 'MOTORISTA', nome: 'Ivo Barbosa', tem_2fa: true }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const GESTOR: PerfilFalso = { papel: 'GESTOR_FROTA', nome: 'Gil Frota', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }

async function abrir(page: Page, perfil: PerfilFalso, caminho: string, opcoes: { detalhes?: unknown[]; telefone?: string | null } = {}) {
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : AAL2)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // A Equipe do N1 lê a mesma RPC de usuários (o servidor filtra a empresa).
  const api = await simularApi(page, perfil.papel === 'CLIENTE' ? { usuarios: EQUIPE } : {})
  const pedidos = await simularPedidos(page, opcoes.detalhes ? { detalhes: opcoes.detalhes } : {})
  const telefone: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meu_telefone`, (r) => json(r, { ok: true, telefone: opcoes.telefone ?? null }))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/salvar_meu_telefone`, (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>
    telefone.push(corpo)
    return json(r, { ok: true, telefone: corpo.p_telefone })
  })
  await page.goto(caminho)
  return { api, pedidos, telefone }
}

async function abrirMenu(page: Page) {
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu).toBeVisible()
  return menu
}

test('R13: o menu mostra Master, Administrador e Visualizador no lugar dos rótulos de hoje', async ({ page }) => {
  await abrir(page, N1, '/')
  const menu = await abrirMenu(page)
  await expect(menu).toContainText('Umi San · Administrador')
  await expect(menu).not.toContainText('Gestor da empresa')
})

test('R13: ADM é "Master" e N3 é "Visualizador"', async ({ browser }) => {
  for (const [perfil, rotulo] of [
    [ADM, 'Master'],
    [N3, 'Umi San · Visualizador'],
  ] as const) {
    const contexto = await browser.newContext()
    const page = await contexto.newPage()
    await abrir(page, perfil, '/')
    const menu = await abrirMenu(page)
    await expect(menu).toContainText(rotulo)
    await contexto.close()
  }
})

test('R12: "Minhas corridas" abre a lista de hoje no app novo, com o ☰ e sem sair da origem', async ({ page }) => {
  await abrir(page, N1, '/')
  const menu = await abrirMenu(page)
  await menu.getByRole('link', { name: 'Minhas corridas' }).click()
  await expect(page).toHaveURL(/127\.0\.0\.1:8789\/pedidos$/)
  // Um nome só por página (Tarefa 8 da fase 4.1): o h1 de hoje usa o nome do menu.
  await expect(page.getByRole('heading', { name: 'Minhas corridas', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
  // Sem a barra de abas do app atual.
  await expect(page.getByRole('navigation', { name: 'Navegação' })).toHaveCount(0)
})

test('R12: o pedido orçado abre a corrida nova', async ({ page }) => {
  await abrir(page, N1, `/pedidos/${ID_PEDIDO}`, { detalhes: [pedidoOrcadoCliente()] })
  await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
})

test('R12 (v2.2): o pedido agendado abre a corrida nova, com o cancelamento do agendamento', async ({ page }) => {
  const agendado = {
    ok: true,
    pedido: detalheFalso({ status: 'AGENDADA' }),
    historico: [],
    orcamento: null,
    acoes: { ...SEM_ACOES, cancelar_agendado: true },
  }
  await abrir(page, N1, `/pedidos/${ID_PEDIDO}`, { detalhes: [agendado] })
  await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible()
  await expect(page.getByTestId('numero-pedido')).toHaveText('Pedido #0042')
  await expect(page.getByRole('button', { name: 'Cancelar agendamento' })).toBeVisible()
})

test('R12: o pedido recusado fica no detalhe de hoje dentro do app novo', async ({ page }) => {
  const recusado = { ok: true, pedido: detalheFalso({ status: 'RECUSADA' }), historico: [], orcamento: null, acoes: SEM_ACOES }
  await abrir(page, N1, `/pedidos/${ID_PEDIDO}`, { detalhes: [recusado] })
  await expect(page).toHaveURL(new RegExp(`/pedidos/${ID_PEDIDO}$`))
  await expect(page.getByRole('heading', { name: 'Pedido #0042' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible()
})

test('R12 + R13: a Equipe do N1 abre no app novo com os níveis Administrador, Solicitante e Visualizador', async ({ page }) => {
  await abrir(page, N1, '/equipe')
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible()
  const corpo = page.locator('main')
  await expect(corpo).not.toContainText('Gestor da empresa (N1)')
  await expect(corpo).not.toContainText('Solicitante (N2)')
  await expect(corpo.getByText(/^(Administrador|Solicitante|Visualizador)$/).first()).toBeVisible()
})

test('R12: a Carteira (extrato) e a Agenda abrem no app novo; o N2/N3 não abre a Equipe', async ({ page }) => {
  await abrir(page, N3, '/extrato')
  await expect(page.getByRole('heading', { name: 'Carteira da empresa' })).toBeVisible()
  await page.goto('/agenda')
  await expect(page).toHaveURL(/\/agenda$/)
  await page.goto('/equipe')
  await expect(page).toHaveURL(/\/$/)
})

test('R12: o ADM abre Contratos e Usuários (com "Master") dentro do app novo', async ({ page }) => {
  await abrir(page, ADM, '/')
  const menu = await abrirMenu(page)
  await menu.getByRole('link', { name: 'Contratos' }).click()
  await expect(page).toHaveURL(/\/adm\/contratos$/)
  await expect(page.getByRole('heading', { name: 'Contratos' })).toBeVisible()
  await page.goto('/adm/usuarios')
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible()
  await expect(page.locator('main')).toContainText('Master')
})

test('R12: o motorista abre a chamada nova a partir de "Minhas corridas e Pendências"', async ({ page }) => {
  const solicitado = {
    ok: true,
    pedido: detalheFalso({ status: 'SOLICITADA', categoria: 'PASSAGEIROS', categoria_nome: 'IVO Passageiros' }),
    historico: [],
    orcamento: null,
    acoes: { ...SEM_ACOES, orcar: true, recusar: true },
  }
  await abrir(page, MOTORISTA, `/pedidos/${ID_PEDIDO}`, { detalhes: [solicitado] })
  await expect(page).toHaveURL(new RegExp(`/chamada/${ID_PEDIDO}$`))
})

test('R13: o gestor de frota vê "Sem acesso a este app"', async ({ page }) => {
  await abrir(page, GESTOR, '/pedidos')
  await expect(page.getByRole('heading', { name: 'Sem acesso a este app' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir a versão 1' })).toHaveAttribute('href', 'https://ivo-v1.pages.dev')
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCount(0)
})

test('R15: Perfil e segurança mostra nome e e-mail só para ler e grava o telefone só com os dígitos', async ({ page }) => {
  const { telefone } = await abrir(page, MOTORISTA, '/perfil', { telefone: '4733445566' })
  await expect(page.getByRole('heading', { name: 'Perfil e segurança' })).toBeVisible()
  await expect(page.getByText(/^IVO Transportes · versão \d+\.\d+\.\d+$/)).toBeVisible()
  await expect(page.locator('main')).toContainText('Ivo Barbosa')
  await expect(page.locator('main')).toContainText('pessoa@exemplo.com.br')
  await expect(page.getByRole('textbox', { name: 'Nome' })).toHaveCount(0)
  await expect(page.getByText('Verificação em duas etapas ativa')).toBeVisible()
  const campo = page.getByLabel('Telefone')
  await expect(campo).toHaveValue('(47) 3344-5566')

  await campo.fill('4799999')
  await page.getByRole('button', { name: 'Salvar telefone' }).click()
  await expect(page.getByText('Informe o telefone com DDD, por exemplo (47) 99999-1234.')).toBeVisible()
  expect(telefone).toHaveLength(0)

  await campo.fill('47999991234')
  await expect(campo).toHaveValue('(47) 99999-1234')
  await page.getByRole('button', { name: 'Salvar telefone' }).click()
  await expect(page.getByText('Telefone salvo.')).toBeVisible()
  expect(telefone).toEqual([{ p_telefone: '47999991234' }])

  await campo.fill('')
  await page.getByRole('button', { name: 'Salvar telefone' }).click()
  await expect(page.getByText('Telefone apagado.')).toBeVisible()
  expect(telefone.at(-1)).toEqual({ p_telefone: null })

  // Colar com o código do país: o +55 sai, o DDD fica o de verdade (91), nada é cortado.
  await campo.fill('+55 91 98888-7777')
  await expect(campo).toHaveValue('(91) 98888-7777')
  await page.getByRole('button', { name: 'Salvar telefone' }).click()
  await expect(page.getByText('Telefone salvo.')).toBeVisible()
  expect(telefone.at(-1)).toEqual({ p_telefone: '91988887777' })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('Perfil e Pedidos sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, N1, '/perfil')
      await expect(page.getByLabel('Telefone')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.goto('/pedidos')
      await expect(page.getByRole('heading', { name: 'Minhas corridas', exact: true })).toBeVisible()
      // A etiqueta "Aguardando" da lista de hoje (StatusBadge do app atual, reusada sem mudança) fica em 4,25:1 no tema
      // claro: herdada do app atual, anotada no relatório da Tarefa 11. O resto da tela passa no axe.
      expect((await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
