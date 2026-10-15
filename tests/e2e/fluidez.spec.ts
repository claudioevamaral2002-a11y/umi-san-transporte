// Fluidez (pedido do dono: "mudar de página ou selecionar faz parecer que pisca"): o topo, as abas e o "+" não
// participam da transição de tela; ao trocar dia/filtro o conteúdo atual fica (esmaecido) até o novo chegar; voltar a
// uma aba já vista mostra a lista na hora.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { escolherDiaNaAgenda } from './apoio/escolherDia.ts'
import { DIA_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }

async function entrar(page: Page, atrasos?: Record<string, { ms: number; depois: number }>) {
  await comSessaoFalsa(page, N2)
  await simularApi(page)
  await simularPedidos(page, { atrasos })
}

test('topo, abas e "+" ficam fora da transição de tela (não piscam)', async ({ page }) => {
  await entrar(page)
  await page.goto('/')
  const nome = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).viewTransitionName)
  expect(await nome('header')).toBe('topo')
  expect(await nome('nav[aria-label="Navegação"]')).toBe('abas')
  expect(await nome('[data-testid="botao-novo-pedido-flutuante"]')).toBe('botao-novo')
})

test('agenda: trocar o dia mantém a grade (esmaecida) até o novo dia chegar', async ({ page }) => {
  await entrar(page, { agenda: { ms: 1500, depois: 1 } })
  await page.goto('/agenda')
  await expect(page.getByTestId('grade-horas')).toBeVisible()
  await escolherDiaNaAgenda(page, DIA_PEDIDO)
  // Logo depois do toque: a grade continua na tela, marcada como carregando, sem esqueleto.
  await expect(page.getByTestId('grade-horas')).toBeVisible({ timeout: 300 })
  await expect(page.getByTestId('agenda-dia')).toHaveAttribute('aria-busy', 'true', { timeout: 300 })
  await expect(page.getByLabel('Carregando o dia')).toHaveCount(0)
  await expect(page.getByTestId('bloco-proprio')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('agenda-dia')).not.toHaveAttribute('aria-busy', 'true')
})

test('pedidos: trocar o filtro mantém a lista até a nova chegar', async ({ page }) => {
  await entrar(page, { meus_pedidos: { ms: 1500, depois: 1 } })
  await page.goto('/pedidos')
  await expect(page.getByTestId('lista-pedidos')).toBeVisible()
  await page.getByRole('button', { name: 'Agendados' }).click()
  await expect(page.getByTestId('lista-pedidos')).toBeVisible({ timeout: 300 })
  await expect(page.getByLabel('Carregando os pedidos')).toHaveCount(0)
})

test('voltar a uma aba já vista mostra a lista na hora e atualiza depois', async ({ page }) => {
  await entrar(page, { meus_pedidos: { ms: 2000, depois: 1 } })
  await page.goto('/pedidos')
  await expect(page.getByTestId('lista-pedidos')).toBeVisible()
  const abas = page.getByRole('navigation', { name: 'Navegação' })
  await abas.getByRole('link', { name: 'Agenda' }).click()
  await expect(page.getByTestId('faixa-semana')).toBeVisible()
  await abas.getByRole('link', { name: 'Pedidos' }).click()
  await expect(page.getByTestId('lista-pedidos')).toBeVisible({ timeout: 500 })
})
