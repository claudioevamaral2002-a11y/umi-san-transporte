// Respostas simuladas do PostgREST (views e RPCs do schema `api`) para testar as telas sem banco.
// O e2e contra o Supabase do CI fica em tests/e2e/real.
import type { Page, Route } from '@playwright/test'
import { painelFalso, saldoFalso } from './dinheiroFalso.ts'
import { json, URL_SUPABASE } from './sessaoFalsa.ts'

export const FAIXAS_PADRAO = [
  { antecedencia_min_horas: 24, multa_bp: 0 },
  { antecedencia_min_horas: 6, multa_bp: 5000 },
  { antecedencia_min_horas: 0, multa_bp: 10000 },
]

export function versaoFalsa(versao: number, extra: Record<string, unknown> = {}) {
  return {
    versao,
    vigente_desde: '2026-10-01T12:00:00Z',
    publicado_em: '2026-10-01T11:00:00Z',
    publicado_por_nome: 'Ana Souza',
    km_sem_reboque_cent: 350,
    km_com_reboque_cent: 520,
    taxa_fixa_reboque_cent: 15000,
    retorno_trecho_unico_bp: 5000,
    hora_espera_cent: 4000,
    hospedagem_diaria_cent: 18000,
    diaria_motorista_cent: 45000,
    faixas_cancelamento: FAIXAS_PADRAO,
    prazo_orcar_horas: 12,
    validade_orcamento_horas: 24,
    limiar_urgente_horas: 6,
    limite_saldo_negativo_cent: 100000,
    alerta_saldo_baixo_cent: 50000,
    ...extra,
  }
}

/** Só o que o cliente recebe de `api.regras_do_servico()`. */
export const REGRAS = {
  faixas_cancelamento: FAIXAS_PADRAO,
  prazo_orcar_horas: 12,
  validade_orcamento_horas: 48,
  limiar_urgente_horas: 6,
}

/** Só o que o motorista recebe de `api.precos_para_orcar()`. */
export const PRECOS = {
  km_sem_reboque_cent: 350,
  km_com_reboque_cent: 520,
  taxa_fixa_reboque_cent: 15000,
  retorno_trecho_unico_bp: 5000,
  hora_espera_cent: 4000,
  hospedagem_diaria_cent: 18000,
  diaria_motorista_cent: 45000,
  prazo_orcar_horas: 12,
  validade_orcamento_horas: 24,
  limiar_urgente_horas: 6,
}

export const EMPRESA_UMI = { id: '00000000-0000-4000-8000-0000000000e1', nome: 'Umi San', logo_caminho: null }
export const EMPRESA_PORTO = { id: '00000000-0000-4000-8000-0000000000e2', nome: 'Porto Azul', logo_caminho: null }

/** Linha de `api.listar_contratos()` de uma empresa (sem versão = sem contrato vigente). */
export function linhaContrato(
  empresa: { id: string; nome: string },
  vigente: Record<string, unknown> | null,
  proxima: string | null = null,
) {
  return { empresa_id: empresa.id, empresa_nome: empresa.nome, ...(vigente ?? { versao: null }), proxima_vigencia: proxima }
}

export const USUARIOS = [
  {
    usuario_id: '00000000-0000-4000-8000-000000000001',
    nome: 'Ana Souza',
    email: 'pessoa@exemplo.com.br',
    telefone: null,
    papel: 'ADM',
    nivel: null,
    empresa_id: null,
    empresa_nome: null,
    ativo: true,
    senha_pendente: false,
    tem_2fa: true,
    criado_em: '2026-10-01T00:00:00Z',
  },
  {
    usuario_id: '00000000-0000-4000-8000-000000000002',
    nome: 'Bruno Lima',
    email: 'bruno@exemplo.com.br',
    telefone: null,
    papel: 'MOTORISTA',
    nivel: null,
    empresa_id: null,
    empresa_nome: null,
    ativo: true,
    senha_pendente: false,
    tem_2fa: true,
    criado_em: '2026-10-02T00:00:00Z',
  },
  {
    usuario_id: '00000000-0000-4000-8000-000000000003',
    nome: 'Carla Dias',
    email: 'carla@umisan.com.br',
    telefone: null,
    papel: 'CLIENTE',
    nivel: 1,
    empresa_id: EMPRESA_UMI.id,
    empresa_nome: 'Umi San',
    ativo: false,
    senha_pendente: true,
    tem_2fa: false,
    criado_em: '2026-10-03T00:00:00Z',
  },
]

