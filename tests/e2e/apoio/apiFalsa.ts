// Respostas simuladas do PostgREST (views e RPCs do schema `api`) para testar as telas sem banco.
// O e2e contra o Supabase do CI fica na Task 13.
import type { Page } from '@playwright/test'
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
    retencao_fotos_dias: 30,
    ...extra,
  }
}

export const PERMISSOES_DESLIGADAS = [
  { chave: 'CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO', ativo: false, alterado_em: null },
  { chave: 'MOTORISTA_EDITA_PARAMETROS', ativo: false, alterado_em: null },
  { chave: 'MOTORISTA_LANCA_RECARGA', ativo: false, alterado_em: null },
]

export const EMPRESA_UMI = { id: '00000000-0000-4000-8000-0000000000e1', nome: 'Umi San', logo_caminho: null }

export const USUARIOS = [
  {
    usuario_id: '00000000-0000-4000-8000-000000000001',
    nome: 'Ana Souza',
    email: 'pessoa@exemplo.com.br',
    telefone: null,
    papel: 'ADM',
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
  vigente?: unknown[]
  historico?: unknown[]
  permissoes?: unknown[]
  empresas?: unknown[]
  usuarios?: unknown[]
  auditoria?: unknown[]
  /** Respostas das RPCs de escrita, por nome (padrão `{ ok: true }`). */
  rpc?: Record<string, unknown>
}

/** Registra as rotas; devolve as chamadas de RPC recebidas (nome + corpo). */
export async function simularApi(page: Page, api: ApiFalsa = {}) {
  const chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }> = []
  const tabela = (nome: string, linhas: unknown[]) =>
    page.route(new RegExp(`${URL_SUPABASE}/rest/v1/${nome}(\\?|$)`), (route) => json(route, linhas))
  await tabela('parametros_vigentes', api.vigente ?? [])
  await tabela('parametros_historico', api.historico ?? api.vigente ?? [])
  await tabela('permissoes', api.permissoes ?? PERMISSOES_DESLIGADAS)
  await tabela('empresas', api.empresas ?? [EMPRESA_UMI])
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/listar_usuarios`, (route) => json(route, api.usuarios ?? USUARIOS))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/listar_auditoria`, (route) => {
    chamadas.push({ rpc: 'listar_auditoria', corpo: route.request().postDataJSON() as Record<string, unknown> })
    return json(route, api.auditoria ?? AUDITORIA)
  })
  for (const nome of ['publicar_parametros', 'alterar_perfil', 'definir_permissao', 'salvar_empresa', 'definir_logo_empresa']) {
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      chamadas.push({ rpc: nome, corpo: route.request().postDataJSON() as Record<string, unknown> })
      return json(route, api.rpc?.[nome] ?? { ok: true })
    })
  }
  await page.route(`${URL_SUPABASE}/storage/v1/object/logos/**`, (route) => {
    chamadas.push({ rpc: 'storage', corpo: { url: route.request().url(), metodo: route.request().method() } })
    return json(route, { Key: 'logos/x', Id: 'x' })
  })
  return chamadas
}
