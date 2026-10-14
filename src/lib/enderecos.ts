import { formatarDuracao } from './tempo.ts'

/**
 * Fase 3A: endereços reais na origem e no destino. Parte pura (testável sem rede): sessão de busca com token do Google,
 * "última resposta vence", junção dos locais da empresa com as sugestões e formatação da rota. As chamadas reais
 * ficam em `enderecosRemoto.ts`.
 */

/** Ponto escolhido. Sem `place_id` nem `endereco`: ponto marcado no mapa. */
export type Local = { nome: string; endereco: string | null; lat: number; lng: number; place_id: string | null }

export type SugestaoGoogle = { place_id: string; nome: string; endereco: string }

export type Sugestao = (SugestaoGoogle & { daEmpresa: false }) | (Local & { daEmpresa: true })

/**
 * Sessão de busca do autocompletar. Uma sessão vai das digitações até um único "detalhar" (o Google cobra a sessão,
 * não cada letra). Quem escolhe uma sugestão usa `token()` no detalhar e depois `encerrar()`; fechar a lista sem
 * escolher também encerra, para a próxima busca começar uma sessão nova.
 * `buscar` devolve `null` quando a resposta ficou velha (houve digitação mais nova ou a sessão foi encerrada).
 */
export function criarSessaoDeBusca<T = Sugestao[]>(
  gerarId: () => string = () => crypto.randomUUID(),
  buscarRemoto: (texto: string, token: string) => Promise<T> = async () => null as T,
) {
  let atual = gerarId()
  let ultima = 0
  return {
    token: () => atual,
    encerrar() {
      atual = gerarId()
      ultima++
    },
    async buscar(texto: string): Promise<T | null> {
      const minha = ++ultima
      const r = await buscarRemoto(texto, atual)
      return minha === ultima ? r : null
    },
  }
}

/** Locais da empresa primeiro; do Google, só o que a empresa ainda não tem (pelo place_id). */
export function juntarSugestoes(locais: Local[], google: SugestaoGoogle[]): Sugestao[] {
  const daEmpresa = new Set(locais.map((l) => l.place_id).filter(Boolean))
  return [
    ...locais.map((l) => ({ ...l, daEmpresa: true as const })),
    ...google.filter((g) => !daEmpresa.has(g.place_id)).map((g) => ({ ...g, daEmpresa: false as const })),
  ]
}

const ponto = (l: Local) => l.place_id ?? `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`

/** Identifica a dupla origem/destino: a rota é pedida uma vez por par. `null` sem os dois pontos. */
export function chaveDaRota(origem: Local | null, destino: Local | null): string | null {
  return origem && destino ? `${ponto(origem)}>${ponto(destino)}` : null
}

/** 38.2 km e 45 min → "38 km pela rota" e "cerca de 45 min". */
export function formatarRota(km: number, minutos: number | null): { km: string; tempo: string | null } {
  return {
    km: km < 1 ? 'menos de 1 km' : `${Math.round(km)} km pela rota`,
    tempo: minutos === null ? null : `cerca de ${formatarDuracao(Math.max(1, Math.round(minutos)))}`,
  }
}
