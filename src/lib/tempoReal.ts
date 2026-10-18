import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

/**
 * Eventos publicados pelo banco: `status` ({id, status, em}), `saldo` ({empresa_id, em}, só em `saldo:<id>`) e, na
 * fase 3B, `posicao` ({lat, lng, rumo, velocidade, precisao, seq, eta, ts}, só em `rastreio:<id>`).
 */
export type EventoTempoReal = 'status' | 'saldo' | 'posicao'

interface Assinatura {
  ouvintes: Set<{ evento: EventoTempoReal; aoMudar: (payload: unknown) => void }>
  canal: RealtimeChannel | null
  encerrada: boolean
}

// Um canal por tópico, compartilhado: o supabase-js devolve o mesmo canal para o mesmo tópico, então duas partes da
// tela (ex.: pendências e lista no Início, ambos em `empresa:<id>`) não podem assinar e remover cada uma o seu.
const assinaturas = new Map<string, Assinatura>()

function assinar(topico: string): Assinatura {
  const existente = assinaturas.get(topico)
  if (existente) return existente
  const a: Assinatura = { ouvintes: new Set(), canal: null, encerrada: false }
  assinaturas.set(topico, a)
  void (async () => {
    try {
      await supabase.realtime.setAuth()
    } catch {
      // Sem token novo: a assinatura usa o que já houver (e o banco recusa se não puder ver).
    }
    if (a.encerrada) return
    a.canal = supabase
      .channel(topico, { config: { private: true } })
      .on('broadcast', { event: '*' }, (m: { event?: string; payload?: unknown }) => {
        for (const o of [...a.ouvintes]) if (o.evento === m.event) o.aoMudar(m.payload)
      })
      .subscribe()
  })()
  return a
}

function soltar(topico: string, a: Assinatura) {
  if (a.ouvintes.size > 0) return
  a.encerrada = true
  assinaturas.delete(topico)
  if (a.canal) void supabase.removeChannel(a.canal)
}

/**
 * Assina um tópico privado (`atividade:<id>`, `empresa:<id>`, `saldo:<id>` ou `equipe`) e chama `aoMudar` a cada `evento`
 * (padrão `status`). A tela relê os dados do servidor: o evento nunca é usado como dado.
 */
export function useTempoReal(topico: string | null, aoMudar: () => void, evento: EventoTempoReal = 'status') {
  useTransmissao(topico, evento, () => aoMudar())
}

/**
 * Fase 3B: como useTempoReal, mas entrega o payload do evento (posição do motorista em `rastreio:<id>`). O payload é
 * dado de terceiros: quem recebe valida cada campo antes de usar.
 */
export function useTransmissao(topico: string | null, evento: EventoTempoReal, aoReceber: (payload: unknown) => void) {
  const retorno = useRef(aoReceber)
  useEffect(() => {
    retorno.current = aoReceber
  })
  useEffect(() => {
    if (!topico) return
    const a = assinar(topico)
    const ouvinte = { evento, aoMudar: (payload: unknown) => retorno.current(payload) }
    a.ouvintes.add(ouvinte)
    return () => {
      a.ouvintes.delete(ouvinte)
      soltar(topico, a)
    }
  }, [topico, evento])
}
