// Pedidos, agenda e orçamento simulados (fase 2A): respostas das RPCs `api.*` com datas relativas a "agora".
// Registrar DEPOIS de `simularApi` (no Playwright a rota registrada por último vence).
import type { Page, Route } from '@playwright/test'
import { REGRAS } from './apiFalsa.ts'
import { json, URL_SUPABASE } from './sessaoFalsa.ts'

const HORA = 3600_000
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Dia do calendário em São Paulo daqui a `n` dias ("2026-10-12"). */
export function diaSp(n = 0): string {
  return FORMATO_DIA.format(new Date(Date.now() + n * 24 * HORA))
}

/** "2026-10-12" + "08:00" (São Paulo, UTC-3 sem horário de verão) → ISO UTC. */
export function instanteSp(dia: string, hora: string): string {
  return new Date(`${dia}T${hora}:00-03:00`).toISOString()
}

export const ID_PEDIDO = '00000000-0000-4000-8000-0000000000a1'
export const ID_PEDIDO_2 = '00000000-0000-4000-8000-0000000000a2'
export const DIA_PEDIDO = diaSp(2)

export const EMPRESA_ID = '00000000-0000-4000-8000-0000000000e1'

/** Horários livres (início de 30 em 30 min) de qualquer dia futuro: 10:00–11:30 e 16:00–17:30. */
export const HORAS_LIVRES = ['10:00', '10:30', '11:00', '16:00', '16:30', '17:00', '17:30']

export function detalheFalso(extra: Record<string, unknown> = {}) {
  return {
    id: ID_PEDIDO,
    numero: 42,
    status: 'ORCADA',
    empresa_id: EMPRESA_ID,
    empresa_nome: 'Umi San',
    solicitante_nome: 'Diego Rocha',
    motorista_nome: 'Bruno Lima',
    inicio: instanteSp(DIA_PEDIDO, '08:00'),
    duracao_min: 120,
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    levar: true,
    trazer: false,
    carga: 'AMBOS',
    pessoas_qtd: 2,
    equipamento_desc: 'Bomba d’água',
    peso_kg: 85.5,
    dimensoes: '1 × 1 × 1 m',
    modalidade: 'VEICULO_PROPRIO',
    reboque: 'NAO',
    contato_nome: 'Rui',
    contato_telefone: '(47) 99999-1234',
    observacoes: '<b>portão 3</b>',
    prazo_orcar_ate: new Date(Date.now() + 5 * HORA).toISOString(),
    prazo_vencido: false,
    criada_em: new Date(Date.now() - 2 * HORA).toISOString(),
    atualizada_em: new Date(Date.now() - HORA).toISOString(),
    ...extra,
  }
}

export const LINHAS = [
  {
    codigo: 'KM',
    descricao: 'Km rodados (trecho único)',
    quantidade: 120,
    unitario_cent: 350,
    percentual_bp: null,
    base_cent: null,
    valor_cent: 42000,
  },
  {
    codigo: 'RETORNO',
    descricao: 'Retorno (50%)',
    quantidade: null,
    unitario_cent: null,
    percentual_bp: 5000,
    base_cent: 42000,
    valor_cent: 21000,
  },
  {
    codigo: 'ESPERA',
    descricao: 'Espera (horas)',
    quantidade: 1.5,
    unitario_cent: 4000,
    percentual_bp: null,
    base_cent: null,
    valor_cent: 6000,
  },
  {
    codigo: 'OUTROS',
    descricao: 'Outros: Balsa extra',
    quantidade: 1,
    unitario_cent: 2000,
    percentual_bp: null,
    base_cent: null,
    valor_cent: 2000,
  },
]

export function orcamentoCliente(extra: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    versao: 1,
    status: 'PENDENTE',
    modalidade: 'VEICULO_PROPRIO',
    valido_ate: new Date(Date.now() + 20 * HORA).toISOString(),
    horario_sugerido: null,
    enviado_em: new Date(Date.now() - HORA).toISOString(),
    linhas: LINHAS,
    total_cent: 71000,
    hash: 'a'.repeat(64),
    regras: REGRAS,
    ...extra,
  }
}

