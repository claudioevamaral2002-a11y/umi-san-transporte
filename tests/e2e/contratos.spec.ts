import { expect, test } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, linhaContrato, simularApi, versaoFalsa, vigiarCsp } from './apoio/apiFalsa.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const ADM = { papel: 'ADM' as const, tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const FUTURO = '2099-01-01T12:00:00Z'

/** Umi San com contrato vigente (v4) e Porto Azul sem contrato. */
const CENARIO = {
  vigente: [versaoFalsa(3)],
  historico: [versaoFalsa(3), versaoFalsa(2)],
  contratos: [
    linhaContrato(EMPRESA_PORTO, null),
    linhaContrato(EMPRESA_UMI, versaoFalsa(4, { publicado_por_nome: 'Ana Souza' }), FUTURO),
  ],
  historicoEmpresas: {
    [EMPRESA_UMI.id]: [versaoFalsa(5, { vigente_desde: FUTURO }), versaoFalsa(4), versaoFalsa(1)],
  },
  empresas: [EMPRESA_PORTO, EMPRESA_UMI],
}

test.describe('início do ADM', () => {
  test('sem tabela modelo: chamada para publicar e atalhos de administração', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { vigente: [], historico: [] })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    const chamada = page.getByTestId('chamada-primeira-tabela')
    await expect(chamada).toContainText('Publique a tabela modelo')
    const atalhos = page.getByRole('region', { name: 'Atalhos' }).getByRole('link')
    await expect(atalhos).toHaveText([/Contratos/, /Usuários/, /Empresas/, /Auditoria/, /Créditos/, /Painel/])

    await chamada.getByRole('link', { name: 'Publicar tabela modelo' }).click()
    await expect(page).toHaveURL(/\/adm\/contratos\/modelo\?publicar=1$/)
    await expect(page.getByRole('dialog', { name: 'Publicar nova versão' })).toBeVisible()
  })

  test('/parametros (endereço antigo) leva o ADM a Contratos', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, CENARIO)
    await page.goto('/parametros')
    await expect(page).toHaveURL(/\/adm\/contratos$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Contratos' })).toBeVisible()
    // A aba "Contratos" substitui a antiga "Tabela".
    await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('link')).toHaveText(['Início', 'Pedidos', 'Agenda', 'Contratos'])
  })
})

