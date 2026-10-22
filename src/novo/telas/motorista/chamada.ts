// Fase 4 (Tarefa 10): o que a chamada e a calculadora do motorista compartilham. Só QUANTIDADES saem do aparelho; o
// preço vem sempre do contrato (`calcular_orcamento` na tela, `enviar_orcamento` no envio). Nenhum ajuste livre
// (`ajuste_cent`): a contraproposta é feita nos itens (Ruling R11, especificação §5.4).
// Fase 4.1 (Tarefa 7): os itens seguem a tarifa da categoria (zerado = não cobra), a categoria de veículo do cliente
// (IVO Motorista) não usa veículo da IVO, as horas entram na calculadora e a rota passa pelas paradas do pedido.
import { useCallback, useEffect, useState } from 'react'
import { HORAS_MAX, HORAS_MIN, kmDaRota, kmDoPedido, PREENCHIMENTO, type CodigoCategoria } from '../../../lib/categorias.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { corrida } from '../../../lib/corrida.ts'
import { pontoDaRota, type PontoRota } from '../../../lib/enderecosRemoto.ts'
import { formDaEntrada, formInicial, KM_MAX_DECIMOS, montarEntrada, type ErrosOrcamento, type FormOrcamento } from '../../../lib/orcar.ts'
import { pedidos, type DetalhePedido, type LinhaOrcamento } from '../../../lib/pedidos.ts'
import { distanciaM, ETA, type Ponto } from '../../../lib/rastreio.ts'
import { rotaAte } from '../../../lib/rotaDesenhada.ts'
import { veiculos, type Veiculo } from '../../../lib/veiculos.ts'
import type { RotaDaTela } from '../../useRota.ts'

/** Parada como `api.pedido` devolve (4.1): do Google só o `place_id`; de um ponto marcado, as coordenadas. */
export interface ParadaDoPedido {
  texto: string
  place_id: string | null
  lat: number | null
  lng: number | null
}

/** O detalhe do pedido com o que a 4.1 acrescentou em `api.pedido` (opcionais: o detalhe antigo não tem). */
export type PedidoDaChamada = DetalhePedido & { paradas?: unknown; horas_estimadas?: number | null }

export const ponto = (p: DetalhePedido, lado: 'origem' | 'destino'): PontoRota | null =>
  pontoDaRota({
    lat: p[`${lado}_lat`] ?? null,
    lng: p[`${lado}_lng`] ?? null,
    place_id: p[`${lado}_place_id`] ?? null,
  })

const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** As paradas do pedido, na ordem (lidas com cuidado: o detalhe antigo não as traz). */
export function paradasDoPedido(p: DetalhePedido): ParadaDoPedido[] {
  const lista = (p as PedidoDaChamada).paradas
  if (!Array.isArray(lista)) return []
  return lista.flatMap((x: unknown): ParadaDoPedido[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    if (typeof o.texto !== 'string') return []
    const lat = numeroOuNulo(o.lat)
    const lng = numeroOuNulo(o.lng)
    return [
      {
        texto: o.texto,
        place_id: typeof o.place_id === 'string' && o.place_id ? o.place_id : null,
        lat: lat !== null && lng !== null ? lat : null,
        lng: lat !== null && lng !== null ? lng : null,
      },
    ]
  })
}

/** Ponto da rota de uma parada; só texto (sem ponto) não entra na rota. */
export const pontoDaParada = (x: ParadaDoPedido): PontoRota | null => pontoDaRota(x)

/** Pontos intermediários da rota do pedido, na ordem (as paradas que têm ponto). */
export function pontosDasParadas(p: DetalhePedido): PontoRota[] {
  return paradasDoPedido(p).flatMap((x) => {
    const pt = pontoDaParada(x)
    return pt ? [pt] : []
  })
}

/**
 * Viagem com paradas: as paradas (índices) que a posição alcançou, somadas às já passadas. Passar a 150 m de uma parada
 * conta como passada (o mesmo raio da chegada ao destino, `ETA.chegadaM`). `coords[i]` é `undefined` enquanto o ponto
 * é buscado e `null` sem ponto (só texto). Devolve a MESMA lista quando nada mudou.
 */
