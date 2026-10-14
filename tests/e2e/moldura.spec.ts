// Moldura do celular no redesign: topo com símbolo, empresa e avatar (abre o menu), abas em pílula e o "+" laranja.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const AAL2 = { aal: 'aal2' as const }
const N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const N3 = { papel: 'CLIENTE' as const, nivel: 3 as const, nome: 'Vera Lima', empresa_nome: 'Umi San' }
const MOTORISTA = { papel: 'MOTORISTA' as const, nome: 'João Reis', tem_2fa: true }

async function entrar(page: Page, perfil: Parameters<typeof comSessaoFalsa>[1], aal?: typeof AAL2) {
  await comSessaoFalsa(page, perfil, aal)
  await simularApi(page)
  await simularPedidos(page)
}

test('cliente N2 vê o + laranja no Início, Pedidos e Agenda; ele abre o Novo pedido', async ({ page }) => {
  await entrar(page, N2)
  for (const rota of ['/', '/pedidos', '/agenda']) {
    await page.goto(rota)
    const mais = page.getByTestId('botao-novo-pedido-flutuante')
    await expect(mais).toBeVisible()
    await expect(mais).toHaveCSS('background-color', 'rgb(255, 106, 0)')
  }
  await page.getByTestId('botao-novo-pedido-flutuante').click()
  await expect(page).toHaveURL(/\/pedidos\/novo$/)
  await expect(page.getByTestId('botao-novo-pedido-flutuante')).toHaveCount(0)
})

test('N3 e motorista não veem o +', async ({ page }) => {
  await entrar(page, N3)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Navegação' })).toBeVisible()
  await expect(page.getByTestId('botao-novo-pedido-flutuante')).toHaveCount(0)
})

test('motorista não vê o +', async ({ page }) => {
  await entrar(page, MOTORISTA, AAL2)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Navegação' })).toBeVisible()
  await expect(page.getByTestId('botao-novo-pedido-flutuante')).toHaveCount(0)
})

test('aba ativa fica numa pílula com a cor de seleção; o avatar abre o menu', async ({ page }) => {
  await entrar(page, N2)
  await page.goto('/agenda')
  const aba = page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Agenda' })
  await expect(aba).toHaveAttribute('aria-current', 'page')
  await expect(aba.getByTestId('aba-icone')).toHaveCSS('background-color', 'rgb(10, 37, 64)')
  await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('button')).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
})