/** Equipe da Umi San vista pela gestora (a sessão falsa é pessoa@exemplo.com.br = "você"). */
export const EQUIPE = [
  {
    usuario_id: '00000000-0000-4000-8000-000000000011',
    nome: 'Carla Dias',
    email: 'pessoa@exemplo.com.br',
    telefone: null,
    papel: 'CLIENTE',
    nivel: 1,
    empresa_id: EMPRESA_UMI.id,
    empresa_nome: 'Umi San',
    ativo: true,
    senha_pendente: false,
    tem_2fa: false,
    criado_em: '2026-10-01T00:00:00Z',
  },
  {
    usuario_id: '00000000-0000-4000-8000-000000000012',
    nome: 'Diego Rocha',
    email: 'diego@umisan.com.br',
    telefone: null,
    papel: 'CLIENTE',
    nivel: 2,
    empresa_id: EMPRESA_UMI.id,
    empresa_nome: 'Umi San',
    ativo: true,
    senha_pendente: false,
    tem_2fa: false,
    criado_em: '2026-10-02T00:00:00Z',
  },
  {
    usuario_id: '00000000-0000-4000-8000-000000000013',
    nome: 'Elisa Prado',
    email: 'elisa@umisan.com.br',
    telefone: null,
    papel: 'CLIENTE',
    nivel: 3,
    empresa_id: EMPRESA_UMI.id,
    empresa_nome: 'Umi San',
    ativo: false,
    senha_pendente: true,
    tem_2fa: false,
    criado_em: '2026-10-03T00:00:00Z',
  },
]

export const AUDITORIA = [
  {
    id: 2,
    em: '2026-10-08T13:00:00Z',
    usuario_id: USUARIOS[0]!.usuario_id,
    usuario_nome: 'Ana Souza',
    papel: 'ADM',
    acao: 'PUBLICAR_PARAMETROS',
    alvo: 'parametros:1',
    resultado: 'OK',
    codigo: null,
    detalhe: { versao: 1, nota: '<img src=x onerror=alert(1)>' },
    ip: '203.0.113.9',
    dispositivo: 'Mozilla/5.0',
  },
  {
    id: 1,
    em: '2026-10-08T12:00:00Z',
    usuario_id: USUARIOS[1]!.usuario_id,
    usuario_nome: 'Bruno Lima',
    papel: 'MOTORISTA',
    acao: 'PUBLICAR_PARAMETROS',
    alvo: 'parametros',
    resultado: 'NEGADO',
    codigo: 'SEM_PERMISSAO',
    detalhe: null,
    ip: null,
    dispositivo: null,
  },
]

export interface ApiFalsa {
  /** Versão vigente da tabela modelo (vira a linha `empresa_id: null` de `listar_contratos`). */
  vigente?: unknown[]
  /** Histórico da tabela modelo (padrão: o vigente). */
  historico?: unknown[]
  /** Linhas das empresas em `listar_contratos` (padrão: Umi San sem contrato). */
  contratos?: unknown[]
  /** Histórico por empresa (`historico_contrato(p_empresa)`). */
  historicoEmpresas?: Record<string, unknown[]>
  /** `regras_do_servico()` do cliente (padrão: as regras de exemplo; `[]` = sem contrato). */
  regras?: unknown[]
  /** `precos_para_orcar(p_empresa)` por empresa (padrão: os preços de exemplo para qualquer empresa). */
  precos?: Record<string, unknown[]>
  retencaoFotosDias?: number
  empresas?: unknown[]
  usuarios?: unknown[]
  auditoria?: unknown[]
  /** Respostas das RPCs de escrita, por nome (padrão `{ ok: true }`). */
  rpc?: Record<string, unknown>
}

