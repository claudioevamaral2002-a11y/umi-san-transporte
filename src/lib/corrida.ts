// Fase 4: ações da corrida (proposta do motorista, confirmação e avaliação do cliente). Dinheiro em centavos; o preço
// vem sempre do banco e nenhuma tela muda antes da resposta.
import { chamar, type LinhaOrcamento } from './pedidos.ts'

/** Ajuste do motorista sobre o total da tabela: de −50% (meio para cima, como `interno.arred`) a +100%. */
export function limitesAjuste(totalTabelaCent: number): { min: number; max: number } {
  const min = totalTabelaCent === 0 ? 0 : -Math.floor(totalTabelaCent / 2 + 0.5)
  return { min, max: totalTabelaCent }
}

export interface ExtrasProposta {
  veiculo_id: string
  /** Centavos com sinal; 0/ausente = sem ajuste. Vai como texto inteiro. */
  ajuste_cent?: number
  /** De 3 a 200 caracteres, obrigatório quando há ajuste. */
  ajuste_motivo?: string
}

export const corrida = {
  enviarProposta: (id: string, entrada: Record<string, unknown>, extras: ExtrasProposta, horarioSugerido: string | null = null) => {
    const p: Record<string, unknown> = { ...entrada, veiculo_id: extras.veiculo_id }
    if (extras.ajuste_cent) {
      p.ajuste_cent = String(extras.ajuste_cent)
      p.ajuste_motivo = extras.ajuste_motivo
    }
    return chamar('enviar_orcamento', { p_atividade: id, p, p_horario_sugerido: horarioSugerido })
  },

  confirmar: (id: string, versao: number, hash: string, chave: string, centroCusto: string | null = null, dispositivo: string | null = null) =>
    chamar('confirmar_corrida', {
      p_atividade: id,
      p_versao: versao,
      p_hash: hash,
      p_chave: chave,
      p_centro_custo: centroCusto,
      p_dispositivo: dispositivo,
    }),

  avaliar: (id: string, nota: number, comentario: string | null) =>
    chamar('avaliar', { p_atividade: id, p_nota: nota, p_comentario: comentario }),
}

const numero = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Uma linha do memorial em poucas palavras ("48 km", "1 h de espera", "pedágio"); `null` = não entra no resumo. */
function falaDaLinha(l: LinhaOrcamento): string | null {
  const q = l.quantidade
  switch (l.codigo) {
    case 'KM':
    case 'KM_COM_REBOQUE':
      return q === null ? null : `${numero(q)} km`
    case 'ESPERA':
      return q === null ? 'espera' : `${numero(q)} h de espera`
    case 'PEDAGIO':
      return 'pedágio'
    case 'HOSPEDAGEM':
      return q === 1 ? '1 diária de hospedagem' : q === null ? 'hospedagem' : `${numero(q)} diárias de hospedagem`
    case 'DIARIA_MOTORISTA':
      return q === 1 ? '1 diária do motorista' : q === null ? 'diárias do motorista' : `${numero(q)} diárias do motorista`
    case 'OUTROS':
      return l.descricao.replace(/^Outros:\s*/i, '') || 'outros'
    case 'AJUSTE_MOTORISTA':
      return 'ajuste do motorista'
    // O retorno acompanha o km e o reboque vem da categoria: não explicam nada sozinhos.
    case 'RETORNO':
    case 'REBOQUE':
      return null
    default:
      return l.descricao.toLowerCase()
  }
}

/**
 * Resumo do que a proposta do motorista mudou em relação à tabela (mesma categoria e mesma rota): as linhas que não
 * existem na tabela ou mudaram de quantidade ou valor. Só exibição; o cálculo linha a linha vem do banco.
 */
export function resumoDaProposta(
  tabela: readonly LinhaOrcamento[],
  proposta: readonly LinhaOrcamento[],
  opcoes: { toleranciaKm?: number } = {},
): string[] {
  const tolerancia = opcoes.toleranciaKm ?? 0
  // Km que só andou um pouco (rota recalculada, arredondamento): não conta como mudança.
  const kmParecido = (l: LinhaOrcamento) =>
    (l.codigo === 'KM' || l.codigo === 'KM_COM_REBOQUE') &&
    l.quantidade !== null &&
    tabela.some((t) => t.codigo === l.codigo && t.quantidade !== null && Math.abs(t.quantidade - l.quantidade!) <= tolerancia)
  const igual = (a: LinhaOrcamento, b: LinhaOrcamento) =>
    a.codigo === b.codigo && a.quantidade === b.quantidade && a.valor_cent === b.valor_cent && a.descricao === b.descricao
  const falas: string[] = []
  for (const l of proposta) {
    if (tabela.some((t) => igual(t, l)) || kmParecido(l)) continue
    const fala = falaDaLinha(l)
    if (fala && !falas.includes(fala)) falas.push(fala)
  }
  return falas
}