test.describe('/adm/contratos', () => {
  test('lista: tabela modelo, empresas com contrato vigente, "Sem contrato" e próxima vigência', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, CENARIO)
    await page.goto('/adm/contratos')
    await expect(page.getByTestId('contrato-modelo')).toContainText('Tabela modelo')
    await expect(page.getByTestId('contrato-modelo')).toContainText('Versão 3')
    const lista = page.getByTestId('lista-contratos').getByRole('listitem')
    await expect(lista).toHaveCount(2)
    const porto = lista.filter({ hasText: 'Porto Azul' })
    await expect(porto).toContainText('Sem contrato')
    const umi = lista.filter({ hasText: 'Umi San' })
    await expect(umi).toContainText('Vigente')
    await expect(umi).toContainText('Versão 4')
    await expect(umi).toContainText('Nova versão agendada para 01/01/2099')

    await umi.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/adm/contratos/${EMPRESA_UMI.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Umi San' })).toBeVisible()
  })

  test('detalhe da empresa: cartões do contrato, histórico com autor e agendada', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, CENARIO)
    await page.goto(`/adm/contratos/${EMPRESA_UMI.id}`)
    await expect(page.getByTestId('versao-vigente')).toContainText('Versão 4')
    await expect(page.getByTestId('versao-vigente')).toContainText('publicada por Ana Souza')
    await expect(page.getByText('A versão 5 entra em vigor em 01/01/2099')).toBeVisible()
    for (const titulo of [
      'Modalidade veículo próprio',
      'Modalidade veículo do cliente',
      'Regras de cancelamento e prazos',
      'Crédito da empresa',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: titulo })).toBeVisible()
    }
    await expect(page.getByTestId('cartao-credito')).toContainText('Limite de saldo negativo')
    await expect(page.getByTestId('cartao-credito')).toContainText(/R\$\s1\.000,00/)
    await expect(page.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
      '24 h ou mais antes: sem multa',
      'De 6 h a menos de 24 h antes: multa de 50%',
      'Menos de 6 h antes: multa de 100%',
    ])
    // Retenção de fotos não é do contrato (vai para Configurações).
    await expect(page.getByText('Fotos guardadas após a entrega')).toHaveCount(0)
    const historico = page.getByTestId('historico-contrato').getByRole('listitem')
    await expect(historico).toHaveCount(3)
    await expect(historico.filter({ hasText: 'Versão 5' })).toContainText('Agendada')
    await expect(historico.filter({ hasText: 'Versão 4' })).toContainText('Vigente')
    await expect(historico.filter({ hasText: 'Versão 1' })).toContainText('publicada por Ana Souza')
  })

  test('ADM publica nova versão do contrato da Umi San: validação, diferença e resultado do servidor', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page, { ...CENARIO, rpc: { publicar_contrato: { ok: true, versao: 6 } } })
    await page.goto(`/adm/contratos/${EMPRESA_UMI.id}`)
    await page.getByRole('button', { name: 'Publicar nova versão' }).click()
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await expect(folha).toBeVisible()
    await expect(folha.getByText('Umi San', { exact: true })).toBeVisible()

    // Pré-preenchido com o contrato vigente.
    const km = folha.getByLabel('Quilômetro sem reboque')
    await expect(km).toHaveValue('3,50')
    await expect(folha.getByLabel('Limite de saldo negativo')).toHaveValue('1.000,00')

    // Inválido: aponta o campo e não envia nada.
    await km.fill('3,505')
    await folha.getByLabel('Retorno em trecho único').fill('120')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByText('Há 2 campos para corrigir.')).toBeVisible()
    await expect(km).toHaveAttribute('aria-invalid', 'true')

    await km.fill('1.234,56')
    await folha.getByLabel('Retorno em trecho único').fill('12,5')
    await folha.getByLabel('Alerta de saldo baixo').fill('750')
    await folha.getByLabel('Faixa 3: a partir de').fill('2')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByRole('alert').filter({ hasText: 'A última faixa precisa começar em 0 h' })).toBeVisible()
    await folha.getByLabel('Faixa 3: a partir de').fill('0')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()

    const confirmacao = folha.getByTestId('confirmacao-contrato')
    await expect(confirmacao.getByText('3 itens mudam em relação à versão 4.')).toBeVisible()
    const alterados = confirmacao.locator('[data-mudou="sim"]')
    await expect(alterados).toHaveCount(3)
    await expect(alterados.first()).toContainText(/R\$\s1\.234,56/)
    await expect(alterados.nth(2)).toContainText('Alerta de saldo baixo')
    expect(chamadas.filter((c) => c.rpc === 'publicar_contrato')).toHaveLength(0)

    // Sem atualização otimista: a tela só muda com a confirmação do servidor.
    await confirmacao.getByRole('button', { name: 'Publicar versão' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Versão 6 publicada.' })).toBeVisible()
    await expect(folha).toBeHidden()
    const envio = chamadas.find((c) => c.rpc === 'publicar_contrato')
    expect(envio?.corpo.p_empresa).toBe(EMPRESA_UMI.id)
    expect(envio?.corpo.p).toMatchObject({ km_sem_reboque_cent: 123456, retorno_trecho_unico_bp: 1250, alerta_saldo_baixo_cent: 75000 })
    expect(Object.keys(envio?.corpo.p as object).sort()).toHaveLength(13)
    expect(envio?.corpo.p).not.toHaveProperty('retencao_fotos_dias')
    expect(chamadas.filter((c) => c.rpc === 'definir_retencao_fotos')).toHaveLength(0)
    expect(new Date(String(envio?.corpo.p_vigente_desde)).getTime()).toBeGreaterThan(Date.now())
    // Recarregou do servidor depois de publicar.
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'historico_contrato').length).toBeGreaterThan(1)
  })

  test('empresa sem contrato: cria a partir da tabela modelo', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page, { ...CENARIO, rpc: { publicar_contrato: { ok: true, versao: 1 } } })
    await page.goto(`/adm/contratos/${EMPRESA_PORTO.id}`)
    await expect(page.getByTestId('sem-contrato')).toContainText('Sem contrato vigente')
    await page.getByRole('button', { name: 'Criar contrato a partir da tabela modelo' }).click()
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    // Pré-preenchido com a tabela modelo vigente.
    await expect(folha.getByLabel('Quilômetro sem reboque')).toHaveValue('3,50')
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByText('Primeiro contrato de Porto Azul, a partir da tabela modelo.')).toBeVisible()
    await folha.getByRole('button', { name: 'Publicar versão' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Versão 1 publicada.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'publicar_contrato')?.corpo.p_empresa).toBe(EMPRESA_PORTO.id)
  })

  test('recusa do servidor é traduzida e nada muda', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { ...CENARIO, rpc: { publicar_contrato: { ok: false, codigo: 'VIGENCIA_NO_PASSADO' } } })
    await page.goto('/adm/contratos/modelo?publicar=1')
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    await expect(folha.getByText('Nenhum valor muda em relação à versão atual.')).toBeVisible()
    await folha.getByRole('button', { name: 'Publicar versão' }).click()
    await expect(folha.getByRole('alert')).toContainText('A vigência precisa começar agora ou no futuro.')
    await folha.getByRole('button', { name: 'Voltar e editar' }).click()
    await expect(folha.getByLabel('Quilômetro sem reboque')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(folha).toBeHidden()
    await expect(page).toHaveURL(/\/adm\/contratos\/modelo$/)
  })
})

