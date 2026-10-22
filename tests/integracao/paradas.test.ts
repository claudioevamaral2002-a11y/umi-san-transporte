import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATO_TESTE,
  comBanco,
  criarPessoa,
  empresaComContrato,
  motoristaUnico,
  rpc,
  type Pessoa,
} from './ajuda.ts'

/**
 * Fase 4.1, Tarefa 2 (paradas, horas estimadas e centro de custo ao pedir): o app atual continua criando e orçando
 * igual, e com a tabela da categoria publicada a prévia do cliente, o cálculo e o orçamento do motorista dão o mesmo
 * total (as paradas do pedido entram no preço mesmo quando o Orçar de hoje não as manda).
 */

/** Horário cheio daqui a `dias` dias, em ISO UTC (dias distintos não colidem na agenda do motorista). */
function horario(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCMinutes(0, 0, 0)
  d.setUTCHours(13)
  return d.toISOString()
}

/** Arredonda meio para cima, como as linhas do orçamento. */
const arred = (x: number) => Math.floor(x + 0.5)

/** Placa aleatória no formato do banco (única entre os arquivos de teste). */
function placa(): string {
  const letra = () => String.fromCharCode(65 + Math.floor(Math.random() * 26))
  const dig = () => String(Math.floor(Math.random() * 10))
  return `${letra()}${letra()}${letra()}${dig()}${letra()}${dig()}${dig()}`
}

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

interface Categoria {
  codigo: string
  disponivel: boolean
  total_cent: number | null
}

async function previa(quem: Pessoa, p: Record<string, unknown>, codigo: string): Promise<Categoria> {
  const r = await rpc(quem, 'categorias_disponiveis', { p })
  expect(r, 'categorias_disponiveis').toMatchObject({ ok: true })
  const c = (r.categorias as Categoria[]).find((x) => x.codigo === codigo)
  expect(c, `categoria ${codigo}`).toBeDefined()
  return c!
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
  await comBanco((db) =>
    db.query(
      `insert into app.veiculos (motorista_id, modelo, cor, placa, lugares, carga_max_kg, categorias)
       values ($1, 'Spin', 'Prata', $2, 6, 400, array['PASSAGEIROS', 'CARGA_LEVE'])`,
      [motorista.id, placa()],
    ),
  )
}, 120_000)

describe('compatibilidade: o app atual depois da migration de paradas', () => {
  it('pedido sem categoria e sem chaves novas: cria, orça e é lido como hoje', async () => {
    const km = 100
    const base = km * CONTRATO_TESTE.km_sem_reboque_cent
    const esperado = base + arred((base * CONTRATO_TESTE.retorno_trecho_unico_bp) / 10000)

    const p = await rpc(n2, 'criar_pedido', { p: corpoDoAppAtual(horario(60)) })
    expect(p, 'criar_pedido').toMatchObject({ ok: true })
    const calc = await rpc(motorista, 'calcular_orcamento', { p_atividade: p.id, p: entradaDoAppAtual(km) })
    expect(calc).toMatchObject({ ok: true, total_cent: esperado })
    const e = await rpc(motorista, 'enviar_orcamento', {
      p_atividade: p.id,
      p: entradaDoAppAtual(km),
      p_horario_sugerido: null,
    })
    expect(e).toMatchObject({ ok: true, versao: 1, total_cent: esperado })

    const visto = await rpc(n2, 'pedido', { p_id: p.id })
    expect(visto.pedido).toMatchObject({ paradas: [], horas_estimadas: null, centro_custo: null })
  })

  it('pedido da categoria pelo app da fase 4, sem tabela publicada: preço de hoje, igual à prévia', async () => {
    const km = 100
    const pv = await previa(n2, { km, levar: true, trazer: false }, 'PASSAGEIROS')
    expect(pv.disponivel).toBe(true)

    const p = await rpc(n2, 'criar_pedido', {
      p: { ...corpoDoAppAtual(horario(61)), categoria: 'PASSAGEIROS' },
    })
    expect(p, 'criar_pedido').toMatchObject({ ok: true })
    const e = await rpc(motorista, 'enviar_orcamento', {
      p_atividade: p.id,
      p: entradaDoAppAtual(km),
      p_horario_sugerido: null,
    })
    expect(e).toMatchObject({ ok: true, total_cent: pv.total_cent })
    expect(e.total_cent).toBe(37500)
  })
})