export function paradasAlcancadas(coords: ReadonlyArray<Ponto | null | undefined>, posicao: Ponto | null, passadas: readonly number[]): readonly number[] {
  if (!posicao) return passadas
  const novas = coords.flatMap((c, i) => (c && !passadas.includes(i) && distanciaM(posicao, c) <= ETA.chegadaM ? [i] : []))
  return novas.length === 0 ? passadas : [...passadas, ...novas].sort((a, b) => a - b)
}

/**
 * Índices das paradas que faltam, na ordem: as não passadas que têm ponto (ou cujo ponto ainda está sendo buscado).
 * Uma parada só com texto não tem como ser alcançada nem roteada e fica de fora.
 */
export function paradasPendentes(coords: ReadonlyArray<Ponto | null | undefined>, passadas: readonly number[]): number[] {
  return coords.flatMap((c, i) => (c !== null && !passadas.includes(i) ? [i] : []))
}

/** Categoria de veículo do cliente (IVO Motorista): o banco grava VEICULO_CLIENTE e não usa veículo da IVO. */
export function veiculoDoCliente(p: Pick<DetalhePedido, 'categoria' | 'modalidade'>): boolean {
  return Boolean(p.categoria) && p.modalidade === 'VEICULO_CLIENTE'
}

/**
 * O reboque não é escolha do motorista: vem da categoria (o banco também força). As três de antes da 4.1 pelo
 * `PREENCHIMENTO`; as criadas pelo Master (e a IVO Motorista) pelo que o banco gravou no pedido; veículo do cliente
 * nunca tem reboque. Sem categoria, o que o cliente pediu.
 */
export function usaReboque(p: Pick<DetalhePedido, 'categoria' | 'reboque'> & Partial<Pick<DetalhePedido, 'modalidade'>>): boolean {
  if (p.categoria && p.modalidade === 'VEICULO_CLIENTE') return false
  const c = p.categoria && Object.hasOwn(PREENCHIMENTO, p.categoria) ? PREENCHIMENTO[p.categoria as CodigoCategoria] : null
  return c ? c.reboque === 'SIM' : p.reboque === 'SIM'
}

/** Trechos que o km cobre: 2 em ida e volta (regra do banco, `trechos_km`). */
export function trechos(p: Pick<DetalhePedido, 'levar' | 'trazer' | 'trechos_km'>): 1 | 2 {
  return p.trechos_km === 2 || (p.trechos_km === undefined && p.levar && p.trazer) ? 2 : 1
}

/**
 * Km pela rota, em décimos, com o MESMO arredondamento do cliente (`kmDaRota`, uma casa por trecho): assim o "Aceitar"
 * do motorista dá o mesmo total que o cliente viu, e a confirmação não mostra uma contraproposta que não existe.
 * 4.1 (Ruling F4): com paradas em ida e volta, a ida passa pelas paradas e a volta é direta (`kmVolta`); a soma é
 * arredondada UMA vez, como `kmDoPedido` (a prévia do cliente).
 */
export function kmDecimosDaRota(kmRota: number, nTrechos: 1 | 2, kmVolta: number | null = null): number {
  const total =
    nTrechos === 2 && kmVolta !== null
      ? Math.round((kmDoPedido({ ida: { km: kmRota }, volta: { km: kmVolta }, levar: true, trazer: true }) ?? 0) * 10)
      : Math.round(kmDaRota(kmRota) * 10) * nTrechos
  return Math.min(KM_MAX_DECIMOS, total)
}

/** Itens que a calculadora mostra: só os que a tarifa da categoria cobra (zerado = não cobra). */
export interface ItensDaTarifa {
  km: boolean
  horas: boolean
  espera: boolean
  paradas: boolean
  hospedagem: boolean
  reboque: boolean
}

