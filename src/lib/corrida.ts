// Fase 4: ações da corrida (proposta do motorista, confirmação e avaliação do cliente). Dinheiro em centavos; o preço
// vem sempre do banco e nenhuma tela muda antes da resposta.
import { chamar } from './pedidos.ts'

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
