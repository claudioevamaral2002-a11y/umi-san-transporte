import { expect, test } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, orcamentoCliente, pendenciaFalsa, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { simularRealtime } from './apoio/realtimeFalso.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const MOTORISTA = { papel: 'MOTORISTA' as const, nome: 'Bruno Lima', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const CLIENTE_N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const CLIENTE_N3 = { papel: 'CLIENTE' as const, nivel: 3 as const, nome: 'Elisa Prado', empresa_nome: 'Umi San' }
const MIN = 60_000
const HISTORICO_AGENDADO = [
  { de: null, para: 'SOLICITADA', em: new Date(Date.now() - 3 * 60 * MIN).toISOString(), observacao: null, por_nome: 'Diego Rocha' },
  { de: 'SOLICITADA', para: 'ORCADA', em: new Date(Date.now() - 2 * 60 * MIN).toISOString(), observacao: null, por_nome: 'Bruno Lima' },
  { de: 'ORCADA', para: 'AGENDADA', em: new Date(Date.now() - 60 * MIN).toISOString(), observacao: null, por_nome: 'Diego Rocha' },
]
const PORTO = { origem_lat: null, origem_lng: null, origem_place_id: 'ChIJpor' }
const RAMPA = { destino_lat: -26.8801, destino_lng: -48.6612, destino_place_id: null }

/** Detalhe do pedido na etapa pedida, como o motorista (ou o cliente) o recebe. */
function detalhe(status: 'AGENDADA' | 'EM_ANDAMENTO' | 'CONCLUIDA', extra: Record<string, unknown> = {}, acoes: Record<string, boolean> = {}) {
  const inicio = new Date(Date.now() + 30 * MIN).toISOString()
  const saiu = status === 'AGENDADA' ? null : new Date(Date.now() - 20 * MIN).toISOString()
  return {
    ok: true,
    pedido: detalheFalso({
      status,
      inicio,
      ...PORTO,
      ...RAMPA,
      saida_liberada_em: new Date(Date.now() - 30 * MIN).toISOString(),
      saiu_em: saiu,
      concluiu_em: status === 'CONCLUIDA' ? new Date().toISOString() : null,
      fim_previsto: new Date(Date.now() + 2 * 60 * MIN).toISOString(),
      previsao_informada: false,
      atraso_anterior_ate: null,
      km_rodados: status === 'CONCLUIDA' ? 41.4 : null,
      observacao_conclusao: status === 'CONCLUIDA' ? 'Entregue no galpão 2' : null,
      pode_ver_rastreio: true,
      fotos_qtd: 0,
      ...extra,
    }),
    historico: [
      ...HISTORICO_AGENDADO,
      ...(status === 'AGENDADA' ? [] : [{ de: 'AGENDADA', para: 'EM_ANDAMENTO', em: saiu, observacao: null, por_nome: 'Bruno Lima' }]),
      ...(status === 'CONCLUIDA' ? [{ de: 'EM_ANDAMENTO', para: 'CONCLUIDA', em: new Date().toISOString(), observacao: null, por_nome: 'Bruno Lima' }] : []),
    ],
    orcamento: orcamentoCliente({ status: 'APROVADO' }),
    acoes: { ...SEM_ACOES, sair: false, informar_previsao: false, concluir: false, enviar_fotos: false, ...acoes },
  }
}

