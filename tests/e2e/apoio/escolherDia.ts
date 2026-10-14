// Novo pedido (redesign): o dia se escolhe na faixa de dias; fora dela, pela folha "Ver mês inteiro".
import { expect, type Locator, type Page } from '@playwright/test'

type Acao = 'click' | 'tap'

export async function escolherDiaNoPedido(page: Page, dia: string, acao: Acao = 'click'): Promise<Locator> {
  const faixa = page.getByTestId('faixa-dias')
  await expect(faixa.locator('[data-dia]').first()).toBeVisible()
  const botao = faixa.locator(`[data-dia="${dia}"]`)
  if ((await botao.count()) === 0) {
    await page.getByRole('button', { name: 'Ver mês inteiro' })[acao]()
    const calendario = page.getByRole('dialog', { name: 'Escolha o dia' }).getByTestId('calendario')
    await expect(calendario.locator('[data-dia]').first()).toBeVisible()
    const noMes = calendario.locator(`[data-dia="${dia}"]`)
    if ((await noMes.count()) === 0) await calendario.getByRole('button', { name: 'Próximo mês' })[acao]()
    await noMes[acao]()
  } else {
    await botao[acao]()
  }
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
  return botao
}

/** Agenda (redesign): o dia se escolhe na faixa da semana (esta e a próxima semana, de domingo a sábado). */
export async function escolherDiaNaAgenda(page: Page, dia: string, acao: Acao = 'click'): Promise<Locator> {
  const faixa = page.getByTestId('faixa-semana')
  await expect(faixa.locator('[data-dia]').first()).toBeVisible()
  const botao = faixa.locator(`[data-dia="${dia}"]`)
  await botao[acao]()
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
  return botao
}
