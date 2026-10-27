// Rótulos e regras de tela da administração (o banco continua decidindo tudo).
import type { Nivel, Papel, Perfil } from './estadoSessao.ts'

export const PAPEIS: Record<Papel, string> = {
  ADM: 'Administrador',
  GESTOR_FROTA: 'Gestor de frota',
  MOTORISTA: 'Motorista',
  CLIENTE: 'Cliente',
}

/** Níveis do cliente (Adendo A10). */
export const NIVEIS: Record<Nivel, string> = {
  1: 'Gestor da empresa (N1)',
  2: 'Solicitante (N2)',
  3: 'Visualizador (N3)',
}

/** O que cada nível do cliente pode fazer (texto de ajuda no convite). */
export const NIVEIS_AJUDA: Record<Nivel, string> = {
  1: 'Cria, aprova e cancela todos os pedidos da empresa e convida colegas.',
  2: 'Cria e acompanha só os próprios pedidos.',
  3: 'Vê os pedidos e o saldo da empresa, sem agir.',
}

export const LISTA_NIVEIS: Nivel[] = [1, 2, 3]

export const ehNivel = (n: unknown): n is Nivel => n === 1 || n === 2 || n === 3

/** "Cliente · Solicitante (N2)", "Motorista"… */
export function rotuloPerfil(papel: Papel, nivel: number | null | undefined): string {
  return papel === 'CLIENTE' && ehNivel(nivel) ? `${PAPEIS.CLIENTE}, ${NIVEIS[nivel]}` : PAPEIS[papel]
}

/** Gestor da empresa (cliente N1): vê a tela Equipe. Só experiência; o banco decide de novo. */
export function gereEquipe(perfil: Pick<Perfil, 'papel' | 'nivel'> | null | undefined): boolean {
  return perfil?.papel === 'CLIENTE' && perfil.nivel === 1
}

