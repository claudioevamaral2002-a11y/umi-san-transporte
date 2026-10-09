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

/** Espera até alguma conexão ficar parada esperando trava numa consulta que contém `trecho` (até 10 s). */
async function esperarBloqueio(trecho: string): Promise<void> {
  const limite = Date.now() + 10_000
  while (Date.now() < limite) {
    const n = await comBanco(
      async (db) =>
        (
          await db.query<{ n: string }>(
            `select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1`,
            [`%${trecho}%`],
          )
        ).rows[0]!.n,
    )
    if (Number(n) > 0) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`ninguém ficou esperando trava em ${trecho}`)
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

// ------------------------------------------------------------------------------------------------ Task 2

/** Início daqui a `horas` horas (minuto cheio), em ISO UTC. */
function emHoras(horas: number): string {
  const d = new Date(Date.now() + horas * 3_600_000)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}
/** Horários distintos (pedidos de 2 h): longe (sem multa) e perto (< 24 h: multa de 100% no contrato de teste). */
let horaLonge = 24 * 60
const slotLonge = () => emHoras((horaLonge += 3))
let horaPerto = 1
const slotPerto = () => {
  horaPerto += 2.5
  if (horaPerto > 22) throw new Error('acabaram os horários a menos de 24 h')
  return emHoras(horaPerto)
}

interface Orcado {
  id: string
  versao: number
  hash: string
}

/** Cliente cria → motorista orça (total = pedágio informado) → o cliente lê versão e hash no detalhe. */
async function pedidoOrcado(cliente: Pessoa, inicio: string, total: number): Promise<Orcado> {
  const p = await rpc(cliente, 'criar_pedido', {
    p: {
      inicio,
      duracao_min: 120,
      origem: 'Porto de Itajaí',
      destino: 'Base Navegantes',
      levar: true,
      trazer: false,
      carga: 'PESSOAS',
      pessoas_qtd: 2,
      modalidade: 'VEICULO_PROPRIO',
      reboque: 'NAO',
    },
  })
  expect(p, 'criar_pedido').toMatchObject({ ok: true })
  expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: p.id, p: { pedagio_cent: total } })).toMatchObject({
    ok: true,
    total_cent: total,
  })
  const detalhe = await rpc(cliente, 'pedido', { p_id: p.id })
  const o = detalhe.orcamento as { versao: number; hash: string; total_cent: number }
  expect(o.total_cent).toBe(total)
  return { id: p.id as string, versao: o.versao, hash: o.hash }
}

function aprovar(quem: Pick<Pessoa, 'cliente'>, o: Orcado, chave = randomUUID()): Promise<Resultado> {
  return rpc(quem, 'aprovar_orcamento', {
    p_atividade: o.id,
    p_versao: o.versao,
    p_hash: o.hash,
    p_chave: chave,
    p_dispositivo: 'vitest',
  })
}

async function estado(atividade: string) {
  return comBanco(async (db) => {
    const a = await db.query<{ status: string; tipo: string; ativo: boolean }>(
      'select a.status, b.tipo, b.ativo from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = $1',
      [atividade],
    )
    const r = await db.query<{ n: string }>('select count(*) as n from app.reservas where atividade_id = $1 and ativa', [
      atividade,
    ])
    const l = await db.query<{ tipo: string; valor: string }>(
      'select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id',
      [atividade],
    )
    const ap = await db.query<{ n: string }>('select count(*) as n from app.aprovacoes where atividade_id = $1', [atividade])
    return {
      ...a.rows[0]!,
      reservasAtivas: Number(r.rows[0]!.n),
      aprovacoes: Number(ap.rows[0]!.n),
      lancamentos: l.rows.map((x) => `${x.tipo}:${Number(x.valor)}`),
    }
  })
}

/** Empresa com contrato (limite R$ 500,00), saldo inicial e um cliente N2 novo (limites de taxa são por usuário). */
async function cenario(saldo: number): Promise<{ empresa: string; cliente: Pessoa }> {
  const empresa = await empresaComContrato()
  if (saldo > 0) expect(await recarga(empresa, saldo)).toMatchObject({ ok: true })
  const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2 })
  return { empresa, cliente }
}