test.describe('motorista: saída e viagem', () => {
  test.use({ geolocation: { latitude: -26.9078, longitude: -48.6619, accuracy: 8 }, permissions: ['geolocation'] })

  test('deslize para sair (teclado) → só depois do servidor vira Em andamento → compartilha a posição', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularMapas(page)
    await simularBlocosDoMapa(page)
    const chamadas = await simularPedidos(page, {
      detalhes: [
        detalhe('AGENDADA', {}, { sair: true, cancelar_agendado: true }),
        detalhe('EM_ANDAMENTO', {}, { informar_previsao: true, concluir: true, enviar_fotos: true }),
      ],
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    const cartao = page.getByTestId('cartao-saida')
    await expect(cartao).toBeVisible()
    await expect(cartao.getByTestId('atalhos-viagem').getByRole('link', { name: 'Maps' })).toHaveAttribute(
      'href',
      /destination_place_id=ChIJpor/,
    )
    await expect(cartao.getByRole('link', { name: 'Ligar' })).toHaveAttribute('href', 'tel:47999991234')

    const trilho = page.getByRole('slider', { name: 'Deslize para sair' })
    await trilho.focus()
    await page.keyboard.press('ArrowRight')
    await expect(trilho).toHaveAttribute('aria-valuenow', '25')
    expect(chamadas.filter((c) => c.rpc === 'registrar_saida')).toHaveLength(0)
    await page.keyboard.press('End')

    await expect(page.getByText('Saída registrada. Boa viagem!')).toBeVisible()
    const saidas = chamadas.filter((c) => c.rpc === 'registrar_saida')
    expect(saidas).toHaveLength(1)
    expect(saidas[0]!.corpo).toMatchObject({ p_atividade: ID_PEDIDO })
    expect(String(saidas[0]!.corpo.p_chave)).toMatch(/^[0-9a-f-]{36}$/)

    // Em andamento: explica o compartilhamento antes de pedir o GPS.
    const viagem = page.getByTestId('viagem-motorista')
    await expect(viagem.getByTestId('aviso-localizacao')).toBeVisible()
    expect(chamadas.filter((c) => c.rpc === 'enviar_posicao')).toHaveLength(0)
    await viagem.getByRole('button', { name: 'Começar a compartilhar' }).click()
    await expect(viagem.getByTestId('selo-localizacao')).toHaveText('Compartilhando sua localização')
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'enviar_posicao').length).toBeGreaterThan(0)
    const posicao = chamadas.find((c) => c.rpc === 'enviar_posicao')!.corpo
    expect(posicao).toMatchObject({ p_atividade: ID_PEDIDO, p: { lat: -26.9078, lng: -48.6619, precisao: 8, seq: 1 } })
    // A chegada: 1 dos 12 cálculos da viagem, depois a rota (simulada: 45 min).
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'registrar_eta').length).toBe(1)
    await expect(viagem.getByTestId('chegada-prevista')).toHaveText(/^~\d{2}:\d{2}$/)
    expect(csp).toEqual([])
  })

  test('antes de 1 h do início o trilho fica travado e diz quando libera', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      detalhes: [detalhe('AGENDADA', { saida_liberada_em: new Date(Date.now() + 90 * MIN).toISOString() }, { sair: true })],
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    const trilho = page.getByRole('slider', { name: 'Deslize para sair' })
    await expect(trilho).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText(/Disponível a partir de \d{2}:\d{2} \(1 h antes do início\)/)).toBeVisible()
    await trilho.press('End')
    expect(chamadas.filter((c) => c.rpc === 'registrar_saida')).toHaveLength(0)
  })

  test('saída recusada (outra viagem em andamento): mensagem e o pedido continua agendado', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularPedidos(page, {
      detalhes: [detalhe('AGENDADA', {}, { sair: true })],
      respostas: { registrar_saida: [{ ok: false, codigo: 'OUTRA_EM_ANDAMENTO' }] },
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await page.getByRole('slider', { name: 'Deslize para sair' }).press('Enter')
    await expect(page.getByText('Você tem outro serviço em andamento. Conclua-o antes de sair para este.')).toBeVisible()
    await expect(page.getByTestId('cartao-saida')).toBeVisible()
  })

  test('nova previsão que colide avisa o próximo cliente; concluir com foto e observação', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularMapas(page)
    const fotos: unknown[] = []
    await page.route(`${URL_SUPABASE}/functions/v1/enviar-foto`, (route) => {
      fotos.push(route.request().postDataJSON())
      return json(route, { ok: true, foto_id: 'f1', caminho: `${ID_PEDIDO}/f1.webp` })
    })
    const emAndamento = detalhe('EM_ANDAMENTO', {}, { informar_previsao: true, concluir: true, enviar_fotos: true })
    const chamadas = await simularPedidos(page, {
      detalhes: [emAndamento],
      respostas: { informar_previsao: [{ ok: true, conflito: true, proximo_id: 'x', proximo_numero: 44 }] },
    })
    // O detalhe vira CONCLUIDA depois que a conclusão chega ao "servidor" (rota registrada por último vence).
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/pedido`, (route) =>
      json(
        route,
        chamadas.some((c) => c.rpc === 'concluir') ? detalhe('CONCLUIDA', { fotos_qtd: 1 }, { enviar_fotos: true }) : emAndamento,
      ),
    )
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    const viagem = page.getByTestId('viagem-motorista')
    await viagem.getByRole('button', { name: 'Nova previsão de término' }).click()
    const folha = page.getByRole('dialog', { name: 'Nova previsão de término' })
    const opcao = folha.getByTestId('opcoes-previsao').getByRole('radio').nth(2)
    const hora = (await opcao.textContent())!.trim()
    await opcao.click()
    await folha.getByLabel('Motivo (opcional)').fill('Espera na balsa')
    await folha.getByRole('button', { name: `Salvar previsão ${hora}` }).click()
    await expect(page.getByText(`Previsão salva: ${hora}. O cliente do pedido #0044 foi avisado do atraso.`)).toBeVisible()
    const previsao = chamadas.find((c) => c.rpc === 'informar_previsao')!.corpo
    expect(previsao).toMatchObject({ p_atividade: ID_PEDIDO, p_motivo: 'Espera na balsa' })
    expect(new Date(String(previsao.p_fim)).getUTCMinutes() % 15).toBe(0)

    await page.getByTestId('viagem-motorista').getByRole('button', { name: 'Concluir serviço' }).click()
    const concluir = page.getByRole('dialog', { name: 'Concluir serviço' })
    // PNG 2×2 vermelho: reduzido no aparelho e enviado como WebP.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
      'base64',
    )
    await concluir.getByTestId('entrada-fotos').setInputFiles({ name: 'galpao.png', mimeType: 'image/png', buffer: png })
    await expect(concluir.locator('[data-estado="ok"]')).toHaveCount(1)
    expect(fotos).toHaveLength(1)
    expect(fotos[0]).toMatchObject({ atividade: ID_PEDIDO })
    expect(Buffer.from(String((fotos[0] as { dados: string }).dados), 'base64').subarray(8, 12).toString()).toBe('WEBP')
    await concluir.getByLabel('Observação (opcional)').fill('  Entregue no galpão 2  ')
    await concluir.getByRole('button', { name: 'Concluir serviço' }).click()
    await expect(page.getByText('Serviço concluído. O trajeto foi apagado e o resumo ficou no pedido.')).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'concluir')!.corpo).toEqual({ p_atividade: ID_PEDIDO, p_observacao: 'Entregue no galpão 2' })
    const resumo = page.getByTestId('resumo-concluido')
    await expect(resumo).toContainText('~41 km')
    await expect(resumo.getByTestId('observacao-conclusao')).toHaveText('“Entregue no galpão 2”')
  })
})

