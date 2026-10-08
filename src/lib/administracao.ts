// Rótulos e regras de tela da administração (o banco continua decidindo tudo).
import type { Papel } from './estadoSessao.ts'

export const PAPEIS: Record<Papel, string> = {
  ADM: 'Administrador',
  MOTORISTA: 'Motorista',
  CLIENTE: 'Cliente',
}

export interface DefinicaoPermissao {
  chave: string
  titulo: string
  explicacao: string
}

/** As 3 chaves da matriz (especificação 2), na ordem da tela. */
export const PERMISSOES: DefinicaoPermissao[] = [
  {
    chave: 'MOTORISTA_EDITA_PARAMETROS',
    titulo: 'Motorista edita a tabela de preços',
    explicacao: 'O motorista pode publicar novas versões da tabela de preços e regras, como o administrador.',
  },
  {
    chave: 'MOTORISTA_LANCA_RECARGA',
    titulo: 'Motorista lança recarga de saldo',
    explicacao: 'O motorista pode registrar recargas (Pix recebido) no saldo da empresa cliente, com comprovante.',
  },
  {
    chave: 'CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO',
    titulo: 'Cliente atua em pedido de colega',
    explicacao:
      'Um cliente pode aprovar, reprovar, pedir revisão ou cancelar pedidos criados por outra pessoa da mesma empresa.',
  },
]

/** Nomes das ações registradas na auditoria; ação desconhecida aparece com o código. */
export const ACOES: Record<string, string> = {
  PUBLICAR_PARAMETROS: 'Publicar tabela de preços',
  PREPARAR_CONVITE: 'Preparar convite',
  CONVIDAR_LINK: 'Gerar link de convite',
  GERAR_LINK: 'Gerar novo link',
  ALTERAR_PERFIL: 'Alterar perfil',
  DEFINIR_ATIVO: 'Ativar/desativar usuário',
  DESATIVAR_AUTH: 'Bloquear acesso (Auth)',
  REATIVAR_AUTH: 'Liberar acesso (Auth)',
  RESETAR_2FA: 'Resetar 2FA',
  AUTORIZAR_OPERACAO_USUARIO: 'Autorizar operação de usuário',
  DEFINIR_PERMISSAO: 'Alterar permissão',
  SALVAR_EMPRESA: 'Salvar empresa',
  DEFINIR_LOGO_EMPRESA: 'Alterar logo da empresa',
  AUTORIZAR_DEFINIR_SENHA: 'Autorizar definição de senha',
  DEFINIR_SENHA: 'Definir senha',
  CONFIRMAR_SENHA: 'Confirmar senha',
  CONVITE_PRIMEIRO_ADM: 'Convite do primeiro administrador',
  LINK_PRIMEIRO_ADM: 'Link do primeiro administrador',
}

export const nomeAcao = (acao: string) => ACOES[acao] ?? acao

/** Normaliza para busca sem acento e sem caixa. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function filtrarUsuarios<T extends { nome: string; email: string; papel: Papel }>(
  lista: T[],
  busca: string,
  papel: Papel | 'TODOS',
): T[] {
  const termo = normalizar(busca)
  return lista.filter(
    (u) =>
      (papel === 'TODOS' || u.papel === papel) &&
      (!termo || normalizar(u.nome).includes(termo) || normalizar(u.email).includes(termo)),
  )
}

/** Motivo de desativação/reativação/permissão: 3 a 500 caracteres (igual ao banco). */
export function motivoValido(motivo: string): boolean {
  const n = motivo.trim().length
  return n >= 3 && n <= 500
}

export const LOGO_TIPOS = ['image/png', 'image/webp'] as const
export const LOGO_MAX_BYTES = 500 * 1024

/** Conferência no navegador antes de enviar o logo (o bucket confere de novo). */
export function validarLogo(arquivo: { type: string; size: number }): { ok: true; extensao: 'png' | 'webp' } | { ok: false; erro: string } {
  if (!(LOGO_TIPOS as readonly string[]).includes(arquivo.type)) return { ok: false, erro: 'Envie uma imagem PNG ou WebP.' }
  if (arquivo.size > LOGO_MAX_BYTES) return { ok: false, erro: 'A imagem passa de 500 KB. Reduza o tamanho e tente de novo.' }
  if (arquivo.size === 0) return { ok: false, erro: 'O arquivo está vazio.' }
  return { ok: true, extensao: arquivo.type === 'image/png' ? 'png' : 'webp' }
}

/** Texto JSON legível do detalhe da auditoria (sempre exibido como texto, nunca como HTML). */
export function detalheComoTexto(detalhe: unknown): string {
  if (detalhe === null || detalhe === undefined) return '—'
  try {
    return JSON.stringify(detalhe, null, 2)
  } catch {
    return String(detalhe)
  }
}
