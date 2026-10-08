import { expect, test } from '@playwright/test'

test('headers de segurança presentes (especificação 9, item 19)', async ({ request }) => {
  const h = (await request.get('/')).headers()
  expect(h['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com")
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['content-security-policy']).not.toMatch(/unsafe-(inline|eval)/)
  expect(h['strict-transport-security']).toContain('max-age=63072000')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['cross-origin-opener-policy']).toBe('same-origin')
  expect(h['permissions-policy']).toContain('geolocation=()')
})

test('CSP bloqueia script inline injetado (especificação 9, item 18)', async ({ page }) => {
  await page.goto('/')
  const resultado = await page.evaluate(
    () =>
      new Promise<{ executou: boolean; diretiva: string }>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (e) =>
            resolve({
              executou: Boolean((window as unknown as { __injetado?: boolean }).__injetado),
              diretiva: e.violatedDirective,
            }),
          { once: true },
        )
        const script = document.createElement('script')
        script.textContent = 'window.__injetado = true'
        document.body.appendChild(script)
      }),
  )
  expect(resultado.executou).toBe(false)
  expect(resultado.diretiva).toMatch(/^script-src/)
})

test('nenhuma violação de CSP ao navegar', async ({ page }) => {
  const violacoes: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(m.text())
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Ver design system' }).click()
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible()
  expect(violacoes).toEqual([])
})
