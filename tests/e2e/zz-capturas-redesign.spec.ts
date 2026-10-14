// Capturas do redesign mobile (claro e escuro) para o dono conferir. Só roda com CAPTURAS=1.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { DIA_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const PASTA = process.env.PASTA_CAPTURAS ?? 'test-results/capturas-redesign'
const CLIENTE = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }

test.skip(!process.env.CAPTURAS, 'só sob demanda')
test.beforeEach(async ({ page }) => page.emulateMedia({ reducedMotion: 'reduce' }))

for (const tema of ['light', 'dark'] as const) {
  const sufixo = tema === 'light' ? 'claro' : 'escuro'
  const foto = (page: Page, nome: string) => page.screenshot({ path: `${PASTA}/${nome}-${sufixo}.png`, fullPage: true })

  test.describe(`capturas ${sufixo}`, () => {
    test.use({ colorScheme: tema })

    test('novo pedido', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularPedidos(page)
      await page.goto('/pedidos/novo')
      await escolherDiaNoPedido(page, DIA_PEDIDO)
      await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
      await expect(page.getByTestId('frase-quando')).toBeVisible()
      await foto(page, '05-novo-pedido-quando')
    })
  })
}
