// Fase 4 (Ruling R15): o telefone do próprio perfil, para o botão "Ligar" do acompanhamento. O banco confere de novo
// (api.salvar_meu_telefone) e grava só os dígitos.
import { mascararTelefone } from './novoPedido.ts'
import { chamar, ler } from './pedidos.ts'

/**
 * A mesma regra do banco (interno.normalizar_telefone): DDD sem zero + 8 dígitos (fixo) ou 9 começando com 9
 * (celular), aceitando espaços, parênteses, pontos, hífens e "+55" no começo. Vazio apaga (`digitos: null`).
 */
export function normalizarTelefone(texto: string): { ok: true; digitos: string | null } | { ok: false } {
  const s = texto.trim()
  if (s === '') return { ok: true, digitos: null }
  if (texto.length > 25 || !/^(\+55)?[0-9() .-]*$/.test(s)) return { ok: false }
  const d = s.replace(/^\+55/, '').replace(/\D/g, '')
  return /^[1-9][1-9](9\d{8}|[2-8]\d{7})$/.test(d) ? { ok: true, digitos: d } : { ok: false }
}

/** "47999991234" → "(47) 99999-1234". Telefone antigo fora do padrão aparece como foi gravado. */
export function formatarTelefone(t: string | null): string {
  if (!t) return ''
  return /^\d{10,11}$/.test(t) ? mascararTelefone(t) : t
}

export const contato = {
  meuTelefone: async () => (await ler<{ telefone: string | null }>('meu_telefone', {})).telefone,
  salvarTelefone: (digitos: string | null) => chamar('salvar_meu_telefone', { p_telefone: digitos }),
}
