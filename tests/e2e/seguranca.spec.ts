import { expect, test } from '@playwright/test'

test('headers de segurança presentes (especificação 9, item 19)', async ({ request }) => {
  const h = (await request.get('/entrar')).headers()
  expect(h['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com")
  expect(h['content-security-policy']).toContain('frame-src https://challenges.cloudflare.com')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['content-security-policy']).not.toMatch(/unsafe-(inline|eval)/)
  expect(h['strict-transport-security']).toContain('max-age=63072000')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['cross-origin-opener-policy']).toBe('same-origin')
  // Fase 3B: o GPS e a tela acesa só para o próprio app (o motorista em viagem); terceiros em iframe, nunca.
  expect(h['permissions-policy']).toContain('geolocation=(self)')
  expect(h['permissions-policy']).toContain('screen-wake-lock=(self)')
  expect(h['permissions-policy']).toContain('microphone=()')
})

test('CSP bloqueia script inline injetado (especificação 9, item 18)', async ({ page }) => {
  await page.goto('/entrar')
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

test('nenhuma violação de CSP com o Turnstile carregado (entrada e navegação)', async ({ page }) => {
  const violacoes: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(m.text())
  })
  // Também pelo evento do navegador (pega violações que não chegam ao console).
  await page.exposeFunction('__violacaoCsp', (v: string) => violacoes.push(v))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __violacaoCsp: (v: string) => void }).__violacaoCsp(
        `${e.violatedDirective} ${e.blockedURI}`,
      )
    })
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/entrar$/)
  // Script e iframe do Turnstile carregados e token emitido (chave de teste sempre aprova).
  await expect(page.locator('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]')).toHaveCount(1)
  await page.getByLabel('E-mail').fill('pessoa@exemplo.com.br')
  await page.getByLabel('Senha', { exact: true }).fill('qualquer-coisa')
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled({ timeout: 20_000 })
  expect(await page.evaluate(() => typeof (window as { turnstile?: unknown }).turnstile)).toBe('object')

  await page.goto('/vitrine')
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible()
  expect(violacoes).toEqual([])
})
