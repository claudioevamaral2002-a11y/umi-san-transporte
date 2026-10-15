// Fase 3A: a função `enderecos` (Google simulado), a busca de locais da empresa e os blocos do mapa.
// Registrar DEPOIS de `comSessaoFalsa`/`simularApi` (no Playwright a rota registrada por último vence).
import type { Page, Route } from '@playwright/test'
import { json, URL_SUPABASE } from './sessaoFalsa.ts'

/** Local da empresa vindo do Google: o banco guarda só nome e place_id (termos do Google). */
export const LOCAL_EMPRESA = { nome: 'Estaleiro Navegantes', lat: null, lng: null, place_id: 'ChIJdef' }

const SUGESTOES = [
  { place_id: 'ChIJdef', nome: 'Estaleiro Navegantes', endereco: 'Navegantes, SC' },
  { place_id: 'ChIJnav', nome: 'Estaleiro Navship', endereco: 'Rua Prefeito José Juvenal Mafra, Navegantes, SC' },
  { place_id: 'ChIJdet', nome: 'Estaleiro Detroit', endereco: 'Rodovia Jorge Lacerda, Itajaí, SC' },
  { place_id: 'ChIJpor', nome: 'Porto de Itajaí', endereco: 'Av. Min. Victor Konder, Itajaí, SC' },
]

const DETALHES: Record<string, { endereco: string; lat: number; lng: number }> = {
  ChIJnav: { endereco: 'Rua Prefeito José Juvenal Mafra, Navegantes, SC', lat: -26.8801, lng: -48.6612 },
  ChIJdet: { endereco: 'Rodovia Jorge Lacerda, Itajaí, SC', lat: -26.93, lng: -48.69 },
  ChIJpor: { endereco: 'Av. Min. Victor Konder, Itajaí, SC', lat: -26.9078, lng: -48.6619 },
  ChIJdef: { endereco: 'Av. Pref. Cirino Adolfo Cabral, 1500, Navegantes', lat: -26.8986, lng: -48.6542 },
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export interface MapasFalsos {
  /** Google fora do ar: a função devolve MAPAS_INDISPONIVEL. */
  fora?: boolean
  /** Atraso (ms) da sugestão quando o texto é exatamente este (corrida de respostas). */
  atrasoSugestao?: { texto: string; ms: number }
  /** Rota sem caminho de carro (mesmo ponto, ilha): km null. */
  semRota?: boolean
  rota?: { km: number; minutos: number }
}

export type ChamadaMapas = { acao: string; [campo: string]: unknown }

/** Simula a função `enderecos`, `locais_da_empresa` e os blocos do Google; devolve as chamadas à função. */
export async function simularMapas(page: Page, opcoes: MapasFalsos = {}) {
  const chamadas: ChamadaMapas[] = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/locais_da_empresa`, (route: Route) => {
    const t = semAcento(String((route.request().postDataJSON() as { p_texto?: string })?.p_texto ?? ''))
    const locais = [LOCAL_EMPRESA].filter((l) => t === '' || semAcento(l.nome).includes(t))
    return json(route, { ok: true, locais })
  })
  await page.route(`${URL_SUPABASE}/functions/v1/enderecos`, async (route: Route) => {
    const c = route.request().postDataJSON() as ChamadaMapas
    chamadas.push(c)
    if (opcoes.fora) return json(route, { ok: false, codigo: 'MAPAS_INDISPONIVEL' })
    if (c.acao === 'sugerir') {
      const texto = String(c.texto)
      if (opcoes.atrasoSugestao?.texto === texto) await new Promise((r) => setTimeout(r, opcoes.atrasoSugestao!.ms))
      const t = semAcento(texto)
      const sugestoes = SUGESTOES.filter((s) => semAcento(s.nome).includes(t) || t.split(' ').every((p) => semAcento(s.nome).includes(p)))
      return json(route, { ok: true, sugestoes })
    }
    if (c.acao === 'detalhar') {
      const d = DETALHES[String(c.place_id)]
      return json(route, d ? { ok: true, local: { nome: c.nome, place_id: c.place_id, ...d } } : { ok: false, codigo: 'MAPAS_INDISPONIVEL' })
    }
    if (c.acao === 'rota') {
      return json(route, opcoes.semRota ? { ok: true, km: null, minutos: null } : { ok: true, ...(opcoes.rota ?? { km: 38.2, minutos: 45 }) })
    }
    return json(route, { ok: false, codigo: 'CAMPOS_INVALIDOS' })
  })
  return chamadas
}

/** PNG transparente 1×1 para os blocos do mapa. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Simula a Map Tiles API: sessão `s1` e blocos PNG. Devolve quantos blocos foram pedidos. */
export async function simularBlocosDoMapa(page: Page) {
  const pedidos = { sessao: 0, blocos: 0 }
  await page.route('https://tile.googleapis.com/**', (route: Route) => {
    if (route.request().url().includes('/v1/createSession')) {
      pedidos.sessao++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: 's1', expiry: '9999999999' }) })
    }
    pedidos.blocos++
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  return pedidos
}

const linhaPrevia = (codigo: string, descricao: string, quantidade: number | null, unitario: number | null, valor: number) => ({
  codigo,
  descricao,
  quantidade,
  unitario_cent: unitario,
  percentual_bp: null,
  base_cent: null,
  valor_cent: valor,
})

/** Prévia simulada: 38 km com reboque = R$ 423,60; sem reboque = R$ 199,50. Devolve as entradas recebidas. */
export async function simularPrevia(page: Page, resposta?: Record<string, unknown>) {
  const entradas: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/previa_orcamento`, (route: Route) => {
    const p = ((route.request().postDataJSON() as { p?: Record<string, unknown> })?.p ?? {}) as Record<string, unknown>
    entradas.push(p)
    if (resposta) return json(route, resposta)
    const linhas = p.usa_reboque
      ? [
          linhaPrevia('KM_COM_REBOQUE', 'Km rodados', 38, 480, 18240),
          linhaPrevia('RETORNO', 'Retorno (50%)', null, null, 9120),
          linhaPrevia('REBOQUE', 'Taxa fixa do reboque', 1, 15000, 15000),
        ]
      : [linhaPrevia('KM', 'Km rodados', 38, 350, 13300), linhaPrevia('RETORNO', 'Retorno (50%)', null, null, 6650)]
    return json(route, { ok: true, modalidade: 'VEICULO_PROPRIO', linhas, total_cent: linhas.reduce((s, l) => s + l.valor_cent, 0) })
  })
  return entradas
}
