import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CHAVE_PUBLICA,
  URL_SUPABASE,
  comBanco,
  criarPessoa,
  empresaComContrato,
  motoristaUnico,
  rpc,
  type Pessoa,
  type Resultado,
} from './ajuda.ts'

/**
 * Fase 2B (núcleo de dinheiro) com concorrência real: chamadas em paralelo (Promise.all), cada uma por um cliente HTTP
 * próprio — logo, conexões e transações independentes no banco.
 */

/** Outro cliente HTTP com o mesmo token (mesma sessão, inclusive aal2): requisição e transação independentes. */
function outroCliente(p: Pessoa): Pick<Pessoa, 'cliente'> {
  return {
    cliente: createClient(URL_SUPABASE, CHAVE_PUBLICA, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'api' },
      global: { headers: { Authorization: `Bearer ${p.token}` } },
    }) as Pessoa['cliente'],
  }
}

const codigos = (rs: Resultado[]) => rs.map((r) => (r.ok ? 'OK' : r.codigo)).sort()

async function conta(empresa: string): Promise<{ contabil: number; reservado: number }> {
  return comBanco(async (db) => {
    const r = await db.query<{ c: string; r: string }>(
      'select saldo_contabil_cent as c, reservado_cent as r from app.contas where empresa_id = $1',
      [empresa],
    )
    return { contabil: Number(r.rows[0]!.c), reservado: Number(r.rows[0]!.r) }
  })
}

async function lancamentos(empresa: string): Promise<{ tipo: string; valor: number; atividade: string | null }[]> {
  return comBanco(async (db) => {
    const r = await db.query<{ tipo: string; valor: string; atividade: string | null }>(
      'select tipo, valor_cent as valor, atividade_id as atividade from app.lancamentos where empresa_id = $1 order by id',
      [empresa],
    )
    return r.rows.map((l) => ({ tipo: l.tipo, valor: Number(l.valor), atividade: l.atividade }))
  })
}

let motorista: Pessoa
let adm: Pessoa

beforeAll(async () => {
  motorista = await motoristaUnico()
  adm = await criarPessoa({ papel: 'ADM' })
}, 120_000)

async function recarga(empresa: string, valor: number, chave = randomUUID()): Promise<Resultado> {
  return rpc(outroCliente(adm), 'lancar_recarga', {
    p_empresa: empresa,
    p_valor_cent: valor,
    p_motivo: 'Pix de teste',
    p_comprovante: 'E2E-PIX',
    p_chave: chave,
  })
}

describe('livro-razão: recarga, ajuste e estorno com concorrência real', () => {
  it('10 recargas simultâneas com a MESMA chave → 1 lançamento e o mesmo resultado para todas', async () => {
    const empresa = await empresaComContrato()
    const chave = randomUUID()
    const resultados = await Promise.all(Array.from({ length: 10 }, () => recarga(empresa, 12345, chave)))
    expect(codigos(resultados)).toEqual(Array<string>(10).fill('OK'))
    for (const r of resultados) expect(r).toEqual(resultados[0])
    expect(await lancamentos(empresa)).toEqual([{ tipo: 'RECARGA', valor: 12345, atividade: null }])
    expect(await conta(empresa)).toEqual({ contabil: 12345, reservado: 0 })
  })

  it('10 recargas simultâneas com chaves diferentes → 10 lançamentos e saldo exato (lock da conta)', async () => {
    const empresa = await empresaComContrato()
    const resultados = await Promise.all(Array.from({ length: 10 }, (_, i) => recarga(empresa, 1000 + i)))
    expect(codigos(resultados)).toEqual(Array<string>(10).fill('OK'))
    // cada resultado viu o saldo depois do seu próprio lançamento: todos os saldos intermediários são distintos
    expect(new Set(resultados.map((r) => r.saldo_contabil_cent)).size).toBe(10)
    expect(Math.max(...resultados.map((r) => r.saldo_contabil_cent as number))).toBe(10045)
    expect(await conta(empresa)).toEqual({ contabil: 10045, reservado: 0 })
  })

  it('5 estornos simultâneos do mesmo lançamento (chaves diferentes) → 1 estorno', async () => {
    const empresa = await empresaComContrato()
    const r = await recarga(empresa, 5000)
    const ajuste = await rpc(adm, 'lancar_ajuste', { p_empresa: empresa, p_valor_cent: -700, p_motivo: 'Correção', p_chave: randomUUID() })
    expect(ajuste).toMatchObject({ ok: true, saldo_contabil_cent: 4300 })
    const estornos = await Promise.all(
      Array.from({ length: 5 }, () =>
        rpc(outroCliente(adm), 'estornar_lancamento', { p_lancamento: r.lancamento_id, p_motivo: 'Pix devolvido', p_chave: randomUUID() }),
      ),
    )
    expect(codigos(estornos)).toEqual(['JA_PROCESSADO', 'JA_PROCESSADO', 'JA_PROCESSADO', 'JA_PROCESSADO', 'OK'])
    expect((await lancamentos(empresa)).map((l) => `${l.tipo}:${l.valor}`)).toEqual(['RECARGA:5000', 'AJUSTE:-700', 'ESTORNO:-5000'])
    expect(await conta(empresa)).toEqual({ contabil: -700, reservado: 0 })
  })

  it('cliente nunca move saldo; motorista também não; ninguém lê o livro direto', async () => {
    const empresa = await empresaComContrato()
    const n1 = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 1 })
    const r = await recarga(empresa, 100)
    for (const quem of [n1, motorista]) {
      expect(await rpc(quem, 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 100, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() })).toEqual({
        ok: false,
        codigo: 'SEM_PERMISSAO',
      })
      expect(await rpc(quem, 'lancar_ajuste', { p_empresa: empresa, p_valor_cent: 100, p_motivo: 'Ajuste', p_chave: randomUUID() })).toEqual({
        ok: false,
        codigo: 'SEM_PERMISSAO',
      })
      expect(await rpc(quem, 'estornar_lancamento', { p_lancamento: r.lancamento_id, p_motivo: 'Estorno', p_chave: randomUUID() })).toEqual({
        ok: false,
        codigo: 'SEM_PERMISSAO',
      })
    }
    for (const tabela of ['lancamentos', 'contas']) {
      const { error } = await n1.cliente.from(tabela).select('*')
      expect(error, tabela).not.toBeNull()
    }
    expect(await conta(empresa)).toEqual({ contabil: 100, reservado: 0 })
    // o cliente vê o saldo e o extrato da própria empresa
    expect(await rpc(n1, 'saldo_empresa', {})).toMatchObject({ ok: true, saldo_contabil_cent: 100, disponivel_cent: 100 })
    const extrato = await rpc(n1, 'extrato', { p_empresa: null, p_filtro: {} })
    expect((extrato.itens as { tipo: string }[]).map((i) => i.tipo)).toEqual(['RECARGA'])
  })
})
