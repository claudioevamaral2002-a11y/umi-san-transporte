import { expect, test } from '@playwright/test'
import { EMPRESA_UMI, simularApi, USUARIOS } from './apoio/apiFalsa.ts'
import { comSessaoFalsa, responderFuncoes } from './apoio/sessaoFalsa.ts'

const ADM = { papel: 'ADM' as const, tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const LINK = 'http://127.0.0.1:8788/c/K7M2QX9PRT'

test.describe('administração', () => {
  test('ADM abre cada tela pelo menu', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    await page.goto('/')
    const telas = [
      ['Contratos', 'Contratos'],
      ['Usuários', 'Usuários'],
      ['Empresas', 'Empresas'],
      ['Configurações', 'Configurações'],
      ['Auditoria', 'Auditoria'],
    ] as const
    for (const [item, titulo] of telas) {
      await page.getByRole('button', { name: 'Menu' }).click()
      await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: item }).click()
      await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
    }
    await expect(page.getByTestId('auditoria-lista').getByRole('listitem')).toHaveCount(2)
  })

  test('usuários: lista com situação, busca e filtro por perfil', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    await page.goto('/adm/usuarios')
    const lista = page.getByTestId('lista-usuarios')
    await expect(lista.getByRole('listitem')).toHaveCount(3)
    const carla = lista.getByRole('listitem').filter({ hasText: 'Carla Dias' })
    await expect(carla).toContainText('Umi San · Gestor da empresa (N1)')
    await expect(carla).toContainText('Inativo')
    await expect(carla).toContainText('Senha pendente')
    await expect(lista.getByRole('listitem').filter({ hasText: 'Bruno Lima' })).toContainText('2FA ok')
    await expect(lista.getByRole('listitem').filter({ hasText: 'Ana Souza' })).toContainText('(você)')

    await page.getByLabel('Buscar por nome ou e-mail').fill('umisan')
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await page.getByLabel('Buscar por nome ou e-mail').fill('')
    await page.getByLabel('Perfil').selectOption('MOTORISTA')
    await expect(lista.getByRole('listitem')).toHaveText([/Bruno Lima/])
  })

  test('convite: link com Copiar e WhatsApp; e-mail já cadastrado sugere novo link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const enviados = await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    responderFuncoes(page, { ok: false, codigo: 'JA_CADASTRADO' }, { ok: true, link: LINK })
    await page.goto('/adm/usuarios')
    const convidar = page.getByRole('button', { name: 'Convidar' })
    await convidar.click()
    const folha = page.getByRole('dialog', { name: 'Convidar pessoa' })
    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    await expect(folha.getByText('Informe o nome (2 a 120 caracteres).')).toBeVisible()
    expect(enviados).toHaveLength(0)

    await folha.getByLabel('Nome').fill('Diego Rocha')
    await folha.getByLabel('E-mail').fill('diego@umisan.com.br')
    await folha.getByLabel('Perfil').selectOption('CLIENTE')
    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    await expect(folha.getByText('Escolha a empresa do cliente.')).toBeVisible()
    await folha.getByLabel('Empresa', { exact: true }).selectOption(EMPRESA_UMI.id)
    await expect(folha.getByLabel('Nível na empresa')).toHaveValue('1')
    await folha.getByLabel('Nível na empresa').selectOption('2')

    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    await expect(folha.getByRole('alert')).toContainText('Gerar novo link')
    await expect(folha.getByRole('button', { name: 'Ver na lista de usuários' })).toBeVisible()

    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    const link = folha.getByTestId('link-gerado')
    await expect(link).toContainText('Link válido por 24 h, uso único')
    await expect(link.getByRole('textbox')).toHaveValue(LINK)
    const whats = link.getByRole('link', { name: 'Enviar no WhatsApp' })
    const href = (await whats.getAttribute('href')) ?? ''
    expect(href.startsWith('https://wa.me/?text=')).toBe(true)
    expect(new URL(href).searchParams.get('text')).toContain(LINK)
    await expect(whats).toHaveAttribute('target', '_blank')

    await link.getByRole('button', { name: 'Copiar' }).click()
    await expect(link.getByText('Link copiado.')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK)
    expect(enviados[1]?.corpo).toEqual({
      email: 'diego@umisan.com.br',
      nome: 'Diego Rocha',
      papel: 'CLIENTE',
      empresa_id: EMPRESA_UMI.id,
      nivel: 2,
    })

    // Esc fecha e o foco volta ao botão que abriu.
    await page.keyboard.press('Escape')
    await expect(folha).toBeHidden()
    await expect(convidar).toBeFocused()
  })

  test('desativar exige motivo; ADM-alvo não tem novo link; reset de 2FA confirma', async ({ page }) => {
    const enviados = await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    await page.goto('/adm/usuarios')
    await page.getByRole('button', { name: 'Gerenciar Bruno Lima' }).click()
    const folha = page.getByRole('dialog', { name: 'Bruno Lima' })
    await folha.getByRole('button', { name: /^Desativar/ }).click()
    await expect(folha.getByText('A pessoa precisará entrar de novo.')).toBeVisible()
    await folha.getByLabel('Motivo').fill('ok')
    await folha.getByRole('button', { name: 'Desativar', exact: true }).click()
    await expect(folha.getByText('Explique o motivo (3 a 500 caracteres).')).toBeVisible()
    expect(enviados).toHaveLength(0)
    await folha.getByLabel('Motivo').fill('Saiu da empresa')
    await folha.getByRole('button', { name: 'Desativar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Bruno Lima foi desativado(a).' })).toBeVisible()
    expect(enviados[0]?.corpo).toEqual({ acao: 'DESATIVAR', usuario_id: USUARIOS[1]!.usuario_id, motivo: 'Saiu da empresa' })

    await page.getByRole('button', { name: 'Gerenciar Bruno Lima' }).click()
    await folha.getByRole('button', { name: /^Resetar 2FA/ }).click()
    await folha.getByRole('button', { name: 'Resetar 2FA', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '2FA de Bruno Lima resetado.' })).toBeVisible()
    expect(enviados[1]?.corpo).toEqual({ acao: 'RESETAR_2FA', usuario_id: USUARIOS[1]!.usuario_id })

    // ADM (a própria conta): sem novo link, sem desativar, perfil travado.
    await page.getByRole('button', { name: 'Gerenciar Ana Souza' }).click()
    const ana = page.getByRole('dialog', { name: 'Ana Souza' })
    await expect(ana.getByRole('button', { name: /Gerar novo link/ })).toHaveCount(0)
    await expect(ana.getByRole('button', { name: /^Desativar/ })).toHaveCount(0)
    await expect(ana.getByText(/procedimento manual/)).toBeVisible()
    await ana.getByRole('button', { name: /^Trocar perfil/ }).click()
    await expect(ana.getByLabel('Perfil')).toBeDisabled()
  })

  test('gerar novo link mostra o link; recusa ALVO_ADM explica o caminho manual', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    responderFuncoes(page, { ok: false, codigo: 'ALVO_ADM' }, { ok: true, link: LINK })
    await page.goto('/adm/usuarios')
    await page.getByRole('button', { name: 'Gerenciar Carla Dias' }).click()
    const folha = page.getByRole('dialog', { name: 'Carla Dias' })
    await folha.getByRole('button', { name: /^Gerar novo link/ }).click()
    await folha.getByRole('button', { name: 'Gerar link', exact: true }).click()
    await expect(folha.getByRole('alert')).toContainText('procedimento manual')
    await folha.getByRole('button', { name: 'Gerar link', exact: true }).click()
    await expect(folha.getByTestId('link-gerado').getByRole('textbox')).toHaveValue(LINK)
  })

  test('trocar perfil chama alterar_perfil com a empresa', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page)
    await page.goto('/adm/usuarios')
    await page.getByRole('button', { name: 'Gerenciar Bruno Lima' }).click()
    const folha = page.getByRole('dialog', { name: 'Bruno Lima' })
    await folha.getByRole('button', { name: /^Trocar perfil/ }).click()
    await folha.getByLabel('Perfil').selectOption('CLIENTE')
    await folha.getByLabel('Empresa', { exact: true }).selectOption(EMPRESA_UMI.id)
    await folha.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Perfil de Bruno Lima atualizado.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'alterar_perfil')?.corpo).toEqual({
      p_usuario: USUARIOS[1]!.usuario_id,
      p_nome: 'Bruno Lima',
      p_papel: 'CLIENTE',
      p_empresa: EMPRESA_UMI.id,
      p_nivel: 1,
    })
  })

  test('convite e troca de perfil para gestor de frota (sem empresa nem nível)', async ({ page }) => {
    const enviados = await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page)
    responderFuncoes(page, { ok: true, link: LINK })
    await page.goto('/adm/usuarios')
    await page.getByRole('button', { name: 'Convidar' }).click()
    const folha = page.getByRole('dialog', { name: 'Convidar pessoa' })
    await folha.getByLabel('Nome').fill('Gil Frota')
    await folha.getByLabel('E-mail').fill('gil@ivo.com.br')
    await folha.getByLabel('Perfil').selectOption('GESTOR_FROTA')
    await expect(folha.getByLabel('Nível na empresa')).toHaveCount(0)
    await expect(folha.getByText(/gestores de frota e motoristas cadastram o 2FA/)).toBeVisible()
    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    await expect(folha.getByTestId('link-gerado')).toBeVisible()
    expect(enviados[0]?.corpo).toEqual({
      email: 'gil@ivo.com.br',
      nome: 'Gil Frota',
      papel: 'GESTOR_FROTA',
      empresa_id: null,
      nivel: null,
    })
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Gerenciar Carla Dias' }).click()
    const carla = page.getByRole('dialog', { name: 'Carla Dias' })
    await carla.getByRole('button', { name: /^Trocar perfil/ }).click()
    await expect(carla.getByLabel('Nível na empresa')).toHaveValue('1')
    await carla.getByLabel('Nível na empresa').selectOption('3')
    await carla.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Perfil de Carla Dias atualizado.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'alterar_perfil')?.corpo).toEqual({
      p_usuario: USUARIOS[2]!.usuario_id,
      p_nome: 'Carla Dias',
      p_papel: 'CLIENTE',
      p_empresa: EMPRESA_UMI.id,
      p_nivel: 3,
    })
  })

  test('permissões: a matriz de delegação saiu do menu e da rota (fase 1B)', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Permissões' })).toHaveCount(0)
    await page.goto('/adm/permissoes')
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
  })

  test('empresas: criar, e logo com conferência de tipo/tamanho e envio', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page, { rpc: { salvar_empresa: { ok: true, id: 'nova' } } })
    await page.goto('/adm/empresas')
    await page.getByRole('button', { name: 'Nova empresa' }).click()
    const nova = page.getByRole('dialog', { name: 'Nova empresa' })
    await nova.getByLabel('Nome da empresa').fill('Porto Azul')
    await nova.getByRole('button', { name: 'Criar empresa' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Empresa Porto Azul criada.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'salvar_empresa')?.corpo).toEqual({ p_id: null, p_nome: 'Porto Azul' })

    await page.getByRole('button', { name: 'Logo de Umi San' }).click()
    const folha = page.getByRole('dialog', { name: 'Logo de Umi San' })
    const arquivo = folha.locator('input[type=file]')
    await arquivo.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
    await expect(folha.getByRole('alert')).toContainText('PNG ou WebP')
    await arquivo.setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(500 * 1024 + 1) })
    await expect(folha.getByRole('alert')).toContainText('500 KB')
    await expect(folha.getByRole('button', { name: 'Salvar logo' })).toBeDisabled()

    // PNG 1x1 válido.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await arquivo.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
    await expect(folha.getByRole('img', { name: 'Pré-visualização do novo logo' })).toBeVisible()
    await folha.getByRole('button', { name: 'Salvar logo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Logo de Umi San atualizado.' })).toBeVisible()
    const envio = chamadas.find((c) => c.rpc === 'storage')
    expect(String(envio?.corpo.url)).toContain(`/storage/v1/object/logos/${EMPRESA_UMI.id}/logo.png`)
    expect(chamadas.find((c) => c.rpc === 'definir_logo_empresa')?.corpo).toEqual({
      p_empresa: EMPRESA_UMI.id,
      p_caminho: `${EMPRESA_UMI.id}/logo.png`,
    })
  })

  test('auditoria: filtros enviados ao banco e detalhe sempre como texto', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await comSessaoFalsa(page, ADM, AAL2)
    const chamadas = await simularApi(page)
    await page.goto('/adm/auditoria')
    const tabela = page.getByTestId('auditoria-tabela')
    await expect(tabela).toBeVisible()
    await expect(tabela.getByRole('row')).toHaveCount(3)
    await expect(tabela).toContainText('Negado')

    await page.getByLabel('De', { exact: true }).fill('2026-10-01')
    await page.getByLabel('Até', { exact: true }).fill('2026-10-08')
    await page.getByLabel('Usuário', { exact: true }).selectOption(USUARIOS[1]!.usuario_id)
    await page.getByLabel('Ação', { exact: true }).selectOption('PUBLICAR_PARAMETROS')
    await page.getByLabel('Resultado', { exact: true }).selectOption('NEGADO')
    await page.getByLabel('Quantidade').selectOption('500')
    await page.getByRole('button', { name: 'Filtrar' }).click()
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'listar_auditoria').length).toBe(2)
    expect(chamadas.filter((c) => c.rpc === 'listar_auditoria')[1]?.corpo).toEqual({
      p_de: '2026-10-01T03:00:00.000Z',
      p_ate: '2026-10-09T02:59:59.999Z',
      p_usuario: USUARIOS[1]!.usuario_id,
      p_acao: 'PUBLICAR_PARAMETROS',
      p_resultado: 'NEGADO',
      p_limite: 500,
    })

    await tabela.getByRole('button', { name: /^Ver detalhe de Publicar tabela de preços em 08\/10\/2026 10:00/ }).click()
    const detalhe = tabela.getByTestId('detalhe-auditoria')
    await expect(detalhe).toContainText('<img src=x onerror=alert(1)>')
    await expect(detalhe.locator('img')).toHaveCount(0)
    await expect(detalhe).toContainText('203.0.113.9')
  })
})
