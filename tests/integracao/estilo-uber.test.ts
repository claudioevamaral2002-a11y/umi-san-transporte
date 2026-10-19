import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CHAVE_PUBLICA,
  CONTRATO_TESTE,
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
 * Fase 4 (pedido estilo Uber sobre o mesmo banco): o app atual continua igual depois das migrations e a confirmação
 * resiste a concorrência real (cada chamada em paralelo usa um cliente HTTP próprio: transações independentes).
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

/** Horário cheio daqui a `dias` dias, em ISO UTC (dias distintos não colidem na agenda do motorista). */
function horario(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCMinutes(0, 0, 0)
  d.setUTCHours(13)
  return d.toISOString()
}

/** Arredonda meio para cima, como as linhas do orçamento. */
const arred = (x: number) => Math.floor(x + 0.5)

/** Lançamentos do pedido, na ordem, como `TIPO:valor`. */
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

async function statusDe(atividade: string): Promise<string> {
  return comBanco(
    async (db) =>
      (await db.query<{ status: string }>('select status from app.atividades where id = $1', [atividade])).rows[0]!
        .status,
  )
}

let motorista: Pessoa
let adm: Pessoa
let empresa: string
let n2: Pessoa

beforeAll(async () => {
  motorista = await motoristaUnico()
  adm = await criarPessoa({ papel: 'ADM' })
  empresa = await empresaComContrato()
  expect(
    await rpc(adm, 'lancar_recarga', {
      p_empresa: empresa,
      p_valor_cent: 1_000_000,
      p_motivo: 'Pix de teste',
      p_comprovante: null,
      p_chave: randomUUID(),
    }),
  ).toMatchObject({ ok: true })
  n2 = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2 })
}, 120_000)

/** Corpo que `montarPedido` (src/lib/novoPedido.ts) monta hoje para PESSOAS, com um ponto marcado no mapa. */
function corpoDoAppAtual(inicio: string): Record<string, unknown> {
  return {
    inicio,
    duracao_min: 120,
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    levar: true,
    trazer: false,
    carga: 'PESSOAS',
    modalidade: 'VEICULO_PROPRIO',
    reboque: 'NAO',
    contato_nome: null,
    contato_telefone: null,
    observacoes: null,
    pessoas_qtd: 2,
    destino_lat: -26.9,
    destino_lng: -48.65,
  }
}

/** Pedido do app atual já orçado pelo motorista (km informado); devolve o pedido e o orçamento vigente. */
/** Entrada do orçamento como `montarEntrada` (src/lib/orcar.ts) a monta hoje para VEICULO_PROPRIO. */
function entradaDoAppAtual(km: number): Record<string, unknown> {
  return {
    modalidade: 'VEICULO_PROPRIO',
    km,
    usa_reboque: false,
    espera_horas: 0,
    pedagio_cent: 0,
    hospedagem_diarias: 0,
  }
}

async function orcado(dias: number, km: number, extra: Record<string, unknown> = {}) {
  const p = await rpc(n2, 'criar_pedido', { p: corpoDoAppAtual(horario(dias)) })
  expect(p, 'criar_pedido').toMatchObject({ ok: true })
  const e = await rpc(motorista, 'enviar_orcamento', {
    p_atividade: p.id,
    p: { ...entradaDoAppAtual(km), ...extra },
    p_horario_sugerido: null,
  })
  expect(e, 'enviar_orcamento').toMatchObject({ ok: true })
  const o = (await rpc(n2, 'pedido', { p_id: p.id })).orcamento as { versao: number; hash: string }
  return { id: p.id as string, o, enviado: e }
}

describe('compatibilidade: o app atual depois das migrations da fase 4', () => {
  it('app atual: criar → enviar → aprovar sem campos novos continua igual', async () => {
    const km = 100
    // calculado pelo contrato do teste: km × tarifa sem reboque + retorno de trecho único (50%), arredondado
    const base = km * CONTRATO_TESTE.km_sem_reboque_cent
    const esperado = base + arred((base * CONTRATO_TESTE.retorno_trecho_unico_bp) / 10000)
    expect(esperado).toBe(37500)

    const { id, o, enviado } = await orcado(40, km)
    expect(enviado).toMatchObject({ versao: 1, total_cent: esperado })
    expect(await statusDe(id)).toBe('ORCADA')

    const aprovado = await rpc(n2, 'aprovar_orcamento', {
      p_atividade: id,
      p_versao: o.versao,
      p_hash: o.hash,
      p_chave: randomUUID(),
      p_dispositivo: 'vitest',
    })
    expect(aprovado).toMatchObject({ ok: true })
    expect(await statusDe(id)).toBe('AGENDADA')
    expect(await lancamentos(id)).toEqual([`RESERVA:${esperado}`])

    const visto = await rpc(n2, 'pedido', { p_id: id })
    expect((visto.orcamento as { total_cent: number }).total_cent).toBe(esperado)
    const codigos = (visto.orcamento as { linhas: { codigo: string }[] }).linhas.map((l) => l.codigo)
    expect(codigos).not.toContain('AJUSTE_MOTORISTA')
  })
})

