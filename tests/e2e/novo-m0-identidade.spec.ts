import { expect, test } from '@playwright/test'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'

for (const tema of ['light', 'dark'] as const) {
  test(`identidade v2 ${tema}: fontes locais carregam e o alto contraste prevalece`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema })
    const csp = await vigiarCsp(page)
    const fontes: string[] = []
    page.on('response', r => { if (r.url().endsWith('.woff2') && r.ok()) fontes.push(r.url()) })
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
    await simularMapas(page)
    await simularApi(page)
    await simularPedidos(page)
    await page.route('https://tile.googleapis.com/**', r => r.fulfill({ status: 503, body: '' }))
    await page.goto('/')
    await expect(page.getByTestId('folha-mapa')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('body')).toHaveCSS('font-family', /DM Sans Variable/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Manrope Variable/)
    const carregadas = await page.evaluate(() => ({
      corpo: document.fonts.check('400 16px "DM Sans Variable"'),
      titulo: document.fonts.check('700 24px "Manrope Variable"'),
    }))
    expect(carregadas).toEqual({ corpo: true, titulo: true })
    expect(fontes.some(url => url.includes('/fontes/dm-sans-latin-'))).toBe(true)
    expect(fontes.some(url => url.includes('/fontes/manrope-latin-'))).toBe(true)
    expect(fontes.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
    await expect(page.getByTestId('folha-mapa')).toHaveCSS('background-color', tema === 'light' ? 'rgb(255, 255, 255)' : 'rgb(20, 55, 71)')
    await page.evaluate(() => document.documentElement.setAttribute('data-contraste', 'alto'))
    await expect(page.getByTestId('folha-mapa')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.getByTestId('folha-mapa')).toHaveCSS('color', 'rgb(0, 0, 0)')
    expect(csp).toEqual([])
  })
}
