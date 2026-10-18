import { randomUUID } from 'node:crypto'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
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
 * Fase 3B com concorrência real (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.2, §2.4): cada chamada em paralelo
 * usa um cliente HTTP próprio, logo conexões e transações independentes no banco.
 */

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

function statusAssinatura(canal: RealtimeChannel): Promise<string> {
  return new Promise((resolve) => {
    const limite = setTimeout(() => resolve('SEM_RESPOSTA'), 8_000)
    canal.subscribe((status) => {
      if (status === 'CLOSED') return
      clearTimeout(limite)
      resolve(status)
    })
  })
}

async function lancamentos(atividade: string): Promise<string[]> {
  return comBanco(async (db) =>
    (
      await db.query<{ tipo: string; valor: string }>(
        'select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id',
        [atividade],
      )
    ).rows.map((l) => `${l.tipo}:${l.valor}`),
  )
}

let motorista: Pessoa
let adm: Pessoa

beforeAll(async () => {
  motorista = await motoristaUnico()
  adm = await criarPessoa({ papel: 'ADM' })
}, 120_000)

async function cenario(): Promise<{ empresa: string; n2: Pessoa; n1: Pessoa }> {
  const empresa = await empresaComContrato()
  expect(
    await rpc(adm, 'lancar_recarga', {
      p_empresa: empresa,
      p_valor_cent: 100000,
      p_motivo: 'Pix de teste',
      p_comprovante: null,
      p_chave: randomUUID(),
    }),
  ).toMatchObject({ ok: true })
  const n2 = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2 })
  const n1 = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 1 })
  return { empresa, n2, n1 }
}

/** Pedido de 30 min daqui a 15 min (dentro da janela de saída), orçado e aprovado. */
async function agendado(cliente: Pessoa, total: number): Promise<string> {
  const inicio = new Date(Date.now() + 15 * 60_000)
  inicio.setUTCSeconds(0, 0)
  const p = await rpc(cliente, 'criar_pedido', {
    p: {
      inicio: inicio.toISOString(),
      duracao_min: 30,
      origem: 'Porto de Itajaí',
      destino: 'Base Navegantes',
      levar: true,
      trazer: false,
      carga: 'PESSOAS',
      pessoas_qtd: 1,
      modalidade: 'VEICULO_PROPRIO',
      reboque: 'NAO',
    },
  })
  expect(p, 'criar_pedido').toMatchObject({ ok: true })
  expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: p.id, p: { pedagio_cent: total } })).toMatchObject({
    ok: true,
  })
  const o = (await rpc(cliente, 'pedido', { p_id: p.id })).orcamento as { versao: number; hash: string }
  expect(
    await rpc(cliente, 'aprovar_orcamento', {
      p_atividade: p.id,
      p_versao: o.versao,
      p_hash: o.hash,
      p_chave: randomUUID(),
      p_dispositivo: 'vitest',
    }),
  ).toMatchObject({ ok: true })
  return p.id as string
}

