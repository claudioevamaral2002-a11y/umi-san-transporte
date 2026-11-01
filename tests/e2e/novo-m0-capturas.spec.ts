import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'

// Evidências com fixtures existentes. Sem dados de contas reais ou tiles externos.
for (const largura of [390, 1440]) {
  test(`captura M0 cliente ${largura}`, async ({ page }) => {
    test.skip(!process.env.IVO_CAPTURAS, 'Capturas são geradas sob demanda, fora da rotina do CI.')
    await page.setViewportSize({ width: largura, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
    await simularMapas(page)
    await simularApi(page)
    await simularPedidos(page)
    await page.route('https://tile.googleapis.com/**', r => r.fulfill({ status: 503, body: '' }))
    await page.goto('/')
    await expect(page.getByTestId('folha-mapa')).toBeVisible()
    await expect(page.getByTestId('mapa-aviso')).toBeVisible()
    const pasta = 'docs/redesign/v2-3/m0'
    await mkdir(pasta, { recursive: true })
    await page.screenshot({ path: `${pasta}/${process.env.IVO_CAPTURAS}-${largura}.png`, fullPage: true })
  })
}
