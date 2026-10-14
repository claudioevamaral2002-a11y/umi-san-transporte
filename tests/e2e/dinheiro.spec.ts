import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import {
  extratoFalso,
  painelFalso,
  pedidoAgendadoCliente,
  pedidoCanceladoCliente,
  saldoFalso,
  simularDinheiro,
} from './apoio/dinheiroFalso.ts'
import { ID_PEDIDO, pedidoOrcadoCliente, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'
import { esperarInicioComAviso } from './apoio/areaIndisponivel.ts'

// Fase 2B (mocks): saldo no Início, aprovação com recibo, cancelamento de agendado com multa, extrato (filtros, CSV,
// PDF) e, para o ADM, créditos por cliente (recarga, ajuste, estorno) e painel. Nenhuma ação de dinheiro é otimista:
// a tela só muda depois da resposta do servidor.

const CLIENTE_N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const ADM = { papel: 'ADM' as const, nome: 'Ana Souza', tem_2fa: true }
const AAL2 = { aal: 'aal2' as const }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BOM = String.fromCharCode(0xfeff)
const R = (valor: string) => new RegExp(`R\\$\\s${valor.replace(/\./g, '\\.')}`)

async function abrirPedido(page: Page) {
  await page.goto(`/pedidos/${ID_PEDIDO}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Pedido #0042' })).toBeVisible()
}

test.describe('cliente: saldo no Início', () => {
  test('N3 vê disponível (contando até o valor), reservado, total, barra e limite; alerta quando baixo', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, { ...CLIENTE_N2, nivel: 3, nome: 'Elisa Prado' })
    await simularApi(page)
    const chamadas = await simularDinheiro(page, {
      saldos: [saldoFalso({ disponivel_cent: 30000, saldo_contabil_cent: 101000, abaixo_alerta: true })],
    })
    await page.goto('/')
    const cartao = page.getByTestId('cartao-saldo')
    await expect(cartao).toBeVisible()
    // O número visível conta até o valor do servidor.
    await expect(cartao.getByTestId('saldo-disponivel').locator('[aria-hidden="true"]')).toHaveText(R('300,00'))
    await expect(cartao.getByTestId('saldo-reservado')).toHaveText(R('710,00'))
    await expect(cartao.getByTestId('saldo-contabil')).toHaveText(R('1.010,00'))
    await expect(cartao.getByTestId('saldo-limite')).toContainText(/Limite de crédito R\$\s1\.000,00/)
    await expect(cartao.getByTestId('saldo-barra')).toBeVisible()
    await expect(cartao).toContainText('Saldo baixo')
    await expect(cartao.getByTestId('saldo-alerta')).toContainText(/Abaixo do alerta de R\$\s500,00/)
    expect(chamadas.find((c) => c.rpc === 'saldo_empresa')?.corpo).toEqual({ p_empresa: null })
    // N3 não cria pedidos, mas vê o extrato.
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)
    await cartao.getByRole('link', { name: 'Ver extrato' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Extrato' })).toBeVisible()
    expect(csp).toEqual([])
  })

  test('movimento reduzido: o valor aparece direto, sem contagem', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularDinheiro(page)
    await page.goto('/')
    const visivel = page.getByTestId('saldo-disponivel').locator('[aria-hidden="true"]')
    await expect(visivel).toHaveText(R('2.490,00'), { timeout: 2_000 })
  })
})

test.describe('cliente: aprovar', () => {
  test('recibo → confirmar → processando → check → card "Agendado"; linha do tempo avança', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoOrcadoCliente(), pedidoAgendadoCliente()] })
    const chamadas = await simularDinheiro(page, { atrasoMs: 900 })
    await abrirPedido(page)
    await page.getByTestId('orcamento-recebido').getByRole('button', { name: 'Aprovar' }).click()

    const recibo = page.getByRole('dialog', { name: 'Recibo da aprovação' })
    await expect(recibo.getByTestId('memorial').getByRole('listitem')).toHaveCount(4)
    await expect(recibo).toContainText(R('710,00'))
    await expect(recibo).toContainText('Válido até')
    await expect(recibo.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveCount(3)
    const saldo = recibo.getByTestId('recibo-saldo')
    await expect(saldo).toContainText(/Disponível agora\s*R\$\s2\.490,00/)
    await expect(saldo.getByTestId('recibo-saldo-depois')).toHaveText(R('1.780,00'))
    await expect(saldo).toContainText(/Limite de crédito R\$\s1\.000,00/)

    await recibo.getByRole('button', { name: 'Confirmar aprovação' }).click()
    // Sem UI otimista: enquanto o servidor não responde, só a animação de processamento.
    await expect(recibo.getByTestId('processando')).toContainText('Confirmando a aprovação com o servidor…')
    await expect(page.getByTestId('cartao-agendado')).toHaveCount(0)
    await expect(page.getByTestId('aprovacao-check')).toBeVisible()
    await expect(recibo).toBeHidden()
    const card = page.getByTestId('cartao-agendado')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('aprovacao-check')).toHaveCount(0)
    await expect(card.getByTestId('agendado-reservado')).toHaveText(R('710,00'))
    await expect(card.getByTestId('agendado-disponivel')).toHaveText(R('1.780,00'))
    await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Agendado')
    await expect(page.getByRole('button', { name: 'Cancelar agendamento' })).toBeVisible()

    const corpo = chamadas.find((c) => c.rpc === 'aprovar_orcamento')!.corpo
    expect(corpo).toMatchObject({ p_atividade: ID_PEDIDO, p_versao: 1, p_hash: 'a'.repeat(64) })
    expect(String(corpo.p_chave)).toMatch(UUID)
    expect(corpo.p_dispositivo).toBe('Android · Chrome · app IVO')
    expect(csp).toEqual([])
  })

  test('movimento reduzido: o card "Agendado" aparece direto', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoOrcadoCliente(), pedidoAgendadoCliente()] })
    await simularDinheiro(page)
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Aprovar' }).click()
    await page.getByRole('button', { name: 'Confirmar aprovação' }).click()
    await expect(page.getByTestId('cartao-agendado')).toBeVisible()
    await expect(page.getByTestId('aprovacao-check')).toHaveCount(0)
  })

  test('SALDO_INSUFICIENTE: quanto falta, disponível e limite; sugere falar com a IVO', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page)
    await simularDinheiro(page, {
      saldos: [saldoFalso({ disponivel_cent: 10000, limite_cent: 50000 })],
      respostas: {
        aprovar_orcamento: [
          { ok: false, codigo: 'SALDO_INSUFICIENTE', disponivel_cent: 10000, limite_cent: 50000, total_cent: 71000, falta_cent: 11000 },
        ],
      },
    })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Aprovar' }).click()
    const recibo = page.getByRole('dialog', { name: 'Recibo da aprovação' })
    await expect(recibo.getByTestId('recibo-saldo')).toContainText(/faltariam R\$\s110,00/)
    await recibo.getByRole('button', { name: 'Confirmar aprovação' }).click()
    const aviso = recibo.getByTestId('saldo-insuficiente')
    await expect(aviso.getByRole('alert')).toHaveText(/Faltam R\$\s110,00 para aprovar este orçamento\./)
    await expect(aviso).toContainText(/Disponível agora\s*R\$\s100,00/)
    await expect(aviso).toContainText(/Limite de crédito\s*R\$\s500,00/)
    await expect(aviso).toContainText(/Total do orçamento\s*R\$\s710,00/)
    await expect(aviso).toContainText('Fale com a IVO Transportes para recarregar')
    await recibo.getByTestId('aprovar-erro').getByRole('button', { name: 'Fechar' }).click()
    await expect(page.getByTestId('cartao-agendado')).toHaveCount(0)
    await expect(page.getByText('Aguardando aprovação').first()).toBeVisible()
  })

  test('queda de rede: "Tentar de novo" reenvia com a MESMA chave; ORCAMENTO_ALTERADO relê o pedido', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const pedidosChamadas = await simularPedidos(page)
    const chamadas = await simularDinheiro(page, {
      respostas: { aprovar_orcamento: ['rede', { ok: false, codigo: 'ORCAMENTO_ALTERADO' }] },
    })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Aprovar' }).click()
    const recibo = page.getByRole('dialog', { name: 'Recibo da aprovação' })
    await recibo.getByRole('button', { name: 'Confirmar aprovação' }).click()
    await expect(recibo.getByRole('alert')).toContainText('Não conseguimos confirmar com o servidor')
    await recibo.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(recibo.getByRole('alert')).toContainText('O orçamento mudou desde que você abriu o recibo')
    const chaves = chamadas.filter((c) => c.rpc === 'aprovar_orcamento').map((c) => c.corpo.p_chave)
    expect(chaves).toHaveLength(2)
    expect(chaves[0]).toBe(chaves[1])
    await expect.poll(() => pedidosChamadas.filter((c) => c.rpc === 'pedido').length).toBeGreaterThan(1)
    await recibo.getByRole('button', { name: 'Ver pedido atualizado' }).click()
    await expect(recibo).toBeHidden()
  })
})

test.describe('cliente: cancelar agendado', () => {
  test('mostra a multa calculada no servidor antes de confirmar; resultado só depois da resposta', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoAgendadoCliente(), pedidoCanceladoCliente()] })
    const chamadas = await simularDinheiro(page, { atrasoMs: 500 })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
    const folha = page.getByRole('dialog', { name: 'Cancelar agendamento' })
    await expect(folha.getByTestId('previa-multa')).toContainText(
      /Cancelando agora: multa de R\$\s355,00 \(50% — de 6 h a menos de 24 h antes\)/,
    )
    await expect(folha.getByTestId('previa-multa')).toContainText(/A reserva de R\$\s710,00 volta para o saldo disponível/)
    expect(chamadas.find((c) => c.rpc === 'simular_cancelamento')?.corpo).toEqual({ p_atividade: ID_PEDIDO })
    await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
    await expect(folha.getByTestId('processando')).toBeVisible()
    await expect(folha).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' })).toHaveText(
      /Agendamento cancelado\. Liberado: R\$\s710,00\. Multa: R\$\s355,00\./,
    )
    await expect(page.getByText('Cancelada').first()).toBeVisible()
    const corpo = chamadas.find((c) => c.rpc === 'cancelar_agendado')!.corpo
    // o cliente confirma a multa que viu na prévia
    expect(corpo).toMatchObject({ p_atividade: ID_PEDIDO, p_motivo: null, p_multa_esperada_cent: 35500 })
    expect(String(corpo.p_chave)).toMatch(UUID)
    expect(csp).toEqual([])
  })

  test('a faixa mudou até a confirmação: mostra a multa nova e só cancela depois de confirmar de novo (chave nova)', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoAgendadoCliente(), pedidoCanceladoCliente()] })
    const chamadas = await simularDinheiro(page, {
      respostas: {
        cancelar_agendado: [
          { ok: false, codigo: 'MULTA_ALTERADA', multa_cent: 71000, faixa: { antecedencia_min_horas: 0, multa_bp: 10000 } },
          {
            ok: true,
            atividade_id: ID_PEDIDO,
            liberado_cent: 71000,
            multa_cent: 71000,
            faixa: { antecedencia_min_horas: 0, multa_bp: 10000 },
            disponivel_cent: 249000,
          },
        ],
      },
    })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
    const folha = page.getByRole('dialog', { name: 'Cancelar agendamento' })
    await expect(folha.getByTestId('previa-multa')).toContainText(/multa de R\$\s355,00/)
    await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
    // nada foi cancelado: a folha continua aberta com a multa nova
    await expect(folha.getByTestId('multa-alterada')).toContainText(/A multa mudou.*Nova multa: R\$\s710,00\./)
    await expect(folha.getByTestId('previa-multa')).toContainText(/multa de R\$\s710,00/)
    await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' })).toHaveCount(0)
    await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
    await expect(folha).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' })).toHaveText(
      /Agendamento cancelado\. Liberado: R\$\s710,00\. Multa: R\$\s710,00\./,
    )
    const corpos = chamadas.filter((c) => c.rpc === 'cancelar_agendado').map((c) => c.corpo)
    expect(corpos.map((c) => c.p_multa_esperada_cent)).toEqual([35500, 71000])
    expect(corpos[0]!.p_chave).not.toBe(corpos[1]!.p_chave)
  })

  test('sem multa pela antecedência', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoAgendadoCliente()] })
    await simularDinheiro(page, {
      simulacao: {
        ok: true,
        atividade_id: ID_PEDIDO,
        numero: 42,
        total_cent: 71000,
        liberado_cent: 71000,
        horas_antes: 50,
        faixa: { antecedencia_min_horas: 24, multa_bp: 0 },
        multa_cent: 0,
        cobra_multa: true,
        motivo_obrigatorio: false,
      },
    })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
    await expect(page.getByTestId('previa-multa')).toContainText('Cancelando agora: sem multa (24 h ou mais antes)')
  })

  test('motorista: sem custo para o cliente, motivo obrigatório', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'MOTORISTA', nome: 'Bruno Lima', tem_2fa: true }, AAL2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [pedidoAgendadoCliente(), pedidoCanceladoCliente()] })
    const chamadas = await simularDinheiro(page, {
      simulacao: {
        ok: true,
        atividade_id: ID_PEDIDO,
        numero: 42,
        total_cent: 71000,
        liberado_cent: 71000,
        horas_antes: 10,
        faixa: null,
        multa_cent: 0,
        cobra_multa: false,
        motivo_obrigatorio: true,
      },
      respostas: { cancelar_agendado: [{ ok: true, atividade_id: ID_PEDIDO, liberado_cent: 71000, multa_cent: 0, faixa: null, disponivel_cent: 1 }] },
    })
    await abrirPedido(page)
    await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
    const folha = page.getByRole('dialog', { name: 'Cancelar agendamento' })
    await expect(folha.getByTestId('previa-multa')).toContainText('Cancelando agora: sem custo para o cliente.')
    await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
    await expect(folha.getByText('Informe o motivo (de 3 a 500 caracteres).')).toBeVisible()
    expect(chamadas.map((c) => c.rpc)).not.toContain('cancelar_agendado')
    await folha.getByLabel('Motivo').fill('Pneu furado, sem veículo reserva')
    await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' })).toContainText('Sem multa.')
    expect(chamadas.find((c) => c.rpc === 'cancelar_agendado')?.corpo).toMatchObject({
      p_motivo: 'Pneu furado, sem veículo reserva',
      p_multa_esperada_cent: null,
    })
  })
})

test.describe('cliente: extrato', () => {
  test('lista com sinal e texto, privacidade do link, filtros, CSV e PDF', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await page.addInitScript(() => {
      const w = window as unknown as { __impressoes: string[] }
      w.__impressoes = []
      window.print = () => {
        w.__impressoes.push(document.title)
      }
    })
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularDinheiro(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Extrato' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Extrato' })).toBeVisible()

    const itens = page.getByTestId('lista-extrato').getByTestId('item-extrato')
    await expect(itens).toHaveCount(5)
    await expect(itens.nth(0)).toContainText('Multa de cancelamento')
    await expect(itens.nth(0)).toContainText(/− R\$\s355,00/)
    await expect(itens.nth(0)).toContainText('Débito')
    await expect(itens.nth(1)).toContainText(/\+ R\$\s710,00/)
    await expect(itens.nth(1)).toContainText('Liberado')
    await expect(itens.nth(2)).toContainText(/− R\$\s710,00/)
    await expect(itens.nth(2)).toContainText('Reservado')
    await expect(itens.nth(4)).toContainText(/\+ R\$\s5\.000,00/)
    await expect(itens.nth(4)).toContainText('Crédito')
    // Pedido que a pessoa pode ver: link; pedido do colega: só o número (e o solicitante).
    await expect(itens.nth(0).getByRole('link', { name: 'Pedido #0042' })).toHaveAttribute('href', `/pedidos/${ID_PEDIDO}`)
    await expect(itens.nth(3)).toContainText('Pedido #0039, Elisa Prado')
    await expect(itens.nth(3).getByRole('link')).toHaveCount(0)
    // Sem campos do ADM para o cliente.
    await expect(page.getByTestId('extrato')).not.toContainText('Pix de outubro')

    const primeira = chamadas.find((c) => c.rpc === 'extrato')!.corpo
    expect(primeira.p_empresa).toBeNull()
    const filtro = primeira.p_filtro as { de: string; ate: string; limite: number }
    expect(filtro.limite).toBe(500)
    expect(new Date(filtro.ate).getTime()).toBeGreaterThan(Date.now())

    // Filtro por tipo (no servidor).
    await page.getByLabel('Tipo').selectOption({ label: 'Multa de cancelamento' })
    await expect(itens).toHaveCount(1)
    expect((chamadas.filter((c) => c.rpc === 'extrato').at(-1)!.corpo.p_filtro as { tipos: string[] }).tipos).toEqual(['MULTA'])
    await page.getByLabel('Tipo').selectOption({ label: 'Todos os tipos' })
    await expect(itens).toHaveCount(5)

    // Período escolhido: [de 00:00, até+1 00:00) em São Paulo.
    await page.getByLabel('Período').selectOption({ label: 'Escolher datas' })
    await page.getByLabel('De', { exact: true }).fill('2026-09-01')
    await page.getByLabel('Até', { exact: true }).fill('2026-09-30')
    await expect
      .poll(() => (chamadas.filter((c) => c.rpc === 'extrato').at(-1)!.corpo.p_filtro as { de: string; ate: string }))
      .toMatchObject({ de: '2026-09-01T03:00:00.000Z', ate: '2026-10-01T03:00:00.000Z' })

    // CSV no padrão do Excel pt-BR, com empresa e período no nome.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()])
    expect(download.suggestedFilename()).toBe('extrato-umi-san-2026-09-01-a-2026-09-30.csv')
    const conteudo = Buffer.concat(await (async () => {
      const partes: Buffer[] = []
      for await (const p of (await download.createReadStream())!) partes.push(p as Buffer)
      return partes
    })()).toString('utf8')
    expect(conteudo.startsWith(BOM)).toBe(true)
    const linhas = conteudo.slice(1).split('\r\n')
    expect(linhas[0]).toBe(
      'Data;Tipo;Natureza;Valor no disponível (R$);Efeito no saldo contábil (R$);Efeito no reservado (R$);Pedido;Solicitante',
    )
    expect(linhas).toHaveLength(7)
    expect(linhas[1]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2};Multa de cancelamento;Débito;-355,00;-355,00;0,00;#0042;Diego Rocha$/)
    expect(linhas[5]).toMatch(/;Recarga;Crédito;5\.000,00;5\.000,00;0,00;;$/)

    // PDF pela impressão do navegador: o título sugere o nome do arquivo.
    await page.getByRole('button', { name: 'Exportar PDF' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __impressoes: string[] }).__impressoes)).toEqual([
      'extrato-umi-san-2026-09-01-a-2026-09-30',
    ])
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('cabecalho-impressao')).toContainText('Período: 01/09/2026 a 30/09/2026')
    await expect(page.getByTestId('tabela-extrato')).toBeVisible()
    await expect(page.getByTestId('filtros-extrato')).toBeHidden()
    await expect(page.getByRole('navigation', { name: 'Navegação' })).toBeHidden()
    await page.emulateMedia({ media: 'screen' })

    // Desktop: tabela.
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByTestId('tabela-extrato').getByRole('row')).toHaveCount(6)
    await expect(page.getByTestId('lista-extrato')).toBeHidden()
    expect(csp).toEqual([])
  })
})

test.describe('ADM: clientes e crédito', () => {
  test('lista por risco → empresa → recarga com confirmação; queda de rede repete a MESMA chave', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
    const chamadas = await simularDinheiro(page, {
      saldos: [saldoFalso(), saldoFalso({ saldo_contabil_cent: 470000, disponivel_cent: 399000 })],
      respostas: { lancar_recarga: ['rede'] },
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Créditos' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes e crédito' })).toBeVisible()
    const empresas = page.getByTestId('credito-empresa')
    await expect(empresas).toHaveCount(2)
    await expect(empresas.nth(0)).toContainText('Porto Azul')
    await expect(empresas.nth(0)).toContainText('Abaixo do alerta')
    await expect(empresas.nth(1)).toContainText('Umi San')
    await expect(empresas.nth(1)).toContainText(/Disponível\s*R\$\s2\.490,00/)
    await expect(empresas.nth(1)).toContainText(/Reservado\s*R\$\s710,00/)
    await expect(empresas.nth(1)).toContainText(/Limite\s*R\$\s1\.000,00/)
    await empresas.nth(1).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Umi San' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'saldo_empresa')?.corpo).toEqual({ p_empresa: EMPRESA_UMI.id })

    await page.getByRole('button', { name: 'Recarga' }).click()
    const folha = page.getByRole('dialog', { name: 'Recarga' })
    await folha.getByRole('button', { name: 'Revisar' }).click()
    await expect(folha.getByText('Informe um valor maior que zero, em reais (ex.: 1.500,00).')).toBeVisible()
    await expect(folha.getByText('Informe o motivo (de 3 a 500 caracteres).')).toBeVisible()
    await folha.getByLabel('Valor').fill('1.500,00')
    await folha.getByLabel('Motivo').fill('Pix de novembro')
    await folha.getByLabel('Comprovante (opcional)').fill('E2E-PIX-456')
    await folha.getByRole('button', { name: 'Revisar' }).click()
    const confirmar = folha.getByTestId('confirmar-lancamento')
    await expect(confirmar.getByTestId('confirmar-valor')).toHaveText(/Recarga \+ R\$\s1\.500,00/)
    await expect(confirmar.getByTestId('confirmar-disponivel')).toHaveText(/R\$\s2\.490,00 para R\$\s3\.990,00/)
    await expect(confirmar).toContainText(/R\$\s3\.200,00 para R\$\s4\.700,00/)
    expect(chamadas.map((c) => c.rpc)).not.toContain('lancar_recarga')

    await confirmar.getByRole('button', { name: 'Confirmar recarga' }).click()
    await expect(confirmar.getByRole('alert')).toContainText('Não conseguimos confirmar com o servidor')
    await expect(confirmar.getByRole('button', { name: 'Voltar' })).toHaveCount(0)
    await confirmar.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(folha).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Recarga lançada' })).toContainText(/Disponível agora: R\$\s3\.990,00/)
    const envios = chamadas.filter((c) => c.rpc === 'lancar_recarga').map((c) => c.corpo)
    expect(envios).toHaveLength(2)
    expect(envios[0]).toEqual({
      p_empresa: EMPRESA_UMI.id,
      p_valor_cent: 150000,
      p_motivo: 'Pix de novembro',
      p_comprovante: 'E2E-PIX-456',
      p_chave: envios[0]!.p_chave,
    })
    expect(String(envios[0]!.p_chave)).toMatch(UUID)
    expect(envios[1]).toEqual(envios[0])
    // Saldo relido do servidor.
    await expect(page.getByTestId('saldo-disponivel').locator('[aria-hidden="true"]')).toHaveText(R('3.990,00'))
    expect(csp).toEqual([])
  })

  test('ajuste a débito e estorno a partir do extrato (com motivo, autor e comprovante)', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
    const chamadas = await simularDinheiro(page, { extrato: extratoFalso(true) })
    await page.goto(`/adm/creditos/${EMPRESA_UMI.id}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Umi San' })).toBeVisible()

    // Ajuste: débito de R$ 25,50.
    await page.getByRole('button', { name: 'Ajuste' }).click()
    const ajuste = page.getByRole('dialog', { name: 'Ajuste de saldo' })
    await ajuste.getByRole('radio', { name: /Débito/ }).click()
    await expect(ajuste.getByRole('radio', { name: /Débito/ })).toHaveAttribute('aria-checked', 'true')
    await ajuste.getByLabel('Valor').fill('25,50')
    await ajuste.getByLabel('Motivo').fill('Correção de pedágio')
    await ajuste.getByRole('button', { name: 'Revisar' }).click()
    await expect(ajuste.getByTestId('confirmar-valor')).toHaveText(/Ajuste de saldo − R\$\s25,50/)
    await expect(ajuste.getByTestId('confirmar-disponivel')).toHaveText(/R\$\s2\.490,00 para R\$\s2\.464,50/)
    await ajuste.getByRole('button', { name: 'Confirmar ajuste' }).click()
    await expect(ajuste).toBeHidden()
    expect(chamadas.find((c) => c.rpc === 'lancar_ajuste')?.corpo).toMatchObject({
      p_empresa: EMPRESA_UMI.id,
      p_valor_cent: -2550,
      p_motivo: 'Correção de pedágio',
    })

    // Extrato do ADM: motivo, comprovante e autor; só lançamentos financeiros têm "Estornar".
    const itens = page.getByTestId('lista-extrato').getByTestId('item-extrato')
    await expect(itens.nth(4)).toContainText('Motivo: Pix de outubro, Comprovante: E2E-PIX-123, Por Ana Souza')
    await expect(itens.nth(0).getByRole('button', { name: 'Estornar' })).toBeVisible()
    await expect(itens.nth(1).getByRole('button', { name: 'Estornar' })).toHaveCount(0)
    await expect(itens.nth(2).getByRole('button', { name: 'Estornar' })).toHaveCount(0)
    await itens.nth(4).getByRole('button', { name: 'Estornar' }).click()
    const estorno = page.getByRole('dialog', { name: 'Estorno' })
    await expect(estorno.getByTestId('estorno-lancamento')).toContainText(/Recarga.*Valor original: \+ R\$\s5\.000,00/s)
    await estorno.getByLabel('Motivo').fill('Pix devolvido')
    await estorno.getByRole('button', { name: 'Revisar' }).click()
    await expect(estorno.getByTestId('confirmar-valor')).toHaveText(/Estorno − R\$\s5\.000,00/)
    await expect(estorno.getByTestId('confirmar-disponivel')).toHaveText(/R\$\s2\.490,00 para −R\$\s2\.510,00|R\$\s2\.490,00 para -R\$\s2\.510,00/)
    await estorno.getByRole('button', { name: 'Confirmar estorno' }).click()
    await expect(estorno).toBeHidden()
    const corpo = chamadas.find((c) => c.rpc === 'estornar_lancamento')!.corpo
    expect(corpo).toMatchObject({ p_lancamento: 5, p_motivo: 'Pix devolvido' })
    expect(String(corpo.p_chave)).toMatch(UUID)
    expect(corpo.p_chave).not.toBe(chamadas.find((c) => c.rpc === 'lancar_ajuste')!.corpo.p_chave)
  })

  test('cliente não abre a área de créditos nem o painel', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    for (const rota of ['/adm/creditos', '/adm/painel', `/adm/creditos/${EMPRESA_UMI.id}`]) {
      await page.goto(rota)
      await esperarInicioComAviso(page, rota)
    }
  })
})

