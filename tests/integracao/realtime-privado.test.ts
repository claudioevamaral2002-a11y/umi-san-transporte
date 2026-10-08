import type { RealtimeChannel } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { comBanco, criarUsuario } from './ajuda.ts'

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

describe('Realtime Broadcast privado (especificação 1.2)', () => {
  it('dono recebe o evento; outro usuário é recusado no mesmo canal', async () => {
    const a = await criarUsuario()
    const b = await criarUsuario()
    const id = await comBanco(async (db) => {
      const r = await db.query<{ id: string }>('insert into app.prova_canal (dono) values ($1) returning id', [a.id])
      return r.rows[0]!.id
    })
    const topico = `prova:${id}`
    try {
      await a.cliente.realtime.setAuth(a.token)
      await b.cliente.realtime.setAuth(b.token)

      const recebidos: unknown[] = []
      const canalA = a.cliente
        .channel(topico, { config: { private: true } })
        .on('broadcast', { event: 'status' }, (mensagem) => recebidos.push(mensagem.payload))
      expect(await statusAssinatura(canalA)).toBe('SUBSCRIBED')

      // Sanidade: o token de B é válido, então a recusa abaixo vem da política, não de credencial ruim.
      expect((await b.cliente.rpc('ping')).data).toBe('pong')
      const canalB = b.cliente.channel(topico, { config: { private: true } })
      expect(await statusAssinatura(canalB)).toBe('CHANNEL_ERROR')

      await comBanco((db) => db.query("update app.prova_canal set status = 'ORCADA' where id = $1", [id]))

      await expect.poll(() => recebidos.length, { timeout: 8_000 }).toBe(1)
      expect(recebidos[0]).toMatchObject({ id, status: 'ORCADA' })
    } finally {
      await a.cliente.removeAllChannels()
      await b.cliente.removeAllChannels()
    }
  })
})