describe('aprovação: concorrência real e crédito', () => {
  it('10 aprovações simultâneas (chaves diferentes) → 1 reserva; a reserva não altera o contábil', async () => {
    const { empresa, cliente } = await cenario(100000)
    const o = await pedidoOrcado(cliente, slotLonge(), 30000)
    const resultados = await Promise.all(Array.from({ length: 10 }, () => aprovar(outroCliente(cliente), o)))
    expect(codigos(resultados)).toEqual(['OK', ...Array<string>(9).fill('STATUS_INVALIDO')])
    expect(resultados.find((r) => r.ok)).toEqual({
      ok: true,
      atividade_id: o.id,
      reservado_cent: 30000,
      disponivel_cent: 70000,
    })
    expect(await estado(o.id)).toEqual({
      status: 'AGENDADA',
      tipo: 'RESERVA',
      ativo: true,
      reservasAtivas: 1,
      aprovacoes: 1,
      lancamentos: ['RESERVA:30000'],
    })
    expect(await conta(empresa)).toEqual({ contabil: 100000, reservado: 30000 })
    expect(await rpc(cliente, 'saldo_empresa', {})).toMatchObject({
      saldo_contabil_cent: 100000,
      reservado_cent: 30000,
      disponivel_cent: 70000,
    })
  })

  it('dois pedidos disputando o mesmo saldo → só o que cabe no limite é aprovado', async () => {
    const { empresa, cliente } = await cenario(0)
    const a = await pedidoOrcado(cliente, slotLonge(), 30000)
    const b = await pedidoOrcado(cliente, slotLonge(), 30000)
    const resultados = await Promise.all([aprovar(outroCliente(cliente), a), aprovar(outroCliente(cliente), b)])
    expect(codigos(resultados)).toEqual(['OK', 'SALDO_INSUFICIENTE'])
    expect(resultados.find((r) => !r.ok)).toEqual({
      ok: false,
      codigo: 'SALDO_INSUFICIENTE',
      disponivel_cent: -30000,
      limite_cent: 50000,
      total_cent: 30000,
      falta_cent: 10000,
    })
    expect(await conta(empresa)).toEqual({ contabil: 0, reservado: 30000 })
  })

  it('cinco pedidos de R$ 200,00 ao mesmo tempo com limite de R$ 500,00 → exatamente 2 aprovados', async () => {
    const { empresa, cliente } = await cenario(0)
    const pedidos: Orcado[] = []
    for (let i = 0; i < 5; i++) pedidos.push(await pedidoOrcado(cliente, slotLonge(), 20000))
    const resultados = await Promise.all(pedidos.map((o) => aprovar(outroCliente(cliente), o)))
    expect(codigos(resultados)).toEqual(['OK', 'OK', 'SALDO_INSUFICIENTE', 'SALDO_INSUFICIENTE', 'SALDO_INSUFICIENTE'])
    expect(await conta(empresa)).toEqual({ contabil: 0, reservado: 40000 })
  })

  it('limite negativo respeitado no centavo', async () => {
    const { empresa, cliente } = await cenario(0)
    expect(await aprovar(cliente, await pedidoOrcado(cliente, slotLonge(), 50000))).toMatchObject({
      ok: true,
      disponivel_cent: -50000,
    })
    expect(await aprovar(cliente, await pedidoOrcado(cliente, slotLonge(), 1))).toMatchObject({
      ok: false,
      codigo: 'SALDO_INSUFICIENTE',
      falta_cent: 1,
    })
    expect(await conta(empresa)).toEqual({ contabil: 0, reservado: 50000 })
  })

  it('mesma chave repetida (em sequência e em paralelo) → mesmo resultado, nenhum lançamento novo', async () => {
    const { empresa, cliente } = await cenario(100000)
    const o = await pedidoOrcado(cliente, slotLonge(), 12000)
    const chave = randomUUID()
    const primeiro = await aprovar(cliente, o, chave)
    expect(primeiro).toMatchObject({ ok: true })
    expect(await aprovar(cliente, o, chave)).toEqual(primeiro)

    const o2 = await pedidoOrcado(cliente, slotLonge(), 8000)
    const chave2 = randomUUID()
    const paralelos = await Promise.all(Array.from({ length: 5 }, () => aprovar(outroCliente(cliente), o2, chave2)))
    for (const r of paralelos) expect(r).toEqual(paralelos[0])
    expect(paralelos[0]).toMatchObject({ ok: true, reservado_cent: 8000 })
    expect((await lancamentos(empresa)).map((l) => `${l.tipo}:${l.valor}`)).toEqual([
      'RECARGA:100000',
      'RESERVA:12000',
      'RESERVA:8000',
    ])
  })

  it('aprovação × expiração (forçado): a expiração com a atividade travada vence → aprovação espera e recebe STATUS_INVALIDO', async () => {
    const { empresa, cliente } = await cenario(1000000)
    const o = await pedidoOrcado(cliente, slotLonge(), 1000)
    const r = await comBanco(async (db) => {
      await db.query('begin')
      // o cron chegou primeiro: trava a atividade, vê o prazo vencido e expira (ainda sem commit)
      await db.query('select 1 from app.atividades where id = $1 for no key update', [o.id])
      const aprovacao = aprovar(outroCliente(cliente), o)
      await esperarBloqueio('aprovar_orcamento')
      await db.query(
        `update app.agenda_blocos set expira_em = now() - interval '1 second' where atividade_id = $1 and tipo = 'PRE_RESERVA'`,
        [o.id],
      )
      expect((await db.query<{ x: boolean }>('select interno.expirar_atividade($1) as x', [o.id])).rows[0]!.x).toBe(true)
      await db.query('select pg_sleep(0.2)')
      await db.query('commit')
      return aprovacao
    })
    expect(r).toEqual({ ok: false, codigo: 'STATUS_INVALIDO' })
    expect(await estado(o.id)).toMatchObject({ status: 'EXPIRADA', ativo: false, reservasAtivas: 0, aprovacoes: 0, lancamentos: [] })
    expect(await conta(empresa)).toEqual({ contabil: 1000000, reservado: 0 })
  })

  it('aprovação × expiração (forçado): a validade vence no meio da aprovação já conferida → aprovação vence, a expiração não desfaz', async () => {
    const { empresa, cliente } = await cenario(1000000)
    const o = await pedidoOrcado(cliente, slotLonge(), 1000)
    const [r, expirou] = await comBanco(async (db) => {
      await db.query('begin')
      // segura o bloco da agenda: a aprovação confere a validade (ainda vale) e para ao converter a pré-reserva
      await db.query('select 1 from app.agenda_blocos where atividade_id = $1 for update', [o.id])
      const aprovacao = aprovar(outroCliente(cliente), o)
      await esperarBloqueio('aprovar_orcamento')
      // agora vence; o cron tenta expirar e fica esperando a atividade (travada pela aprovação)
      await db.query(`update app.agenda_blocos set expira_em = now() - interval '1 second' where atividade_id = $1`, [o.id])
      const expiracao = comBanco(
        async (x) => (await x.query<{ x: boolean }>('select interno.expirar_atividade($1) as x', [o.id])).rows[0]!.x,
      )
      await esperarBloqueio('expirar_atividade')
      await db.query('commit')
      return Promise.all([aprovacao, expiracao])
    })
    expect(r).toMatchObject({ ok: true, reservado_cent: 1000 })
    expect(expirou).toBe(false)
    expect(await estado(o.id)).toEqual({
      status: 'AGENDADA',
      tipo: 'RESERVA',
      ativo: true,
      reservasAtivas: 1,
      aprovacoes: 1,
      lancamentos: ['RESERVA:1000'],
    })
    expect(await conta(empresa)).toEqual({ contabil: 1000000, reservado: 1000 })
  })

  it('recargas × aprovações na mesma empresa ao mesmo tempo → saldos exatos e limite respeitado', async () => {
    const { empresa, cliente } = await cenario(0)
    const pedidos: Orcado[] = []
    for (let i = 0; i < 3; i++) pedidos.push(await pedidoOrcado(cliente, slotLonge(), 30000))
    const resultados = await Promise.all([
      ...pedidos.map((o) => aprovar(outroCliente(cliente), o)),
      recarga(empresa, 30000),
      recarga(empresa, 30000),
    ])
    const aprovacoes = resultados.slice(0, 3)
    expect(codigos(resultados.slice(3))).toEqual(['OK', 'OK'])
    const aprovados = aprovacoes.filter((r) => r.ok).length
    expect(aprovados).toBeGreaterThanOrEqual(1)
    for (const r of aprovacoes.filter((x) => !x.ok)) {
      expect(r.codigo).toBe('SALDO_INSUFICIENTE')
      // a recusa viu um disponível real: com este pedido passaria do limite
      expect((r.disponivel_cent as number) - 30000).toBeLessThan(-50000)
    }
    const c = await conta(empresa)
    expect(c).toEqual({ contabil: 60000, reservado: aprovados * 30000 })
    expect(c.contabil - c.reservado).toBeGreaterThanOrEqual(-50000)
    expect((await lancamentos(empresa)).map((l) => l.tipo).sort()).toEqual(
      ['RECARGA', 'RECARGA', ...Array<string>(aprovados).fill('RESERVA')].sort(),
    )
  })
})

