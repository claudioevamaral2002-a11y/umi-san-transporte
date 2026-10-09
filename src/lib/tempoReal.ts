import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

/** Eventos publicados pelo banco: `status` ({id, status, em}) e `saldo` ({empresa_id, em}, só em `saldo:<id>`). */
export type EventoTempoReal = 'status' | 'saldo'

interface Assinatura {
  ouvintes: Set<{ evento: EventoTempoReal; aoMudar: () => void }>
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
      .on('broadcast', { event: '*' }, (m: { event?: string }) => {
        for (const o of [...a.ouvintes]) if (o.evento === m.event) o.aoMudar()
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
  const retorno = useRef(aoMudar)
  useEffect(() => {
    retorno.current = aoMudar
  })
  useEffect(() => {
    if (!topico) return
    const a = assinar(topico)
    const ouvinte = { evento, aoMudar: () => retorno.current() }
    a.ouvintes.add(ouvinte)
    return () => {
      a.ouvintes.delete(ouvinte)
      soltar(topico, a)
    }
  }, [topico, evento])
}
