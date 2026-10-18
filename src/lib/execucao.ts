// Fase 3B: ações da execução no schema `api` e a foto pela Edge Function `enviar-foto`. Nenhuma é otimista: a tela só
// muda depois da resposta do servidor (a saída mexe no saldo da empresa; especificação 12.2).
import type { RespostaRpc } from './api.ts'
import { chamarFuncao } from './funcoes.ts'
import { supabase } from './supabase.ts'

async function chamar(nome: string, args: Record<string, unknown>): Promise<RespostaRpc> {
  try {
    const { data, error } = await supabase.rpc(nome, args)
    if (error || !data || typeof data !== 'object' || typeof (data as RespostaRpc).ok !== 'boolean') {
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    return data as RespostaRpc
  } catch {
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
}

export interface PosicaoEnviada {
  lat: number
  lng: number
  precisao: number
  rumo: number | null
  velocidade: number | null
  seq: number
  eta: string | null
}

export interface FotoDoPedido {
  id: string
  caminho: string
  enviada_em: string
}

export const execucao = {
  /** Deslize para sair: reserva → débito numa transação. A chave repete o mesmo resultado se a resposta se perder. */
  registrarSaida: (id: string, chave: string) => chamar('registrar_saida', { p_atividade: id, p_chave: chave }),
  informarPrevisao: (id: string, fim: string, motivo: string | null) =>
    chamar('informar_previsao', { p_atividade: id, p_fim: fim, p_motivo: motivo }),
  concluir: (id: string, observacao: string | null) => chamar('concluir', { p_atividade: id, p_observacao: observacao }),
  enviarPosicao: (id: string, p: PosicaoEnviada) => chamar('enviar_posicao', { p_atividade: id, p }),
  /** Gasta 1 dos 12 cálculos de chegada da viagem (antes de pedir a rota ao Google). */
  registrarEta: (id: string) => chamar('registrar_eta', { p_atividade: id }),
  fotos: async (id: string): Promise<FotoDoPedido[]> => {
    const r = await chamar('fotos_do_pedido', { p_atividade: id })
    return r.ok && Array.isArray(r.fotos) ? (r.fotos as FotoDoPedido[]) : []
  },
  /** URL assinada curta (5 min) de uma foto confirmada; `null` sem permissão. */
  urlDaFoto: async (caminho: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage.from('fotos').createSignedUrl(caminho, 300)
      return error ? null : data.signedUrl
    } catch {
      return null
    }
  },
  enviarFoto: (id: string, base64: string) => chamarFuncao('enviar-foto', { atividade: id, dados: base64 }),
}