test.describe('motorista: Início', () => {
  test('próximo serviço em cartão grande com o trilho; saindo dali abre o pedido', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      pendencias: { proximos: [pendenciaFalsa({ status: 'AGENDADA', inicio: new Date(Date.now() + 20 * MIN).toISOString() })] },
      detalhes: [detalhe('EM_ANDAMENTO', {}, { informar_previsao: true, concluir: true })],
    })
    await page.goto('/')
    const cartao = page.getByTestId('proximo-servico')
    await expect(cartao).toContainText('Porto de Itajaí')
    await cartao.getByRole('slider', { name: 'Deslize para sair' }).press('End')
    await expect(page).toHaveURL(new RegExp(`/pedidos/${ID_PEDIDO}$`))
    await expect(page.getByText('Saída registrada. Boa viagem!')).toBeVisible()
    expect(chamadas.filter((c) => c.rpc === 'registrar_saida')).toHaveLength(1)
  })

  test('viagem em andamento: atalho para voltar, com o aviso de previsão vencida', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularPedidos(page, {
      pendencias: {
        proximos: [pendenciaFalsa({ status: 'EM_ANDAMENTO', atrasado: true, fim_previsto: new Date(Date.now() - 5 * MIN).toISOString() })],
      },
    })
    await page.goto('/')
    const atalho = page.getByTestId('proximo-em-andamento')
    await expect(atalho).toContainText('Voltar à viagem')
    await expect(atalho).toContainText(/Passou da previsão \(\d{2}:\d{2}\): informe uma nova/)
    await expect(page.getByTestId('proximo-servico')).toHaveCount(0)
  })
})

