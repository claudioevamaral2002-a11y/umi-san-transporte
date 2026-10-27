// Pedidos, agenda e orçamento (fase 2A): leituras e ações no schema `api`. O banco decide quem vê e faz o quê;
// nenhuma ação aqui é otimista — a tela só muda depois da resposta do servidor (especificação 12.2).
import type { Status } from '../design/componentes/StatusBadge.tsx'
import type { RespostaRpc } from './api.ts'
import type { Faixa } from './contratos.ts'
import type { Carga, Modalidade, Reboque } from './situacao.ts'
import { supabase } from './supabase.ts'

export interface ItemPedido {
  id: string
  numero: number
  status: Status
  inicio: string
  duracao_min: number
  origem: string
  destino: string
  /** Fase 4.1: endereços das paradas, na ordem (até 3), quando houver. */
  paradas?: string[] | null
  levar: boolean
  trazer: boolean
  modalidade: Modalidade
  total_cent: number | null
  prazo_orcar_ate: string | null
  valido_ate: string | null
  prazo_vencido: boolean
  empresa_nome: string | null
  /** v2.2: soma das MULTAS lançadas na atividade (nulo = sem multa). Opcional: o banco anterior não devolvia. */
  multa_cent?: number | null
}

export interface DetalhePedido {
  id: string
  numero: number
  status: Status
  empresa_id: string
  empresa_nome: string
  solicitante_nome: string | null
  motorista_nome: string | null
  inicio: string
  duracao_min: number
  origem: string
  destino: string
  levar: boolean
  trazer: boolean
  carga: Carga
  pessoas_qtd: number | null
  equipamento_desc: string | null
  peso_kg: number | null
  dimensoes: string | null
  modalidade: Modalidade
  reboque: Reboque
  contato_nome: string | null
  contato_telefone: string | null
  observacoes: string | null
  prazo_orcar_ate: string
  prazo_vencido: boolean
  criada_em: string
  atualizada_em: string
  // Fase 3A (opcionais: pedidos antigos não têm). Ponto do Google: só o place_id; marcado no mapa: lat/lng.
  origem_lat?: number | null
  origem_lng?: number | null
  destino_lat?: number | null
  destino_lng?: number | null
  origem_place_id?: string | null
  destino_place_id?: string | null
  /** Trechos que o km do orçamento cobre: 2 em ida e volta, 1 em trecho único (regra do banco). */
  trechos_km?: 1 | 2
  // Fase 3B (opcionais: o app aberto durante o deploy ainda recebe o detalhe antigo).
  saiu_em?: string | null
  concluiu_em?: string | null
  /** Previsão informada pelo motorista ou início + duração. */
  fim_previsto?: string | null
  previsao_informada?: boolean
  /** O serviço anterior do motorista atrasou e deve acabar neste horário. */
  atraso_anterior_ate?: string | null
  km_rodados?: number | null
  observacao_conclusao?: string | null
  /** A saída libera 1 h antes do início (D1). */
  saida_liberada_em?: string | null
  pode_ver_rastreio?: boolean
  fotos_qtd?: number
  // Fase 4 (opcionais: pedidos do app atual não têm categoria).
  categoria?: string | null
  categoria_nome?: string | null
  /** Veículo da corrida, visto pelo cliente a partir do orçamento (ORCADA). */
  veiculo?: { modelo: string; cor: string; placa: string } | null
  centro_custo?: string | null
  agora?: boolean
  /** Nota de 1 a 5 do cliente (uma vez, só concluída). */
  avaliacao?: number | null
  /** Última posição gravada (só em andamento, para quem pode ver o rastreio): a tela já abre com ela. */
  ultima_posicao?: { lat: number; lng: number; em: string } | null
  /** Telefone do motorista (perfil), a partir de AGENDADA, para o botão "Ligar" do cliente (Tarefa 10). */
  motorista_telefone?: string | null
  // v2.1 (opcionais: pedidos antigos e o banco anterior não têm).
  /** Diárias (hospedagem) que o cliente estimou ao pedir, de 0 a 30. */
  diarias_estimadas?: number | null
  /** "Outros custos" que o cliente avisou ao pedir (texto, sem valor; até 120 caracteres). */
  outros_custos?: string | null
  /** O Para é o mesmo lugar do De: circuito fechado, sem o retorno de trecho único. */
  volta_a_origem?: boolean
  /** Forma de cobrança da empresa do pedido (todos os níveis a recebem, inclusive o N3, que não lê o saldo). */
  forma_cobranca?: 'CREDITO' | 'FATURADO'
}

