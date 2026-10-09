export type Papel = 'ADM' | 'GESTOR_FROTA' | 'MOTORISTA' | 'CLIENTE'

/** Nível do cliente: 1 gestor da empresa, 2 solicitante, 3 visualizador (nulo para os demais papéis). */
export type Nivel = 1 | 2 | 3

export type EstadoSessao =
  | 'carregando'
  | 'anonimo'
  | 'definir_senha'
  | 'cadastrar_2fa'
  | 'verificar_2fa'
  | 'pronto'
  | 'inativo'

/** Linha de `api.meu_perfil()`. */
export interface Perfil {
  nome: string
  papel: Papel
  nivel: Nivel | null
  empresa_id: string | null
  empresa_nome: string | null
  empresa_logo_caminho: string | null
  /** Só para cliente: a empresa tem contrato vigente (nulo para os demais papéis). */
  empresa_tem_contrato: boolean | null
  ativo: boolean
  senha_pendente: boolean
  tem_2fa: boolean
}

export interface EntradaEstado {
  temSessao: boolean
  /** `null` = usuário sem perfil (criado sem convite): não acessa nada. */
  perfil: Perfil | null
  /** Nível atual da sessão (`aal1`/`aal2`) e o próximo possível (`aal2` se há fator verificado). */
  aalAtual: string | null
  aalProximo: string | null
  /** Aberto por link de convite/recuperação nesta carga do app. */
  viaLink: boolean
}

export const EXIGE_2FA: readonly Papel[] = ['ADM', 'GESTOR_FROTA', 'MOTORISTA']

/** Máquina de estados da entrada (desenho §3). O banco decide de verdade; isto só guia a tela. */
export function derivarEstado(e: EntradaEstado): Exclude<EstadoSessao, 'carregando'> {
  if (!e.temSessao) return 'anonimo'
  if (!e.perfil || !e.perfil.ativo) return 'inativo'
  if (e.perfil.senha_pendente || e.viaLink) return 'definir_senha'
  if (!EXIGE_2FA.includes(e.perfil.papel)) return 'pronto'
  if (e.aalAtual === 'aal2') return 'pronto'
  if (e.perfil.tem_2fa || e.aalProximo === 'aal2') return 'verificar_2fa'
  return 'cadastrar_2fa'
}

/** Para onde cada estado leva a pessoa. */
export function rotaDoEstado(estado: EstadoSessao): string | null {
  switch (estado) {
    case 'anonimo':
      return '/entrar'
    case 'definir_senha':
      return '/definir-senha'
    case 'cadastrar_2fa':
    case 'verificar_2fa':
      return '/seguranca/2fa'
    case 'inativo':
      return '/sem-acesso'
    case 'pronto':
      return '/'
    case 'carregando':
      return null
  }
}
