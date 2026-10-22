// Acompanhamento do cliente (Tarefa 9): a posição do motorista, o sinal e a chegada prevista. Regras puras de
// `lib/rastreio.ts` (a última vence, 20 s / 60 s); aqui só a montagem da tela. Nada é inventado: sem posição, sem carro.
import { useState } from 'react'
import { useAgora as useRelogio } from '../telas/execucao/comum.tsx'
import { aplicarPosicao, comoPosicao, estadoDoSinal, type EstadoSinal, type Posicao } from '../lib/rastreio.ts'
import type { DetalhePedido } from '../lib/pedidos.ts'
import { useTransmissao } from '../lib/tempoReal.ts'
import { chegadaPrevista, posicaoGravada, type Chegada } from '../lib/acompanhamento.ts'

export interface Acompanhamento {
  posicao: Posicao | null
  sinal: EstadoSinal
  /** Segundos desde a última posição. */
  idadeS: number
  chegada: Chegada | null
}

/**
 * Posição do motorista em `rastreio:<id>` (só em andamento e para quem pode ver). Abre com a última posição gravada; a
 * chegada transmitida é guardada e continua à vista quando o sinal cai.
 */
export function useAcompanhamento(p: DetalhePedido | undefined, minutosDaRota: number | null): Acompanhamento {
  const ativo = !!p && p.status === 'EM_ANDAMENTO' && p.pode_ver_rastreio === true
  const [recebida, setRecebida] = useState<{ posicao: Posicao; eta: string | null } | null>(null)
  const agora = useRelogio(1_000)

  useTransmissao(ativo ? `rastreio:${p.id}` : null, 'posicao', (payload) => {
    const nova = comoPosicao(payload, Date.now())
    if (!nova) return
    setRecebida((atual) => {
      const vence = aplicarPosicao(atual?.posicao ?? null, nova)
      if (vence !== nova) return atual
      return { posicao: nova, eta: nova.eta ?? atual?.eta ?? null }
    })
  })

  const gravada = ativo ? posicaoGravada(p.ultima_posicao) : null
  const posicao = ativo ? (recebida?.posicao ?? gravada) : null
  const sinal = estadoDoSinal(posicao?.recebidaEm ?? null, agora)
  // Sem sinal, a estimativa (saída + rota) não vale mais e some; a última chegada do motorista continua à vista.
  const prevista = ativo ? chegadaPrevista(recebida?.eta ?? null, p.saiu_em, minutosDaRota, agora) : null
  const chegada = prevista?.estimada && sinal === 'perdido' ? null : prevista
  return {
    posicao,
    sinal,
    idadeS: posicao ? Math.max(0, Math.round((agora - posicao.recebidaEm) / 1000)) : 0,
    chegada,
  }
}