test.describe('configurações e empresas', () => {
  test('retenção de fotos: cartão em Configurações, salva só com confirmação do servidor', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page, { retencaoFotosDias: 30 })
    await page.goto('/adm/configuracoes')
    const cartao = page.getByTestId('cartao-retencao-fotos')
    await expect(cartao).toContainText('30 dias')
    await cartao.getByRole('button', { name: 'Alterar prazo' }).click()
    await cartao.getByLabel('Fotos guardadas após a entrega').fill('0')
    await cartao.getByRole('button', { name: 'Salvar' }).click()
    await expect(cartao.getByText('Informe um número inteiro de dias, de 1 a 3650.')).toBeVisible()
    await cartao.getByLabel('Fotos guardadas após a entrega').fill('45')
    await cartao.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Fotos passam a ser guardadas por 45 dias' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'definir_retencao_fotos')?.corpo).toEqual({ p_dias: 45 })
  })

  test('nova empresa: depois de criar, convite para o contrato a partir da tabela modelo', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { ...CENARIO, rpc: { salvar_empresa: { ok: true, id: EMPRESA_PORTO.id } } })
    await page.goto('/adm/empresas')
    await page.getByRole('button', { name: 'Nova empresa' }).click()
    const nova = page.getByRole('dialog', { name: 'Nova empresa' })
    await nova.getByLabel('Nome da empresa').fill('Porto Azul')
    await nova.getByRole('button', { name: 'Criar empresa' }).click()
    const passo = page.getByTestId('proximo-passo-contrato')
    await expect(passo).toContainText('Porto Azul ainda não tem contrato')
    await passo.getByRole('link', { name: 'Criar contrato a partir da tabela modelo' }).click()
    await expect(page).toHaveURL(new RegExp(`/adm/contratos/${EMPRESA_PORTO.id}\\?publicar=1$`))
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await expect(folha.getByLabel('Quilômetro sem reboque')).toHaveValue('3,50')
  })
})

test('telas novas do ADM sem violação de CSP', async ({ page }) => {
  const violacoes = await vigiarCsp(page)
  await comSessaoFalsa(page, ADM, AAL2)
  await simularApi(page, CENARIO)
  for (const [rota, titulo] of [
    ['/adm/contratos', 'Contratos'],
    [`/adm/contratos/${EMPRESA_UMI.id}`, 'Umi San'],
    ['/adm/contratos/modelo', 'Tabela modelo'],
    ['/adm/configuracoes', 'Configurações'],
    ['/adm/usuarios', 'Usuários'],
  ] as const) {
    await page.goto(rota)
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  }
  expect(violacoes).toEqual([])
})