/**
 * Entrada de sondagem: uma unidade de cada quantidade. O banco devolve só as linhas que a tarifa cobra (cada linha só
 * sai com valor e quantidade > 0), e isso diz à tela que itens mostrar sem nenhuma regra de preço no aparelho. Sem
 * categoria (app atual), `horas` e `paradas` o banco recusa: ficam de fora.
 */
export function entradaDaSonda(p: PedidoDaChamada): Record<string, unknown> {
  const e: Record<string, unknown> = {
    modalidade: veiculoDoCliente(p) ? 'VEICULO_CLIENTE' : 'VEICULO_PROPRIO',
    km: 1,
    usa_reboque: usaReboque(p),
    espera_horas: 1,
    pedagio_cent: 0,
    hospedagem_diarias: 1,
  }
  if (p.categoria) {
    e.horas = 1
    e.paradas = 1
  }
  return e
}

/** Os itens pelas linhas da sondagem. */
export function itensDaSonda(linhas: readonly Pick<LinhaOrcamento, 'codigo'>[]): ItensDaTarifa {
  const c = new Set(linhas.map((l) => l.codigo))
  return {
    km: c.has('KM') || c.has('KM_COM_REBOQUE'),
    horas: c.has('HORAS'),
    espera: c.has('ESPERA'),
    paradas: c.has('PARADAS'),
    hospedagem: c.has('HOSPEDAGEM'),
    reboque: c.has('REBOQUE') || c.has('KM_COM_REBOQUE'),
  }
}

/** Sem a sondagem (falhou): os itens de antes da 4.1 e as horas se o pedido as tem. */
export function itensPadrao(p: PedidoDaChamada): ItensDaTarifa {
  return {
    km: true,
    horas: Boolean(p.categoria) && typeof p.horas_estimadas === 'number',
    espera: true,
    paradas: false,
    hospedagem: true,
    reboque: usaReboque(p),
  }
}

/**
 * Formulário da calculadora: o de hoje mais as horas (em meias horas, como a espera). `null` = sem horas (pedido antigo
 * sem horas estimadas): nada vai na entrada até o motorista mexer no contador, e o total fica igual ao da tabela.
 */
export type FormCalculadora = FormOrcamento & { horasMeias: number | null }

export const HORAS_MIN_MEIAS = HORAS_MIN * 2
export const HORAS_MAX_MEIAS = HORAS_MAX * 2

/** Meias horas válidas (0,5 a 24 h) ou `null`. */
function meiasDeHoras(h: unknown): number | null {
  if (typeof h !== 'number' || !Number.isFinite(h)) return null
  const m = h * 2
  return Number.isInteger(m) && m >= HORAS_MIN_MEIAS && m <= HORAS_MAX_MEIAS ? m : null
}

/** As horas do pedido (horas estimadas pelo cliente), em meias horas; sem elas, `null`. */
export const horasDoPedido = (p: PedidoDaChamada): number | null => meiasDeHoras(p.horas_estimadas)

/** A tabela pura: só os km da rota, sem espera, pedágio, hospedagem ou outros (as horas e paradas são as do pedido). */
export function formDaTabela(p: PedidoDaChamada, kmRota: number | null, kmVolta: number | null = null): FormCalculadora {
  const f = formInicial('VEICULO_PROPRIO', usaReboque(p) ? 'SIM' : 'NAO')
  if (kmRota !== null) f.kmDecimos = kmDecimosDaRota(kmRota, trechos(p), kmVolta)
  return { ...f, horasMeias: horasDoPedido(p) }
}

/** Ponto de partida da calculadora: o orçamento anterior numa revisão; senão, a tabela pela rota. */
export function formDaCalculadora(
  p: PedidoDaChamada,
  anterior: unknown,
  kmRota: number | null,
  kmVolta: number | null = null,
): FormCalculadora {
  if (anterior && typeof anterior === 'object' && !Array.isArray(anterior)) {
    const a = anterior as Record<string, unknown>
    // A entrada anterior da IVO Motorista vem com VEICULO_CLIENTE: os itens são lidos como os do veículo próprio (km,
    // espera), nunca como diárias.
    const f = formDaEntrada({ ...a, modalidade: 'VEICULO_PROPRIO' }, 'VEICULO_PROPRIO', usaReboque(p) ? 'SIM' : 'NAO')
    return {
      ...f,
      modalidade: 'VEICULO_PROPRIO',
      usaReboque: usaReboque(p),
      diarias: 0,
      horasMeias: meiasDeHoras(a.horas) ?? horasDoPedido(p),
    }
  }
  return formDaTabela(p, kmRota, kmVolta)
}

