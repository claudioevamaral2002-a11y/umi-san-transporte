import { expect, test } from '@playwright/test'
import { comSessaoFalsa, json, responderFuncoes, simularResgateDeLink, URL_SUPABASE } from './apoio/sessaoFalsa.ts'
import { esperarInicioComAviso } from './apoio/areaIndisponivel.ts'

test.describe('guardas', () => {
  test('anônimo em rota protegida vai para /entrar', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/entrar$/)
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
    await page.goto('/definir-senha')
    await expect(page).toHaveURL(/\/entrar$/)
    await page.goto('/seguranca/2fa')
    await expect(page).toHaveURL(/\/entrar$/)
  })

  test('link expirado mostra aviso na entrada', async ({ page }) => {
    await page.goto('/definir-senha#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
    await expect(page).toHaveURL(/\/entrar/)
    await expect(page.getByText('Este link expirou ou já foi usado.')).toBeVisible()
  })

  test('rota desconhecida mostra 404', async ({ page }) => {
    await page.goto('/nao-existe')
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
  })
})

test.describe('/entrar', () => {
  test('campos rotulados, mostrar/ocultar senha e erro genérico com novo CAPTCHA', async ({ page }) => {
    let tentativas = 0
    const tokens: string[] = []
    await page.route(`${URL_SUPABASE}/auth/v1/token?grant_type=password`, async (route) => {
      tentativas++
      const corpo = route.request().postDataJSON() as { password: string; gotrue_meta_security?: { captcha_token?: string } }
      tokens.push(corpo.gotrue_meta_security?.captcha_token ?? '')
      expect(corpo.password).toBe('Café-Forte-12') // normalizada em NFC
      await json(route, { code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
    })
    await page.goto('/entrar')
    await page.getByLabel('E-mail').fill('pessoa@exemplo.com.br')
    const senha = page.getByLabel('Senha', { exact: true })
    await senha.fill('Café-Forte-12')
    await expect(senha).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Mostrar senha' }).click()
    await expect(senha).toHaveAttribute('type', 'text')

    const entrar = page.getByRole('button', { name: 'Entrar' })
    await expect(entrar).toBeEnabled({ timeout: 20_000 }) // token do Turnstile (chave de teste)
    await entrar.click()
    await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.')
    expect(tentativas).toBe(1)
    expect(tokens[0]).not.toBe('')
    // O CAPTCHA foi reiniciado: novo token antes de liberar outra tentativa.
    await senha.fill('Café-Forte-12')
    await expect(entrar).toBeEnabled({ timeout: 20_000 })
  })
})

test.describe('/c/<código> (link curto de acesso)', () => {
  const LINK = '/c/K7M2QX9PRT'
  const ORIGEM_APP = 'http://127.0.0.1:8788'

  test('abrir sem tocar não chama nada (pré-visualização é inofensiva) e nada vaza para terceiros', async ({ page }) => {
    const pedidos = await simularResgateDeLink(page, 'sessao')
    const resposta = await page.goto(LINK)
    // Referrer-Policy: para outras origens só vai a origem (nunca o caminho com o código).
    expect(resposta?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
    await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible()
    await expect(page.getByText('Toque em Continuar para validar seu link de acesso.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible()
    await page.waitForTimeout(500)

    expect(pedidos.filter((p) => p.url.includes('/functions/v1/') || p.url.includes('/auth/v1/verify'))).toEqual([])
    expect(pedidos.filter((p) => !p.url.startsWith(ORIGEM_APP))).toEqual([])
    await expect(page.locator('script[src*="challenges.cloudflare.com"]')).toHaveCount(0)
  })

  test('Continuar resgata uma vez, abre a sessão e leva ao formulário de senha (código some da URL)', async ({ page }) => {
    const pedidos = await simularResgateDeLink(page, 'sessao')
    await page.goto('/c/k7m2-qx9prt')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page).toHaveURL(/\/definir-senha$/)
    await expect(page.getByLabel('Nova senha')).toBeVisible()
    await expect(page.getByText('Primeiro acesso')).toBeVisible()
    const resgates = pedidos.filter((p) => p.url.endsWith('/functions/v1/resgatar-link') && p.metodo === 'POST')
    expect(resgates).toHaveLength(1)
    expect(pedidos.some((p) => p.url.includes('/auth/v1/verify'))).toBe(false)
    // voltar não reabre a tela do link (replace no histórico)
    expect(await page.evaluate(() => location.href)).not.toContain('K7M2')
  })

  test('link usado ou expirado: mensagem clara, sem botão de tentar de novo', async ({ page }) => {
    const pedidos = await simularResgateDeLink(page, { ok: false, codigo: 'EXPIRADO' })
    await page.goto(LINK)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('alert')).toContainText('Este link expirou ou já foi usado. Peça um novo ao administrador.')
    await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Ir para a entrada' })).toBeVisible()
    expect(pedidos.filter((p) => p.url.endsWith('/functions/v1/resgatar-link') && p.metodo === 'POST')).toHaveLength(1)
  })

  test('código malformado: aviso direto, sem chamar o servidor', async ({ page }) => {
    const pedidos = await simularResgateDeLink(page, 'sessao')
    await page.goto('/c/nao-e-codigo')
    await expect(page.getByRole('alert')).toContainText('Este link expirou ou já foi usado.')
    await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0)
    expect(pedidos.filter((p) => p.url.includes('/functions/v1/'))).toEqual([])
  })

  test('falha de rede: pode tentar de novo', async ({ page }) => {
    await simularResgateDeLink(page, 'sessao')
    await page.route(`${URL_SUPABASE}/functions/v1/resgatar-link`, (route) => route.abort('failed'))
    await page.goto(LINK)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('alert')).toContainText('Algo deu errado')
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled()
  })
})

test.describe('/definir-senha', () => {
  test('medidor espelha as regras, traduz a recusa e, com sucesso, volta à entrada', async ({ page }) => {
    const enviados = await comSessaoFalsa(page, { papel: 'MOTORISTA', senha_pendente: true })
    responderFuncoes(page, { ok: false, codigo: 'SENHA_VAZADA' })
    await page.goto('/definir-senha')
    await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible()
    await expect(page.getByText('Passo 1 de 2')).toBeVisible()

    const criar = page.getByRole('button', { name: 'Criar senha' })
    await page.getByLabel('Nova senha').fill('abc')
    await expect(page.getByText('Pelo menos 10 caracteres — pendente')).toBeAttached()
    await expect(criar).toBeDisabled()

    await page.getByLabel('Nova senha').fill('Password1234')
    await page.getByLabel('Repita a senha').fill('Password1234')
    await expect(criar).toBeEnabled()
    await criar.click()
    await expect(page.getByRole('alert')).toContainText('Essa senha já apareceu em vazamentos. Escolha outra.')

    await page.getByLabel('Nova senha').fill('Café-Forte-12')
    await page.getByLabel('Repita a senha').fill('Café-Forte-12')
    await criar.click()
    await expect(page).toHaveURL(/\/entrar$/)
    await expect(page.getByText('Senha criada. Entre com a nova senha.')).toBeVisible()
    expect(enviados.map((e) => e.funcao)).toEqual(['definir-senha', 'definir-senha'])
    expect(enviados[1]?.corpo).toEqual({ senha: 'Café-Forte-12' })
  })
})

test.describe('/seguranca/2fa', () => {
  test('cadastro: QR, chave copiável e 6 caixas preenchidas ao colar', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'MOTORISTA', tem_2fa: false })
    await page.goto('/')
    await expect(page).toHaveURL(/\/seguranca\/2fa$/)
    await expect(page.getByRole('heading', { name: 'Proteja sua conta de motorista' })).toBeVisible()
    await expect(page.getByText('Passo 2 de 2')).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toBeVisible()
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible()

    const codigos: string[] = []
    await page.route(`${URL_SUPABASE}/auth/v1/factors/*/verify`, async (route) => {
      codigos.push((route.request().postDataJSON() as { code: string }).code)
      await json(route, { code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, 422)
    })
    const primeira = page.getByLabel('Dígito 1 de 6')
    await expect(primeira).toHaveAttribute('autocomplete', 'one-time-code')
    await primeira.focus()
    await page.evaluate(() => {
      const dados = new DataTransfer()
      dados.setData('text', '123 456')
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dados, bubbles: true, cancelable: true }))
    })
    // Colar preenche as 6 caixas e já confere o código completo.
    await expect.poll(() => codigos).toEqual(['123456'])
    // A verificação simulada recusa: mensagem e caixas limpas.
    await expect(page.getByRole('alert')).toContainText('Código incorreto')
    await expect(primeira).toHaveValue('')
  })

  test('login com 2FA já cadastrado: só as 6 caixas', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'ADM', tem_2fa: true })
    await page.goto('/')
    await expect(page).toHaveURL(/\/seguranca\/2fa$/)
    await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Código QR/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })
})

test.describe('moldura autenticada', () => {
  test('ADM vê o grupo Administração; motorista não, e a URL forçada mostra "sem permissão"', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'ADM', tem_2fa: true }, { aal: 'aal2' })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('dialog').getByText('Administração')).toBeVisible()
  })

  test('motorista não vê Administração', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'MOTORISTA', tem_2fa: true }, { aal: 'aal2' })
    await page.goto('/adm/usuarios')
    await esperarInicioComAviso(page)
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('dialog').getByText('Administração')).toHaveCount(0)
  })

  test('cliente vê o nome da empresa no topo e não precisa de 2FA', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', empresa_nome: 'Umi San' })
    await page.goto('/')
    await expect(page.getByTestId('empresa-cliente')).toHaveText('Umi San')
  })

  test('conta desativada vai para /sem-acesso', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'CLIENTE', ativo: false })
    await page.goto('/')
    await expect(page).toHaveURL(/\/sem-acesso$/)
    await expect(page.getByRole('heading', { name: 'Sua conta não está ativa' })).toBeVisible()
  })
})
