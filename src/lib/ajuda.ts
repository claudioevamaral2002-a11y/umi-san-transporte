// v2.2 (especificação §4.4 e §5.5): tela Ajuda e "Falar com a IVO". O contato é o de Configurações
// (`app.configuracao.contato_recarga`, na tela "Contato da IVO"); os números da Ajuda do cliente vêm do contrato
// vigente da empresa (`api.ajuda_cliente`). O texto das respostas fica nas telas.
import type { Faixa, FormaCobranca } from './contratos.ts'
import { ErroLeitura, ler } from './pedidos.ts'

/** O que a Ajuda do cliente mostra com números reais do contrato vigente da empresa. */
export interface AjudaCliente {
  /** Faixas de cancelamento, como no contrato (`descreverFaixas` as põe em frases). */
  faixas_cancelamento: Faixa[]
  prazo_orcar_horas: number
  validade_orcamento_horas: number
  forma_cobranca: FormaCobranca
}

/** `cancelamento` como o banco manda: as faixas do contrato, soltas ou dentro de um objeto. */
type CancelamentoRecebido = Faixa[] | { faixas_cancelamento?: Faixa[]; faixas?: Faixa[] } | null | undefined

interface RespostaAjuda {
  /** O banco manda as faixas no topo da resposta, como no contrato. */
  faixas_cancelamento?: Faixa[] | null
  cancelamento?: CancelamentoRecebido
  prazo_orcar_horas: number
  validade_orcamento_horas: number
  forma_cobranca?: FormaCobranca
}

function faixasDe(c: CancelamentoRecebido): Faixa[] {
  if (Array.isArray(c)) return c
  return c?.faixas_cancelamento ?? c?.faixas ?? []
}

/** Contato da IVO (telefone ou WhatsApp), para qualquer perfil logado. `null` = o Master ainda não cadastrou. */
export async function contatoIvo(): Promise<string | null> {
  const contato = (await ler<{ contato?: string | null }>('contato_ivo', {})).contato
  return typeof contato === 'string' && contato.trim() ? contato.trim() : null
}

/** Só cliente. `null` = a empresa não tem contrato vigente (`SEM_CONTRATO`); outra recusa: `ErroLeitura`. */
export async function ajudaCliente(): Promise<AjudaCliente | null> {
  let r: RespostaAjuda
  try {
    r = await ler<RespostaAjuda>('ajuda_cliente', {})
  } catch (e) {
    if (e instanceof ErroLeitura && e.codigo === 'SEM_CONTRATO') return null
    throw e
  }
  return {
    faixas_cancelamento: faixasDe(r.faixas_cancelamento ?? r.cancelamento),
    prazo_orcar_horas: r.prazo_orcar_horas,
    validade_orcamento_horas: r.validade_orcamento_horas,
    forma_cobranca: r.forma_cobranca ?? 'CREDITO',
  }
}

/**
 * Link do "Falar com a IVO": telefone com 10 ou 11 dígitos (DDD + número; a formatação e um "+55" na frente são
 * aceitos; começando com 0, como "0800…", não) → `tel:+55…`; `wa.me/…` ou `https://wa.me/…` → o link do WhatsApp (sempre com https). Qualquer outra
 * coisa → `null`: a tela mostra o texto sem link.
 */
export function linkContato(contato: string): string | null {
  const t = contato.trim()
  if (/^wa\.me\/\S+$/i.test(t)) return `https://${t}`
  if (/^https:\/\/wa\.me\/\S+$/i.test(t)) return t
  if (!/^[\d\s().+-]+$/.test(t)) return null
  let digitos = t.replace(/\D/g, '')
  if (t.startsWith('+')) {
    if (!digitos.startsWith('55')) return null
    digitos = digitos.slice(2)
  }
  // DDD nunca começa com 0: "0800…" e o prefixo de operadora ficam sem link.
  return /^[1-9]\d{9,10}$/.test(digitos) ? `tel:+55${digitos}` : null
}
