import { expect, type Page } from '@playwright/test'

export const AVISO_AREA_INDISPONIVEL = 'Essa área não está disponível para o seu perfil'

/** Área fora do perfil: a guarda leva ao Início (`/`) com o aviso curto — nunca a uma tela "Sem permissão". */
export async function esperarInicioComAviso(page: Page, rota?: string) {
  await expect(page, rota).toHaveURL(/^[^?#]*:\/\/[^/]+\/$/)
  await expect(page.getByTestId('aviso-navegacao'), rota).toHaveText(AVISO_AREA_INDISPONIVEL)
  await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite)/ }), rota).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sem permissão' }), rota).toHaveCount(0)
}