/** Nomes das ações registradas na auditoria; ação desconhecida aparece com o código. */
export const ACOES: Record<string, string> = {
  PUBLICAR_PARAMETROS: 'Publicar tabela de preços',
  PUBLICAR_CONTRATO: 'Publicar contrato',
  DEFINIR_RETENCAO_FOTOS: 'Alterar retenção de fotos',
  PREPARAR_CONVITE: 'Preparar convite',
  CONVIDAR_LINK: 'Gerar link de convite',
  GERAR_LINK: 'Gerar novo link',
  ALTERAR_PERFIL: 'Alterar perfil',
  DEFINIR_ATIVO: 'Ativar/desativar usuário',
  DESATIVAR_AUTH: 'Bloquear acesso (Auth)',
  REATIVAR_AUTH: 'Liberar acesso (Auth)',
  RESETAR_2FA: 'Resetar 2FA',
  AUTORIZAR_OPERACAO_USUARIO: 'Autorizar operação de usuário',
  DEFINIR_PERMISSAO: 'Alterar permissão (matriz antiga)',
  SALVAR_EMPRESA: 'Salvar empresa',
  DEFINIR_LOGO_EMPRESA: 'Alterar logo da empresa',
  AUTORIZAR_DEFINIR_SENHA: 'Autorizar definição de senha',
  DEFINIR_SENHA: 'Definir senha',
  CONFIRMAR_SENHA: 'Confirmar senha',
  CONVITE_PRIMEIRO_ADM: 'Convite do primeiro administrador',
  LINK_PRIMEIRO_ADM: 'Link do primeiro administrador',
  CRIAR_LINK_CURTO: 'Criar link de acesso',
  RESGATAR_LINK: 'Abrir link de acesso (Continuar)',
  VERIFICAR_LINK: 'Validar link de acesso',
  AUDITORIA_LIMITADA: 'Limite de chamadas atingido',
  SALVAR_TELEFONE: 'Salvar telefone',
  MEU_TELEFONE: 'Ver o próprio telefone',
  // v2.2: pedidos (`grep -ho "interno.negar('…'\|auditar('…'" supabase/migrations`)
  CRIAR_PEDIDO: 'Criar pedido',
  LISTAR_PEDIDOS: 'Listar pedidos',
  VER_PEDIDO: 'Ver pedido',
  VER_PENDENCIAS: 'Ver pendências',
  VER_AGENDA: 'Ver agenda',
  DIAS_DO_MES: 'Ver dias do mês',
  HORARIOS_LIVRES: 'Ver horários livres',
  CALCULAR_ORCAMENTO: 'Calcular orçamento',
  PREVIA_ORCAMENTO: 'Prévia do orçamento',
  ENVIAR_ORCAMENTO: 'Enviar orçamento',
  APROVAR_ORCAMENTO: 'Aprovar orçamento',
  REPROVAR_ORCAMENTO: 'Reprovar orçamento',
  PEDIR_REVISAO: 'Pedir revisão do orçamento',
  RECUSAR_PEDIDO: 'Recusar pedido',
  CANCELAR_PEDIDO: 'Cancelar pedido',
  CANCELAR_AGENDADO: 'Cancelar pedido agendado',
  CANCELAR_SEM_SAIDA: 'Cancelar sem saída do motorista',
  SIMULAR_CANCELAMENTO: 'Simular cancelamento',
  EXPIRAR_VENCIDOS: 'Expirar pedidos vencidos',
  CONFIRMAR_CORRIDA: 'Confirmar corrida',
  REGISTRAR_SAIDA: 'Registrar saída',
  REGISTRAR_ETA: 'Registrar previsão de chegada',
  INFORMAR_PREVISAO: 'Informar nova previsão',
  ENVIAR_POSICAO: 'Enviar posição',
  CONCLUIR: 'Concluir corrida',
  AVALIAR: 'Avaliar corrida',
  ENVIAR_FOTO: 'Enviar foto',
  AUTORIZAR_FOTO: 'Autorizar envio de foto',
  CONFIRMAR_FOTO: 'Confirmar foto',
  VER_FOTOS: 'Ver fotos',
  CATEGORIAS_DISPONIVEIS: 'Ver categorias e preços do pedido',
  LOCAIS_DA_EMPRESA: 'Buscar locais da empresa',
  USO_MAPAS: 'Busca de endereço (mapas)',
  // v2.2: dinheiro
  VER_SALDO: 'Ver saldo',
  VER_EXTRATO: 'Ver extrato',
  LANCAR_RECARGA: 'Lançar recarga',
  LANCAR_AJUSTE: 'Lançar ajuste',
  ESTORNAR_LANCAMENTO: 'Estornar lançamento',
  RECONCILIAR_SALDOS: 'Reconciliar saldos',
  PAINEL_EMPRESA: 'Ver painel da empresa',
  VER_PAINEL_ADM: 'Ver painel do Master',
  // v2.2: faturas
  VER_FATURAS: 'Ver faturas',
  VER_FATURA: 'Ver fatura',
  PREVIA_FATURA: 'Prévia da fatura',
  GERAR_FATURA: 'Gerar fatura',
  MARCAR_FATURA_PAGA: 'Marcar fatura como paga',
  CANCELAR_FATURA: 'Cancelar fatura',
  TROCAR_PDF_FATURA: 'Trocar PDF da nota fiscal',
  // v2.2: cadastros
  PUBLICAR_TARIFAS: 'Publicar tabela de categorias',
  CATEGORIAS_ADM: 'Ver categorias (Master)',
  SALVAR_CATEGORIA: 'Salvar categoria',
  EXCLUIR_CATEGORIA: 'Excluir categoria',
  CATEGORIAS_VEICULO: 'Alterar categorias do veículo',
  SALVAR_VEICULO: 'Salvar veículo',
  MEUS_VEICULOS: 'Ver os próprios veículos',
  MUDAR_SITUACAO_VEICULO: 'Mudar situação do veículo',
  DEFINIR_TETO_MAPAS: 'Alterar teto de buscas de endereço',
  DEFINIR_CONTATO_RECARGA: 'Alterar contato da IVO',
  RENOMEAR_LOCAL: 'Renomear local salvo',
  EXCLUIR_LOCAL: 'Excluir local salvo',
  LOCAIS_EMPRESA_TODOS: 'Ver locais salvos',
  // v2.2: leituras novas
  ACOES_AUDITORIA: 'Ver ações da auditoria',
  AJUDA_CLIENTE: 'Ver ajuda do cliente',
  CONTATO_IVO: 'Ver contato da IVO',
}

export const nomeAcao = (acao: string) => ACOES[acao] ?? acao

export type GrupoAcao = 'Acesso' | 'Pedidos' | 'Dinheiro' | 'Faturas' | 'Cadastros'

/** Ordem dos grupos no filtro de Ação. */
export const GRUPOS_ACAO: readonly GrupoAcao[] = ['Acesso', 'Pedidos', 'Dinheiro', 'Faturas', 'Cadastros']

const grupo = (g: GrupoAcao, acoes: string[]) => Object.fromEntries(acoes.map((a) => [a, g])) as Record<string, GrupoAcao>

