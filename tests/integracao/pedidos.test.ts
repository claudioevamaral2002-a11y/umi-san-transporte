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
 * Fase 2A (pedidos, agenda e orçamento) com concorrência real: várias chamadas em paralelo (Promise.all), cada uma
 * por um cliente HTTP próprio — logo, conexões e transações independentes no banco.
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

/** Horário cheio daqui a `dias` dias (+ `horas`), em ISO UTC. */
function horario(dias: number, horas = 0): string {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCMinutes(0, 0, 0)
  d.setUTCHours(13 + horas)
  return d.toISOString()
}

function pedido(inicio: string, extra: Record<string, unknown> = {}) {
  return {
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
    ...extra,
  }
}

async function criar(quem: Pick<Pessoa, 'cliente'>, inicio: string, extra: Record<string, unknown> = {}): Promise<Resultado> {
  return rpc(quem, 'criar_pedido', { p: pedido(inicio, extra) })
}

async function estado(atividade: string) {
  return comBanco(async (db) => {
    const a = await db.query<{ status: string; bloco_ativo: boolean }>(
      `select a.status, b.ativo as bloco_ativo
         from app.atividades a join app.agenda_blocos b on b.atividade_id = a.id where a.id = $1`,
      [atividade],
    )
    const o = await db.query<{ versao: number; status: string }>(
      'select versao, status from app.orcamentos where atividade_id = $1 order by versao',
      [atividade],
    )
    const h = await db.query<{ de: string | null; para: string }>(
      'select de, para from app.atividade_historico where atividade_id = $1 order by id',
      [atividade],
    )
    return { ...a.rows[0]!, orcamentos: o.rows, historico: h.rows }
  })
}

const codigos = (rs: Resultado[]) => rs.map((r) => (r.ok ? 'OK' : r.codigo)).sort()

let motorista: Pessoa
let adm: Pessoa
let empresaA: string
let empresaB: string
let clienteA: Pessoa
let clienteB: Pessoa

beforeAll(async () => {
  motorista = await motoristaUnico()
  adm = await criarPessoa({ papel: 'ADM' })
  empresaA = await empresaComContrato()
  empresaB = await empresaComContrato()
  clienteA = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 2 })
  clienteB = await criarPessoa({ papel: 'CLIENTE', empresa: empresaB, nivel: 1 })
}, 120_000)

describe('agenda: conflito impedido no banco, com concorrência real', () => {
  it('dois clientes (quatro requisições) no mesmo horário ao mesmo tempo → só 1 entra', async () => {
    const inicio = horario(10)
    const resultados = await Promise.all([
      criar(clienteA, inicio),
      criar(clienteB, inicio),
      criar(outroCliente(clienteA), inicio),
      criar(outroCliente(clienteB), inicio, { duracao_min: 60 }),
    ])
    expect(codigos(resultados)).toEqual(['HORARIO_OCUPADO', 'HORARIO_OCUPADO', 'HORARIO_OCUPADO', 'OK'])

    const ativos = await comBanco((db) =>
      db.query<{ n: string }>(
        `select count(*) as n from app.agenda_blocos
          where ativo and motorista_id = $1 and periodo && tstzrange($2::timestamptz, $2::timestamptz + interval '2 hours')`,
        [motorista.id, inicio],
      ),
    )
    expect(Number(ativos.rows[0]!.n)).toBe(1)
    const vencedor = resultados.find((r) => r.ok)!
    expect((await estado(vencedor.id as string)).status).toBe('SOLICITADA')
  })

  it('pedido sobre pré-reserva vencida entra (mesmo em paralelo, só 1) e a antiga vira EXPIRADA', async () => {
    const inicio = horario(11)
    const antigo = await criar(clienteA, inicio)
    expect(antigo).toMatchObject({ ok: true })
    // o prazo de orçar venceu e o cron ainda não passou
    await comBanco(async (db) => {
      await db.query(`update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = $1`, [antigo.id])
      await db.query(`update app.atividades set prazo_orcar_ate = now() - interval '1 minute' where id = $1`, [antigo.id])
    })

    const resultados = await Promise.all([criar(clienteB, inicio), criar(outroCliente(clienteA), horario(11, 1))])
    expect(codigos(resultados)).toEqual(['HORARIO_OCUPADO', 'OK'])
    const velho = await estado(antigo.id as string)
    expect(velho.status).toBe('EXPIRADA')
    expect(velho.bloco_ativo).toBe(false)
    expect(velho.historico.at(-1)).toEqual({ de: 'SOLICITADA', para: 'EXPIRADA' })
  })
})

