import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_UMI, EQUIPE, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { comSessaoFalsa, responderFuncoes } from './apoio/sessaoFalsa.ts'

const AAL2 = { aal: 'aal2' as const }
const LINK = 'http://127.0.0.1:8788/c/K7M2QX9PRT'

const abrirMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click()
  return page.getByRole('dialog', { name: 'Menu' })
}

test.describe('cliente', () => {
  test('N2 (solicitante): Regras do serviço sem preços; sem Equipe', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
    const chamadas = await simularApi(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Diego' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Atalhos' }).getByRole('link')).toHaveText([/Pedidos/, /Agenda/, /Regras do serviço/, /Extrato/])
    const menu = await abrirMenu(page)
    await expect(menu.getByRole('link')).toHaveText(['Início', 'Pedidos', 'Agenda', 'Regras do serviço', 'Extrato'])
    await menu.getByRole('link', { name: 'Regras do serviço' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Regras do serviço' })).toBeVisible()
    await expect(page.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
      '24 h ou mais antes: sem multa',
      'De 6 h a menos de 24 h antes: multa de 50%',
      'Menos de 6 h antes: multa de 100%',
    ])
    const prazos = page.getByTestId('regras-prazos')
    await expect(prazos).toContainText('Orçamento em até 12 horas')
    await expect(prazos).toContainText('Orçamento vale por 2 dias')
    await expect(prazos).toContainText('Urgente: menos de 6 horas')
    // Nada de preço, limite, versão ou autor.
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(/R\$|Versão|publicad|saldo|Quilômetro/i)
    expect(chamadas.map((c) => c.rpc)).not.toContain('precos_para_orcar')
    expect(chamadas.map((c) => c.rpc)).not.toContain('listar_contratos')

    // Equipe, Tabela e Contratos não abrem.
    for (const rota of ['/equipe', '/tabela', '/adm/contratos', '/parametros']) {
      await page.goto(rota)
      await expect(page.getByRole('heading', { name: 'Sem permissão' }), rota).toBeVisible()
    }
  })

  test('empresa sem contrato vigente: aviso no início e regras vazias', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 3, nome: 'Elisa Prado', empresa_tem_contrato: false })
    await simularApi(page, { regras: [] })
    await page.goto('/')
    await expect(page.getByTestId('aviso-sem-contrato')).toContainText(
      'Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.',
    )
    await page.goto('/regras')
    await expect(page.getByText('Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.')).toBeVisible()
  })

  test('N1 (gestora da empresa): Equipe com níveis; convida colega com nível; gerencia só colegas', async ({ page }) => {
    const enviados = await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 1, nome: 'Carla Dias', empresa_nome: 'Umi San' })
    const chamadas = await simularApi(page, { usuarios: EQUIPE })
    responderFuncoes(page, { ok: true, link: LINK }, { ok: true })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Atalhos' }).getByRole('link')).toHaveText([
      /Pedidos/,
      /Agenda/,
      /Regras do serviço/,
      /Extrato/,
      /Equipe/,
    ])
    // Barra inferior: até 4 destinos + "Menu"; Equipe fica no menu.
    await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('link')).toHaveText([
      'Início',
      'Pedidos',
      'Agenda',
      'Regras',
    ])
    const menuN1 = await abrirMenu(page)
    await menuN1.getByRole('link', { name: 'Equipe' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible()
    const lista = page.getByTestId('lista-usuarios')
    await expect(lista.getByRole('listitem')).toHaveCount(3)
    await expect(lista.getByRole('listitem').filter({ hasText: 'Diego Rocha' })).toContainText('Solicitante (N2)')
    await expect(lista.getByRole('listitem').filter({ hasText: 'Elisa Prado' })).toContainText('Visualizador (N3)')
    const eu = lista.getByRole('listitem').filter({ hasText: '(você)' })
    await expect(eu).toContainText('Gestor da empresa (N1)')
    // Sobre a própria conta: nada a gerenciar.
    await expect(eu.getByRole('button', { name: /Gerenciar/ })).toHaveCount(0)
    expect(chamadas.map((c) => c.rpc)).toContain('listar_usuarios')

    // Convite: sem perfil nem empresa; só o nível.
    const convidar = page.getByRole('button', { name: 'Convidar colega' })
    await convidar.click()
    const folha = page.getByRole('dialog', { name: 'Convidar colega' })
    await expect(folha.getByLabel('Perfil')).toHaveCount(0)
    await expect(folha.getByLabel('Empresa', { exact: true })).toHaveCount(0)
    await folha.getByLabel('Nome').fill('Fábio Lima')
    await folha.getByLabel('E-mail').fill('fabio@umisan.com.br')
    await folha.getByLabel('Nível na empresa').selectOption('3')
    await expect(folha.getByText('Vê os pedidos e o saldo da empresa, sem agir.')).toBeVisible()
    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    await expect(folha.getByTestId('link-gerado').getByRole('textbox')).toHaveValue(LINK)
    expect(enviados[0]).toEqual({
      funcao: 'convidar',
      corpo: { email: 'fabio@umisan.com.br', nome: 'Fábio Lima', papel: 'CLIENTE', empresa_id: null, nivel: 3 },
    })
    await page.keyboard.press('Escape')
    await expect(folha).toBeHidden()

    // Gerenciar colega: só novo link e desativar/reativar (sem trocar perfil nem 2FA).
    await page.getByRole('button', { name: 'Gerenciar Diego Rocha' }).click()
    const diego = page.getByRole('dialog', { name: 'Diego Rocha' })
    await expect(diego.getByRole('button', { name: /^Gerar novo link/ })).toBeVisible()
    await expect(diego.getByRole('button', { name: /^Trocar perfil/ })).toHaveCount(0)
    await expect(diego.getByRole('button', { name: /^Resetar 2FA/ })).toHaveCount(0)
    await diego.getByRole('button', { name: /^Desativar/ }).click()
    await diego.getByLabel('Motivo').fill('Saiu da empresa')
    await diego.getByRole('button', { name: 'Desativar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Diego Rocha foi desativado(a).' })).toBeVisible()
    expect(enviados[1]).toEqual({
      funcao: 'gerir-usuario',
      corpo: { acao: 'DESATIVAR', usuario_id: EQUIPE[1]!.usuario_id, motivo: 'Saiu da empresa' },
    })
  })
})