describe('proposta: ajuste do motorista visível para o cliente', () => {
  it('proposta: cliente vê a linha AJUSTE_MOTORISTA no api.pedido', async () => {
    const tabela = 37500
    const ajuste = -5000
    const { id, enviado } = await orcado(41, 100, { ajuste_cent: String(ajuste), ajuste_motivo: 'Cliente frequente' })
    expect(enviado).toMatchObject({ total_cent: tabela + ajuste })

    const visto = await rpc(n2, 'pedido', { p_id: id })
    const orcamento = visto.orcamento as {
      total_cent: number
      linhas: { codigo: string; total_cent?: number; subtotal_cent?: number }[]
    }
    expect(orcamento.total_cent).toBe(tabela + ajuste)
    const linha = orcamento.linhas.find((l) => l.codigo === 'AJUSTE_MOTORISTA')
    expect(linha, 'linha AJUSTE_MOTORISTA').toBeDefined()
    expect(JSON.stringify(linha)).toContain('Cliente frequente')
    expect(JSON.stringify(linha)).toContain(String(ajuste))
  })
})

describe('confirmar_corrida: concorrência real', () => {
  it('10 confirmações simultâneas com a mesma chave → 1 só RESERVA', async () => {
    const { id, o } = await orcado(42, 100)
    const chave = randomUUID()
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        rpc(outroCliente(n2), 'confirmar_corrida', {
          p_atividade: id,
          p_versao: o.versao,
          p_hash: o.hash,
          p_chave: chave,
          p_centro_custo: 'Obra 7',
          p_dispositivo: 'vitest',
        }),
      ),
    )
    // a repetição com a mesma chave devolve o resultado original; ninguém pode falhar nem reservar duas vezes
    expect(resultados.filter((r) => r.ok)).toHaveLength(10)
    expect(await lancamentos(id)).toEqual(['RESERVA:37500'])
    expect(await statusDe(id)).toBe('AGENDADA')
    const cc = await comBanco(
      async (db) =>
        (await db.query<{ centro_custo: string | null }>('select centro_custo from app.atividades where id = $1', [id]))
          .rows[0]!.centro_custo,
    )
    expect(cc).toBe('Obra 7')
  })

  it('controle: confirmar_corrida sozinho, num pedido preparado igual, dá certo', async () => {
    const { id, o } = await orcado(47, 100)
    expect(
      await rpc(n2, 'confirmar_corrida', {
        p_atividade: id,
        p_versao: o.versao,
        p_hash: o.hash,
        p_chave: randomUUID(),
        p_dispositivo: 'vitest',
      }),
    ).toMatchObject({ ok: true })
    expect(await statusDe(id)).toBe('AGENDADA')
    expect(await lancamentos(id)).toEqual(['RESERVA:37500'])
  })

  it('confirmar × cancelar simultâneos: um só vence', async () => {
    for (let i = 0; i < 4; i++) {
      const { id, o } = await orcado(43 + i, 100)
      const [confirmar, cancelar] = await Promise.all([
        rpc(outroCliente(n2), 'confirmar_corrida', {
          p_atividade: id,
          p_versao: o.versao,
          p_hash: o.hash,
          p_chave: randomUUID(),
          p_dispositivo: 'vitest',
        }),
        rpc(outroCliente(n2), 'cancelar_pedido', { p_atividade: id, p_motivo: null }),
      ])
      const vencedores = [confirmar, cancelar].filter((r: Resultado) => r.ok)
      expect(vencedores, `confirmar=${JSON.stringify(confirmar)} cancelar=${JSON.stringify(cancelar)}`).toHaveLength(1)
      const perdedor = confirmar.ok ? cancelar : confirmar
      expect(perdedor.codigo, 'o perdedor é recusado por estado').toBe('STATUS_INVALIDO')
      if (confirmar.ok) {
        expect(await statusDe(id)).toBe('AGENDADA')
        expect(await lancamentos(id)).toEqual(['RESERVA:37500'])
      } else {
        expect(await statusDe(id)).toBe('CANCELADA')
        expect(await lancamentos(id)).toEqual([])
      }
    }
    const r = await comBanco(async (db) => (await db.query<{ r: unknown }>('select interno.reconciliar() as r')).rows[0]!.r)
    expect((r as { divergencias: unknown[] }).divergencias).toEqual([])
  }, 90_000)
})