describe('estorno × cancelamento (sem deadlock: atividade → conta em todo lugar)', () => {
  it('estorno da multa de X em paralelo com repetições do cancelamento de X → sem erro, um estorno, saldo exato', async () => {
    const { empresa, cliente } = await cenario(100000)
    for (let i = 0; i < 3; i++) {
      const o = await pedidoOrcado(cliente, slotPerto(), 2000)
      expect(await aprovar(cliente, o)).toMatchObject({ ok: true })
      const args = { p_atividade: o.id, p_motivo: null, p_chave: randomUUID(), p_multa_esperada_cent: 2000 }
      const original = await rpc(cliente, 'cancelar_agendado', args)
      expect(original).toMatchObject({ ok: true, multa_cent: 2000 })
      const multa = await comBanco(
        async (db) =>
          (await db.query<{ id: string }>(`select id from app.lancamentos where atividade_id = $1 and tipo = 'MULTA'`, [o.id]))
            .rows[0]!.id,
      )
      // rpc() lança em erro HTTP (deadlock = 500): todas precisam responder
      const [estorno, ...repeticoes] = await Promise.all([
        rpc(outroCliente(adm), 'estornar_lancamento', { p_lancamento: Number(multa), p_motivo: 'Multa perdoada', p_chave: randomUUID() }),
        ...Array.from({ length: 4 }, () => rpc(outroCliente(cliente), 'cancelar_agendado', args)),
      ])
      expect(estorno).toMatchObject({ ok: true, tipo: 'ESTORNO', valor_cent: 2000 })
      for (const r of repeticoes) expect(r).toEqual(original)
      expect((await estado(o.id)).lancamentos).toEqual(['RESERVA:2000', 'LIBERACAO_RESERVA:2000', 'MULTA:-2000', 'ESTORNO:2000'])
    }
    expect(await conta(empresa)).toEqual({ contabil: 100000, reservado: 0 })
  }, 60_000)
})