/**
 * Entrada de `calcular_orcamento`/`enviar_orcamento`: a de hoje (`montarEntrada`, veículo próprio) e, pela 4.1, as
 * `horas` quando a tarifa cobra por hora. Na categoria de veículo do cliente, a modalidade é VEICULO_CLIENTE e nunca vai
 * `diarias` (a tarifa cobra por hora). As paradas não vão: o banco usa as do pedido.
 */
export function entradaDaChamada(
  f: FormCalculadora,
  p: PedidoDaChamada,
  itens: Pick<ItensDaTarifa, 'horas'> | null = null,
): { ok: true; entrada: Record<string, unknown> } | { ok: false; erros: ErrosOrcamento } {
  const m = montarEntrada({ ...f, modalidade: 'VEICULO_PROPRIO' })
  if (!m.ok) return m
  const entrada: Record<string, unknown> = { ...m.entrada }
  delete entrada.diarias
  if (veiculoDoCliente(p)) {
    entrada.modalidade = 'VEICULO_CLIENTE'
    entrada.usa_reboque = false
  }
  if (itens?.horas && f.horasMeias !== null) entrada.horas = f.horasMeias / 2
  return { ok: true, entrada }
}

/** Envia a proposta: na categoria de veículo do cliente, `veiculo_id` nulo (um veículo ali é VEICULO_INVALIDO). */
export function enviarProposta(id: string, entrada: Record<string, unknown>, veiculoId: string | null) {
  if (veiculoId) return corrida.enviarProposta(id, entrada, { veiculo_id: veiculoId })
  return pedidos.enviarOrcamento(id, { ...entrada, veiculo_id: null }, null)
}

/** Veículos que podem fazer a corrida: ATIVOS, da categoria do pedido; o primeiro (o mais antigo) é o sugerido. */
export function veiculosDaChamada(lista: readonly Veiculo[], categoria: string | null | undefined): Veiculo[] {
  return lista
    .filter((v) => v.situacao === 'ATIVO' && (!categoria || (v.categorias as string[]).includes(categoria)))
    .sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em) || a.id.localeCompare(b.id))
}

export const rotuloVeiculo = (v: Pick<Veiculo, 'modelo' | 'cor' | 'placa'>) => `${v.modelo} ${v.cor} · ${v.placa}`

/** A rota do pedido: a ida pelas paradas e, quando pedido, a volta direta (só em memória, termos do Google). */
export type RotaDaChamada = RotaDaTela & { kmVolta: number | null }

export type EstadoRotaDaChamada =
  | { fase: 'sem-pontos' }
  | { fase: 'carregando' }
  | { fase: 'pronta'; rota: RotaDaChamada }
  | { fase: 'falhou' }

/** A linha fica só na memória desta aba: a chamada e a calculadora reaproveitam a mesma consulta. */
const memoria = new Map<string, Promise<RotaDaChamada | null>>()

async function consultar(origem: PontoRota, destino: PontoRota, paradas: PontoRota[], comVolta: boolean) {
  const [ida, volta] = await Promise.all([
    rotaAte(origem, destino, paradas),
    comVolta ? rotaAte(destino, origem) : Promise.resolve(null),
  ])
  if (!ida || (comVolta && !volta)) return null
  return { ...ida, kmVolta: volta ? volta.km : null }
}

/**
 * Km, tempo e linha da origem ao destino passando pelas paradas, na ordem. `comVolta` (ida e volta com paradas) busca
 * também a volta direta, que soma no km. Sem paradas, a mesma chamada de antes (2 pontos).
 */