describe('orçamento: concorrência real', () => {
  it('10 envios simultâneos (motorista e ADM, clientes distintos) → exatamente 1 orçamento PENDENTE', async () => {
    const p = await criar(clienteA, horario(12))
    expect(p).toMatchObject({ ok: true })
    const quem = Array.from({ length: 10 }, (_, i) => outroCliente(i % 2 === 0 ? motorista : adm))
    const resultados = await Promise.all(
      quem.map((q, i) => rpc(q, 'enviar_orcamento', { p_atividade: p.id, p: { km: 40 + i } })),
    )
    expect(codigos(resultados)).toEqual(['OK', ...Array<string>(9).fill('STATUS_INVALIDO')])

    const e = await estado(p.id as string)
    expect(e.status).toBe('ORCADA')
    expect(e.orcamentos).toEqual([{ versao: 1, status: 'PENDENTE' }])
    expect(e.historico.filter((h) => h.para === 'ORCADA')).toHaveLength(1)
    // o total gravado é o calculado no servidor para a entrada do vencedor
    const vencedor = resultados.findIndex((r) => r.ok)
    const km = 40 + vencedor
    expect(resultados[vencedor]!.total_cent).toBe(km * 250 + Math.floor((km * 250 * 5000) / 10000 + 0.5))
  })

  it('cancelar × enviar orçamento simultâneos → um estado final coerente (CANCELADA, nada PENDENTE)', async () => {
    for (let i = 0; i < 4; i++) {
      const p = await criar(clienteA, horario(13 + i))
      expect(p).toMatchObject({ ok: true })
      const [cancelar, enviar] = await Promise.all([
        rpc(outroCliente(clienteA), 'cancelar_pedido', { p_atividade: p.id, p_motivo: null }),
        rpc(outroCliente(motorista), 'enviar_orcamento', { p_atividade: p.id, p: { km: 10 } }),
      ])
      // cancelar vale em SOLICITADA e em ORCADA: sempre vence; o envio entra antes ou é recusado
      expect(cancelar).toMatchObject({ ok: true })
      expect(enviar.ok ? 'OK' : enviar.codigo).toMatch(/^(OK|STATUS_INVALIDO)$/)

      const e = await estado(p.id as string)
      expect(e.status).toBe('CANCELADA')
      expect(e.bloco_ativo).toBe(false)
      expect(e.historico.at(-1)!.para).toBe('CANCELADA')
      if (enviar.ok) {
        expect(e.orcamentos).toEqual([{ versao: 1, status: 'CANCELADO' }])
        expect(e.historico.map((h) => h.para)).toEqual(['SOLICITADA', 'ORCADA', 'CANCELADA'])
      } else {
        expect(e.orcamentos).toEqual([])
        expect(e.historico.map((h) => h.para)).toEqual(['SOLICITADA', 'CANCELADA'])
      }
    }
  })

  it('fluxo pela API: prévia, envio, revisão, reenvio e reprovação (preço sempre do contrato)', async () => {
    const p = await criar(clienteA, horario(20))
    expect(p).toMatchObject({ ok: true })

    const previa = await rpc(motorista, 'calcular_orcamento', { p_atividade: p.id, p: { km: 100 } })
    expect(previa).toMatchObject({ ok: true, total_cent: 37500 })
    expect(await rpc(motorista, 'calcular_orcamento', { p_atividade: p.id, p: { km: 100, km_sem_reboque_cent: 1 } })).toMatchObject({
      ok: false,
      codigo: 'CAMPOS_INVALIDOS',
    })
    expect(await rpc(clienteA, 'calcular_orcamento', { p_atividade: p.id, p: { km: 100 } })).toMatchObject({
      ok: false,
      codigo: 'SEM_PERMISSAO',
    })

    expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: p.id, p: { km: 100 } })).toMatchObject({
      ok: true,
      versao: 1,
      total_cent: 37500,
    })
    // cliente de outra empresa não age no pedido
    expect(await rpc(clienteB, 'pedir_revisao', { p_atividade: p.id, p_motivo: 'Outra empresa' })).toMatchObject({
      ok: false,
      codigo: 'SEM_PERMISSAO',
    })
    expect(await rpc(clienteA, 'pedir_revisao', { p_atividade: p.id, p_motivo: 'Valor acima do esperado' })).toMatchObject({
      ok: true,
    })
    expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: p.id, p: { km: 80 } })).toMatchObject({
      ok: true,
      versao: 2,
      total_cent: 30000,
    })
    expect(await rpc(clienteA, 'reprovar_orcamento', { p_atividade: p.id, p_motivo: null })).toMatchObject({ ok: true })

    const e = await estado(p.id as string)
    expect(e.status).toBe('REPROVADA')
    expect(e.bloco_ativo).toBe(false)
    expect(e.orcamentos).toEqual([
      { versao: 1, status: 'SUBSTITUIDO' },
      { versao: 2, status: 'REPROVADO' },
    ])
  })
})

describe('crédito ao criar pedido (sem crédito → SEM_CREDITO; a aprovação continua a checagem dura)', () => {
  it('fim do limite: SEM_CREDITO auditado e nada criado; com R$ 0,01 de crédito volta a criar', async () => {
    const empresa = await empresaComContrato()
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2 })
    const limite = 50000
    expect(
      await rpc(adm, 'lancar_ajuste', { p_empresa: empresa, p_valor_cent: -limite, p_motivo: 'Consumo antigo', p_chave: randomUUID() }),
    ).toMatchObject({ ok: true })
    const saldo = await rpc(cliente, 'saldo_empresa')
    expect(Number(saldo.disponivel_cent) + Number(saldo.limite_cent)).toBe(0)

    const antes = await comBanco(async (db) => (await db.query('select count(*)::int as n from app.atividades where empresa_id = $1', [empresa])).rows[0].n)
    expect(await criar(cliente, horario(40))).toEqual({ ok: false, codigo: 'SEM_CREDITO' })
    const depois = await comBanco(async (db) => (await db.query('select count(*)::int as n from app.atividades where empresa_id = $1', [empresa])).rows[0].n)
    expect(depois).toBe(antes)
    const auditado = await comBanco(async (db) =>
      (
        await db.query(
          `select detalhe from app.auditoria where acao = 'CRIAR_PEDIDO' and codigo = 'SEM_CREDITO' and usuario_id = $1`,
          [cliente.id],
        )
      ).rows,
    )
    expect(auditado).toEqual([{ detalhe: { disponivel_cent: -limite, limite_cent: limite } }])

    // Recarga e criação em paralelo: depois da recarga confirmada, a criação passa.
    await Promise.all([
      rpc(outroCliente(adm), 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 1, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() }),
      criar(outroCliente(cliente), horario(41)),
    ])
    expect(await criar(cliente, horario(42))).toMatchObject({ ok: true })
  })
})
