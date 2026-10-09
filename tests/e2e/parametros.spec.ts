import { expect, test } from '@playwright/test'
import { simularApi, versaoFalsa } from './apoio/apiFalsa.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const ADM = { papel: 'ADM' as const, tem_2fa: true }
const MOTORISTA = { papel: 'MOTORISTA' as const, nome: 'Bruno Lima', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }

test.describe('início por perfil', () => {
  test('ADM sem tabela publicada: chamada para publicar e atalhos de administração', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { vigente: [], historico: [] })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    await expect(page.getByText('Nada pendente por aqui.')).toBeVisible()
    const chamada = page.getByTestId('chamada-primeira-tabela')
    await expect(chamada).toContainText('Publique a primeira tabela de preços')
    const atalhos = page.getByRole('region', { name: 'Atalhos' }).getByRole('link')
    await expect(atalhos).toHaveText([/Usuários/, /Tabela de preços e regras/, /Auditoria/])

    await chamada.getByRole('link', { name: 'Publicar tabela' }).click()
    await expect(page).toHaveURL(/\/parametros\?publicar=1$/)
    await expect(page.getByRole('dialog', { name: 'Publicar nova versão' })).toBeVisible()
  })

  test('motorista não recebe a chamada nem o atalho da tabela modelo (só o ADM publica)', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page, { vigente: [], historico: [] })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Bruno' })).toBeVisible()
    await expect(page.getByText('Nada pendente por aqui.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Atalhos' })).toHaveCount(0)
    await expect(page.getByTestId('chamada-primeira-tabela')).toHaveCount(0)
  })
})

test.describe('/parametros', () => {
  test('cliente não abre a tabela modelo nem a vê no menu (sem preços para o cliente)', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', nome: 'Carla Dias', empresa_nome: 'Umi San' })
    await simularApi(page, { vigente: [versaoFalsa(3)] })
    await page.goto('/parametros')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
    await expect(page.getByTestId('versao-vigente')).toHaveCount(0)
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Tabela de preços e regras' })).toHaveCount(0)
  })

  test('motorista não abre a tabela modelo (limites e histórico só para o ADM)', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page, { vigente: [versaoFalsa(3)] })
    await page.goto('/parametros')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
    await expect(page.getByTestId('versao-vigente')).toHaveCount(0)
  })

  test('ADM vê a tabela modelo vigente e o histórico', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { vigente: [versaoFalsa(3)], historico: [versaoFalsa(3), versaoFalsa(2)] })
    await page.goto('/parametros')
    await expect(page.getByRole('heading', { name: 'Tabela de preços e regras' })).toBeVisible()
    await expect(page.getByText('Tabela modelo', { exact: true })).toBeVisible()
    await expect(page.getByTestId('versao-vigente')).toContainText('Versão 3')
    await expect(page.getByRole('heading', { name: 'Veículo próprio' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Veículo da Umi San' })).toBeVisible()
    await expect(page.getByText('Quilômetro sem reboque')).toBeVisible()
    await expect(page.getByText(/R\$\s3,50/)).toBeVisible()
    await expect(page.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
      '24 h ou mais antes: sem multa',
      'De 6 h a menos de 24 h antes: multa de 50%',
      'Menos de 6 h antes: multa de 100%',
    ])
    await expect(page.getByText('Versão 2', { exact: true })).toBeVisible()
    await expect(page.getByText('Fotos guardadas após a entrega')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publicar nova versão' })).toBeVisible()
  })

  test('sem versão publicada: estado vazio', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { vigente: [], historico: [] })
    await page.goto('/parametros')
    await expect(page.getByText('Tabela ainda não publicada')).toBeVisible()
  })

  test('publicar: validação, confirmação com o que mudou e resultado do servidor', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page, {
      vigente: [versaoFalsa(4)],
      rpc: { publicar_contrato: { ok: true, versao: 5 } },
    })
    await page.goto('/parametros')
    await page.getByRole('button', { name: 'Publicar nova versão' }).click()
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await expect(folha).toBeVisible()

    // Preenchido com a versão vigente.
    const km = folha.getByLabel('Quilômetro sem reboque')
    await expect(km).toHaveValue('3,50')
    await expect(folha.getByLabel('Retorno em trecho único')).toHaveValue('50')

    // Inválido: aponta o campo e não envia nada.
    await km.fill('3,505')
    await folha.getByLabel('Retorno em trecho único').fill('120')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByText('Há 2 campos para corrigir.')).toBeVisible()
    await expect(km).toHaveAttribute('aria-invalid', 'true')
    await expect(folha.getByText('Informe um valor em reais, por exemplo 1.234,56.')).toBeVisible()

    await km.fill('1.234,56')
    await folha.getByLabel('Retorno em trecho único').fill('12,5')
    // Faixas: a última precisa começar em 0 h.
    await folha.getByLabel('Faixa 3: a partir de').fill('2')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByRole('alert').filter({ hasText: 'A última faixa precisa começar em 0 h' })).toBeVisible()
    await folha.getByLabel('Faixa 3: a partir de').fill('0')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()

    const confirmacao = folha.getByTestId('confirmacao-parametros')
    await expect(confirmacao).toBeVisible()
    await expect(confirmacao.getByText('2 itens mudam em relação à versão 4.')).toBeVisible()
    const alterados = confirmacao.locator('[data-mudou="sim"]')
    await expect(alterados).toHaveCount(2)
    await expect(alterados.first()).toContainText('Quilômetro sem reboque')
    await expect(alterados.first()).toContainText(/R\$\s1\.234,56/)
    await expect(alterados.nth(1)).toContainText('12,5%')
    expect(chamadas.filter((c) => c.rpc === 'publicar_contrato')).toHaveLength(0)

    await confirmacao.getByRole('button', { name: 'Publicar versão' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Versão 5 publicada.' })).toBeVisible()
    await expect(folha).toBeHidden()
    const envio = chamadas.find((c) => c.rpc === 'publicar_contrato')
    expect(envio?.corpo.p_empresa).toBeNull()
    expect(envio?.corpo.p).toMatchObject({ km_sem_reboque_cent: 123456, retorno_trecho_unico_bp: 1250, prazo_orcar_horas: 12 })
    // 13 campos do contrato; a retenção de fotos é global e só é enviada quando muda.
    expect(Object.keys(envio?.corpo.p as object)).toHaveLength(13)
    expect(chamadas.filter((c) => c.rpc === 'definir_retencao_fotos')).toHaveLength(0)
    expect(new Date(String(envio?.corpo.p_vigente_desde)).getTime()).toBeGreaterThan(Date.now())
  })

  test('publicar: recusa do servidor é traduzida e nada muda', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { vigente: [versaoFalsa(4)], rpc: { publicar_contrato: { ok: false, codigo: 'VIGENCIA_NO_PASSADO' } } })
    await page.goto('/parametros?publicar=1')
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByText('Nenhum valor muda em relação à versão atual.')).toBeVisible()
    await folha.getByRole('button', { name: 'Publicar versão' }).click()
    await expect(folha.getByRole('alert')).toContainText('A vigência precisa começar agora ou no futuro.')
    await folha.getByRole('button', { name: 'Voltar e editar' }).click()
    await expect(folha.getByLabel('Quilômetro sem reboque')).toBeVisible()
    // Esc fecha a folha (e tira o pedido de formulário da URL).
    await page.keyboard.press('Escape')
    await expect(folha).toBeHidden()
    await expect(page).toHaveURL(/\/parametros$/)
  })
})