describe('tabela publicada: prévia do cliente = orçamento do motorista', () => {
  it('Passageiros com 2 paradas: a prévia, o cálculo e o envio dão o mesmo total', async () => {
    const ativas = await comBanco(
      async (db) =>
        (await db.query<{ codigo: string }>('select codigo from app.categorias where ativa order by ordem, codigo')).rows,
    )
    const zerada = {
      taxa_fixa_cent: 0,
      km_cent: 300,
      hora_cent: 0,
      hora_espera_cent: 0,
      parada_cent: 0,
      retorno_bp: 0,
      reboque_cent: 0,
      hospedagem_diaria_cent: 0,
    }
    const tarifas: Record<string, typeof zerada> = {}
    for (const { codigo } of ativas) tarifas[codigo] = { ...zerada }
    tarifas.PASSAGEIROS = { ...zerada, taxa_fixa_cent: 4000, km_cent: 350, parada_cent: 1500, retorno_bp: 2000 }
    tarifas.MOTORISTA = { ...zerada, km_cent: 0, hora_cent: 9000 }
    expect(
      await rpc(adm, 'publicar_tarifas', {
        p_empresa: empresa,
        p_tarifas: tarifas,
        p_vigente_desde: new Date().toISOString(),
      }),
    ).toMatchObject({ ok: true })

    const km = 48
    const pv = await previa(n2, { km, levar: true, trazer: false, paradas: 2 }, 'PASSAGEIROS')
    // taxa 4000 + 48 km × 350 + retorno 20% + 2 paradas × 1500
    expect(pv.total_cent).toBe(4000 + 16800 + 3360 + 3000)

    const p = await rpc(n2, 'criar_pedido', {
      p: {
        ...corpoDoAppAtual(horario(62)),
        categoria: 'PASSAGEIROS',
        paradas: [
          { texto: 'Centro de Itajaí', place_id: 'ChIJ_parada-1' },
          { texto: 'Ponto marcado', lat: -26.91, lng: -48.66 },
        ],
        centro_custo: 'Obra 7',
      },
    })
    expect(p, 'criar_pedido').toMatchObject({ ok: true })

    const calc = await rpc(motorista, 'calcular_orcamento', { p_atividade: p.id, p: entradaDoAppAtual(km) })
    expect(calc).toMatchObject({ ok: true, total_cent: pv.total_cent })
    const e = await rpc(motorista, 'enviar_orcamento', {
      p_atividade: p.id,
      p: entradaDoAppAtual(km),
      p_horario_sugerido: null,
    })
    expect(e).toMatchObject({ ok: true, total_cent: pv.total_cent })

    const paradas = [
      { texto: 'Centro de Itajaí', place_id: 'ChIJ_parada-1', lat: null, lng: null },
      { texto: 'Ponto marcado', place_id: null, lat: -26.91, lng: -48.66 },
    ]
    expect((await rpc(n2, 'pedido', { p_id: p.id })).pedido).toMatchObject({ paradas, centro_custo: 'Obra 7' })
    expect((await rpc(motorista, 'pedido', { p_id: p.id })).pedido).toMatchObject({ paradas })
  })

  it('quarta parada: CAMPOS_INVALIDOS', async () => {
    const r = await rpc(n2, 'criar_pedido', {
      p: {
        ...corpoDoAppAtual(horario(63)),
        categoria: 'PASSAGEIROS',
        paradas: [1, 2, 3, 4].map((n) => ({ texto: `Parada ${n}` })),
      },
    })
    expect(r).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
  })
})