export interface LinhaOrcamento {
  codigo: string
  descricao: string
  quantidade: number | null
  unitario_cent: number | null
  percentual_bp: number | null
  base_cent: number | null
  valor_cent: number
}

export interface RegrasOrcamento {
  faixas_cancelamento: Faixa[]
  prazo_orcar_horas: number
  validade_orcamento_horas: number
  limiar_urgente_horas: number
}

/** Orçamento como o perfil o vê (`interno.orcamento_para`): gestor de frota não recebe valores. */
export interface OrcamentoVisto {
  id: string
  versao: number
  status: string
  modalidade: Modalidade
  valido_ate: string
  horario_sugerido: string | null
  enviado_em: string
  linhas?: LinhaOrcamento[]
  total_cent?: number
  hash?: string
  regras?: RegrasOrcamento
}

export interface PassoHistorico {
  de: Status | null
  para: Status
  em: string
  observacao: string | null
  por_nome: string | null
}

export interface Acoes {
  orcar: boolean
  recusar: boolean
  pedir_revisao: boolean
  reprovar: boolean
  cancelar: boolean
  /** Fase 2B: aprovar o orçamento (dono N2 ou N1, dentro da validade). */
  aprovar: boolean
  /** Fase 2B: cancelar AGENDADA (cliente com multa pela faixa; prestador sem custo, com motivo). */
  cancelar_agendado: boolean
  /** Fase 3B (motorista do pedido ou ADM): deslize para sair, nova previsão, concluir e fotos. */
  sair?: boolean
  informar_previsao?: boolean
  concluir?: boolean
  enviar_fotos?: boolean
  /** Fase 4: avaliar a corrida concluída (cliente que decide, uma vez). */
  avaliar?: boolean
}

/** Motorista/ADM, pedido SOLICITADA depois de uma revisão: a última versão enviada e o motivo do cliente. */
export interface OrcamentoAnterior {
  versao: number
  modalidade: Modalidade
  /** Quantidades enviadas antes (mesmo formato da entrada de `enviar_orcamento`). */
  entrada: Record<string, unknown>
  linhas: LinhaOrcamento[]
  total_cent: number
  motivo_revisao: string | null
}

/**
 * v2.2: o que de fato foi lançado para a atividade (somado dos lançamentos), não o orçamento. Cada valor é positivo
 * (o que saiu ou voltou) ou nulo quando não houve lançamento daquele tipo.
 */
export interface CobrancaPedido {
  /** Débito da corrida (o que foi cobrado). */
  debito_cent: number | null
  /** Multa de cancelamento. */
  multa_cent: number | null
  /** Reserva devolvida ao saldo (Crédito) ao cancelar ou expirar. */
  liberado_cent: number | null
}

export interface RespostaPedido {
  pedido: DetalhePedido
  historico: PassoHistorico[]
  orcamento: OrcamentoVisto | null
  /** Ausente/nulo para cliente e gestor de frota, e fora de uma revisão. */
  orcamento_anterior?: OrcamentoAnterior | null
  acoes: Acoes
  /** v2.2: nulo para o motorista (como a forma de cobrança). Opcional: o banco anterior não devolvia. */
  cobranca?: CobrancaPedido | null
}

/** Bloco da agenda: de outra empresa (cliente) só {inicio, fim, ocupado}. */
export interface Bloco {
  inicio: string
  fim: string
  ocupado: true
  tipo?: 'PRE_RESERVA' | 'RESERVA'
  expira_em?: string | null
  atividade_id?: string
  numero?: number
  status?: Status
  origem?: string
  destino?: string
  propria_empresa?: boolean
  pode_abrir?: boolean
  empresa_nome?: string
  motorista_nome?: string | null
}

/** v2.2: corrida em andamento ou concluída do período que a pessoa pode ver (cartão cinza da agenda). */
export interface ConcluidaAgenda {
  id: string
  numero: number
  inicio: string
  duracao_min: number
  origem: string
  destino: string
  categoria_nome: string | null
  status: Extract<Status, 'EM_ANDAMENTO' | 'CONCLUIDA'>
}

/** Resposta de `api.agenda`: os blocos de sempre e, a partir da v2.2, as corridas em andamento e concluídas. */
export interface DiaAgenda {
  blocos: Bloco[]
  /** Opcional: o banco anterior não devolvia (a tela trata como lista vazia). */
  concluidas?: ConcluidaAgenda[]
}

