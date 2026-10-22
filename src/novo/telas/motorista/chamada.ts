// Fase 4 (Tarefa 10): o que a chamada e a calculadora do motorista compartilham. Só QUANTIDADES saem do aparelho; o
// preço vem sempre do contrato (`calcular_orcamento` na tela, `enviar_orcamento` no envio). Nenhum ajuste livre
// (`ajuste_cent`): a contraproposta é feita nos itens (Ruling R11, especificação §5.4).
import { useCallback } from 'react'
import { kmDaRota, PREENCHIMENTO, type CodigoCategoria } from '../../../lib/categorias.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { pontoDaRota, type PontoRota } from '../../../lib/enderecosRemoto.ts'
import { formDaEntrada, formInicial, KM_MAX_DECIMOS, type FormOrcamento } from '../../../lib/orcar.ts'
import { pedidos, type DetalhePedido } from '../../../lib/pedidos.ts'
import { veiculos, type Veiculo } from '../../../lib/veiculos.ts'
import { useRota } from '../../useRota.ts'

export const ponto = (p: DetalhePedido, lado: 'origem' | 'destino'): PontoRota | null =>
  pontoDaRota({
    lat: p[`${lado}_lat`] ?? null,
    lng: p[`${lado}_lng`] ?? null,
    place_id: p[`${lado}_place_id`] ?? null,
  })

/** O reboque não é escolha do motorista: vem da categoria (o banco também força); sem categoria, o que o cliente pediu. */
export function usaReboque(p: Pick<DetalhePedido, 'categoria' | 'reboque'>): boolean {
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
 */
export function kmDecimosDaRota(kmRota: number, nTrechos: 1 | 2): number {
  return Math.min(KM_MAX_DECIMOS, Math.round(kmDaRota(kmRota) * 10) * nTrechos)
}

/** A tabela pura: só os km da rota, sem espera, pedágio, hospedagem ou outros. */
export function formDaTabela(p: DetalhePedido, kmRota: number | null): FormOrcamento {
  const f = formInicial('VEICULO_PROPRIO', usaReboque(p) ? 'SIM' : 'NAO')
  if (kmRota !== null) f.kmDecimos = kmDecimosDaRota(kmRota, trechos(p))
  return f
}

/** Ponto de partida da calculadora: o orçamento anterior numa revisão; senão, a tabela pela rota. */
export function formDaCalculadora(p: DetalhePedido, anterior: unknown, kmRota: number | null): FormOrcamento {
  if (anterior) {
    const f = formDaEntrada(anterior, 'VEICULO_PROPRIO', usaReboque(p) ? 'SIM' : 'NAO')
    return { ...f, modalidade: 'VEICULO_PROPRIO', usaReboque: usaReboque(p), diarias: 0 }
  }
  return formDaTabela(p, kmRota)
}

/** Veículos que podem fazer a corrida: ATIVOS, da categoria do pedido; o primeiro (o mais antigo) é o sugerido. */
export function veiculosDaChamada(lista: readonly Veiculo[], categoria: string | null | undefined): Veiculo[] {
  return lista
    .filter((v) => v.situacao === 'ATIVO' && (!categoria || (v.categorias as string[]).includes(categoria)))
    .sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em) || a.id.localeCompare(b.id))
}

export const rotuloVeiculo = (v: Pick<Veiculo, 'modelo' | 'cor' | 'placa'>) => `${v.modelo} ${v.cor} · ${v.placa}`

/** Pedido, rota (km, tempo e linha só em memória) e veículos da chamada. */
export function useChamada(id: string) {
  const detalhe = useConsulta(`novo-chamada-${id}`, () => pedidos.detalhe(id))
  const lista = useConsulta('novo-meus-veiculos', veiculos.meus)
  const p = detalhe.dados?.pedido
  const { estado: rota, tentarDeNovo } = useRota(p ? ponto(p, 'origem') : null, p ? ponto(p, 'destino') : null)
  const { recarregar: recarregarDetalhe } = detalhe
  const { recarregar: recarregarVeiculos } = lista
  const recarregar = useCallback(() => {
    recarregarDetalhe()
    recarregarVeiculos()
  }, [recarregarDetalhe, recarregarVeiculos])
  return {
    r: detalhe.dados,
    erro: detalhe.erro || lista.erro,
    recarregar,
    rota,
    tentarDeNovo,
    veiculos: lista.dados === undefined ? undefined : veiculosDaChamada(lista.dados, p?.categoria),
  }
}