test.describe('ADM: painel', () => {
  test('crédito por risco, corridas, aprovado no período, pendências e reconciliação com divergência', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    const chamadas = await simularDinheiro(page, { painel: painelFalso() })
    await page.goto('/')
    // Resumo no Início do ADM.
    const resumo = page.getByTestId('painel-resumo')
    await expect(resumo.getByTestId('painel-lista-credito').getByRole('listitem').first()).toContainText('Porto Azul')
    await expect(resumo.getByTestId('painel-agendadas')).toHaveText('3')
    await resumo.getByRole('link', { name: 'Abrir painel' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Painel' })).toBeVisible()
    const credito = page.getByTestId('painel-credito').getByRole('listitem')
    await expect(credito).toHaveCount(2)
    await expect(credito.nth(0)).toContainText('Porto Azul')
    await expect(credito.nth(0)).toContainText('Abaixo do alerta')
    await expect(credito.nth(1)).toContainText(/Umi San.*R\$\s2\.490,00/s)
    await expect(page.getByTestId('painel-agendadas')).toHaveText('3')
    await expect(page.getByTestId('painel-em-andamento')).toHaveText('1')
    await expect(page.getByTestId('painel-aprovado')).toContainText('3 pedidos aprovados')
    await expect(page.getByTestId('painel-aprovado-total')).toHaveText(R('2.130,00'))
    await expect(page.getByTestId('painel-pendencias')).toContainText(/Aguardando orçamento\s*2/)
    await expect(page.getByTestId('painel-abaixo-alerta')).toHaveText('1')
    const rec = page.getByTestId('painel-reconciliacao')
    await expect(rec).toContainText('1 divergência')
    await expect(rec.getByTestId('lista-divergencias')).toContainText('Pedido agendado sem reserva')
    await expect(rec.getByTestId('lista-divergencias')).toContainText('Porto Azul')

    await page.getByLabel('Período').selectOption({ label: 'Últimos 7 dias' })
    await expect
      .poll(() => chamadas.filter((c) => c.rpc === 'painel_adm').length)
      .toBeGreaterThan(2)
    const ultimo = chamadas.filter((c) => c.rpc === 'painel_adm').at(-1)!.corpo
    const dias = (Date.now() - new Date(String(ultimo.p_de)).getTime()) / 86_400_000
    expect(dias).toBeGreaterThan(6)
    expect(dias).toBeLessThan(7.1)
    expect(csp).toEqual([])
  })

  test('reconciliação em dia: "Tudo confere"', async ({ page }) => {
    await comSessaoFalsa(page, ADM, AAL2)
    await simularApi(page)
    await simularDinheiro(page, {
      painel: painelFalso({
        ultima_reconciliacao: { id: 8, em: new Date().toISOString(), ok: true, empresas: 2, divergencias_qtd: 0, divergencias: [] },
      }),
    })
    await page.goto('/adm/painel')
    await expect(page.getByTestId('painel-reconciliacao')).toContainText('Tudo confere')
  })
})
