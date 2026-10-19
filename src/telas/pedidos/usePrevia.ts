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

/** `calcular_orcamento` com debounce de 300 ms; respostas antigas são descartadas. Sem entrada, `null`. */
export function usePrevia(id: string, entrada: Record<string, unknown> | null, atrasoMs = ATRASO_PREVIA_MS): Previa | null {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const chave = entrada ? JSON.stringify(entrada) : null
  const sequencia = useRef(0)
  useEffect(() => {
    if (!chave) return
    const minha = ++sequencia.current
    const t = setTimeout(() => {
      setPrevia({ estado: 'calculando' })
      void pedidos.calcular(id, JSON.parse(chave) as Record<string, unknown>).then((r) => {
        if (minha !== sequencia.current) return
        if (r.ok && Array.isArray(r.linhas) && typeof r.total_cent === 'number') {
          setPrevia({ estado: 'ok', linhas: r.linhas as LinhaOrcamento[], total: r.total_cent })
        } else {
          setPrevia({ estado: 'erro', mensagem: mensagemDoCodigo(r.codigo), codigo: String(r.codigo ?? '') })
        }
      })
    }, atrasoMs)
    return () => clearTimeout(t)
  }, [id, chave, atrasoMs])
  return chave ? previa : null
}
