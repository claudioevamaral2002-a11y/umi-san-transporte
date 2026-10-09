import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import {
  DIA_PEDIDO,
  ID_PEDIDO,
  diaSp,
  instanteSp,
  pedidoOrcadoCliente,
  pendenciaFalsa,
  simularPedidos,
} from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const CLIENTE_N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }

/** Abre o mês do dia (avança se for o mês seguinte) e toca no dia. */
async function escolherDia(page: Page, dia: string) {
  const calendario = page.getByTestId('calendario')
  const botao = calendario.locator(`[data-dia="${dia}"]`)
  await expect(calendario.locator('[data-dia]').first()).toBeVisible()
  if ((await botao.count()) === 0) await calendario.getByRole('button', { name: 'Próximo mês' }).click()
  await botao.click()
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
}

test.describe('cliente: novo pedido', () => {
  test('4 passos com Levar/Trazer, máscara de telefone, revisão e HORARIO_OCUPADO → novo horário → enviado', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      respostas: { criar_pedido: [{ ok: false, codigo: 'HORARIO_OCUPADO' }] },
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Novo pedido' }).first().click()

    // Passo 1 — Quando?
    await expect(page.getByRole('heading', { level: 1, name: 'Quando?' })).toBeVisible()
    await expect(page.getByText('Passo 1 de 4')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Voltar ao passo anterior' })).toHaveCount(0)
    // Dia cheio e dias passados não são selecionáveis.
    const cheio = page.getByTestId('calendario').locator(`[data-dia="${diaSp(3)}"]`)
    if ((await cheio.count()) > 0) await expect(cheio).toBeDisabled()
    if (diaSp(-1).slice(0, 7) === diaSp(0).slice(0, 7)) {
      await expect(page.getByTestId('calendario').locator(`[data-dia="${diaSp(-1)}"]`)).toBeDisabled()
    }
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Escolha o dia e um dos horários livres.' })).toBeVisible()

    await escolherDia(page, DIA_PEDIDO)
    const horarios = page.getByTestId('horarios-livres')
    await horarios.getByRole('radio', { name: '10:00' }).click()
    await expect(horarios.getByRole('radio', { name: '10:00' })).toHaveAttribute('aria-checked', 'true')
    // Duração: 2 h padrão, passos de 30 min (refaz as consultas).
    await expect(page.getByRole('group', { name: 'Duração estimada' })).toContainText('2 h')
    await page.getByRole('button', { name: 'Aumentar duração estimada' }).click()
    await expect(page.getByRole('group', { name: 'Duração estimada' })).toContainText('2 h 30 min')
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'horarios_livres' && c.corpo.p_duracao_min === 150).length).toBeGreaterThan(0)
    await expect(page.getByText('O motorista confirma no orçamento.')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click()

    // Passo 2 — Onde? Levar e Trazer são independentes; ao menos um.
    await expect(page.getByRole('heading', { level: 1, name: 'Onde?' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Onde?' })).toBeFocused()
    await page.getByLabel('Origem').fill('Porto de Itajaí')
    await page.getByLabel('Destino').fill('Base Navegantes')
    await expect(page.getByText('Marque os dois para ida e volta.')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Marque Levar, Trazer ou os dois.' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('checkbox', { name: 'Trazer' }).check()
    await page.getByLabel('Nome do contato').fill('Rui')
    await page.getByLabel('Telefone do contato').pressSequentially('47999991234')
    await expect(page.getByLabel('Telefone do contato')).toHaveValue('(47) 99999-1234')
    await page.getByRole('button', { name: 'Continuar' }).click()

    // Passo 3 — O que vamos levar?
    await expect(page.getByRole('heading', { level: 1, name: 'O que vamos levar?' })).toBeVisible()
    await page.getByRole('radio', { name: 'Ambos' }).click()
    await page.getByRole('button', { name: 'Aumentar pessoas' }).click()
    await page.getByLabel('Equipamento').fill('Bomba d’água')
    await page.getByLabel('Peso (kg)').fill('85,5')
    await page.getByRole('radio', { name: 'Veículo do cliente' }).click()
    await page.getByRole('radio', { name: 'Não sei' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()

    // Passo 4 — Confira o pedido.
    await expect(page.getByRole('heading', { level: 1, name: 'Confira o pedido' })).toBeVisible()
    const resumo = page.getByTestId('resumo-pedido')
    await expect(resumo).toContainText('10:00')
    await expect(resumo).toContainText('Duração estimada: 2 h 30 min')
    await expect(resumo).toContainText('Levar e trazer (ida e volta)')
    await expect(resumo).toContainText('2 pessoas + Bomba d’água')
    await expect(resumo).toContainText('Veículo do cliente')
    await expect(resumo).toContainText('Reboque: Não sei')
    await expect(page.getByTestId('aviso-prazo')).toContainText(
      'O motorista envia o orçamento em até 12 horas; o horário fica pré-reservado até lá.',
    )
    // "Editar" leva ao passo e volta mantendo o que foi preenchido.
    await page.getByRole('button', { name: 'Editar onde' }).click()
    await expect(page.getByLabel('Origem')).toHaveValue('Porto de Itajaí')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()

    // Enviar: o horário acabou de ser ocupado → volta ao passo 1 com aviso e horários relidos.
    const antes = chamadas.filter((c) => c.rpc === 'horarios_livres').length
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Quando?' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Esse horário acabou de ser ocupado. Escolha outro.' })).toBeVisible()
    await expect.poll(() => chamadas.filter((c) => c.rpc === 'horarios_livres').length).toBeGreaterThan(antes)
    await expect(page.getByTestId('horarios-livres').getByRole('radio', { checked: true })).toHaveCount(0)
    await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:30' }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByLabel('Origem')).toHaveValue('Porto de Itajaí')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await page.getByRole('button', { name: 'Enviar pedido' }).click()

    // Só depois da confirmação do servidor: tela de sucesso.
    await expect(page.getByTestId('pedido-enviado')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pedido enviado' })).toBeVisible()
    await expect(page.getByText('Pedido #0043')).toBeVisible()
    const envios = chamadas.filter((c) => c.rpc === 'criar_pedido')
    expect(envios).toHaveLength(2)
    expect(envios[1]!.corpo.p).toEqual({
      inicio: instanteSp(DIA_PEDIDO, '10:30'),
      duracao_min: 150,
      origem: 'Porto de Itajaí',
      destino: 'Base Navegantes',
      levar: true,
      trazer: true,
      carga: 'AMBOS',
      pessoas_qtd: 2,
      equipamento_desc: 'Bomba d’água',
      peso_kg: 85.5,
      dimensoes: null,
      modalidade: 'VEICULO_CLIENTE',
      reboque: 'NAO_SEI',
      contato_nome: 'Rui',
      contato_telefone: '(47) 99999-1234',
      observacoes: null,
    })
    await page.getByRole('link', { name: 'Acompanhar pedido' }).click()
    await expect(page).toHaveURL(new RegExp(`/pedidos/${ID_PEDIDO}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Pedido #0042' })).toBeVisible()
    expect(csp).toEqual([])
  })

  test('fechar com dados pede confirmação; sem dados fecha direto', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page)
    await page.goto('/pedidos')
    await page.getByRole('link', { name: 'Novo pedido' }).click()
    await page.getByRole('button', { name: 'Fechar o novo pedido' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible()

    await page.getByRole('link', { name: 'Novo pedido' }).click()
    await escolherDia(page, DIA_PEDIDO)
    await page.getByTestId('horarios-livres').getByRole('radio', { name: '16:00' }).click()
    await page.getByRole('button', { name: 'Fechar o novo pedido' }).click()
    const folha = page.getByRole('dialog', { name: 'Descartar este pedido?' })
    await folha.getByRole('button', { name: 'Continuar preenchendo' }).click()
    await expect(folha).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: 'Quando?' })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar o novo pedido' }).click()
    await page.getByRole('dialog', { name: 'Descartar este pedido?' }).getByRole('button', { name: 'Descartar pedido' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible()
  })

  test('sem contrato vigente: "Novo pedido" indisponível com explicação', async ({ page }) => {
    await comSessaoFalsa(page, { ...CLIENTE_N2, empresa_tem_contrato: false })
    await simularApi(page, { regras: [] })
    await simularPedidos(page)
    await page.goto('/')
    const bloco = page.getByTestId('novo-pedido-indisponivel')
    await expect(bloco.getByRole('button', { name: 'Novo pedido' })).toBeDisabled()
    await expect(bloco).toContainText('Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.')
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)
    await page.goto('/pedidos/novo')
    await expect(page.getByTestId('novo-pedido-sem-contrato')).toContainText('Novo pedido indisponível')
    await expect(page.getByTestId('calendario')).toHaveCount(0)
  })

  test('N3 (visualizador) não cria pedido: sem botão, rota recusada e janelas livres sem ação', async ({ page }) => {
    await comSessaoFalsa(page, { ...CLIENTE_N2, nivel: 3, nome: 'Elisa Prado' })
    await simularApi(page)
    const chamadas = await simularPedidos(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Olá, Elisa' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)
    await page.goto('/pedidos')
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)
    await page.goto('/pedidos/novo')
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible()
    expect(chamadas.map((c) => c.rpc)).not.toContain('criar_pedido')
    await page.goto('/agenda')
    await escolherDia(page, DIA_PEDIDO)
    await expect(page.getByTestId('janela-livre').first()).toBeVisible()
    await expect(page.getByTestId('agenda-dia').getByRole('link', { name: /fazer pedido/ })).toHaveCount(0)
  })
})

test.describe('cliente: pedidos e orçamento recebido', () => {
  test('início com pendências e contagem; lista com filtros', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      pendencias: {
        aguardando_aprovacao: [pendenciaFalsa({ status: 'ORCADA', prazo: new Date(Date.now() + 20 * 3600_000).toISOString(), total_cent: 71000, versao: 1 })],
        aguardando_orcamento: [pendenciaFalsa({ id: 'x', numero: 41, urgente: true })],
      },
    })
    await page.goto('/')
    const aprovar = page.getByTestId('grupo-aprovar')
    await expect(aprovar.getByRole('heading', { name: /Aguardando sua aprovação/ })).toBeVisible()
    await expect(aprovar.getByTestId('pendencia-aprovar')).toContainText('Pedido #0042')
    await expect(aprovar.getByTestId('pendencia-aprovar')).toContainText(/R\$\s710,00/)
    await expect(aprovar.getByTestId('contagem')).toHaveText(/^Aprovar em até (19|20) h/)
    const andamento = page.getByTestId('grupo-acompanhar')
    await expect(andamento.getByTestId('pendencia-acompanhar')).toContainText('URGENTE')
    await expect(andamento.getByTestId('contagem')).toHaveText(/^Orçamento em até (4|5) h/)

    await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Pedidos' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible()
    const lista = page.getByTestId('lista-pedidos')
    await expect(lista.getByRole('listitem')).toHaveCount(2)
    await expect(lista.getByRole('listitem').first()).toContainText('Aguardando aprovação')
    await expect(lista.getByRole('listitem').first()).toContainText(/Aprovar em até/)
    await expect(lista.getByRole('listitem').nth(1)).toContainText('Solicitada')
    expect(chamadas.find((c) => c.rpc === 'meus_pedidos')?.corpo).toEqual({
      p_filtro: { status: ['SOLICITADA', 'ORCADA'], limite: 100 },
    })
    await page.getByRole('button', { name: 'Encerrados' }).click()
    await expect(page.getByRole('button', { name: 'Encerrados' })).toHaveAttribute('aria-pressed', 'true')
    await expect(lista.getByRole('listitem')).toHaveCount(1)
    await expect(lista.getByRole('listitem')).toContainText('Cancelada')
    await page.getByRole('button', { name: 'Agendados' }).click()
    await expect(page.getByText('Nenhum pedido aqui')).toBeVisible()
    expect(csp).toEqual([])
  })

  test('detalhe com orçamento: memorial, regras, Aprovar habilitado, pedir revisão e reprovar', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      respostas: { pedir_revisao: [{ ok: false, codigo: 'LIMITE_EXCEDIDO' }] },
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Pedido #0042' })).toBeVisible()
    await expect(page.getByText('Aguardando aprovação').first()).toBeVisible()
    await expect(page.getByTestId('contagem').first()).toHaveText(/^Orçamento válido por mais (19|20) h/)
    await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Orçado')

    const orc = page.getByTestId('orcamento-recebido')
    await expect(orc).toContainText(/R\$\s710,00/)
    await expect(orc).toContainText('Válido até')
    const memorial = orc.getByTestId('memorial').getByRole('listitem')
    await expect(memorial).toHaveCount(4)
    await expect(memorial.nth(0)).toContainText('Km rodados (trecho único)')
    await expect(memorial.nth(0)).toContainText(/120 × R\$\s3,50/)
    await expect(memorial.nth(0)).toContainText(/R\$\s420,00/)
    await expect(memorial.nth(1)).toContainText(/50% de R\$\s420,00/)
    await expect(memorial.nth(2)).toContainText(/1,5 × R\$\s40,00/)
    await expect(memorial.nth(3)).toContainText('Outros: Balsa extra')
    await expect(orc.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
      '24 h ou mais antes: sem multa',
      'De 6 h a menos de 24 h antes: multa de 50%',
      'Menos de 6 h antes: multa de 100%',
    ])
    await expect(orc.getByRole('button', { name: 'Aprovar' })).toBeEnabled()
    // Texto do pedido nunca vira HTML.
    await expect(page.getByText('<b>portão 3</b>')).toBeVisible()

    // Pedir revisão: motivo obrigatório; erro do servidor aparece; depois confirma.
    await orc.getByRole('button', { name: 'Pedir revisão' }).click()
    const folha = page.getByRole('dialog', { name: 'Pedir revisão' })
    await folha.getByRole('button', { name: 'Pedir revisão' }).click()
    await expect(folha.getByLabel('O que precisa mudar?')).toBeFocused()
    expect(chamadas.map((c) => c.rpc)).not.toContain('pedir_revisao')
    await folha.getByLabel('O que precisa mudar?').fill('Km parece alto')
    await folha.getByRole('button', { name: 'Pedir revisão' }).click()
    await expect(folha.getByRole('alert')).toContainText('Muitas tentativas seguidas')
    await folha.getByRole('button', { name: 'Pedir revisão' }).click()
    await expect(folha).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Revisão pedida. O motorista vai enviar um novo orçamento.' })).toBeVisible()
    expect(chamadas.filter((c) => c.rpc === 'pedir_revisao').at(-1)?.corpo).toEqual({ p_atividade: ID_PEDIDO, p_motivo: 'Km parece alto' })

    // Reprovar: motivo opcional.
    await orc.getByRole('button', { name: 'Reprovar' }).click()
    const reprovar = page.getByRole('dialog', { name: 'Reprovar orçamento' })
    await reprovar.getByRole('button', { name: 'Reprovar orçamento' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Orçamento reprovado.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'reprovar_orcamento')?.corpo).toEqual({ p_atividade: ID_PEDIDO, p_motivo: null })

    // Cancelar (sem custo nesta etapa).
    await page.getByRole('button', { name: 'Cancelar pedido' }).click()
    const cancelar = page.getByRole('dialog', { name: 'Cancelar pedido' })
    await expect(cancelar.getByText('Sem custo nesta etapa.')).toBeVisible()
    await cancelar.getByRole('button', { name: 'Cancelar pedido' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pedido cancelado.' })).toBeVisible()
    expect(csp).toEqual([])
  })

  test('pedido de outra empresa ou inexistente: "não encontrado"', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [{ ok: false, codigo: 'NAO_ENCONTRADO' }] })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await expect(page.getByText('Pedido não encontrado')).toBeVisible()
  })
})

test.describe('cliente: agenda', () => {
  test('mês com marcadores e dia com o próprio pedido, ocupado de outra empresa e janelas livres', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, { detalhes: [pedidoOrcadoCliente()] })
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Agenda' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'dias_do_mes')?.corpo.p_duracao_min).toBe(60)

    await escolherDia(page, DIA_PEDIDO)
    const botaoDia = page.getByTestId('calendario').locator(`[data-dia="${DIA_PEDIDO}"]`)
    await expect(botaoDia).toHaveAccessibleName(/1 pedido seu.*ocupado/)
    const dia = page.getByTestId('agenda-dia')
    const proprio = dia.getByTestId('bloco-proprio')
    await expect(proprio).toContainText('08:00–10:00')
    await expect(proprio).toContainText('Pedido #0042')
    await expect(proprio).toContainText('Porto de Itajaí → Base Navegantes')
    const ocupado = dia.getByTestId('bloco-ocupado')
    await expect(ocupado).toContainText('12:00–14:00')
    await expect(ocupado).toContainText('Ocupado')
    await expect(ocupado).not.toContainText('#')
    await expect(dia.getByTestId('janela-livre')).toHaveText([/Livre · 10:00–11:30/, /Livre · 16:00–18:00/])

    // Janela livre inicia o pedido com dia e horário preenchidos.
    await dia.getByRole('link', { name: /Livre das 16:00 às 18:00/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Quando?' })).toBeVisible()
    await expect(page.getByTestId('horarios-livres').getByRole('radio', { name: '16:00' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Fechar o novo pedido' }).click()
    await page.getByRole('dialog', { name: 'Descartar este pedido?' }).getByRole('button', { name: 'Descartar pedido' }).click()

    // O próprio bloco abre o pedido.
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    await escolherDia(page, DIA_PEDIDO)
    await page.getByTestId('agenda-dia').getByTestId('bloco-proprio').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedido #0042' })).toBeVisible()
    expect(csp).toEqual([])
  })
})
