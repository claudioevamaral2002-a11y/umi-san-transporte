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

/**
 * Máscara do campo "Telefone" do perfil: tira o código do país antes de mascarar ("+55 91 98888-7777" →
 * "(91) 98888-7777"). Sem isso, a máscara de 11 dígitos guardava o "55" como DDD e cortava o fim do número.
 * Vale para "+55…" e para 12–13 dígitos começando com 55; o resto fica igual a `mascararTelefone` (a do Novo pedido,
 * que não muda).
 */
export function mascararTelefoneDoPerfil(texto: string): string {
  const s = texto.trimStart()
  if (s.startsWith('+55')) return mascararTelefone(s.slice(3))
  const d = s.replace(/\D/g, '')
  if (/^55\d{10,11}$/.test(d)) return mascararTelefone(d.slice(2))
  return mascararTelefone(texto)
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
