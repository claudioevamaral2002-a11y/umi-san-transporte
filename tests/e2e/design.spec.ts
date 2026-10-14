import { expect, test } from '@playwright/test'

test('carregamento curto (200 ms) nunca mostra a pickup', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 200 ms' }).click()
  const apareceu = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const fim = performance.now() + 600
        const olhar = () => {
          if (document.querySelector('[data-testid="carregando-pickup"]')) return resolve(true)
          if (performance.now() > fim) return resolve(false)
          requestAnimationFrame(olhar)
        }
        olhar()
      }),
  )
  expect(apareceu).toBe(false)
})

test('carregamento longo mostra a pickup só depois de 400 ms', async ({ page }) => {
  await page.goto('/vitrine')
  const inicio = Date.now()
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  await expect(page.getByTestId('carregando-pickup')).toBeVisible()
  expect(Date.now() - inicio).toBeGreaterThanOrEqual(380)
  await expect(page.getByTestId('carregando-pickup')).toBeHidden({ timeout: 3_000 })
})

test('com movimento reduzido as rodas não giram', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  const roda = page.getByTestId('pickup-roda').first()
  await expect(roda).toBeAttached()
  expect(await roda.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

test('valores monetários usam números tabulares', async ({ page }) => {
  await page.goto('/vitrine')
  await expect(page.getByText(/1\.234,56/)).toHaveCSS('font-variant-numeric', 'tabular-nums')
})

test('raios seguem a hierarquia (cartão 16, botão 14, campo 12)', async ({ page }) => {
  await page.goto('/vitrine')
  const raio = (id: string) => page.getByTestId(id).evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
  expect(await raio('vitrine-cartao')).toBe('16px')
  expect(await raio('vitrine-botao')).toBe('14px')
  expect(await raio('vitrine-campo')).toBe('12px')
})

test('segmentado: um só escolhido, com contorno laranja e sem ✓', async ({ page }) => {
  await page.goto('/vitrine')
  const grupo = page.getByRole('radiogroup', { name: 'Visualização' })
  await grupo.getByRole('radio', { name: '3 dias' }).click()
  await expect(grupo.getByRole('radio', { checked: true })).toHaveText('3 dias')
  const sombra = await grupo.getByRole('radio', { name: '3 dias' }).evaluate((e) => getComputedStyle(e).boxShadow)
  expect(sombra).toContain('rgb(255, 106, 0)')
  await expect(grupo).not.toContainText('✓')
})

test('status usa ícone SVG e texto', async ({ page }) => {
  await page.goto('/vitrine')
  const selo = page.getByTestId('vitrine-status').getByText('Agendada')
  await expect(selo.locator('svg')).toHaveCount(1)
})

test('carrinho novo: pickup com reboque e barco, 3 rodas, triângulo da marca, SVG pequeno', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Simular 1500 ms' }).click()
  const carrinho = page.getByTestId('carregando-pickup')
  await expect(carrinho).toBeVisible()
  await expect(carrinho.getByTestId('pickup-roda')).toHaveCount(3)
  await expect(carrinho.locator('[data-parte="barco"]')).toHaveCount(1)
  await expect(carrinho.locator('[data-parte="selo"]')).toHaveAttribute('fill', 'var(--cor-laranja)')
  const bytes = await carrinho.locator('svg').evaluate((e) => new Blob([e.outerHTML]).size)
  expect(bytes).toBeLessThan(50 * 1024)
})