/** v2.2: o assunto de cada ação conhecida (o filtro de Ação agrupa por ele). */
export const GRUPO_ACAO: Record<string, GrupoAcao> = {
  ...grupo('Acesso', [
    'PREPARAR_CONVITE', 'CONVIDAR_LINK', 'GERAR_LINK', 'ALTERAR_PERFIL', 'DEFINIR_ATIVO', 'DESATIVAR_AUTH',
    'REATIVAR_AUTH', 'RESETAR_2FA', 'AUTORIZAR_OPERACAO_USUARIO', 'DEFINIR_PERMISSAO', 'AUTORIZAR_DEFINIR_SENHA',
    'DEFINIR_SENHA', 'CONFIRMAR_SENHA', 'CONVITE_PRIMEIRO_ADM', 'LINK_PRIMEIRO_ADM', 'CRIAR_LINK_CURTO', 'RESGATAR_LINK',
    'VERIFICAR_LINK', 'AUDITORIA_LIMITADA', 'SALVAR_TELEFONE', 'MEU_TELEFONE', 'ACOES_AUDITORIA',
  ]),
  ...grupo('Pedidos', [
    'CRIAR_PEDIDO', 'LISTAR_PEDIDOS', 'VER_PEDIDO', 'VER_PENDENCIAS', 'VER_AGENDA', 'DIAS_DO_MES', 'HORARIOS_LIVRES',
    'CALCULAR_ORCAMENTO', 'PREVIA_ORCAMENTO', 'ENVIAR_ORCAMENTO', 'APROVAR_ORCAMENTO', 'REPROVAR_ORCAMENTO',
    'PEDIR_REVISAO', 'RECUSAR_PEDIDO', 'CANCELAR_PEDIDO', 'CANCELAR_AGENDADO', 'CANCELAR_SEM_SAIDA',
    'SIMULAR_CANCELAMENTO', 'EXPIRAR_VENCIDOS', 'CONFIRMAR_CORRIDA', 'REGISTRAR_SAIDA', 'REGISTRAR_ETA',
    'INFORMAR_PREVISAO', 'ENVIAR_POSICAO', 'CONCLUIR', 'AVALIAR', 'ENVIAR_FOTO', 'AUTORIZAR_FOTO', 'CONFIRMAR_FOTO',
    'VER_FOTOS', 'CATEGORIAS_DISPONIVEIS', 'LOCAIS_DA_EMPRESA', 'USO_MAPAS', 'AJUDA_CLIENTE', 'CONTATO_IVO',
  ]),
  ...grupo('Dinheiro', [
    'VER_SALDO', 'VER_EXTRATO', 'LANCAR_RECARGA', 'LANCAR_AJUSTE', 'ESTORNAR_LANCAMENTO', 'RECONCILIAR_SALDOS',
    'PAINEL_EMPRESA', 'VER_PAINEL_ADM',
  ]),
  ...grupo('Faturas', [
    'VER_FATURAS', 'VER_FATURA', 'PREVIA_FATURA', 'GERAR_FATURA', 'MARCAR_FATURA_PAGA', 'CANCELAR_FATURA',
    'TROCAR_PDF_FATURA',
  ]),
  ...grupo('Cadastros', [
    'PUBLICAR_PARAMETROS', 'PUBLICAR_CONTRATO', 'PUBLICAR_TARIFAS', 'DEFINIR_RETENCAO_FOTOS', 'SALVAR_EMPRESA',
    'DEFINIR_LOGO_EMPRESA', 'CATEGORIAS_ADM', 'SALVAR_CATEGORIA', 'EXCLUIR_CATEGORIA', 'CATEGORIAS_VEICULO',
    'SALVAR_VEICULO', 'MEUS_VEICULOS', 'MUDAR_SITUACAO_VEICULO', 'DEFINIR_TETO_MAPAS', 'DEFINIR_CONTATO_RECARGA',
    'RENOMEAR_LOCAL', 'EXCLUIR_LOCAL', 'LOCAIS_EMPRESA_TODOS',
  ]),
}

export interface OpcaoAcao {
  /** O código, que vai no filtro (`p_acao`). */
  valor: string
  /** O nome legível, ou o próprio código quando a ação é desconhecida. */
  rotulo: string
  total: number
}

/**
 * v2.2: opções do filtro de Ação a partir de `api.acoesAuditoria()`: agrupadas por assunto (na ordem de `GRUPOS_ACAO`),
 * em ordem alfabética do rótulo dentro do grupo. Ação sem grupo conhecido vai para "Outras", no fim, com o código
 * como rótulo. Grupos vazios não aparecem.
 */
export function opcoesDeAcao(
  lista: readonly { acao: string; total: number }[],
): { grupo: GrupoAcao | 'Outras'; opcoes: OpcaoAcao[] }[] {
  const ordem: (GrupoAcao | 'Outras')[] = [...GRUPOS_ACAO, 'Outras']
  const porGrupo = new Map<GrupoAcao | 'Outras', OpcaoAcao[]>(ordem.map((g) => [g, []]))
  for (const { acao, total } of lista) {
    const g = Object.hasOwn(GRUPO_ACAO, acao) ? GRUPO_ACAO[acao]! : 'Outras'
    porGrupo.get(g)!.push({ valor: acao, rotulo: Object.hasOwn(ACOES, acao) ? ACOES[acao]! : acao, total })
  }
  return ordem
    .map((g) => ({ grupo: g, opcoes: porGrupo.get(g)!.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')) }))
    .filter((g) => g.opcoes.length > 0)
}

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

/** Motivo de desativação/reativação: 3 a 500 caracteres (igual ao banco). */
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