export interface DiaDoMes {
  dia: string
  livre: boolean
  dia_cheio: boolean
  meus: number
  aguardando_voce: number
  ocupado: boolean
}

export interface ItemPendencia {
  id: string
  numero: number
  status: Status
  inicio: string
  duracao_min: number
  origem: string
  destino: string
  /** Fase 4.1: endereços das paradas, na ordem (até 3), quando houver. */
  paradas?: string[] | null
  /** Prazo para orçar (aguardando orçamento) ou validade do orçamento (aguardando aprovação). */
  prazo?: string
  urgente?: boolean
  revisao?: boolean
  versao?: number
  total_cent?: number | null
  empresa_nome: string | null
  // Fase 3B (próximos)
  saiu_em?: string | null
  fim_previsto?: string | null
  atrasado?: boolean
  atraso_anterior_ate?: string | null
}

export interface Pendencias {
  aguardando_orcamento: ItemPendencia[]
  aguardando_aprovacao: ItemPendencia[]
  proximos: ItemPendencia[]
}

export interface EntradaPrevia {
  km: number
  usa_reboque: boolean
  levar: boolean
  trazer: boolean
  modalidade: Modalidade
}

export interface Previa {
  modalidade: Modalidade
  linhas: LinhaOrcamento[]
  total_cent: number
  valido_ate: string
}

/** Leitura recusada pelo banco (`{ok:false, codigo}`): vira `erro` na tela, com o código. */
export class ErroLeitura extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
  }
}

export async function chamar(nome: string, args: Record<string, unknown>): Promise<RespostaRpc> {
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

export async function ler<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const r = await chamar(nome, args)
  if (!r.ok) throw new ErroLeitura(r.codigo ?? 'ERRO_INESPERADO')
  return r as unknown as T
}

/** `api.agenda(p_de, p_ate)`; `concluidas` sempre lista (vazia quando o banco anterior não a devolve). */
async function lerAgenda(de: Date, ate: Date): Promise<Required<DiaAgenda>> {
  const r = await ler<DiaAgenda>('agenda', { p_de: de.toISOString(), p_ate: ate.toISOString() })
  return { blocos: r.blocos, concluidas: r.concluidas ?? [] }
}

export const pedidos = {
  listar: async (status: readonly Status[] | null, limite = 100) =>
    (await ler<{ itens: ItemPedido[] }>('meus_pedidos', { p_filtro: status ? { status, limite } : { limite } })).itens,

  detalhe: (id: string) => ler<RespostaPedido>('pedido', { p_id: id }),

  agenda: async (de: Date, ate: Date) => (await lerAgenda(de, ate)).blocos,

  /** v2.2: os blocos e as corridas em andamento/concluídas do período. */
  agendaCompleta: lerAgenda,

  horariosLivres: (dia: string, duracaoMin: number) =>
    ler<{ horarios: string[]; dia_cheio: boolean }>('horarios_livres', { p_dia: dia, p_duracao_min: duracaoMin }),

  diasDoMes: async (mes: string, duracaoMin: number) =>
    (await ler<{ dias: DiaDoMes[] }>('dias_do_mes', { p_mes: mes, p_duracao_min: duracaoMin })).dias,

  pendencias: () => ler<Pendencias>('pendencias', {}),

  /** Fase 3A: prévia do orçamento pela tabela do contrato (N1/N2; nunca grava orçamento). */
  previaOrcamento: (p: EntradaPrevia) => ler<{ linhas: LinhaOrcamento[]; total_cent: number }>('previa_orcamento', { p }),

  // Ações (todas confirmadas pelo servidor).
  criar: (p: Record<string, unknown>) => chamar('criar_pedido', { p }),
  calcular: (id: string, entrada: Record<string, unknown>) => chamar('calcular_orcamento', { p_atividade: id, p: entrada }),
  enviarOrcamento: (id: string, entrada: Record<string, unknown>, horarioSugerido: string | null) =>
    chamar('enviar_orcamento', { p_atividade: id, p: entrada, p_horario_sugerido: horarioSugerido }),
  recusar: (id: string, motivo: string) => chamar('recusar_pedido', { p_atividade: id, p_motivo: motivo }),
  pedirRevisao: (id: string, motivo: string) => chamar('pedir_revisao', { p_atividade: id, p_motivo: motivo }),
  reprovar: (id: string, motivo: string | null) => chamar('reprovar_orcamento', { p_atividade: id, p_motivo: motivo }),
  cancelar: (id: string, motivo: string | null) => chamar('cancelar_pedido', { p_atividade: id, p_motivo: motivo }),
}
