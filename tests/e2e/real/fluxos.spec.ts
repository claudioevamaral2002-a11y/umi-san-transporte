import { devices, expect, test, type Browser } from '@playwright/test'
import {
  CHAVE_PUBLICA,
  ORIGEM_APP,
  URL_SUPABASE,
  comBanco,
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

/** Contrato completo (13 campos), como o ADM publica. */
const CONTRATO = {
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
}

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
    expect(link).toMatch(new RegExp(`^${ORIGEM_APP}/c/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$`))
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

      // Início de motorista: a Tabela para orçar; sem a administração nem os contratos (fase 1B).
      await pagina.getByRole('button', { name: 'Menu' }).click()
      const menu = pagina.getByRole('dialog', { name: 'Menu' })
      await expect(menu.getByRole('link', { name: 'Início' })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Tabela' })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Contratos' })).toHaveCount(0)
      await expect(menu.getByRole('link', { name: 'Usuários' })).toHaveCount(0)
    } finally {
      await contexto.close()
    }
  })

  test('cliente convidado entra sem 2FA, vê a empresa com logo e as regras do serviço sem preços', async ({ page }) => {
    const nomeEmpresa = `Empresa Logo ${Date.now()}`
    const empresaId = await empresaNova(nomeEmpresa)
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Logo' })
    const caminho = `${empresaId}/logo.png`
    const envio = await adm.cliente.storage.from('logos').upload(caminho, pngMinimo(), { contentType: 'image/png', upsert: true })
    expect(envio.error).toBeNull()
    expect((await rpc(adm, 'definir_logo_empresa', { p_empresa: empresaId, p_caminho: caminho })).ok).toBe(true)
    // Contrato da empresa (vigente em segundos): o cliente vê só as regras dele.
    const contrato = await rpc(adm, 'publicar_contrato', {
      p_empresa: empresaId,
      p: CONTRATO,
      p_vigente_desde: new Date(Date.now() + 2_000).toISOString(),
    })
    expect(contrato.ok, JSON.stringify(contrato)).toBe(true)

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
      body: JSON.stringify({ email: emailCliente, nome: 'Carla Cliente', papel: 'CLIENTE', empresa_id: empresaId, nivel: 2 }),
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

    // Regras do serviço (Adendo A10): faixas e prazos do contrato da empresa, sem preços nem limites.
    await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Regras' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Regras do serviço' })).toBeVisible()
    await expect(page.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
      '48 h ou mais antes: sem multa',
      'Menos de 48 h antes: multa de 50%',
    ])
    await expect(page.getByTestId('regras-prazos')).toContainText('Orçamento em até 1 dia')
    await expect(page.getByTestId('regras-prazos')).toContainText('Orçamento vale por 3 dias')
    expect(await page.locator('main').innerText()).not.toMatch(/R\$|saldo|Versão/i)
    // Solicitante (N2) não tem Equipe; tabela e contratos não abrem.
    await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Equipe' })).toHaveCount(0)
    for (const rota of ['/parametros', '/adm/contratos', '/tabela', '/equipe']) {
      await page.goto(rota)
      await expect(page.getByRole('heading', { name: 'Sem permissão' }), rota).toBeVisible()
    }
    // Cliente também não entra na administração.
    await page.goto('/adm/usuarios')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
  })

  test('link curto: prévia não gasta; depois de usado, a segunda abertura avisa que expirou', async ({ page, browser }) => {
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Reuso' })
    const resposta = await fetch(`${URL_SUPABASE}/functions/v1/convidar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adm.token}`, apikey: CHAVE_PUBLICA, 'Content-Type': 'application/json', Origin: ORIGEM_APP },
      body: JSON.stringify({ email: emailUnico('reuso'), nome: 'Rita Reuso', papel: 'MOTORISTA' }),
    })
    const convite = (await resposta.json()) as { ok: boolean; link?: string }
    expect(convite.ok).toBe(true)

    // Várias "prévias" (GET do documento) antes do toque: nada é gasto.
    for (let i = 0; i < 3; i++) expect((await page.request.get(convite.link!)).status()).toBe(200)
    await definirSenhaPeloLink(page, convite.link!, senhaForte())

    const { contexto, pagina } = await novoContexto(browser)
    try {
      await pagina.goto(convite.link!)
      await pagina.getByRole('button', { name: 'Continuar' }).click()
      await expect(pagina.getByRole('alert')).toContainText('Este link expirou ou já foi usado. Peça um novo ao administrador.')
      await expect(pagina.getByRole('button', { name: 'Continuar' })).toHaveCount(0)
    } finally {
      await contexto.close()
    }
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

  test('ADM publica nova versão do contrato da Umi San (vigência futura) e a vê agendada', async ({ page }) => {
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Contrato' })
    const umi = (
      await comBanco((db) =>
        db.query<{ id: string }>("select id from app.empresas where nome = 'Umi San' order by criada_em, id limit 1"),
      )
    ).rows[0]!.id
    // Tabela modelo vigente em segundos: base do formulário se a Umi San ainda não tiver contrato.
    const modelo = await rpc(adm, 'publicar_contrato', {
      p_empresa: null,
      p: CONTRATO,
      p_vigente_desde: new Date(Date.now() + 3_000).toISOString(),
    })
    expect(modelo.ok, JSON.stringify(modelo)).toBe(true)

    await entrarComDoisFatores(page, adm.email, adm.senha, adm.segredoTotp!)
    await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Contratos' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Contratos' })).toBeVisible()
    await expect(page.getByTestId('contrato-modelo')).toContainText('Vigente')
    await page.getByTestId('lista-contratos').getByRole('listitem').filter({ hasText: 'Umi San' }).first().getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/adm/contratos/${umi}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Umi San' })).toBeVisible()

    // Com contrato: "Publicar nova versão"; sem contrato: "Criar contrato a partir da tabela modelo".
    await page.getByRole('button', { name: /^(Publicar nova versão|Criar contrato a partir da tabela modelo)$/ }).first().click()
    const folha = page.getByRole('dialog', { name: 'Publicar nova versão' })
    await expect(folha).toBeVisible()
    await expect(folha.getByLabel('Quilômetro sem reboque')).not.toHaveValue('')
    await folha.getByLabel('Quilômetro sem reboque').fill('4,75')

    // O campo é no horário de São Paulo (UTC-3, sem horário de verão): agora + 2 min, arredondado para cima.
    const alvo = new Date(Math.ceil((Date.now() + 2 * 60_000) / 60_000) * 60_000 - 3 * 3600_000)
    await folha.getByLabel('Vale a partir de').fill(alvo.toISOString().slice(0, 16))
    await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
    const confirmacao = folha.getByTestId('confirmacao-contrato')
    await expect(confirmacao).toBeVisible()
    await confirmacao.getByRole('button', { name: 'Publicar versão' }).click()

    const aviso = page.getByRole('status').filter({ hasText: /Versão \d+ publicada/ })
    await expect(aviso).toBeVisible({ timeout: 30_000 })
    const versao = /Versão (\d+) publicada/.exec(await aviso.innerText())![1]!
    const linha = page.getByTestId('historico-contrato').getByRole('listitem').filter({ hasText: new RegExp(`Versão ${versao}(?!\\d)`) })
    await expect(linha).toContainText('Agendada')
    await expect(linha).toContainText('publicada por Admin Contrato')

    // A lista mostra a próxima vigência da Umi San.
    await page.goto('/adm/contratos')
    await expect(
      page.getByTestId('lista-contratos').getByRole('listitem').filter({ hasText: 'Umi San' }).first(),
    ).toContainText('Nova versão agendada')
  })
})