export const HISTORICO_ORCADO = [
  { de: null, para: 'SOLICITADA', em: new Date(Date.now() - 2 * HORA).toISOString(), observacao: null, por_nome: 'Diego Rocha' },
  { de: 'SOLICITADA', para: 'ORCADA', em: new Date(Date.now() - HORA).toISOString(), observacao: null, por_nome: 'Bruno Lima' },
]

export const SEM_ACOES = {
  orcar: false,
  recusar: false,
  pedir_revisao: false,
  reprovar: false,
  cancelar: false,
  aprovar: false,
  cancelar_agendado: false,
}

/** Detalhe que o cliente que decide (dono N2/N1) recebe com o orçamento PENDENTE. */
export function pedidoOrcadoCliente() {
  return {
    ok: true,
    pedido: detalheFalso(),
    historico: HISTORICO_ORCADO,
    orcamento: orcamentoCliente(),
    acoes: { ...SEM_ACOES, pedir_revisao: true, reprovar: true, cancelar: true, aprovar: true },
  }
}

/** Detalhe que o motorista atribuído recebe com o pedido aguardando orçamento. */
export function pedidoSolicitadoMotorista(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    pedido: detalheFalso({ status: 'SOLICITADA', solicitante_nome: 'Diego Rocha', ...extra }),
    historico: [HISTORICO_ORCADO[0]],
    orcamento: null,
    acoes: { ...SEM_ACOES, orcar: true, recusar: true, cancelar: true },
  }
}

export function itemLista(extra: Record<string, unknown> = {}) {
  return {
    id: ID_PEDIDO,
    numero: 42,
    status: 'ORCADA',
    inicio: instanteSp(DIA_PEDIDO, '08:00'),
    duracao_min: 120,
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    levar: true,
    trazer: false,
    modalidade: 'VEICULO_PROPRIO',
    total_cent: 71000,
    prazo_orcar_ate: null,
    valido_ate: new Date(Date.now() + 20 * HORA).toISOString(),
    prazo_vencido: false,
    empresa_nome: null,
    ...extra,
  }
}

export const LISTA_PADRAO = [
  itemLista(),
  itemLista({
    id: ID_PEDIDO_2,
    numero: 41,
    status: 'SOLICITADA',
    total_cent: null,
    valido_ate: null,
    prazo_orcar_ate: new Date(Date.now() + 5 * HORA).toISOString(),
    origem: 'Base Navegantes',
    destino: 'Porto de Itajaí',
  }),
  itemLista({ id: '00000000-0000-4000-8000-0000000000a3', numero: 40, status: 'CANCELADA', total_cent: null, valido_ate: null }),
]

export function pendenciaFalsa(extra: Record<string, unknown> = {}) {
  return {
    id: ID_PEDIDO,
    numero: 42,
    status: 'SOLICITADA',
    inicio: instanteSp(DIA_PEDIDO, '08:00'),
    duracao_min: 120,
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    prazo: new Date(Date.now() + 5 * HORA).toISOString(),
    urgente: false,
    revisao: false,
    empresa_nome: null,
    ...extra,
  }
}