export function useRotaPorParadas(origem: PontoRota | null, destino: PontoRota | null, paradas: readonly PontoRota[], comVolta = false) {
  const volta = comVolta && paradas.length > 0
  const chave = origem && destino ? JSON.stringify([origem, destino, paradas, volta]) : null
  const [resultado, setResultado] = useState<{ chave: string; rota: RotaDaChamada | null } | null>(null)
  const [rodada, setRodada] = useState(0)

  useEffect(() => {
    if (!chave) return
    let vivo = true
    let promessa = memoria.get(chave)
    if (!promessa) {
      const [o, d, ps, v] = JSON.parse(chave) as [PontoRota, PontoRota, PontoRota[], boolean]
      promessa = consultar(o, d, ps, v).catch(() => null)
      memoria.set(chave, promessa)
    }
    void promessa.then((rota) => {
      if (!rota) memoria.delete(chave)
      if (vivo) setResultado({ chave, rota })
    })
    return () => {
      vivo = false
    }
  }, [chave, rodada])

  const tentarDeNovo = useCallback(() => {
    setResultado(null)
    setRodada((r) => r + 1)
  }, [])

  const estado: EstadoRotaDaChamada = !chave
    ? { fase: 'sem-pontos' }
    : !resultado || resultado.chave !== chave
      ? { fase: 'carregando' }
      : resultado.rota
        ? { fase: 'pronta', rota: resultado.rota }
        : { fase: 'falhou' }
  return { estado, tentarDeNovo }
}

/** Itens da tarifa pela sondagem (`undefined` enquanto o banco responde; se ele falhar, `itensPadrao`). */
export function useItensDaTarifa(p: PedidoDaChamada | undefined): ItensDaTarifa | undefined {
  const chave = p ? JSON.stringify([p.id, entradaDaSonda(p), itensPadrao(p)]) : null
  const [resultado, setResultado] = useState<{ chave: string; itens: ItensDaTarifa } | null>(null)
  useEffect(() => {
    if (!chave) return
    let vivo = true
    const [id, entrada, padrao] = JSON.parse(chave) as [string, Record<string, unknown>, ItensDaTarifa]
    void pedidos.calcular(id, entrada).then((r) => {
      if (!vivo) return
      const itens = r.ok && Array.isArray(r.linhas) ? itensDaSonda(r.linhas as LinhaOrcamento[]) : padrao
      setResultado({ chave, itens })
    })
    return () => {
      vivo = false
    }
  }, [chave])
  return resultado && resultado.chave === chave ? resultado.itens : undefined
}

/** Pedido, rota (km, tempo e linha só em memória, pelas paradas) e veículos da chamada. */
export function useChamada(id: string) {
  const detalhe = useConsulta(`novo-chamada-${id}`, () => pedidos.detalhe(id))
  const lista = useConsulta('novo-meus-veiculos', veiculos.meus)
  const p = detalhe.dados?.pedido as PedidoDaChamada | undefined
  const { estado: rota, tentarDeNovo } = useRotaPorParadas(
    p ? ponto(p, 'origem') : null,
    p ? ponto(p, 'destino') : null,
    p ? pontosDasParadas(p) : [],
    p ? trechos(p) === 2 : false,
  )
  const { recarregar: recarregarDetalhe } = detalhe
  const { recarregar: recarregarVeiculos } = lista
  const recarregar = useCallback(() => {
    recarregarDetalhe()
    recarregarVeiculos()
  }, [recarregarDetalhe, recarregarVeiculos])
  const doCliente = p ? veiculoDoCliente(p) : false
  return {
    r: detalhe.dados,
    // Na categoria de veículo do cliente, a lista de veículos não importa: a falha dela não trava a chamada.
    erro: detalhe.erro || (!doCliente && lista.erro),
    recarregar,
    rota,
    tentarDeNovo,
    veiculos: doCliente ? [] : lista.dados === undefined ? undefined : veiculosDaChamada(lista.dados, p?.categoria),
  }
}