describe('saída: concorrência real', () => {
  it('10 saídas simultâneas (chaves diferentes) → 1 débito; a conclusão não lança nada', async () => {
    const { n2 } = await cenario()
    const id = await agendado(n2, 4321)
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        rpc(outroCliente(motorista), 'registrar_saida', { p_atividade: id, p_chave: randomUUID() }),
      ),
    )
    expect(codigos(resultados)).toEqual(['OK', ...Array<string>(9).fill('STATUS_INVALIDO')])
    expect(await lancamentos(id)).toEqual(['RESERVA:4321', 'LIBERACAO_RESERVA:4321', 'DEBITO:-4321'])
    expect(await rpc(motorista, 'concluir', { p_atividade: id, p_observacao: null })).toMatchObject({ ok: true })
    expect(await lancamentos(id)).toEqual(['RESERVA:4321', 'LIBERACAO_RESERVA:4321', 'DEBITO:-4321'])
  })

  it('saída × cancelamento simultâneos → um só vence (multa ou débito, nunca os dois)', async () => {
    const { n2 } = await cenario()
    for (let i = 0; i < 3; i++) {
      const id = await agendado(n2, 2000)
      const [saida, cancelamento] = await Promise.all([
        rpc(outroCliente(motorista), 'registrar_saida', { p_atividade: id, p_chave: randomUUID() }),
        rpc(outroCliente(n2), 'cancelar_agendado', {
          p_atividade: id,
          p_motivo: null,
          p_chave: randomUUID(),
          p_multa_esperada_cent: 2000,
        }),
      ])
      expect(codigos([saida!, cancelamento!])).toEqual(['OK', 'STATUS_INVALIDO'])
      if (saida!.ok) {
        expect(await lancamentos(id)).toEqual(['RESERVA:2000', 'LIBERACAO_RESERVA:2000', 'DEBITO:-2000'])
        expect(await rpc(motorista, 'concluir', { p_atividade: id, p_observacao: null })).toMatchObject({ ok: true })
      } else {
        expect(await lancamentos(id)).toEqual(['RESERVA:2000', 'LIBERACAO_RESERVA:2000', 'MULTA:-2000'])
      }
    }
    const r = await comBanco(async (db) => (await db.query<{ r: unknown }>('select interno.reconciliar() as r')).rows[0]!.r)
    expect((r as { divergencias: unknown[] }).divergencias).toEqual([])
  }, 60_000)
})

describe('rastreio: canal privado por viagem', () => {
  it('N1 e o solicitante recebem a posição; N3 é recusado; nada passa depois da conclusão', async () => {
    const { empresa, n2, n1 } = await cenario()
    const n3 = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 3 })
    const id = await agendado(n2, 1500)
    expect(await rpc(motorista, 'registrar_saida', { p_atividade: id, p_chave: randomUUID() })).toMatchObject({ ok: true })
    const pessoas = [n1, n2, n3]
    try {
      for (const p of pessoas) await p.cliente.realtime.setAuth(p.token)
      const topico = `rastreio:${id}`
      const recebidos = new Map<Pessoa, Array<Record<string, unknown>>>()
      for (const p of [n1, n2]) {
        const lista: Array<Record<string, unknown>> = []
        recebidos.set(p, lista)
        const canal = p.cliente
          .channel(topico, { config: { private: true } })
          .on('broadcast', { event: 'posicao' }, (m) => lista.push(m.payload as Record<string, unknown>))
        expect(await statusAssinatura(canal)).toBe('SUBSCRIBED')
      }
      // Sanidade: o token do N3 é válido; a recusa vem da regra de quem vê o rastreio.
      expect((await n3.cliente.rpc('ping')).data).toBe('pong')
      expect(await statusAssinatura(n3.cliente.channel(topico, { config: { private: true } }))).toBe('CHANNEL_ERROR')

      expect(
        await rpc(motorista, 'enviar_posicao', {
          p_atividade: id,
          p: { lat: -26.9, lng: -48.66, precisao: 8, rumo: 45, velocidade: 10, seq: 1 },
        }),
      ).toMatchObject({ ok: true })
      for (const lista of recebidos.values()) {
        await expect.poll(() => lista.length, { timeout: 8_000 }).toBe(1)
        expect(lista[0]).toMatchObject({ lat: -26.9, lng: -48.66, seq: 1 })
      }

      expect(await rpc(motorista, 'concluir', { p_atividade: id, p_observacao: 'ok' })).toMatchObject({ ok: true })
      expect(
        await rpc(motorista, 'enviar_posicao', { p_atividade: id, p: { lat: -26.91, lng: -48.66, seq: 2 } }),
      ).toMatchObject({ ok: false, codigo: 'STATUS_INVALIDO' })
      const posicoes = await comBanco(
        async (db) => (await db.query<{ n: string }>('select count(*) as n from app.posicoes where atividade_id = $1', [id]))
          .rows[0]!.n,
      )
      expect(Number(posicoes)).toBe(0)
    } finally {
      for (const p of pessoas) await p.cliente.removeAllChannels()
    }
  }, 60_000)
})