/** Blocos do dia: o próprio pedido 08:00–10:00 e um de outra empresa (só "ocupado") 12:00–14:00. */
export function blocosDoDia(dia: string, equipe = false) {
  const proprio = {
    inicio: instanteSp(dia, '08:00'),
    fim: instanteSp(dia, '10:00'),
    ocupado: true,
    tipo: 'PRE_RESERVA',
    expira_em: new Date(Date.now() + 5 * HORA).toISOString(),
    atividade_id: ID_PEDIDO,
    numero: 42,
    status: 'SOLICITADA',
    origem: 'Porto de Itajaí',
    destino: 'Base Navegantes',
    propria_empresa: true,
    pode_abrir: true,
    ...(equipe ? { empresa_id: EMPRESA_ID, empresa_nome: 'Umi San', motorista_id: 'm', motorista_nome: 'Bruno Lima' } : {}),
  }
  const outro = equipe
    ? {
        inicio: instanteSp(dia, '12:00'),
        fim: instanteSp(dia, '14:00'),
        ocupado: true,
        tipo: 'PRE_RESERVA',
        expira_em: new Date(Date.now() + 5 * HORA).toISOString(),
        atividade_id: ID_PEDIDO_2,
        numero: 7,
        status: 'ORCADA',
        origem: 'Cais Sul',
        destino: 'Terminal Norte',
        propria_empresa: false,
        pode_abrir: true,
        empresa_id: '00000000-0000-4000-8000-0000000000e2',
        empresa_nome: 'Porto Azul',
        motorista_id: 'm',
        motorista_nome: 'Bruno Lima',
      }
    : { inicio: instanteSp(dia, '12:00'), fim: instanteSp(dia, '14:00'), ocupado: true }
  return [proprio, outro]
}

/** Dias do mês: passados sem nada; DIA_PEDIDO com pedido seu e ocupado; diaSp(3) cheio; diaSp(5) ocupado. */
export function diasDoMes(mes: string) {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate()
  const hoje = diaSp(0)
  return Array.from({ length: ultimo }, (_, i) => {
    const dia = `${mes.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`
    const futuro = dia >= hoje
    return {
      dia,
      livre: futuro && dia !== diaSp(3),
      dia_cheio: dia === diaSp(3),
      meus: dia === DIA_PEDIDO ? 1 : 0,
      aguardando_voce: 0,
      ocupado: dia === DIA_PEDIDO || dia === diaSp(5),
    }
  })
}

/** Cálculo de mentira (só para a prévia ao vivo): km × 3,50 (ou 5,20 com reboque), espera × 40, diárias × 450... */
export function calcularFalso(e: Record<string, unknown>) {
  const linhas: Array<Record<string, unknown>> = []
  const linha = (codigo: string, descricao: string, quantidade: number, unitario: number) =>
    linhas.push({
      codigo,
      descricao,
      quantidade,
      unitario_cent: unitario,
      percentual_bp: null,
      base_cent: null,
      valor_cent: Math.round(quantidade * unitario),
    })
  const proprio = e.modalidade !== 'VEICULO_CLIENTE'
  if (proprio) {
    const km = Number(e.km ?? 0)
    if (km > 0) linha(e.usa_reboque ? 'KM_COM_REBOQUE' : 'KM', 'Km rodados (trecho único)', km, e.usa_reboque ? 520 : 350)
    if (e.usa_reboque) linha('REBOQUE', 'Taxa fixa de reboque', 1, 15000)
    const espera = Number(e.espera_horas ?? 0)
    if (espera > 0) linha('ESPERA', 'Espera (horas)', espera, 4000)
  } else {
    const d = Number(e.diarias ?? 0)
    if (d > 0) linha('DIARIA_MOTORISTA', 'Diárias do motorista', d, 45000)
  }
  const pedagio = Number(e.pedagio_cent ?? 0)
  if (pedagio > 0) linha('PEDAGIO', 'Pedágio/balsa (estimado)', 1, pedagio)
  const hosp = Number(e.hospedagem_diarias ?? 0)
  if (hosp > 0) linha('HOSPEDAGEM', 'Hospedagem (diárias)', hosp, 18000)
  for (const o of (e.outros as Array<{ descricao: string; valor_cent: number }> | undefined) ?? []) {
    linha('OUTROS', `Outros: ${o.descricao}`, 1, o.valor_cent)
  }
  return {
    ok: true,
    modalidade: proprio ? 'VEICULO_PROPRIO' : 'VEICULO_CLIENTE',
    linhas,
    total_cent: linhas.reduce((s, l) => s + Number(l.valor_cent), 0),
    valido_ate: new Date(Date.now() + 24 * HORA).toISOString(),
  }
}

