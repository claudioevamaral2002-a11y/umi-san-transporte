import { expect, test, type Page } from '@playwright/test'
import { confirmarCodigo, criarPessoa, entrarComSenha } from './apoio.ts'

// Bug de produção: o código do autenticador era pedido de novo a cada abertura do app (a senha, não).
// Depois do TOTP a sessão é aal2 e precisa continuar aal2 em recarga, reabertura e renovação do token.

interface SessaoGuardada {
  access_token: string
  refresh_token: string
  expires_at: number
}

const lerSessao = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i)!
      if (chave.endsWith('-auth-token')) return { chave, valor: JSON.parse(localStorage.getItem(chave)!) as SessaoGuardada }
    }
    return null
  })

const aalDo = (jwt: string) =>
  (JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { aal?: string }).aal ?? null

async function esperarInicioSemCodigo(page: Page, nome: string) {
  await expect(page.getByRole('heading', { name: `Olá, ${nome}` })).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/:\/\/[^/]+\/$/)
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toHaveCount(0)
}

test.describe('2FA: o código só é pedido num login novo', () => {
  test('ADM com TOTP: recarga, reabertura, token vencido e renovação automática continuam no Início (aal2)', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000)
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Alice Sessao' })
    await entrarComSenha(page, adm.email, adm.senha)
    await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible({ timeout: 20_000 })
    // Token de antes do 2FA (aal1), para simular o aparelho que ficou com ele (passo 5).
    const preMfa = (await lerSessao(page))!.valor
    expect(aalDo(preMfa.access_token)).toBe('aal1')
    await confirmarCodigo(page, adm.segredoTotp!)
    const inicial = await lerSessao(page)
    expect(inicial).not.toBeNull()
    expect(aalDo(inicial!.valor.access_token)).toBe('aal2')

    // 1) Recarregar (a sessão em memória some; volta do armazenamento).
    await page.reload()
    await esperarInicioSemCodigo(page, 'Alice')

    // 2) Reabrir: outra aba/janela do mesmo app (mesmo armazenamento), direto na raiz.
    const outra = await context.newPage()
    await outra.goto('/')
    await esperarInicioSemCodigo(outra, 'Alice')
    await outra.close()

    // 3) App reaberto depois do vencimento do token de acesso (JWT de 15 min): o app renova no servidor.
    const antes = (await lerSessao(page))!
    await page.evaluate(
      ([chave, valor]) => localStorage.setItem(chave, valor),
      [antes.chave, JSON.stringify({ ...antes.valor, expires_at: Math.floor(Date.now() / 1000) - 60 })] as const,
    )
    await page.reload()
    await esperarInicioSemCodigo(page, 'Alice')
    const renovada = (await lerSessao(page))!
    expect(renovada.valor.access_token).not.toBe(antes.valor.access_token)
    expect(renovada.valor.refresh_token).not.toBe(antes.valor.refresh_token)
    expect(aalDo(renovada.valor.access_token)).toBe('aal2')

    // 4) Renovação automática com o app aberto (token perto de vencer): continua aal2, sem pedir código.
    await page.evaluate(
      ([chave, valor]) => localStorage.setItem(chave, valor),
      [renovada.chave, JSON.stringify({ ...renovada.valor, expires_at: Math.floor(Date.now() / 1000) + 20 })] as const,
    )
    await page.reload()
    await esperarInicioSemCodigo(page, 'Alice')
    await expect
      .poll(async () => (await lerSessao(page))!.valor.refresh_token, { timeout: 60_000 })
      .not.toBe(renovada.valor.refresh_token)
    expect(aalDo((await lerSessao(page))!.valor.access_token)).toBe('aal2')
    await expect(page.getByRole('heading', { name: 'Digite o código' })).toHaveCount(0)
    await page.reload()
    await esperarInicioSemCodigo(page, 'Alice')

    // 5) O aparelho ficou com o token de acesso de ANTES do 2FA (resposta da verificação perdida ao trocar de app,
    //    app fechado no meio, outra janela): a sessão no servidor já é aal2, então o app renova e não pede o código.
    const atual = (await lerSessao(page))!
    await page.evaluate(
      ([chave, valor]) => localStorage.setItem(chave, valor),
      [atual.chave, JSON.stringify({ ...atual.valor, access_token: preMfa.access_token, expires_at: preMfa.expires_at })] as const,
    )
    await page.reload()
    await esperarInicioSemCodigo(page, 'Alice')
    expect(aalDo((await lerSessao(page))!.valor.access_token)).toBe('aal2')
  })
})
