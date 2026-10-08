/**
 * Tradução dos códigos devolvidos pelas RPCs `api.*` e pelas Edge Functions (`{ok, codigo}`).
 * Mensagens genéricas: nunca revelam se um e-mail/usuário existe nem detalhes internos.
 */
export const MENSAGENS = {
  // Gerais
  ERRO_INESPERADO: 'Algo deu errado. Tente de novo em instantes.',
  CAMPOS_INVALIDOS: 'Confira os dados informados e tente de novo.',
  SEM_PERMISSAO: 'Você não tem permissão para fazer isso.',
  NAO_PERMITIDO: 'Você não tem permissão para fazer isso.',
  NAO_ENCONTRADO: 'Não encontramos o que você procurou. Atualize a página e tente de novo.',
  LIMITE_EXCEDIDO: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  NAO_AUTENTICADO: 'Sua sessão terminou. Entre de novo.',
  METODO_NAO_PERMITIDO: 'Algo deu errado. Tente de novo em instantes.',
  ORIGEM_NAO_PERMITIDA: 'Algo deu errado. Tente de novo em instantes.',
  ERRO_AUTH: 'Algo deu errado. Tente de novo em instantes.',

  // Senha
  SENHA_FRACA: 'A senha precisa ter pelo menos 10 caracteres, com letra maiúscula, letra minúscula e número.',
  SENHA_LONGA: 'Senha longa demais. Use uma senha mais curta.',
  SENHA_VAZADA: 'Essa senha já apareceu em vazamentos. Escolha outra.',
  VERIFICACAO_INDISPONIVEL: 'Não conseguimos verificar a senha agora. Tente de novo em alguns minutos.',
  REAUTENTICACAO_NECESSARIA: 'Por segurança, abra o link de novo ou peça um novo link ao administrador.',

  // Gestão de usuários
  ULTIMO_ADM: 'Não é possível: este é o último administrador ativo.',
  PROPRIO_USUARIO: 'Você não pode fazer isso com a sua própria conta.',
  PROPRIO_PAPEL: 'Você não pode alterar o seu próprio perfil.',
  ALVO_ADM: 'Essa ação não vale para administradores.',
  MOTIVO_OBRIGATORIO: 'Informe o motivo.',
  JA_EXISTE_ADM: 'Já existe um administrador.',

  // Matriz, empresas e parâmetros
  CHAVE_INVALIDA: 'Permissão desconhecida. Atualize a página e tente de novo.',
  CAMINHO_INVALIDO: 'Arquivo de logo inválido. Envie um PNG ou WebP.',
  VIGENCIA_NO_PASSADO: 'A vigência precisa começar agora ou no futuro.',
} as const satisfies Record<string, string>

export type Codigo = keyof typeof MENSAGENS

export function mensagemDoCodigo(codigo: string | null | undefined): string {
  if (codigo && Object.hasOwn(MENSAGENS, codigo)) return MENSAGENS[codigo as Codigo]
  return MENSAGENS.ERRO_INESPERADO
}

/** Erros do Supabase Auth (login e 2FA). O login é sempre genérico: não diz se o e-mail existe. */
export function mensagemErroAuth(
  erro: { code?: string; status?: number; name?: string } | null | undefined,
  /** `codigo`: conferência do código de 6 dígitos (recusa sem código conhecido = código errado). */
  contexto: 'login' | '2fa' | 'codigo' = 'login',
): string {
  const codigo = erro?.code ?? ''
  if (codigo === 'captcha_failed') return 'A verificação de segurança falhou. Tente de novo.'
  if (codigo === 'over_request_rate_limit' || erro?.status === 429) return MENSAGENS.LIMITE_EXCEDIDO
  const codigoErrado = 'Código incorreto ou vencido. Confira o app autenticador e tente de novo.'
  if (codigo === 'mfa_verification_failed' || codigo === 'mfa_challenge_expired') return codigoErrado
  if (erro?.name === 'AuthRetryableFetchError' || erro?.status === 0) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  if (contexto === 'codigo' && (erro?.status === 400 || erro?.status === 422)) return codigoErrado
  return contexto === 'login' ? 'E-mail ou senha incorretos.' : MENSAGENS.ERRO_INESPERADO
}
