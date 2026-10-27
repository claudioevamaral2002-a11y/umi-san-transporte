// v2.2 (auditoria A03): a resposta atrasada de uma busca (o detalhe do Google de um campo) não apaga o que o cliente
// digitou em outro campo nesse meio-tempo. Roda no projeto Playwright `novo` (dist-novo).
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const CATEGORIAS = {
  ok: true,
  categorias: [
    {
      codigo: 'PASSAGEIROS',
      nome: 'IVO Passageiros',
      descricao_curta: 'até 4 pessoas',
      disponivel: true,
      total_cent: 18000,
      linhas: [],
      carga: 'PESSOAS',
      reboque: 'NAO',
      veiculo_cliente: false,
      cobra_hora: false,
      cobra_parada: true,
      pessoas_max: 4,
    },
  ],
}

/** Abre o início do cliente com o detalhe do Google de `place_id` segurado até `liberar()`. */
async function abrir(page: Page, place_id: string) {
  await page.setViewportSize({ width: 390, height: 844 })
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page)
  await simularMapas(page, { rota: { km: 42, minutos: 55 } })
  await simularBlocosDoMapa(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) => json(route, CATEGORIAS))
  let liberar!: () => void
  const liberado = new Promise<void>((r) => (liberar = r))
  const segurado = { chegou: false, respondido: false }
  await page.route(`${URL_SUPABASE}/functions/v1/enderecos`, async (route: Route) => {
    const c = route.request().postDataJSON() as { acao: string; place_id?: string }
    if (c.acao !== 'detalhar' || c.place_id !== place_id) return route.fallback()
    segurado.chegou = true
    await liberado
    await route.fallback()
    segurado.respondido = true
  })
  await page.goto('/')
  return { liberar, segurado }
}

/** Escolhe a sugestão `opcao` no campo `nome` (digitando `texto`). */
async function escolher(page: Page, nome: string, texto: string, opcao: RegExp) {
  await page.getByRole('combobox', { name: nome, exact: true }).fill(texto)
  await page.getByRole('option', { name: opcao }).first().click()
}

test.describe('v2.2: o destino não apaga', () => {
  test('a origem resolve depois de o cliente digitar o Para: o Para continua com o texto', async ({ page }) => {
    const { liberar, segurado } = await abrir(page, 'ChIJnav')
    const de = page.getByRole('combobox', { name: 'De', exact: true })
    const para = page.getByRole('combobox', { name: 'Para', exact: true })
    await escolher(page, 'De', 'Navship', /Estaleiro Navship/)
    await expect.poll(() => segurado.chegou).toBe(true)
    await para.fill('Porto de Itajaí')
    liberar()
    // A origem chegou (o endereço aparece embaixo do campo) e o Para ficou como o cliente digitou.
    await expect(page.getByTestId('endereco-de')).toContainText('Rua Prefeito José Juvenal Mafra')
    expect(segurado.respondido).toBe(true)
    await expect(de).toHaveValue('Estaleiro Navship')
    await expect(para).toHaveValue('Porto de Itajaí')
    await page.waitForTimeout(300)
    await expect(para).toHaveValue('Porto de Itajaí')
    // Com o Para escolhido, os dois pontos têm local: sobem as categorias.
    await page.getByRole('option', { name: /Porto de Itajaí/ }).first().click()
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await expect(page.getByTestId('rota-de-para')).toContainText('Estaleiro Navship')
    await expect(page.getByTestId('rota-de-para')).toContainText('Porto de Itajaí')
  })

  test('uma parada resolve depois de o cliente digitar o Para: nenhum campo volta ao valor antigo', async ({ page }) => {
    const { liberar, segurado } = await abrir(page, 'ChIJnav')
    await page.getByRole('button', { name: '+ Adicionar parada' }).click()
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Parada 1', 'Navship', /Estaleiro Navship/)
    await expect.poll(() => segurado.chegou).toBe(true)
    const para = page.getByRole('combobox', { name: 'Para', exact: true })
    await para.fill('Porto de Itajaí')
    liberar()
    await expect(page.getByTestId('endereco-parada-1')).toContainText('Rua Prefeito José Juvenal Mafra')
    await page.waitForTimeout(300)
    await expect(para).toHaveValue('Porto de Itajaí')
    await expect(page.getByRole('combobox', { name: 'De', exact: true })).toHaveValue('Estaleiro Navegantes')
    await expect(page.getByRole('combobox', { name: 'Parada 1', exact: true })).toHaveValue('Estaleiro Navship')
    await page.getByRole('option', { name: /Porto de Itajaí/ }).first().click()
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    const percurso = page.getByTestId('rota-de-para')
    await expect(percurso).toContainText('Estaleiro Navegantes')
    await expect(percurso).toContainText('Estaleiro Navship')
    await expect(percurso).toContainText('Porto de Itajaí')
  })

  test('o Para resolve depois de o cliente mudar a parada: a parada fica com o texto novo', async ({ page }) => {
    const { liberar, segurado } = await abrir(page, 'ChIJpor')
    await page.getByRole('button', { name: '+ Adicionar parada' }).click()
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    await expect.poll(() => segurado.chegou).toBe(true)
    const parada = page.getByRole('combobox', { name: 'Parada 1', exact: true })
    await parada.fill('Estaleiro Detroit')
    liberar()
    await expect(page.getByTestId('endereco-para')).toContainText('Av. Min. Victor Konder')
    await page.waitForTimeout(300)
    await expect(parada).toHaveValue('Estaleiro Detroit')
    await expect(page.getByRole('combobox', { name: 'Para', exact: true })).toHaveValue('Porto de Itajaí')
  })
})
