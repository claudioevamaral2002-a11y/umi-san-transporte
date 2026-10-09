import { randomUUID } from 'node:crypto'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { criarPessoa, empresaComContrato, motoristaUnico, rpc, type Pessoa } from './ajuda.ts'

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

/** Horário cheio daqui a `dias` dias, em ISO UTC (10:00 em São Paulo). */
function horario(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCHours(13, 0, 0, 0)
  return d.toISOString()
}

let empresaA: string
let clienteA: Pessoa
let clienteB: Pessoa
let motorista: Pessoa

beforeAll(async () => {
  motorista = await motoristaUnico()
  empresaA = await empresaComContrato()
  clienteA = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 2 })
  clienteB = await criarPessoa({ papel: 'CLIENTE', empresa: await empresaComContrato(), nivel: 1 })
}, 120_000)

describe('Realtime Broadcast privado por pedido e por empresa (especificação 1.2; fase 2A)', () => {
  it('dono recebe a mudança de status no pedido e na empresa; cliente de outra empresa é recusado nos dois', async () => {
    const criado = await rpc(clienteA, 'criar_pedido', {
      p: {
        inicio: horario(30),
        duracao_min: 60,
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
    expect(criado).toMatchObject({ ok: true })
    const id = criado.id as string
    try {
      await clienteA.cliente.realtime.setAuth(clienteA.token)
      await clienteB.cliente.realtime.setAuth(clienteB.token)

      const noPedido: unknown[] = []
      const naEmpresa: unknown[] = []
      const canalPedido = clienteA.cliente
        .channel(`atividade:${id}`, { config: { private: true } })
        .on('broadcast', { event: 'status' }, (mensagem) => noPedido.push(mensagem.payload))
      expect(await statusAssinatura(canalPedido)).toBe('SUBSCRIBED')
      const canalEmpresa = clienteA.cliente
        .channel(`empresa:${empresaA}`, { config: { private: true } })
        .on('broadcast', { event: 'status' }, (mensagem) => naEmpresa.push(mensagem.payload))
      expect(await statusAssinatura(canalEmpresa)).toBe('SUBSCRIBED')

      // Sanidade: o token de B é válido, então as recusas abaixo vêm da política, não de credencial ruim.
      expect((await clienteB.cliente.rpc('ping')).data).toBe('pong')
      expect(await statusAssinatura(clienteB.cliente.channel(`atividade:${id}`, { config: { private: true } }))).toBe(
        'CHANNEL_ERROR',
      )
      expect(await statusAssinatura(clienteB.cliente.channel(`empresa:${empresaA}`, { config: { private: true } }))).toBe(
        'CHANNEL_ERROR',
      )

      expect(await rpc(clienteA, 'cancelar_pedido', { p_atividade: id, p_motivo: null })).toMatchObject({ ok: true })

      await expect.poll(() => noPedido.length, { timeout: 8_000 }).toBe(1)
      await expect.poll(() => naEmpresa.length, { timeout: 8_000 }).toBe(1)
      expect(noPedido[0]).toMatchObject({ id, status: 'CANCELADA' })
      expect(naEmpresa[0]).toMatchObject({ id, status: 'CANCELADA' })
      expect(Object.keys(noPedido[0] as object).sort()).toEqual(['em', 'id', 'status'])
    } finally {
      await clienteA.cliente.removeAllChannels()
      await clienteB.cliente.removeAllChannels()
    }
  })

  it('tópico equipe: motorista e gestor de frota recebem {id, status, em, empresa_id}; cliente é recusado', async () => {
    const gestor = await criarPessoa({ papel: 'GESTOR_FROTA' })
    try {
      await motorista.cliente.realtime.setAuth(motorista.token)
      await gestor.cliente.realtime.setAuth(gestor.token)
      await clienteA.cliente.realtime.setAuth(clienteA.token)

      const doMotorista: Array<Record<string, unknown>> = []
      const doGestor: Array<Record<string, unknown>> = []
      const canalMotorista = motorista.cliente
        .channel('equipe', { config: { private: true } })
        .on('broadcast', { event: 'status' }, (m) => doMotorista.push(m.payload as Record<string, unknown>))
      expect(await statusAssinatura(canalMotorista)).toBe('SUBSCRIBED')
      const canalGestor = gestor.cliente
        .channel('equipe', { config: { private: true } })
        .on('broadcast', { event: 'status' }, (m) => doGestor.push(m.payload as Record<string, unknown>))
      expect(await statusAssinatura(canalGestor)).toBe('SUBSCRIBED')

      // Cliente (token válido) não assina o tópico da equipe.
      expect((await clienteA.cliente.rpc('ping')).data).toBe('pong')
      expect(await statusAssinatura(clienteA.cliente.channel('equipe', { config: { private: true } }))).toBe('CHANNEL_ERROR')

      const criado = await rpc(clienteA, 'criar_pedido', {
        p: {
          inicio: horario(31),
          duracao_min: 60,
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
      expect(criado).toMatchObject({ ok: true })
      const id = criado.id as string
      expect(await rpc(clienteA, 'cancelar_pedido', { p_atividade: id, p_motivo: null })).toMatchObject({ ok: true })

      const deste = (lista: Array<Record<string, unknown>>) => lista.filter((x) => x.id === id)
      await expect.poll(() => deste(doMotorista).length, { timeout: 8_000 }).toBe(2)
      await expect.poll(() => deste(doGestor).length, { timeout: 8_000 }).toBe(2)
      expect(deste(doMotorista).map((x) => String(x.status)).sort()).toEqual(['CANCELADA', 'SOLICITADA'])
      expect(deste(doMotorista).find((x) => x.status === 'CANCELADA')).toMatchObject({ id, empresa_id: empresaA })
      for (const x of deste(doGestor)) expect(Object.keys(x).sort()).toEqual(['em', 'empresa_id', 'id', 'status'])
    } finally {
      await motorista.cliente.removeAllChannels()
      await gestor.cliente.removeAllChannels()
      await clienteA.cliente.removeAllChannels()
    }
  })

  it('tópico saldo:<empresa> (M1): clientes da empresa e ADM recebem `saldo`; motorista, gestor e outra empresa são recusados', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const gestor = await criarPessoa({ papel: 'GESTOR_FROTA' })
    const n3 = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA, nivel: 3 })
    const pessoas = [clienteA, n3, adm, motorista, gestor, clienteB]
    try {
      for (const p of pessoas) await p.cliente.realtime.setAuth(p.token)
      const topico = `saldo:${empresaA}`
      const recebidos = new Map<Pessoa, Array<Record<string, unknown>>>()
      for (const p of [clienteA, n3, adm]) {
        const lista: Array<Record<string, unknown>> = []
        recebidos.set(p, lista)
        const canal = p.cliente
          .channel(topico, { config: { private: true } })
          .on('broadcast', { event: 'saldo' }, (m) => lista.push(m.payload as Record<string, unknown>))
        expect(await statusAssinatura(canal)).toBe('SUBSCRIBED')
      }
      // Sanidade: os tokens são válidos; a recusa vem da política (a equipe não vê saldo; Adendo A10).
      for (const p of [motorista, gestor, clienteB]) {
        expect((await p.cliente.rpc('ping')).data).toBe('pong')
        expect(await statusAssinatura(p.cliente.channel(topico, { config: { private: true } }))).toBe('CHANNEL_ERROR')
      }

      expect(
        await rpc(adm, 'lancar_recarga', {
          p_empresa: empresaA,
          p_valor_cent: 2500,
          p_motivo: 'Pix de teste',
          p_comprovante: null,
          p_chave: randomUUID(),
        }),
      ).toMatchObject({ ok: true })
      for (const lista of recebidos.values()) {
        await expect.poll(() => lista.length, { timeout: 8_000 }).toBe(1)
        expect(lista[0]).toMatchObject({ empresa_id: empresaA })
        expect(Object.keys(lista[0]!).sort()).toEqual(['em', 'empresa_id'])
      }
    } finally {
      for (const p of pessoas) await p.cliente.removeAllChannels()
    }
  }, 60_000)
})
