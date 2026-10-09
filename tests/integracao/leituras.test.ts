import { beforeAll, describe, expect, it } from 'vitest'
import { comBanco, criarPessoa, empresaComContrato, motoristaUnico, rpc, type Pessoa } from './ajuda.ts'

/** Fase 2A (leituras): nada de outra empresa vaza pela agenda, pelos horários livres ou pelo detalhe do pedido. */

/** 10:00 em São Paulo (13:00 UTC) daqui a `dias` dias, em ISO UTC. */
function horario(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCHours(13, 0, 0, 0)
  return d.toISOString()
}

const instantes = (lista: unknown) => (lista as string[]).map((h) => new Date(h).getTime())
const em = (iso: string, minutos: number) => new Date(iso).getTime() + minutos * 60_000

interface Bloco {
  inicio: string
  fim: string
  ocupado: boolean
  atividade_id?: string
  origem?: string
}

let motorista: Pessoa
let adm: Pessoa
let clienteA: Pessoa
let clienteB: Pessoa
let empresaA: string

beforeAll(async () => {
  motorista = await motoristaUnico()
  adm = await criarPessoa({ papel: 'ADM' })
  empresaA = await empresaComContrato()
  clienteA = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 2 })
  clienteB = await criarPessoa({ papel: 'CLIENTE', empresa: await empresaComContrato(), nivel: 1 })
}, 120_000)

