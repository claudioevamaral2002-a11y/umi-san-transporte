// Contraste WCAG medido na página (toque no celular, claro e escuro).
import { expect, type Locator } from '@playwright/test'

/** Luminância relativa (WCAG) de "rgb(r, g, b)" / "rgba(r, g, b, a)" (alfa ignorado: os fundos aqui são opacos). */
function luminancia(cor: string): number {
  const [r, g, b] = (cor.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
export const fundo = (l: Locator) => l.evaluate((e) => getComputedStyle(e).backgroundColor)
/** Fundo efetivo atrás do elemento (primeiro ancestral com fundo não transparente). */
export const fundoAtras = (l: Locator) =>
  l.evaluate((e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p).backgroundColor
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
    }
    return getComputedStyle(document.body).backgroundColor
  })

/** O item escolhido precisa se destacar do que está atrás dele (≥ 3:1, WCAG 1.4.11). */
export async function esperarDestacado(item: Locator) {
  await expect.poll(async () => contraste(await fundo(item), await fundoAtras(item))).toBeGreaterThanOrEqual(3)
}
