import { useCallback, useEffect, useState } from 'react'
import type { PontoRota } from '../lib/enderecosRemoto.ts'
import { rotaAte } from '../lib/rotaDesenhada.ts'

export type RotaDaTela = NonNullable<Awaited<ReturnType<typeof rotaAte>>>

/**
 * A linha do trajeto fica só na memória desta aba (termos do Google: nunca vai para o banco nem para o histórico do
 * navegador). Escolher a categoria e abrir a corrida logo depois reaproveitam a mesma chamada da Routes API.
 */
const memoria = new Map<string, Promise<RotaDaTela | null>>()

export type EstadoRota =
  | { fase: 'sem-pontos' }
  | { fase: 'carregando' }
  | { fase: 'pronta'; rota: RotaDaTela }
  | { fase: 'falhou' }

/** Km, tempo e linha do trajeto entre dois pontos; `tentarDeNovo` refaz a chamada quando o Google falhou. */
export function useRota(origem: PontoRota | null, destino: PontoRota | null) {
  const chave = origem && destino ? JSON.stringify([origem, destino]) : null
  const [resultado, setResultado] = useState<{ chave: string; rota: RotaDaTela | null } | null>(null)
  const [rodada, setRodada] = useState(0)

  useEffect(() => {
    if (!chave) return
    let vivo = true
    let promessa = memoria.get(chave)
    if (!promessa) {
      const [o, d] = JSON.parse(chave) as [PontoRota, PontoRota]
      promessa = rotaAte(o, d).catch(() => null)
      memoria.set(chave, promessa)
    }
    void promessa.then((rota) => {
      if (!rota) memoria.delete(chave)
      if (vivo) setResultado({ chave, rota })
    })
    return () => {
      vivo = false
    }
  }, [chave, rodada])

  const tentarDeNovo = useCallback(() => {
    setResultado(null)
    setRodada((r) => r + 1)
  }, [])

  const estado: EstadoRota = !chave
    ? { fase: 'sem-pontos' }
    : !resultado || resultado.chave !== chave
      ? { fase: 'carregando' }
      : resultado.rota
        ? { fase: 'pronta', rota: resultado.rota }
        : { fase: 'falhou' }
  return { estado, tentarDeNovo }
}