test.describe('motorista', () => {
  test('Tabela: modalidades com preços unitários e prazos; sem limites, versão, autor ou fotos', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'MOTORISTA', nome: 'Bruno Lima', tem_2fa: true }, AAL2)
    const chamadas = await simularApi(page)
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Atalhos' }).getByRole('link')).toHaveText([/Agenda/, /Pedidos/, /Tabela/])
    await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Tabela' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Tabela' })).toBeVisible()
    await expect(page.getByText('Umi San', { exact: true })).toBeVisible()
    const proprio = page.getByTestId('cartao-proprio')
    await expect(proprio.getByRole('heading', { name: 'Modalidade veículo próprio' })).toBeVisible()
    await expect(proprio).toContainText('Quilômetro sem reboque')
    await expect(proprio).toContainText(/R\$\s3,50/)
    const cliente = page.getByTestId('cartao-cliente')
    await expect(cliente.getByRole('heading', { name: 'Modalidade veículo do cliente' })).toBeVisible()
    await expect(cliente).toContainText(/R\$\s450,00/)
    await expect(page.getByTestId('cartao-prazos')).toContainText('Prazo para orçar')
    const texto = await page.locator('main').innerText()
    expect(texto).not.toMatch(/saldo|Versão|publicad|Fotos|Umi San\b.*Modalidade/i)
    expect(chamadas.find((c) => c.rpc === 'precos_para_orcar')?.corpo).toEqual({ p_empresa: EMPRESA_UMI.id })
    expect(chamadas.map((c) => c.rpc)).not.toContain('listar_contratos')
    expect(chamadas.map((c) => c.rpc)).not.toContain('historico_contrato')

    for (const rota of ['/adm/contratos', '/regras', '/equipe', '/parametros']) {
      await page.goto(rota)
      await expect(page.getByRole('heading', { name: 'Sem permissão' }), rota).toBeVisible()
    }
  })

  test('empresa sem contrato vigente: explica que não dá para orçar', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'MOTORISTA', tem_2fa: true }, AAL2)
    await simularApi(page, { precos: { [EMPRESA_UMI.id]: [] } })
    await page.goto('/tabela')
    await expect(page.getByText('Umi San ainda não tem contrato vigente')).toBeVisible()
  })
})

test.describe('gestor de frota', () => {
  test('exige 2FA como o ADM e o motorista', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'GESTOR_FROTA', tem_2fa: false })
    await page.goto('/')
    await expect(page).toHaveURL(/\/seguranca\/2fa$/)
    await expect(page.getByRole('heading', { name: 'Proteja sua conta de gestor de frota' })).toBeVisible()
  })

  test('início com a agenda da frota; nenhuma tela de preço', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'GESTOR_FROTA', nome: 'Gil Frota', tem_2fa: true }, AAL2)
    const chamadas = await simularApi(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Gil' })).toBeVisible()
    await expect(page.getByTestId('atalho-agenda')).toContainText('Agenda da frota')
    await expect(page.getByRole('region', { name: 'Atalhos' }).getByRole('link')).toHaveText([/Agenda/, /Pedidos/])
    const menu = await abrirMenu(page)
    await expect(menu.getByRole('link')).toHaveText(['Início', 'Pedidos', 'Agenda'])
    await page.keyboard.press('Escape')
    for (const rota of ['/tabela', '/regras', '/adm/contratos', '/parametros', '/equipe']) {
      await page.goto(rota)
      await expect(page.getByRole('heading', { name: 'Sem permissão' }), rota).toBeVisible()
    }
    const lidas = chamadas.map((c) => c.rpc)
    for (const rpc of ['precos_para_orcar', 'listar_contratos', 'historico_contrato', 'regras_do_servico']) {
      expect(lidas, rpc).not.toContain(rpc)
    }
  })
})

test('telas de cliente e motorista sem violação de CSP', async ({ page, browser }) => {
  const violacoes = await vigiarCsp(page)
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 1, empresa_nome: 'Umi San' })
  await simularApi(page, { usuarios: EQUIPE })
  for (const [rota, titulo] of [
    ['/regras', 'Regras do serviço'],
    ['/equipe', 'Equipe'],
  ] as const) {
    await page.goto(rota)
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  }
  expect(violacoes).toEqual([])

  const contexto = await browser.newContext({ ...test.info().project.use })
  try {
    const motorista = await contexto.newPage()
    const doMotorista = await vigiarCsp(motorista)
    await comSessaoFalsa(motorista, { papel: 'MOTORISTA', tem_2fa: true }, AAL2)
    await simularApi(motorista)
    await motorista.goto('/tabela')
    await expect(motorista.getByTestId('precos-para-orcar')).toBeVisible()
    expect(doMotorista).toEqual([])
  } finally {
    await contexto.close()
  }
})
