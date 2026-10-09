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

beforeAll(async () => {
  await motoristaUnico()
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
})
