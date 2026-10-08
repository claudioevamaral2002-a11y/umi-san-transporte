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
