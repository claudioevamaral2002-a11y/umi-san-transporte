import './ambiente.ts'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { expect, type Page } from '@playwright/test'
import { CONTRATO_TESTE, comBanco, empresaNova } from '../../integracao/ajuda.ts'
import { gerarTotp } from '../../integracao/totp.ts'

export * from '../../integracao/ajuda.ts'

/** Origem do app no teste (a mesma do APP_ORIGENS das Edge Functions no CI). */
export const ORIGEM_APP = 'http://127.0.0.1:8788'

/** Senha forte e única (maiúscula, minúscula, número; fora das listas de vazamento). */
export const senhaForte = () => `Ivo-${randomUUID()}-9aZ`

export const emailUnico = (prefixo: string) => `${prefixo}-${randomUUID()}@teste.local`

/** Entra pela tela: espera o token do Turnstile (o botão só habilita depois). */
export async function entrarComSenha(page: Page, email: string, senha: string) {
  await page.goto('/entrar')
  await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible()
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(senha)
  const entrar = page.getByRole('button', { name: 'Entrar', exact: true })
  await expect(entrar).toBeEnabled({ timeout: 30_000 })
  await entrar.click()
}

async function digitarCodigo(page: Page, codigo: string) {
  for (let i = 0; i < 6; i++) await page.getByLabel(`Dígito ${i + 1} de 6`).fill(codigo[i]!)
}

/**
 * Digita o código TOTP calculado do segredo e espera a saudação do Início. Se o código for recusado (virada da
 * janela de 30 s), espera a próxima janela e tenta de novo.
 */
export async function confirmarCodigo(page: Page, segredo: string) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await digitarCodigo(page, gerarTotp(segredo))
    const resultado = await Promise.race([
      page
        .getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite),/ })
        .waitFor({ timeout: 20_000 })
        .then(
          () => 'ok',
          () => 'nada',
        ),
      page
        .getByRole('alert')
        .first()
        .waitFor({ timeout: 20_000 })
        .then(
          () => 'erro',
          () => 'nada',
        ),
    ])
    if (resultado === 'ok') return
    if (resultado === 'nada') break
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000)
  }
  await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite),/ })).toBeVisible({ timeout: 5_000 })
}

/** Login completo de quem já tem 2FA cadastrado: senha + código; termina no Início. */
export async function entrarComDoisFatores(page: Page, email: string, senha: string, segredo: string) {
  await entrarComSenha(page, email, senha)
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible({ timeout: 20_000 })
  await confirmarCodigo(page, segredo)
}

/**
 * Da tela do link curto até o novo login: prévia (GET) → "Continuar" → "Crie sua senha" → /entrar.
 * Antes do toque, simula o que WhatsApp/navegador fazem (GET do link e uma recarga): nada pode ser gasto.
 */
export async function definirSenhaPeloLink(page: Page, link: string, senha: string) {
  expect(link).toMatch(/\/c\/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
  const previa = await page.request.get(link)
  expect(previa.status()).toBe(200)
  await page.goto(link)
  await expect(page.getByText('Toque em Continuar para validar seu link de acesso.')).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page).toHaveURL(/\/definir-senha$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible()
  await page.getByLabel('Nova senha').fill(senha)
  await page.getByLabel('Repita a senha').fill(senha)
  await page.getByRole('button', { name: 'Criar senha' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Senha criada. Entre com a nova senha.')).toBeVisible()
}

/** PNG 1x1 válido (vermelho), para o logo da empresa. */
export function pngMinimo(): Buffer {
  const crc32 = (buf: Buffer) => {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(dados.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, dados])))
    return Buffer.concat([len, t, dados, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    bloco('IEND', Buffer.alloc(0)),
  ])
}

/** PDF mínimo e único (o bucket notas-fiscais só confere o tipo e o tamanho). */
export function pdfMinimo(): Buffer {
  return Buffer.from(`%PDF-1.4\n% NF de teste ${randomUUID()}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`)
}

/** Empresa nova com contrato no Crédito vigente há 90 dias (antes de qualquer quinzena fechada). */
export async function empresaComContratoAntigo(): Promise<string> {
  const empresa = await empresaNova()
  await comBanco((db) =>
    db.query(`select interno.inserir_contrato($1, $2::jsonb, now() - interval '90 days', null, 'Teste')`, [
      empresa,
      JSON.stringify(CONTRATO_TESTE),
    ]),
  )
  return empresa
}

/**
 * v2.1: leva o Faturado da empresa e o DEBITO da corrida para a última quinzena fechada, para o Master poder gerar a
 * fatura hoje. A versão Faturado passa a valer desde o início da quinzena e o DEBITO vai para o meio-dia do último dia
 * dela (horário de Brasília). Contrato e livro-razão são imutáveis: SÓ neste cenário de teste os gatilhos que barram o
 * update são desligados, numa transação (o DDL volta junto se algo falhar). Devolve a quinzena (AAAA-MM-DD).
 */
export async function levarParaQuinzenaFechada(empresa: string, atividade: string): Promise<{ inicio: string; fim: string }> {
  return comBanco(async (db) => {
    await db.query('begin')
    try {
      const q = (
        await db.query<{ inicio: string; fim: string }>(
          'select inicio::text as inicio, fim::text as fim from interno.ultima_quinzena_fechada()',
        )
      ).rows[0]!
      await db.query('alter table app.contratos_versoes disable trigger contratos_sem_update')
      const c = await db.query(
        `update app.contratos_versoes set vigente_desde = $2::date::timestamp at time zone 'America/Sao_Paulo'
          where empresa_id = $1 and forma_cobranca = 'FATURADO'`,
        [empresa, q.inicio],
      )
      await db.query('alter table app.contratos_versoes enable trigger contratos_sem_update')
      await db.query('alter table app.lancamentos disable trigger lancamentos_sem_update')
      const l = await db.query(
        `update app.lancamentos set criado_em = ($2::date + time '12:00') at time zone 'America/Sao_Paulo'
          where empresa_id = $1 and atividade_id = $3 and tipo = 'DEBITO'`,
        [empresa, q.fim, atividade],
      )
      await db.query('alter table app.lancamentos enable trigger lancamentos_sem_update')
      if (c.rowCount !== 1 || l.rowCount !== 1) throw new Error(`esperava 1 contrato e 1 DEBITO (${c.rowCount}, ${l.rowCount})`)
      await db.query('commit')
      return q
    } catch (e) {
      await db.query('rollback')
      throw e
    }
  })
}
