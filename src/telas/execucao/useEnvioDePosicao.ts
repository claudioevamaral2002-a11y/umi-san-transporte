// A viagem do motorista (fase 3B), em um hook só para as duas telas: a do app atual (ViagemMotorista) e a do app novo
// (fase 4, ViagemNoMapa). Junta o aviso de localização (LGPD, §5 da 3B), a tela acesa (Wake Lock) e o envio da posição.
// Só roda com a tela da viagem aberta: ao sair dela ou concluir, o GPS e a tela acesa param.
import { useState } from 'react'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import { useEnvioDePosicao as useEnvioDoGps, useTelaAcesa } from '../../lib/viagem.ts'
import { pontosDoPedido } from './comum.tsx'

const CHAVE_CIENTE = 'ivo:aviso-localizacao'

function lerCiente(): boolean {
  try {
    return localStorage.getItem(CHAVE_CIENTE) === '1'
  } catch {
    return false
  }
}

/**
 * Envio da posição do pedido em andamento. O GPS só começa depois que o motorista leu o aviso ("Começar a
 * compartilhar"), uma vez por aparelho. A tela fica acesa enquanto a viagem estiver aberta.
 */
export function useEnvioDePosicao(pedido: DetalhePedido) {
  const [ciente, setCiente] = useState(lerCiente)
  const { origem, destino } = pontosDoPedido(pedido)
  const idaEVolta = pedido.levar && pedido.trazer
  useTelaAcesa(true)
  const envio = useEnvioDoGps({ id: pedido.id, ativo: ciente, idaEVolta, origem, destino })

  function ficarCiente() {
    try {
      localStorage.setItem(CHAVE_CIENTE, '1')
    } catch {
      // sem armazenamento: pergunta de novo na próxima viagem
    }
    setCiente(true)
  }

  return { ...envio, ciente, ficarCiente, origem, destino, idaEVolta }
}
