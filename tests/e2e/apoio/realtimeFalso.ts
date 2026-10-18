// Fase 3B: Realtime simulado (websocket do Supabase interceptado pelo Playwright). Responde ao phx_join e ao heartbeat
// e deixa o teste empurrar um broadcast num tópico, no formato de texto do protocolo 2.0.0:
// [join_ref, ref, topic, event, payload].
import type { Page, WebSocketRoute } from '@playwright/test'

export async function simularRealtime(page: Page) {
  const canais = new Map<string, string | null>()
  let socket: WebSocketRoute | null = null
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    socket = ws
    ws.onMessage((msg) => {
      if (typeof msg !== 'string') return
      const [joinRef, ref, topic, event] = JSON.parse(msg) as [string | null, string | null, string, string]
      if (event === 'phx_join') canais.set(topic, joinRef)
      if (event === 'phx_leave') canais.delete(topic)
      if (['phx_join', 'phx_leave', 'heartbeat', 'access_token'].includes(event)) {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]))
      }
    })
  })
  return {
    /** O app entrou no tópico (`rastreio:<id>`, `atividade:<id>`...). */
    assinou: (topico: string) => canais.has(`realtime:${topico}`),
    /** Empurra `{type: 'broadcast', event, payload}` no tópico, como o banco faz com realtime.send. */
    transmitir: (topico: string, evento: string, payload: Record<string, unknown>) => {
      const t = `realtime:${topico}`
      socket?.send(JSON.stringify([canais.get(t) ?? null, null, t, 'broadcast', { type: 'broadcast', event: evento, payload }]))
    },
  }
}
