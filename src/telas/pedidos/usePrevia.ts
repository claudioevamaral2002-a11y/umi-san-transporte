// Prévia ao vivo do orçamento (motorista): `calcular_orcamento` não grava nada; preço e total vêm do contrato. Usada
// pelo Orçar do app atual e pela calculadora da contraproposta do app novo (fase 4, §5.4).
import { useEffect, useRef, useState } from 'react'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { pedidos, type LinhaOrcamento } from '../../lib/pedidos.ts'

const ATRASO_PREVIA_MS = 300

export type Previa =
  | { estado: 'calculando' }
  | { estado: 'ok'; linhas: LinhaOrcamento[]; total: number }
  | { estado: 'erro'; mensagem: string; codigo: string }

/** Prévia guardada com a etiqueta (pedido + entrada) para a qual foi calculada. */
export interface PreviaDaChave {
  chave: string
  previa: Previa
}

/** Etiqueta da prévia: o pedido e a entrada exata (a mesma entrada de outro pedido não reaproveita o total). */
export function etiquetaDaPrevia(id: string, entrada: Record<string, unknown> | null): string | null {
  return entrada ? JSON.stringify([id, entrada]) : null
}

/**
 * A prévia só vale para a entrada atual: guardada para outra entrada (ou ainda nada), é "calculando". Assim a tela
 * nunca mostra o total de uma entrada e envia outra durante o debounce (dinheiro: o que se vê é o que se envia).
 */
export function previaDaChave(guardada: PreviaDaChave | null, chave: string | null): Previa | null {
  if (!chave) return null
  return guardada && guardada.chave === chave ? guardada.previa : { estado: 'calculando' }
}

/** `calcular_orcamento` com debounce de 300 ms; respostas antigas são descartadas. Sem entrada, `null`. */
export function usePrevia(id: string, entrada: Record<string, unknown> | null, atrasoMs = ATRASO_PREVIA_MS): Previa | null {
  const [guardada, setGuardada] = useState<PreviaDaChave | null>(null)
  const chave = etiquetaDaPrevia(id, entrada)
  const sequencia = useRef(0)
  useEffect(() => {
    if (!chave) return
    const minha = ++sequencia.current
    const [atividade, corpo] = JSON.parse(chave) as [string, Record<string, unknown>]
    const t = setTimeout(() => {
      void pedidos.calcular(atividade, corpo).then((r) => {
        if (minha !== sequencia.current) return
        const previa: Previa =
          r.ok && Array.isArray(r.linhas) && typeof r.total_cent === 'number'
            ? { estado: 'ok', linhas: r.linhas as LinhaOrcamento[], total: r.total_cent }
            : { estado: 'erro', mensagem: mensagemDoCodigo(r.codigo), codigo: String(r.codigo ?? '') }
        setGuardada({ chave, previa })
      })
    }, atrasoMs)
    return () => clearTimeout(t)
  }, [chave, atrasoMs])
  return previaDaChave(guardada, chave)
}
