// v2.2 (Tarefa 5, especificação §5.5): "Locais salvos" real. Lista da empresa, "Pedir daqui" (abre o Início com o De
// preenchido, pelo mesmo caminho do "Pedir de novo") e, só para o Administrador (N1), renomear e excluir com
// confirmação. Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const N2: PerfilFalso = { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const N3: PerfilFalso = { papel: 'CLIENTE', nivel: 3, nome: 'Paulo Reis', empresa_nome: 'Umi San' }
const TELA = { width: 390, height: 844 }

const LOCAIS = [
  { id: 1, nome: 'Estaleiro Navegantes', usos: 12, ultimo_uso: '2026-10-20T12:00:00Z', place_id: 'pid-estaleiro', lat: null, lng: null },
  { id: 2, nome: 'Porto de Itajaí · Portão 3', usos: 1, ultimo_uso: '2026-10-10T12:00:00Z', place_id: null, lat: -26.9, lng: -48.66 },
]

async function abrir(page: Page, perfil: PerfilFalso, locais: unknown[] = LOCAIS, respostas: Record<string, unknown> = {}) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, perfil)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page)
  await simularPedidos(page, {})
  const chamadas: Array<{ rpc: string; corpo: unknown }> = []
  let lista = [...locais]
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/locais_empresa_todos`, (r) => json(r, { ok: true, locais: lista }))
  for (const rpc of ['renomear_local', 'excluir_local']) {
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/${rpc}`, (r) => {
      const corpo = r.request().postDataJSON() as { p_id: number; p_nome?: string }
      chamadas.push({ rpc, corpo })
      const resposta = (respostas[rpc] as Record<string, unknown> | undefined) ?? { ok: true }
      if (resposta.ok) {
        lista =
          rpc === 'excluir_local'
            ? lista.filter((l) => (l as { id: number }).id !== corpo.p_id)
            : lista.map((l) => ((l as { id: number }).id === corpo.p_id ? { ...(l as object), nome: corpo.p_nome } : l))
      }
      return json(r, resposta)
    })
  }
  await page.goto('/locais')
  return chamadas
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test('lista os locais da empresa, mais usados primeiro, sem "em breve" e sem rolagem lateral', async ({ page }) => {
  await abrir(page, N2)
  await expect(page.getByRole('heading', { name: 'Locais salvos', level: 1 })).toBeVisible()
  await expect(page.getByText('Esta tela chega em breve.')).toHaveCount(0)
  const itens = page.getByTestId('local-salvo')
  await expect(itens).toHaveCount(2)
  await expect(itens.nth(0)).toContainText('Estaleiro Navegantes')
  await expect(itens.nth(0)).toContainText('Usado em 12 pedidos')
  await expect(itens.nth(1)).toContainText('Usado em 1 pedido')
  expect(await semRolagemLateral(page)).toBe(false)
})

test('N2: "Pedir daqui" abre o Início com o De preenchido; sem lápis nem Excluir', async ({ page }) => {
  await abrir(page, N2)
  await expect(page.getByRole('button', { name: /^Renomear/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Excluir/ })).toHaveCount(0)
  await page.getByTestId('local-salvo').nth(0).getByRole('button', { name: 'Pedir daqui' }).click()
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
  await expect(page.getByRole('combobox', { name: 'De', exact: true })).toHaveValue('Estaleiro Navegantes')
  await expect(page.getByRole('combobox', { name: 'Para', exact: true })).toHaveValue('')
})

test('N3 (só acompanha): vê a lista, sem "Pedir daqui", lápis nem Excluir', async ({ page }) => {
  await abrir(page, N3)
  await expect(page.getByTestId('local-salvo')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Pedir daqui' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Renomear/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Excluir/ })).toHaveCount(0)
})

test('N1: renomeia pelo lápis (com a validação do nome) e exclui com confirmação', async ({ page }) => {
  const chamadas = await abrir(page, N1)
  await page.getByRole('button', { name: 'Renomear Estaleiro Navegantes' }).click()
  const folha = page.getByRole('dialog', { name: 'Renomear local' })
  const campo = folha.getByLabel('Nome do local')
  await campo.fill('x')
  await folha.getByRole('button', { name: 'Salvar nome' }).click()
  await expect(folha.getByText('O nome precisa ter de 2 a 80 caracteres.')).toBeVisible()
  expect(chamadas).toHaveLength(0)
  await campo.fill('  Estaleiro Sul  ')
  await folha.getByRole('button', { name: 'Salvar nome' }).click()
  await expect(page.getByText('Local renomeado.')).toBeVisible()
  expect(chamadas).toEqual([{ rpc: 'renomear_local', corpo: { p_id: 1, p_nome: 'Estaleiro Sul' } }])
  await expect(page.getByTestId('local-salvo').nth(0)).toContainText('Estaleiro Sul')

  await page.getByRole('button', { name: 'Excluir Porto de Itajaí · Portão 3' }).click()
  const confirmar = page.getByRole('dialog', { name: 'Excluir local?' })
  await expect(confirmar).toContainText('Os pedidos que já usaram este local não mudam.')
  await confirmar.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirmar).toBeHidden()
  expect(chamadas).toHaveLength(1)
  await page.getByRole('button', { name: 'Excluir Porto de Itajaí · Portão 3' }).click()
  await page.getByRole('dialog', { name: 'Excluir local?' }).getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(page.getByText('Local excluído.')).toBeVisible()
  expect(chamadas.at(-1)).toEqual({ rpc: 'excluir_local', corpo: { p_id: 2 } })
  await expect(page.getByTestId('local-salvo')).toHaveCount(1)
})

test('N1: recusa do banco aparece na folha, sem mudar a lista', async ({ page }) => {
  await abrir(page, N1, LOCAIS, { excluir_local: { ok: false, codigo: 'NAO_ENCONTRADO' } })
  await page.getByRole('button', { name: 'Excluir Estaleiro Navegantes' }).click()
  const confirmar = page.getByRole('dialog', { name: 'Excluir local?' })
  await confirmar.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(confirmar.getByRole('alert')).toContainText('Não encontramos o que você procurou.')
  await expect(page.getByTestId('local-salvo')).toHaveCount(2)
})

test('N1: nome repetido (JA_EXISTE) mostra a mensagem e a folha fica aberta', async ({ page }) => {
  await abrir(page, N1, LOCAIS, { renomear_local: { ok: false, codigo: 'JA_EXISTE' } })
  await page.getByRole('button', { name: 'Renomear Estaleiro Navegantes' }).click()
  const folha = page.getByRole('dialog', { name: 'Renomear local' })
  await folha.getByLabel('Nome do local').fill('Porto de Itajaí · Portão 3')
  await folha.getByRole('button', { name: 'Salvar nome' }).click()
  await expect(folha.getByRole('alert')).toContainText('Já existe um local salvo com este nome.')
  await expect(page.getByTestId('local-salvo').nth(0)).toContainText('Estaleiro Navegantes')
})

test('lista vazia: "Os lugares dos seus pedidos aparecem aqui."', async ({ page }) => {
  await abrir(page, N2, [])
  await expect(page.getByText('Os lugares dos seus pedidos aparecem aqui.')).toBeVisible()
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })
    test('Locais do N1 sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, N1)
      await expect(page.getByTestId('local-salvo')).toHaveCount(2)
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
      await page.getByRole('button', { name: 'Renomear Estaleiro Navegantes' }).click()
      await expect(page.getByRole('dialog', { name: 'Renomear local' })).toBeVisible()
      expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