describe('leituras sem vazamento entre empresas', () => {
  it('agenda, horários livres e detalhe: cliente B só vê "ocupado"; pré-reserva vencida vira livre', async () => {
    const inicio = horario(40)
    const dia = inicio.slice(0, 10)
    const de = `${dia}T03:00:00Z` // 00:00 em São Paulo
    const ate = new Date(em(de, 24 * 60)).toISOString()
    const criado = await rpc(clienteA, 'criar_pedido', {
      p: {
        inicio,
        duracao_min: 120,
        origem: 'Endereço Sigiloso da Empresa A',
        destino: 'Base Navegantes',
        levar: true,
        trazer: false,
        carga: 'PESSOAS',
        pessoas_qtd: 2,
        modalidade: 'VEICULO_PROPRIO',
        reboque: 'NAO',
      },
    })
    expect(criado).toMatchObject({ ok: true })
    const id = criado.id as string

    // agenda: B vê só o intervalo ocupado; A vê o próprio pedido com detalhes
    const agendaB = await rpc(clienteB, 'agenda', { p_de: de, p_ate: ate })
    expect(agendaB.ok).toBe(true)
    const blocosB = agendaB.blocos as Bloco[]
    expect(blocosB).toHaveLength(1)
    expect(Object.keys(blocosB[0]!).sort()).toEqual(['fim', 'inicio', 'ocupado'])
    expect(new Date(blocosB[0]!.inicio).getTime()).toBe(em(inicio, 0))
    expect(new Date(blocosB[0]!.fim).getTime()).toBe(em(inicio, 120))
    expect(JSON.stringify(agendaB)).not.toContain('Sigiloso')
    expect(JSON.stringify(agendaB)).not.toContain(id)
    const blocosA = (await rpc(clienteA, 'agenda', { p_de: de, p_ate: ate })).blocos as Bloco[]
    expect(blocosA).toHaveLength(1)
    expect(blocosA[0]).toMatchObject({ atividade_id: id, origem: 'Endereço Sigiloso da Empresa A', ocupado: true })

    // horários livres (mesmos para qualquer cliente): 2 h a partir de 08:00 e de 12:00 cabem; 08:30–11:30 não
    const livres = await rpc(clienteB, 'horarios_livres', { p_dia: dia, p_duracao_min: 120 })
    expect(livres).toMatchObject({ ok: true, dia_cheio: false })
    const t = instantes(livres.horarios)
    expect(t).toContain(em(inicio, -120))
    expect(t).toContain(em(inicio, 120))
    for (const m of [-90, -30, 0, 60, 90]) expect(t).not.toContain(em(inicio, m))
    expect(t).toHaveLength(35 - 7)

    // detalhe: B não acha; A vê memorial e regras, sem limites/autor/versão do contrato
    expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: id, p: { km: 100 } })).toMatchObject({ ok: true })
    expect(await rpc(clienteB, 'pedido', { p_id: id })).toEqual({ ok: false, codigo: 'NAO_ENCONTRADO' })
    const listaB = await rpc(clienteB, 'meus_pedidos')
    expect(JSON.stringify(listaB)).not.toContain(id)
    const detalheA = await rpc(clienteA, 'pedido', { p_id: id })
    expect(detalheA).toMatchObject({ ok: true, orcamento: { total_cent: 37500, regras: { prazo_orcar_horas: 12 } } })
    for (const proibido of ['limite_saldo', 'alerta_saldo', 'publicado', 'contrato_versao', 'entrada']) {
      expect(JSON.stringify(detalheA)).not.toContain(proibido)
    }
    const detalheMotorista = await rpc(motorista, 'pedido', { p_id: id })
    expect(detalheMotorista).toMatchObject({ ok: true, orcamento: { entrada: { km: 100 }, precos: { km_sem_reboque_cent: 250 } } })
    for (const proibido of ['limite_saldo', 'alerta_saldo', 'publicado', 'contrato_versao']) {
      expect(JSON.stringify(detalheMotorista)).not.toContain(proibido)
    }
    expect(await rpc(adm, 'pedido', { p_id: id })).toMatchObject({
      ok: true,
      orcamento: { contrato_versao: 1, snapshot: { limite_saldo_negativo_cent: 50000 } },
    })

    // pré-reserva vencida (o cron ainda não passou): livre na agenda e nos horários
    await comBanco((db) =>
      db.query(`update app.agenda_blocos set expira_em = now() - interval '1 minute' where atividade_id = $1`, [id]),
    )
    expect((await rpc(clienteB, 'agenda', { p_de: de, p_ate: ate })).blocos).toEqual([])
    const depois = instantes((await rpc(clienteB, 'horarios_livres', { p_dia: dia, p_duracao_min: 120 })).horarios)
    expect(depois).toContain(em(inicio, 0))
    expect(depois).toHaveLength(35)
  })

  it('agenda abre o pedido do colega para N1/N3 (não para N2); dias_do_mes coerente e só com contagens próprias', async () => {
    const n1 = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 1 })
    const n3 = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 3 })
    const colega = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 2 })
    const inicio = horario(41)
    const dia = inicio.slice(0, 10)
    const de = `${dia}T03:00:00Z`
    const ate = new Date(em(de, 24 * 60)).toISOString()
    const criado = await rpc(colega, 'criar_pedido', {
      p: {
        inicio,
        duracao_min: 120,
        origem: 'Endereço Sigiloso do Colega',
        destino: 'Base Navegantes',
        levar: true,
        trazer: true,
        carga: 'PESSOAS',
        pessoas_qtd: 1,
        modalidade: 'VEICULO_PROPRIO',
        reboque: 'NAO',
      },
    })
    expect(criado).toMatchObject({ ok: true })
    const id = criado.id as string

    const podeAbrir = async (quem: Pessoa) => {
      const blocos = (await rpc(quem, 'agenda', { p_de: de, p_ate: ate })).blocos as Array<Bloco & { pode_abrir?: boolean }>
      return blocos.find((b) => b.atividade_id === id)?.pode_abrir
    }
    expect(await podeAbrir(n1)).toBe(true)
    expect(await podeAbrir(n3)).toBe(true)
    expect(await podeAbrir(clienteA)).toBe(false)
    expect(await podeAbrir(colega)).toBe(true)
    expect(await rpc(n3, 'pedido', { p_id: id })).toMatchObject({ ok: true })

    interface Dia {
      dia: string
      livre: boolean
      dia_cheio: boolean
      meus: number
      aguardando_voce: number
      ocupado: boolean
    }
    const doDia = async (quem: Pessoa) => {
      const r = await rpc(quem, 'dias_do_mes', { p_mes: dia, p_duracao_min: 120 })
      expect(r).toMatchObject({ ok: true, mes: `${dia.slice(0, 8)}01`, duracao_min: 120 })
      return { r, d: (r.dias as Dia[]).find((x) => x.dia === dia)! }
    }
    const doColega = await doDia(colega)
    expect(doColega.d).toEqual({ dia, livre: true, dia_cheio: false, meus: 1, aguardando_voce: 0, ocupado: true })
    expect((await doDia(n1)).d.meus).toBe(1)
    expect((await doDia(clienteA)).d.meus).toBe(0)
    const deB = await doDia(clienteB)
    expect(deB.d).toEqual({ dia, livre: true, dia_cheio: false, meus: 0, aguardando_voce: 0, ocupado: true })
    expect(JSON.stringify(deB.r)).not.toContain(id)
    expect(JSON.stringify(deB.r)).not.toContain('Sigiloso')
    const motoristaDia = await doDia(motorista)
    expect(motoristaDia.d).toMatchObject({ meus: 1, aguardando_voce: 1 })

    // coerente com horarios_livres no mesmo dia
    const livres = await rpc(clienteB, 'horarios_livres', { p_dia: dia, p_duracao_min: 120 })
    expect(deB.d.livre).toBe((livres.horarios as string[]).length > 0)
    expect(deB.d.dia_cheio).toBe(livres.dia_cheio)
  })
})