/** Registra as rotas; devolve as chamadas de RPC recebidas (nome + corpo), inclusive as de leitura. */
export async function simularApi(page: Page, api: ApiFalsa = {}) {
  const chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }> = []
  const corpoDe = (route: Route) => (route.request().postDataJSON() ?? {}) as Record<string, unknown>
  const tabela = (nome: string, linhas: unknown[]) =>
    page.route(new RegExp(`${URL_SUPABASE}/rest/v1/${nome}(\\?|$)`), (route) => json(route, linhas))
  const leitura = (nome: string, responder: (corpo: Record<string, unknown>) => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      const corpo = corpoDe(route)
      chamadas.push({ rpc: nome, corpo })
      return json(route, responder(corpo))
    })
  const modelo = (api.vigente ?? []).map((v) => ({ empresa_id: null, empresa_nome: null, proxima_vigencia: null, ...(v as object) }))
  const empresas = api.contratos ?? [linhaContrato(EMPRESA_UMI, null)]
  await leitura('listar_contratos', () => [
    ...(modelo.length > 0 ? modelo : [{ empresa_id: null, empresa_nome: null, versao: null, proxima_vigencia: null }]),
    ...empresas,
  ])
  await leitura('historico_contrato', (c) =>
    c.p_empresa === null || c.p_empresa === undefined
      ? (api.historico ?? api.vigente ?? [])
      : (api.historicoEmpresas?.[String(c.p_empresa)] ?? []),
  )
  await leitura('ler_configuracao', () => [
    { retencao_fotos_dias: api.retencaoFotosDias ?? 30, alterado_em: '2026-10-01T00:00:00Z', mapas_teto_diario_empresa: 2000 },
  ])
  await leitura('regras_do_servico', () => api.regras ?? [REGRAS])
  await leitura('precos_para_orcar', (c) => api.precos?.[String(c.p_empresa)] ?? (api.precos ? [] : [PRECOS]))
  await tabela('empresas', api.empresas ?? [EMPRESA_UMI])
  await leitura('listar_usuarios', () => api.usuarios ?? USUARIOS)
  await leitura('listar_auditoria', () => api.auditoria ?? AUDITORIA)
  // Fase 2A: o Início lê as pendências de todo perfil (detalhes em pedidosFalsos.ts).
  await leitura('pendencias', () => ({ ok: true, aguardando_orcamento: [], aguardando_aprovacao: [], proximos: [] }))
  await leitura('meus_pedidos', () => ({ ok: true, itens: [] }))
  // Fase 2B: o Início do cliente mostra o saldo e o do ADM, o resumo do painel (detalhes em dinheiroFalso.ts).
  await leitura('saldo_empresa', () => saldoFalso())
  await leitura('extrato', () => ({ ok: true, itens: [] }))
  await leitura('painel_adm', () => painelFalso())
  for (const nome of ['publicar_contrato', 'definir_retencao_fotos', 'definir_teto_mapas', 'alterar_perfil', 'salvar_empresa', 'definir_logo_empresa']) {
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      chamadas.push({ rpc: nome, corpo: corpoDe(route) })
      return json(route, api.rpc?.[nome] ?? { ok: true })
    })
  }
  await page.route(`${URL_SUPABASE}/storage/v1/object/logos/**`, (route) => {
    chamadas.push({ rpc: 'storage', corpo: { url: route.request().url(), metodo: route.request().method() } })
    return json(route, { Key: 'logos/x', Id: 'x' })
  })
  return chamadas
}

/** Junta as violações de CSP da página (console e evento do navegador). */
export async function vigiarCsp(page: Page): Promise<string[]> {
  const violacoes: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(m.text())
  })
  await page.exposeFunction('__violacaoCsp', (v: string) => violacoes.push(v))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __violacaoCsp: (v: string) => void }).__violacaoCsp(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  return violacoes
}
