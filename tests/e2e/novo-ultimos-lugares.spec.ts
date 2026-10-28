// v2.2.1: tocar no De (ou no Para) com o campo vazio mostra os "Últimos lugares" da empresa (o banco devolve os usados
// por último primeiro); com texto, o grupo volta a ser "Locais da empresa". Roda no projeto Playwright `novo`
// (dist-novo).
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

/** Na ordem do banco com o texto vazio: o último usado primeiro. */
const ULTIMOS = [
  { nome: 'Porto de Itajaí', lat: null, lng: null, place_id: 'ChIJpor' },
  { nome: 'Estaleiro Navegantes', lat: null, lng: null, place_id: 'ChIJdef' },
  { nome: 'Marina Itajaí, rampa 2', lat: -26.91, lng: -48.65, place_id: null },
]

async function abrir(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page)
  await simularMapas(page)
  await simularBlocosDoMapa(page)
  const textos: string[] = []
  // Registrada depois de simularMapas: vence a dela.
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/locais_da_empresa`, (route: Route) => {
    const t = String((route.request().postDataJSON() as { p_texto?: string })?.p_texto ?? '')
    textos.push(t)
    const locais = t.trim() === '' ? ULTIMOS : ULTIMOS.filter((l) => l.nome.toLowerCase().includes(t.trim().toLowerCase()))
    return json(route, { ok: true, locais })
  })
  await page.goto('/')
  return { textos }
}

test.describe('v2.2.1: Últimos lugares no De/Para', () => {
  test('De vazio: "Últimos lugares" com os locais na ordem do banco; escolher preenche o campo', async ({ page }) => {
    const { textos } = await abrir(page)
    const de = page.getByRole('combobox', { name: 'De', exact: true })
    await expect(de).toHaveValue('')
    await de.click()
    const lista = page.getByRole('listbox', { name: 'Sugestões para De' })
    const grupo = lista.getByRole('group', { name: 'Últimos lugares' })
    await expect(grupo.getByRole('option')).toHaveText([/Porto de Itajaí/, /Estaleiro Navegantes/, /Marina Itajaí, rampa 2/])
    await expect(lista.getByText('Últimos lugares', { exact: true })).toBeVisible()
    await expect(lista.getByRole('group', { name: 'Locais da empresa' })).toHaveCount(0)
    expect(textos).toContain('')

    await grupo.getByRole('option', { name: /Marina Itajaí, rampa 2/ }).click()
    await expect(de).toHaveValue('Marina Itajaí, rampa 2')
    await expect(lista).toHaveCount(0)
  })

  test('com texto, o grupo volta a ser "Locais da empresa"', async ({ page }) => {
    await abrir(page)
    const para = page.getByRole('combobox', { name: 'Para', exact: true })
    await para.click()
    const lista = page.getByRole('listbox', { name: 'Sugestões para Para' })
    await expect(lista.getByRole('group', { name: 'Últimos lugares' })).toBeVisible()
    await para.fill('porto')
    const grupo = lista.getByRole('group', { name: 'Locais da empresa' })
    await expect(grupo.getByRole('option')).toHaveText([/Porto de Itajaí/])
    await expect(lista.getByRole('group', { name: 'Últimos lugares' })).toHaveCount(0)
  })
})