export interface PedidosFalsos {
  /** Itens de `meus_pedidos` (filtrados pelo status pedido). */
  lista?: unknown[]
  /** Respostas de `pedido(p_id)` em sequência (a última se repete). */
  detalhes?: unknown[]
  pendencias?: { aguardando_orcamento?: unknown[]; aguardando_aprovacao?: unknown[]; proximos?: unknown[] }
  /** Agenda vista pela equipe (todos com detalhes). */
  equipe?: boolean
  /** Respostas das RPCs de escrita, em sequência por nome (depois `{ ok: true }`). */
  respostas?: Record<string, unknown[]>
  /** Atraso (ms) de uma RPC de leitura a partir da chamada `depois` + 1 (testes de fluidez). */
  atrasos?: Record<string, { ms: number; depois: number }>
}

/** Registra as RPCs de pedidos/agenda/orçamento; devolve as chamadas recebidas (nome + corpo). */
export async function simularPedidos(page: Page, opcoes: PedidosFalsos = {}) {
  const chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }> = []
  const corpoDe = (route: Route) => (route.request().postDataJSON() ?? {}) as Record<string, unknown>
  const contagem: Record<string, number> = {}
  const rota = (nome: string, responder: (corpo: Record<string, unknown>) => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, async (route) => {
      const corpo = corpoDe(route)
      chamadas.push({ rpc: nome, corpo })
      contagem[nome] = (contagem[nome] ?? 0) + 1
      const atraso = opcoes.atrasos?.[nome]
      if (atraso && contagem[nome]! > atraso.depois) await new Promise((r) => setTimeout(r, atraso.ms))
      return json(route, responder(corpo))
    })
  const detalhes = [...(opcoes.detalhes ?? [pedidoOrcadoCliente()])]
  const respostas = Object.fromEntries(Object.entries(opcoes.respostas ?? {}).map(([k, v]) => [k, [...v]]))

  await rota('meus_pedidos', (c) => {
    const status = (c.p_filtro as { status?: string[] } | undefined)?.status
    const lista = (opcoes.lista ?? LISTA_PADRAO) as Array<{ status: string }>
    return { ok: true, itens: status ? lista.filter((i) => status.includes(i.status)) : lista }
  })
  await rota('pedido', () => (detalhes.length > 1 ? detalhes.shift() : detalhes[0]))
  await rota('pendencias', () => ({
    ok: true,
    aguardando_orcamento: opcoes.pendencias?.aguardando_orcamento ?? [],
    aguardando_aprovacao: opcoes.pendencias?.aguardando_aprovacao ?? [],
    proximos: opcoes.pendencias?.proximos ?? [],
  }))
  await rota('dias_do_mes', (c) => ({ ok: true, mes: c.p_mes, duracao_min: c.p_duracao_min, dias: diasDoMes(String(c.p_mes)) }))
  await rota('horarios_livres', (c) => {
    const dia = String(c.p_dia)
    const horarios = dia === diaSp(3) ? [] : HORAS_LIVRES.map((h) => instanteSp(dia, h))
    return { ok: true, dia, duracao_min: c.p_duracao_min, horarios, dia_cheio: horarios.length === 0 }
  })
  await rota('agenda', (c) => {
    const dia = diaDo(String(c.p_de))
    return { ok: true, blocos: dia === DIA_PEDIDO ? blocosDoDia(dia, opcoes.equipe) : [] }
  })
  await rota('calcular_orcamento', (c) => respostas.calcular_orcamento?.shift() ?? calcularFalso((c.p ?? {}) as Record<string, unknown>))
  for (const nome of ['criar_pedido', 'enviar_orcamento', 'recusar_pedido', 'pedir_revisao', 'reprovar_orcamento', 'cancelar_pedido']) {
    const padrao: Record<string, unknown> =
      nome === 'criar_pedido'
        ? { ok: true, id: ID_PEDIDO, numero: 43, prazo_orcar_ate: new Date(Date.now() + 12 * HORA).toISOString() }
        : { ok: true }
    await rota(nome, () => respostas[nome]?.shift() ?? padrao)
  }
  return chamadas
}

/** Dia (São Paulo) de um instante ISO. */
function diaDo(iso: string): string {
  return FORMATO_DIA.format(new Date(iso))
}