describe('cancelamento de AGENDADA: concorrência real e multa', () => {
  it('cancelamento × cancelamento simultâneos → um vence, no máximo uma multa', async () => {
    const { empresa, cliente } = await cenario(100000)
    let multas = 0
    for (let i = 0; i < 3; i++) {
      const o = await pedidoOrcado(cliente, slotPerto(), 7000)
      expect(await aprovar(cliente, o)).toMatchObject({ ok: true })
      const resultados = await Promise.all([
        rpc(outroCliente(cliente), 'cancelar_agendado', {
          p_atividade: o.id,
          p_motivo: null,
          p_chave: randomUUID(),
          p_multa_esperada_cent: 7000,
        }),
        rpc(outroCliente(cliente), 'cancelar_agendado', {
          p_atividade: o.id,
          p_motivo: 'Mudou o plano',
          p_chave: randomUUID(),
          p_multa_esperada_cent: 7000,
        }),
        rpc(outroCliente(motorista), 'cancelar_agendado', {
          p_atividade: o.id,
          p_motivo: 'Veículo em manutenção',
          p_chave: randomUUID(),
        }),
      ])
      expect(codigos(resultados)).toEqual(['OK', 'STATUS_INVALIDO', 'STATUS_INVALIDO'])
      const vencedor = resultados.findIndex((r) => r.ok)
      const doCliente = vencedor < 2
      const e = await estado(o.id)
      expect(e).toMatchObject({ status: 'CANCELADA', ativo: false, reservasAtivas: 0 })
      // cliente venceu: libera e cobra 100% (< 24 h); motorista venceu: só libera
      expect(e.lancamentos).toEqual(
        doCliente
          ? ['RESERVA:7000', 'LIBERACAO_RESERVA:7000', 'MULTA:-7000']
          : ['RESERVA:7000', 'LIBERACAO_RESERVA:7000'],
      )
      expect(resultados[vencedor]).toMatchObject({ multa_cent: doCliente ? 7000 : 0, liberado_cent: 7000 })
      if (doCliente) multas++
    }
    expect(await conta(empresa)).toEqual({ contabil: 100000 - multas * 7000, reservado: 0 })
  })

  it('cancelamento repetido com a mesma chave (em paralelo) → mesmo resultado, uma multa', async () => {
    const { empresa, cliente } = await cenario(100000)
    const o = await pedidoOrcado(cliente, slotPerto(), 3333)
    expect(await aprovar(cliente, o)).toMatchObject({ ok: true })
    const chave = randomUUID()
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        rpc(outroCliente(cliente), 'cancelar_agendado', {
          p_atividade: o.id,
          p_motivo: null,
          p_chave: chave,
          p_multa_esperada_cent: 3333,
        }),
      ),
    )
    for (const r of resultados) expect(r).toEqual(resultados[0])
    expect(resultados[0]).toMatchObject({
      ok: true,
      liberado_cent: 3333,
      multa_cent: 3333,
      faixa: { antecedencia_min_horas: 0, multa_bp: 10000 },
    })
    expect((await estado(o.id)).lancamentos).toEqual(['RESERVA:3333', 'LIBERACAO_RESERVA:3333', 'MULTA:-3333'])
    expect(await conta(empresa)).toEqual({ contabil: 100000 - 3333, reservado: 0 })
  })

  it('fluxo: ADM recarrega → cliente cria → motorista orça → cliente aprova → cancela com multa; extrato mostra tudo', async () => {
    const { empresa, cliente } = await cenario(0)
    expect(await recarga(empresa, 20000)).toMatchObject({ ok: true, saldo_contabil_cent: 20000 })
    const o = await pedidoOrcado(cliente, slotPerto(), 15000)
    expect(await aprovar(cliente, o)).toEqual({ ok: true, atividade_id: o.id, reservado_cent: 15000, disponivel_cent: 5000 })
    expect(await rpc(cliente, 'saldo_empresa', {})).toMatchObject({
      saldo_contabil_cent: 20000,
      reservado_cent: 15000,
      disponivel_cent: 5000,
    })

    const simulacao = await rpc(cliente, 'simular_cancelamento', { p_atividade: o.id })
    expect(simulacao).toMatchObject({ ok: true, total_cent: 15000, liberado_cent: 15000, multa_cent: 15000, cobra_multa: true })
    const cancelado = await rpc(cliente, 'cancelar_agendado', {
      p_atividade: o.id,
      p_motivo: 'Não vamos mais',
      p_chave: randomUUID(),
      p_multa_esperada_cent: simulacao.multa_cent,
    })
    expect(cancelado).toMatchObject({ ok: true, liberado_cent: 15000, multa_cent: simulacao.multa_cent, disponivel_cent: 5000 })

    const extrato = await rpc(cliente, 'extrato', { p_empresa: null, p_filtro: {} })
    const itens = extrato.itens as {
      tipo: string
      valor_cent: number
      efeito_contabil_cent: number
      pode_abrir: boolean
      numero: number | null
    }[]
    expect(itens.map((i) => `${i.tipo}:${i.valor_cent}:${i.efeito_contabil_cent}`)).toEqual([
      'MULTA:-15000:-15000',
      'LIBERACAO_RESERVA:15000:0',
      'RESERVA:15000:0',
      'RECARGA:20000:20000',
    ])
    expect(itens.filter((i) => i.numero !== null).every((i) => i.pode_abrir)).toBe(true)

    // colega N2 da mesma empresa: vê a linha (nº e solicitante), mas não abre o pedido
    const colega = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2 })
    const visto = await rpc(colega, 'extrato', { p_empresa: null, p_filtro: { tipos: ['MULTA'] } })
    expect(visto.itens).toEqual([
      expect.objectContaining({
        tipo: 'MULTA',
        valor_cent: -15000,
        pode_abrir: false,
        atividade_id: null,
        solicitante_nome: expect.any(String),
      }),
    ])
    expect(await conta(empresa)).toEqual({ contabil: 5000, reservado: 0 })
  })

  it('a reconciliação continua limpa nas empresas deste arquivo depois de toda a concorrência', async () => {
    const r = await comBanco(
      async (db) =>
        (await db.query<{ r: { divergencias: { empresa_id: string }[] } }>('select interno.reconciliar() as r')).rows[0]!.r,
    )
    const minhas = await comBanco(async (db) =>
      (
        await db.query<{ id: string }>(
          `select distinct empresa_id as id from app.lancamentos where criado_em > now() - interval '1 hour'`,
        )
      ).rows.map((x) => x.id),
    )
    expect(minhas.length).toBeGreaterThan(5)
    expect(r.divergencias.filter((d) => minhas.includes(d.empresa_id))).toEqual([])
  })
})
