export interface LinkDeEntrada {
  /** O app foi aberto por um link de convite ou de recuperação de senha (fluxo implícito). */
  definirSenha: boolean
  /** O link veio com erro (expirado, já usado, inválido). */
  erro: boolean
}

/** Lê o fragmento `#access_token=…&type=invite` (ou `#error=…`) devolvido pelo Supabase Auth. */
export function lerLinkDeEntrada(hash: string): LinkDeEntrada {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const tipo = params.get('type')
  return {
    definirSenha: params.has('access_token') && (tipo === 'invite' || tipo === 'recovery'),
    erro: params.has('error') || params.has('error_code') || params.has('error_description'),
  }
}
