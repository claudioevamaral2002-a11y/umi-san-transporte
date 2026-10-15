import { describe, expect, it } from 'vitest'
import { comBanco, criarPessoa, empresaComContrato, motoristaUnico, rpc } from './ajuda.ts'

/**
 * Fase 3A contra o banco real: a prévia do cliente dá o mesmo total que o orçamento do motorista para os mesmos km
 * (também em ida e volta), e do ponto do Google o pedido guarda só o place_id (termos do Google).
 */
describe('prévia do orçamento e km estimado', () => {
  it('a prévia do N2 dá o mesmo total que o orçamento do motorista; o pedido guarda só o place_id', async () => {
    const empresa = await empresaComContrato()
    const n2 = await criarPessoa({ papel: 'CLIENTE', nivel: 2, empresa })
    const motorista = await motoristaUnico()
    const inicio = new Date(Date.now() + 5 * 86_400_000)
    inicio.setUTCMinutes(0, 0, 0)
    inicio.setUTCHours(14)
    const criado = await rpc(n2, 'criar_pedido', {
      p: {
        inicio: inicio.toISOString(),
        duracao_min: 120,
        origem: 'Porto de Itajaí',
        destino: 'Estaleiro Navegantes',
        levar: true,
        trazer: false,
        carga: 'PESSOAS',
        pessoas_qtd: 1,
        modalidade: 'VEICULO_PROPRIO',
        reboque: 'SIM',
        origem_lat: -26.9078,
        origem_lng: -48.6619,
        destino_place_id: 'ChIJdef',
      },
    })
    expect(criado).toMatchObject({ ok: true })

    const previa = await rpc(n2, 'previa_orcamento', {
      p: { km: 38.2, usa_reboque: true, levar: true, trazer: false, modalidade: 'VEICULO_PROPRIO' },
    })
    const orcamento = await rpc(motorista, 'calcular_orcamento', { p_atividade: criado.id, p: { km: 38.2, usa_reboque: true } })
    expect(previa.ok).toBe(true)
    expect(orcamento.ok).toBe(true)
    expect(previa.total_cent).toBe(orcamento.total_cent)

    const detalhe = await rpc(motorista, 'pedido', { p_id: criado.id })
    expect(detalhe.pedido).toMatchObject({ destino_place_id: 'ChIJdef', destino_lat: null, origem_lat: -26.9078, trechos_km: 1 })

    const locais = await rpc(n2, 'locais_da_empresa', { p_texto: 'estaleiro' })
    expect(locais).toMatchObject({ ok: true, locais: [{ nome: 'Estaleiro Navegantes', place_id: 'ChIJdef' }] })

    // Ida e volta: a prévia recebe o km de um trecho e cobra o dobro, igual ao orçamento com o km de ida e volta.
    const ida = new Date(inicio.getTime() + 86_400_000)
    const idaEVolta = await rpc(n2, 'criar_pedido', {
      p: {
        inicio: ida.toISOString(), duracao_min: 120, origem: 'Porto de Itajaí', destino: 'Estaleiro Navegantes',
        levar: true, trazer: true, carga: 'PESSOAS', pessoas_qtd: 1, modalidade: 'VEICULO_PROPRIO', reboque: 'NAO',
        origem_place_id: 'ChIJabc', destino_place_id: 'ChIJdef',
      },
    })
    expect(idaEVolta).toMatchObject({ ok: true })
    const previaIv = await rpc(n2, 'previa_orcamento', {
      p: { km: 38.2, usa_reboque: false, levar: true, trazer: true, modalidade: 'VEICULO_PROPRIO' },
    })
    const detalheIv = await rpc(motorista, 'pedido', { p_id: idaEVolta.id })
    expect(detalheIv.pedido).toMatchObject({ origem_place_id: 'ChIJabc', trechos_km: 2 })
    const orcamentoIv = await rpc(motorista, 'calcular_orcamento', { p_atividade: idaEVolta.id, p: { km: 76.4 } })
    expect(previaIv.total_cent).toBe(orcamentoIv.total_cent)

    // A prévia nunca grava orçamento.
    const n = await comBanco((db) =>
      db.query<{ n: number }>('select count(*)::int as n from app.orcamentos where atividade_id = $1', [criado.id]),
    )
    expect(n.rows[0]!.n).toBe(0)
  })
})
