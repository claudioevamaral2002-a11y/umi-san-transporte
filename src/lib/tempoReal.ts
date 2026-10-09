import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

/**
 * Assina um tópico privado (`atividade:<id>`, `empresa:<id>` ou `equipe`) e chama `aoMudar` a cada evento `status`
 * ({id, status, em}). A tela relê os dados do servidor: o evento nunca é usado como dado.
 */
export function useTempoReal(topico: string | null, aoMudar: () => void) {
  const retorno = useRef(aoMudar)
  useEffect(() => {
    retorno.current = aoMudar
  })
  useEffect(() => {
    if (!topico) return
    let ativo = true
    let canal: RealtimeChannel | null = null
    void (async () => {
      try {
        await supabase.realtime.setAuth()
      } catch {
        // Sem token novo: a assinatura usa o que já houver (e o banco recusa se não puder ver).
      }
      if (!ativo) return
      canal = supabase
        .channel(topico, { config: { private: true } })
        .on('broadcast', { event: 'status' }, () => retorno.current())
        .subscribe()
    })()
    return () => {
      ativo = false
      if (canal) void supabase.removeChannel(canal)
    }
  }, [topico])
}
