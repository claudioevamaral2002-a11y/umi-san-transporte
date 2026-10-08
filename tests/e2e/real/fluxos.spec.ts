import { devices, expect, test, type Browser } from '@playwright/test'
import {
  CHAVE_PUBLICA,
  ORIGEM_APP,
  URL_SUPABASE,
  confirmarCodigo,
  criarPessoa,
  definirSenhaPeloLink,
  emailUnico,
  empresaNova,
  entrarComDoisFatores,
  entrarComSenha,
  pngMinimo,
  rpc,
  senhaForte,
} from './apoio.ts'

// Fluxos contra o Supabase real do CI (Auth + Edge Functions + banco) — só rodam com E2E_BACKEND_REAL=1.
// Cada teste usa e-mails únicos; as pessoas "semeadas" nascem pelo Admin API com o mesmo helper dos testes de integração.

/** Segunda pessoa, outro navegador (outro armazenamento): abre o link de convite longe da sessão do ADM. */
async function novoContexto(browser: Browser) {
  const contexto = await browser.newContext({ ...devices['Pixel 7'], baseURL: ORIGEM_APP })
  return { contexto, pagina: await contexto.newPage() }
}

test.describe('fluxos reais', () => {
  test.setTimeout(240_000)

  test('ADM convida motorista pela tela: link, senha, login, 2FA e início de motorista', async ({ page, browser, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Convite' })
    await entrarComDoisFatores(page, adm.email, adm.senha, adm.segredoTotp!)
    await expect(page.getByRole('heading', { name: 'Olá, Admin' })).toBeVisible()

    await page.goto('/adm/usuarios')
    await page.getByRole('button', { name: 'Convidar' }).click()
    const folha = page.getByRole('dialog', { name: 'Convidar pessoa' })
    const emailMotorista = emailUnico('motorista')
    await folha.getByLabel('Nome').fill('Marlene Motorista')
    await folha.getByLabel('E-mail').fill(emailMotorista)
    await folha.getByLabel('Perfil').selectOption('MOTORISTA')
    await folha.getByRole('button', { name: 'Gerar link de convite' }).click()
    const gerado = folha.getByTestId('link-gerado')
    await expect(gerado).toBeVisible({ timeout: 30_000 })
    await gerado.getByRole('button', { name: 'Copiar' }).click()
    await expect(gerado.getByText('Link copiado.')).toBeVisible()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    expect(link).toContain('/auth/v1/verify')
    expect(link).toBe(await gerado.getByRole('textbox').inputValue())

    const { contexto, pagina } = await novoContexto(browser)
    try {
      const senha = senhaForte()
      await definirSenhaPeloLink(pagina, link, senha)
      await entrarComSenha(pagina, emailMotorista, senha)

      await expect(pagina.getByRole('heading', { name: 'Proteja sua conta de motorista' })).toBeVisible({ timeout: 30_000 })
      await expect(pagina.locator('code').first()).toBeVisible({ timeout: 20_000 })
      const chave = (await pagina.locator('code').first().innerText()).replace(/\s+/g, '')
      expect(chave).toMatch(/^[A-Z2-7]{16,}$/)
      await confirmarCodigo(pagina, chave)
      await expect(pagina.getByRole('heading', { name: 'Olá, Marlene' })).toBeVisible()

      // Início de motorista: sem a administração no menu.
      await pagina.getByRole('button', { name: 'Menu' }).click()
      const menu = pagina.getByRole('dialog', { name: 'Menu' })
      await expect(menu.getByRole('link', { name: 'Tabela de preços e regras' })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Usuários' })).toHaveCount(0)
    } finally {
      await contexto.close()
    }
  })

  test('cliente convidado entra sem 2FA, vê a empresa com logo e a tabela só para leitura', async ({ page }) => {
    const nomeEmpresa = `Empresa Logo ${Date.now()}`
    const empresaId = await empresaNova(nomeEmpresa)
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Logo' })
    const caminho = `${empresaId}/logo.png`
    const envio = await adm.cliente.storage.from('logos').upload(caminho, pngMinimo(), { contentType: 'image/png', upsert: true })
    expect(envio.error).toBeNull()
    expect((await rpc(adm, 'definir_logo_empresa', { p_empresa: empresaId, p_caminho: caminho })).ok).toBe(true)

    // Convite pela função (a mesma que a tela chama), com o JWT aal2 do ADM.
    const emailCliente = emailUnico('cliente')
    const resposta = await fetch(`${URL_SUPABASE}/functions/v1/convidar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adm.token}`,
        apikey: CHAVE_PUBLICA,
        'Content-Type': 'application/json',
        Origin: ORIGEM_APP,
      },
      body: JSON.stringify({ email: emailCliente, nome: 'Carla Cliente', papel: 'CLIENTE', empresa_id: empresaId }),
    })
    const convite = (await resposta.json()) as { ok: boolean; link?: string; codigo?: string }
    expect(convite, JSON.stringify(convite)).toMatchObject({ ok: true })

    const senha = senhaForte()
    await definirSenhaPeloLink(page, convite.link!, senha)
    await entrarComSenha(page, emailCliente, senha)

    // Cliente não passa por 2FA: vai direto ao início.
    await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible({ timeout: 30_000 })
    const pilula = page.getByTestId('empresa-cliente')
    await expect(pilula).toBeVisible()
    const logo = pilula.getByRole('img', { name: nomeEmpresa })
    await expect(logo).toBeVisible({ timeout: 15_000 })
    expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)

    await page.goto('/parametros')
    await expect(page.getByRole('heading', { name: 'Tabela de preços e regras' })).toBeVisible()
    await expect(page.getByText('Somente leitura')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publicar nova versão' })).toHaveCount(0)
    await page.goto('/parametros?publicar=1')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Cliente também não entra na administração.
    await page.goto('/adm/usuarios')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
  })

  test('motorista que força /adm/usuarios vê "Sem permissão" e o banco recusa a lista', async ({ page, request }) => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Bruno Motorista' })
    await entrarComDoisFatores(page, motorista.email, motorista.senha, motorista.segredoTotp!)

    await page.goto('/adm/usuarios')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
    await expect(page.getByTestId('lista-usuarios')).toHaveCount(0)

    // Mesma sessão do navegador chamando a RPC direto: sem GERIR_USUARIOS a lista vem vazia.
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i)
        if (chave?.endsWith('-auth-token')) return (JSON.parse(localStorage.getItem(chave)!) as { access_token: string }).access_token
      }
      return null
    })
    expect(token).toBeTruthy()
    const r = await request.post(`${URL_SUPABASE}/rest/v1/rpc/listar_usuarios`, {
      headers: { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${token}`, 'Content-Profile': 'api', 'Content-Type': 'application/json' },
      data: {},
    })
    const corpo = (await r.json()) as unknown
    expect(Array.isArray(corpo) ? corpo : []).toHaveLength(0)
  })

  test('ADM publica versão com vigência futura e a vê agendada no histórico', async ({ page }) => {
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Tabela' })
    // Versão inicial (vigente em segundos) para o formulário partir de valores reais.
    const inicial = await rpc(adm, 'publicar_parametros', {
      p: {
        km_sem_reboque_cent: 450,
        km_com_reboque_cent: 650,
        taxa_fixa_reboque_cent: 15000,
        retorno_trecho_unico_bp: 5000,
        hora_espera_cent: 8000,
        hospedagem_diaria_cent: 25000,
        diaria_motorista_cent: 20000,
        faixas_cancelamento: [
          { antecedencia_min_horas: 48, multa_bp: 0 },
          { antecedencia_min_horas: 0, multa_bp: 5000 },
        ],
        prazo_orcar_horas: 24,
        validade_orcamento_horas: 72,
        limiar_urgente_horas: 12,
        limite_saldo_negativo_cent: 100000,
        alerta_saldo_baixo_cent: 20000,
        retencao_fotos_dias: 365,
      },
      p_vigente_desde: new Date(Date.now() + 3_000).toISOString(),
    })
    expect(inicial.ok, JSON.stringify(inicial)).toBe(true)

    await entrarComDoisFatores(page, adm.email, adm.senha, adm.segredoTotp!)
    await page.goto('/parametros?publicar=1')
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await expect(folha).toBeVisible()
    await folha.getByLabel('Quilômetro sem reboque').fill('4,75')

    // O campo é no horário de São Paulo (UTC-3, sem horário de verão): agora + 2 min, arredondado para cima.
    const alvo = new Date(Math.ceil((Date.now() + 2 * 60_000) / 60_000) * 60_000 - 3 * 3600_000)
    await folha.getByLabel('Vale a partir de').fill(alvo.toISOString().slice(0, 16))
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    const confirmacao = folha.getByTestId('confirmacao-parametros')
    await expect(confirmacao.getByText(/1 item muda/)).toBeVisible()
    await confirmacao.getByRole('button', { name: 'Publicar versão' }).click()

    const aviso = page.getByRole('status').filter({ hasText: /Versão \d+ publicada/ })
    await expect(aviso).toBeVisible({ timeout: 30_000 })
    const versao = /Versão (\d+) publicada/.exec(await aviso.innerText())![1]!
    const linha = page.getByRole('listitem').filter({ hasText: new RegExp(`Versão ${versao}\\b`) })
    await expect(linha).toContainText('Agendada')
    await expect(page.getByText(new RegExp(`A versão ${versao} entra em vigor em`))).toBeVisible()
  })
})
