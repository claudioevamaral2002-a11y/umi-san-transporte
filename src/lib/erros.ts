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
  EXPIRADO: 'Este link expirou ou já foi usado. Peça um novo ao administrador.',
  REAUTENTICACAO_NECESSARIA: 'O link expirou para criar a senha. Peça um novo link ao administrador.',

  // Gestão de usuários
  ULTIMO_ADM: 'Não é possível: este é o último administrador ativo.',
  PROPRIO_USUARIO: 'Você não pode fazer isso com a sua própria conta.',
  PROPRIO_PAPEL: 'Você não pode alterar o seu próprio perfil.',
  ALVO_ADM: 'Essa ação não vale para administradores.',
  MOTIVO_OBRIGATORIO: 'Informe o motivo.',
  JA_EXISTE_ADM: 'Já existe um administrador.',
  // Devolvidos por interno.checar_convite (preparar_convite / convidar).
  JA_CADASTRADO: 'Este e-mail já tem cadastro. Use "Gerar novo link" na lista de pessoas.',
  EMAIL_EM_USO: 'Este e-mail já está em uso. Use "Gerar novo link" na lista de pessoas.',

  // Empresas e contratos (CHAVE_INVALIDA: só nas migrations da fase 1, da matriz já removida)
  CHAVE_INVALIDA: 'Permissão desconhecida. Atualize a página e tente de novo.',
  CAMINHO_INVALIDO: 'Arquivo de logo inválido. Envie um PNG ou WebP.',
  VIGENCIA_NO_PASSADO: 'A vigência precisa começar agora ou no futuro.',
  // publicar_tarifas com uma versão do contrato já agendada para o futuro (fase 4.1).
  VERSAO_FUTURA_PENDENTE: 'Já existe uma versão agendada para o futuro. Espere ela começar a valer ou fale com o suporte.',

  // Pedidos, agenda e orçamento (fase 2A)
  SEM_CONTRATO: 'Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.',
  SEM_MOTORISTA: 'Nenhum motorista disponível no momento. Tente de novo mais tarde.',
  HORARIO_OCUPADO: 'Esse horário acabou de ser ocupado. Escolha outro.',
  STATUS_INVALIDO: 'Este pedido mudou de situação. Atualize a página.',
  PRAZO_VENCIDO: 'O prazo deste pedido venceu.',
  CAMPOS_INCOMPATIVEIS: 'Há campos que não valem para a modalidade escolhida.',
  VALOR_FORA_DO_LIMITE: 'O valor calculado passou do limite permitido. Confira as quantidades.',

  // Saldo, aprovação e cancelamento de agendado (fase 2B)
  SALDO_INSUFICIENTE: 'Saldo insuficiente para aprovar este orçamento.',
  SEM_CREDITO: 'Sua empresa está sem crédito. Fale com a IVO Transportes para recarregar.',
  ORCAMENTO_VENCIDO: 'A validade deste orçamento venceu. Peça um novo pedido.',
  ORCAMENTO_ALTERADO: 'Este orçamento mudou desde que você abriu. Atualize a página e confira antes de aprovar.',
  JA_PROCESSADO: 'Esta operação já foi feita. Atualize a página.',
  CHAVE_REUTILIZADA: 'Algo deu errado. Atualize a página e tente de novo.',
  NAO_ESTORNAVEL: 'Este lançamento não pode ser estornado.',
  MULTA_ALTERADA: 'A multa mudou: o horário do cancelamento passou para outra faixa. Confira o novo valor e confirme de novo.',
  DIVERGENCIA_SALDO: 'A conferência de saldo encontrou divergência. Veja o painel.',

  // Endereços e mapas (fase 3A)
  TETO_DIARIO: 'A busca de endereços chegou ao limite de hoje. Escreva o local; o motorista confere os km.',
  MAPAS_INDISPONIVEL: 'Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km.',

  // Execução e rastreio (fase 3B)
  FORA_DA_JANELA: 'Ainda é cedo para sair: a saída libera 1 hora antes do início.',
  OUTRA_EM_ANDAMENTO: 'Você tem outro serviço em andamento. Conclua-o antes de sair para este.',
  PREVISAO_INVALIDA: 'Escolha um horário entre agora e as próximas 24 horas.',
  LIMITE_ETA: 'A previsão de chegada já foi recalculada o máximo de vezes nesta viagem.',
  FOTO_INVALIDA: 'Foto inválida. Envie uma imagem JPEG, PNG ou WebP de até 5 MB.',
  LIMITE_FOTOS: 'Este serviço já tem 10 fotos.',
  VEICULO_INVALIDO: 'Confira os dados do veículo: modelo, cor, placa, lugares, carga máxima e categorias.',
  PLACA_DUPLICADA: 'Já existe um veículo com esta placa.',

  // Pedido no estilo Uber (fase 4)
  CATEGORIA_INDISPONIVEL: 'Esta categoria está indisponível no momento. Escolha outra.',
  AJUSTE_FORA_DO_LIMITE: 'O novo valor precisa ficar entre a metade e o dobro do valor da tabela.',
  MOTIVO_INVALIDO: 'Informe o motivo do novo valor, com 3 a 200 caracteres.',
  CENTRO_CUSTO_INVALIDO: 'O centro de custo pode ter até 80 caracteres.',
  JA_AVALIADO: 'Esta corrida já foi avaliada.',
  NOTA_INVALIDA: 'Escolha uma nota de 1 a 5 estrelas.',
  TELEFONE_INVALIDO: 'Informe o telefone com DDD, por exemplo (47) 99999-1234.',
  VALOR_INVALIDO: 'O valor do orçamento precisa ser maior que zero. Confira os km e os valores informados.',

  // Categorias livres (fase 4.1)
  CATEGORIA_DUPLICADA: 'Já existe uma categoria ativa com este nome.',

  // Faturado (NF) e excluir categoria (v2.1)
  CATEGORIA_EM_USO: 'Esta categoria já foi usada e não pode ser excluída. Use Desativar.',
  NAO_FATURADO: 'Esta empresa não está no Faturado (NF). Confira a forma de cobrança do contrato.',
  QUINZENA_INVALIDA: 'Escolha uma quinzena: do dia 1 ao 15 ou do dia 16 ao último dia do mês.',
  QUINZENA_EM_ANDAMENTO: 'Esta quinzena ainda não terminou. Gere a fatura depois do último dia dela.',
  NADA_A_FATURAR: 'Não há nada a faturar nesta quinzena.',
  FATURA_PAGA: 'Esta fatura já está paga e não pode mais ser alterada.',
  FATURA_CANCELADA: 'Esta fatura foi cancelada. Atualize a página.',
  // Conferido no aparelho antes de enviar a NF (enviarPdfNota).
  PDF_INVALIDO: 'Envie a NF em PDF de até 5 MB.',
  // v2.2: criar_pedido com mais pessoas do que a categoria leva; o banco devolve `pessoas_max` na resposta.
  ACIMA_DA_CAPACIDADE: 'Esta categoria leva até {pessoas_max} pessoas.',
} as const satisfies Record<string, string>

