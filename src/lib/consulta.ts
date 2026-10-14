import { useCallback, useEffect, useRef, useState } from 'react'

interface Estado<T> {
  chave: string
  rodada: number
  dados: T | undefined
  erro: boolean
}

interface Opcoes {
  /** Ao trocar de chave (outro dia, outro filtro), continua mostrando os dados da chave anterior até a nova chegar. */
  manterAnterior?: boolean
  /** Guarda a última resposta desta chave na memória: voltar à tela mostra na hora e atualiza em seguida. */
  cache?: boolean
}

/**
 * Última resposta por chave (só na memória da aba). Nunca usar em leituras de dinheiro (saldo, extrato, créditos):
 * ali o valor mostrado vem sempre do servidor. Limpa ao entrar ou sair da conta (outra pessoa no mesmo aparelho).
 */
const memoria = new Map<string, unknown>()
/** Muda a cada limpeza: resposta de uma busca iniciada antes de trocar de conta não entra na memória da nova conta. */
let geracao = 0

export function limparConsultas() {
  memoria.clear()
  geracao += 1
}

export function geracaoDaMemoria(): number {
  return geracao
}

export function guardarNaMemoria(chave: string, dados: unknown, geracaoDaBusca: number) {
  if (geracaoDaBusca === geracao) memoria.set(chave, dados)
}

export function lerDaMemoria<T>(chave: string): { tem: boolean; dados: T | undefined } {
  return memoria.has(chave) ? { tem: true, dados: memoria.get(chave) as T } : { tem: false, dados: undefined }
}

/**
 * Leitura simples com recarga: refaz a busca quando `chave` muda ou ao chamar `recarregar()`.
 * Durante a recarga mantém os dados anteriores (sem piscar a tela). `atualizando` = mostrando dados antigos
 * (da memória ou da chave anterior) enquanto a resposta nova não chega.
 */
export function useConsulta<T>(chave: string, buscar: () => Promise<T>, opcoes: Opcoes = {}) {
  const funcao = useRef(buscar)
  useEffect(() => {
    funcao.current = buscar
  })
  const guardar = opcoes.cache === true
  const [rodada, setRodada] = useState(0)
  const [estado, setEstado] = useState<Estado<T> | null>(null)

  useEffect(() => {
    let ativo = true
    const daBusca = geracao
    funcao.current().then(
      (dados) => {
        if (guardar) guardarNaMemoria(chave, dados, daBusca)
        if (ativo) setEstado({ chave, rodada, dados, erro: false })
      },
      () => {
        if (ativo) setEstado((a) => ({ chave, rodada, dados: a?.chave === chave ? a.dados : undefined, erro: true }))
      },
    )
    return () => {
      ativo = false
    }
  }, [chave, rodada, guardar])

  const recarregar = useCallback(() => setRodada((r) => r + 1), [])
  const mesma = estado?.chave === chave
  // A resposta da própria chave vale mesmo quando é `null` (ex.: "sem contrato", "não encontrado").
  const dados = mesma
    ? estado.dados
    : guardar && lerDaMemoria<T>(chave).tem
      ? lerDaMemoria<T>(chave).dados
      : opcoes.manterAnterior && estado
        ? estado.dados
        : undefined
  const carregando = !mesma || estado.rodada !== rodada
  return {
    dados,
    erro: mesma && estado.erro,
    carregando,
    atualizando: carregando && dados !== undefined,
    recarregar,
  }
}

/** Resposta do supabase-js → dados, ou lança (vira `erro` no `useConsulta`). */
export function exigir<T>(r: { data: T | null; error: unknown }): T {
  if (r.error || r.data === null) throw r.error ?? new Error('sem dados')
  return r.data
}