test.describe('cliente: acompanhar a viagem', () => {
  test('mapa ao vivo: a posição do canal move o carro e mostra a chegada; seq antigo é ignorado', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularMapas(page)
    await simularBlocosDoMapa(page)
    const realtime = await simularRealtime(page)
    await simularPedidos(page, { detalhes: [detalhe('EM_ANDAMENTO')] })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    const mapa = page.getByTestId('mapa-ao-vivo')
    await expect(mapa).toHaveAttribute('data-pronto', 'sim')
    await expect(page.getByTestId('sinal-motorista')).toHaveText('Aguardando a posição do motorista…')
    await expect.poll(() => realtime.assinou(`rastreio:${ID_PEDIDO}`)).toBe(true)

    const chegada = new Date(Date.now() + 25 * MIN).toISOString()
    realtime.transmitir(`rastreio:${ID_PEDIDO}`, 'posicao', { lat: -26.9, lng: -48.66, seq: 5, eta: chegada, ts: new Date().toISOString() })
    await expect(mapa).toHaveAttribute('data-posicao', '-26.900000,-48.660000')
    await expect(page.getByTestId('sinal-motorista')).toHaveText('Atualizado agora')
    await expect(page.getByTestId('chegada-cliente')).toHaveText(/^~\d{2}:\d{2}$/)
    await expect(page.locator('.marcador-carro')).toHaveCount(1)
    await expect(page.locator('.marcador-destino')).toHaveCount(1)

    realtime.transmitir(`rastreio:${ID_PEDIDO}`, 'posicao', { lat: -26.95, lng: -48.7, seq: 4 })
    realtime.transmitir(`rastreio:${ID_PEDIDO}`, 'posicao', { lat: '-26', lng: -48.7, seq: 9 })
    realtime.transmitir(`rastreio:${ID_PEDIDO}`, 'posicao', { lat: -26.89, lng: -48.65, seq: 6 })
    await expect(mapa).toHaveAttribute('data-posicao', '-26.890000,-48.650000')
    expect(csp).toEqual([])
  })

  test('sem posição há mais de 60 s: carro cinza e "sinal perdido" (nunca inventa posição)', async ({ page }) => {
    await page.clock.install()
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularMapas(page)
    await simularBlocosDoMapa(page)
    const realtime = await simularRealtime(page)
    await simularPedidos(page, { detalhes: [detalhe('EM_ANDAMENTO')] })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await expect(page.getByTestId('mapa-ao-vivo')).toHaveAttribute('data-pronto', 'sim')
    await expect.poll(() => realtime.assinou(`rastreio:${ID_PEDIDO}`)).toBe(true)
    realtime.transmitir(`rastreio:${ID_PEDIDO}`, 'posicao', { lat: -26.9, lng: -48.66, seq: 1 })
    await expect(page.getByTestId('sinal-motorista')).toHaveText('Atualizado agora')
    await page.clock.runFor(30_000)
    await expect(page.getByTestId('sinal-motorista')).toHaveText(/^Atualizado há \d+ s$/)
    await page.clock.runFor(40_000)
    await expect(page.getByTestId('sinal-motorista')).toContainText('Sinal do motorista perdido. Última posição há 1 min.')
    await expect(page.getByTestId('mapa-ao-vivo')).toHaveAttribute('data-sinal', 'perdido')
    await expect(page.locator('.marcador-carro.perdido')).toHaveCount(1)
  })

  test('N3 (visualizador) vê o status, sem mapa; próximo pedido mostra o atraso do anterior', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N3)
    await simularApi(page)
    await simularPedidos(page, {
      detalhes: [
        detalhe('EM_ANDAMENTO', { pode_ver_rastreio: false }),
        detalhe('AGENDADA', { atraso_anterior_ate: new Date(Date.now() + 40 * MIN).toISOString() }),
      ],
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await expect(page.getByTestId('linha-do-tempo')).toBeVisible()
    await expect(page.getByTestId('mapa-ao-vivo-cartao')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('aviso-atraso-anterior')).toContainText(/O motorista está terminando outro serviço\. Previsão de chegada ~\d{2}:\d{2}/)
  })
})