export type Codigo = keyof typeof MENSAGENS

export function mensagemDoCodigo(codigo: string | null | undefined): string {
  if (codigo && Object.hasOwn(MENSAGENS, codigo)) return MENSAGENS[codigo as Codigo]
  return MENSAGENS.ERRO_INESPERADO
}

/**
 * Mensagens de CAMPOS_INVALIDOS por campo do pedido (fase 4.1). O banco audita o campo em `detalhe.invalidos`, mas a
 * resposta ao app traz só o código: a tela confere paradas, horas, centro de custo, diárias e outros custos antes de enviar e usa estas
 * mensagens; se o banco recusar mesmo assim, `mensagemDoPedido(codigo, campos)` diz qual campo.
 */
export const MENSAGENS_CAMPO_DO_PEDIDO = {
  paradas: 'Confira as paradas: use até 3, cada uma com 3 a 200 caracteres.',
  horas_estimadas: 'Informe as horas estimadas, de 0,5 a 24, de meia em meia hora.',
  centro_custo: 'O centro de custo pode ter até 80 caracteres.',
  // v2.1
  diarias_estimadas: 'Informe as diárias de 0 a 30.',
  outros_custos: 'Os outros custos podem ter até 120 caracteres.',
} as const satisfies Record<string, string>

/** v2.2: a mensagem quando falta o valor de um `{campo}` da mensagem do código. */
const SEM_VALOR: Partial<Record<Codigo, string>> = {
  ACIMA_DA_CAPACIDADE: 'Esta categoria leva menos pessoas.',
}

/**
 * Mensagem de uma recusa de `criar_pedido`; `campos` (opcional) são os campos inválidos conhecidos pela tela e
 * `valores` (v2.2, opcional) preenchem os `{chave}` da mensagem (ex.: `{ pessoas_max: 4 }`). Sem um valor (número ou
 * texto), a mensagem genérica do código, sem o número.
 */
export function mensagemDoPedido(
  codigo: string | null | undefined,
  campos?: readonly string[],
  valores?: Readonly<Record<string, unknown>>,
): string {
  if (codigo === 'CAMPOS_INVALIDOS') {
    for (const c of campos ?? []) if (Object.hasOwn(MENSAGENS_CAMPO_DO_PEDIDO, c)) return MENSAGENS_CAMPO_DO_PEDIDO[c as keyof typeof MENSAGENS_CAMPO_DO_PEDIDO]
  }
  const modelo = mensagemDoCodigo(codigo)
  let faltou = false
  const texto = modelo.replace(/\{(\w+)\}/g, (_, chave: string) => {
    const v = valores && Object.hasOwn(valores, chave) ? valores[chave] : undefined
    if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '')) return String(v)
    faltou = true
    return ''
  })
  if (!faltou) return texto
  return (codigo && Object.hasOwn(SEM_VALOR, codigo) ? SEM_VALOR[codigo as Codigo] : undefined) ?? MENSAGENS.ERRO_INESPERADO
}

/** VEICULO_INVALIDO no envio do orçamento (a mensagem de MENSAGENS é a do cadastro do veículo). */
export const VEICULO_AO_ORCAR = 'Nenhum veículo ativo atende esta categoria. Cadastre ou reative um veículo.'

/** Mensagem da recusa no envio do orçamento (Orçar do app atual, Chamada e Propor valor do app novo). */
export function mensagemAoOrcar(codigo: string | null | undefined): string {
  return codigo === 'VEICULO_INVALIDO' ? VEICULO_AO_ORCAR : mensagemDoCodigo(codigo)
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
