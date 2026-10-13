import { expect, test } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { AVISO_AREA_INDISPONIVEL, esperarInicioComAviso } from './apoio/areaIndisponivel.ts'
import { ID_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const AAL2 = { aal: 'aal2' as const }

// Endereços "velhos" que o app pode reabrir (aba restaurada, PWA, link antigo) e que o perfil NÃO acessa.
const CASOS: Array<{ nome: string; perfil: PerfilFalso; aal2: boolean; proibidas: string[] }> = [
  { nome: 'ADM', perfil: { papel: 'ADM', tem_2fa: true }, aal2: true, proibidas: ['/regras', '/extrato', '/equipe', '/tabela', '/pedidos/novo'] },
  {
    nome: 'gestor de frota',
    perfil: { papel: 'GESTOR_FROTA', tem_2fa: true },
    aal2: true,
    proibidas: ['/adm/painel', '/tabela', '/extrato', '/pedidos/novo', `/pedidos/${ID_PEDIDO}/orcar`],
  },
  {
    nome: 'motorista',
    perfil: { papel: 'MOTORISTA', tem_2fa: true },
    aal2: true,
    proibidas: ['/adm/usuarios', '/regras', '/extrato', '/equipe', '/pedidos/novo'],
  },
  { nome: 'cliente N1', perfil: { papel: 'CLIENTE', nivel: 1 }, aal2: false, proibidas: ['/adm/creditos', '/tabela', `/pedidos/${ID_PEDIDO}/orcar`] },
  { nome: 'cliente N2', perfil: { papel: 'CLIENTE', nivel: 2 }, aal2: false, proibidas: ['/equipe', '/adm/painel', '/parametros'] },
  { nome: 'cliente N3', perfil: { papel: 'CLIENTE', nivel: 3 }, aal2: false, proibidas: ['/pedidos/novo', '/equipe', '/adm/contratos'] },
]

test.describe('abrir o app num endereço fora do perfil', () => {
  for (const caso of CASOS) {
    test(`${caso.nome}: vai ao Início com aviso (nunca "Sem permissão")`, async ({ page }) => {
      await comSessaoFalsa(page, { nome: 'Ana Souza', empresa_nome: 'Umi San', ...caso.perfil }, caso.aal2 ? AAL2 : {})
      await simularApi(page)
      await simularPedidos(page)
      // Abrir pela raiz: Início, sem aviso.
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
      await expect(page.getByTestId('aviso-navegacao')).toHaveCount(0)
      for (const rota of caso.proibidas) {
        await page.goto(rota)
        await esperarInicioComAviso(page, rota)
      }
    })
  }

  test('o aviso some sozinho e não volta ao recarregar depois disso', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 3, nome: 'Ana Souza' })
    await simularApi(page)
    await simularPedidos(page)
    await page.goto('/equipe')
    await esperarInicioComAviso(page)
    await expect(page.getByTestId('aviso-navegacao')).toHaveCount(0, { timeout: 8_000 })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    await expect(page.getByText(AVISO_AREA_INDISPONIVEL)).toHaveCount(0)
  })
})

test.describe('entrar sempre leva ao Início', () => {
  test('aparelho com o endereço do ADM aberto: o cliente N3 que entra cai no Início, não na área do ADM', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 3, nome: 'Ana Souza' }, { semSessaoInicial: true })
    await simularApi(page)
    await simularPedidos(page)
    // Sem sessão (a do ADM acabou), o app reabre no último endereço: /adm/painel → /entrar.
    await page.goto('/adm/painel')
    await expect(page).toHaveURL(/\/entrar$/)
    await page.getByLabel('E-mail').fill('ana@exemplo.com.br')
    await page.getByLabel('Senha', { exact: true }).fill('Senha-Forte-123')
    const entrar = page.getByRole('button', { name: 'Entrar', exact: true })
    await expect(entrar).toBeEnabled({ timeout: 20_000 }) // token do Turnstile (chave de teste)
    await entrar.click()
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    await expect(page).toHaveURL(/:\/\/[^/]+\/$/)
    await expect(page.getByTestId('aviso-navegacao')).toHaveCount(0)
  })
})
