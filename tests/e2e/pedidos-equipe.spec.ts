import { expect, test } from '@playwright/test'
import { EMPRESA_UMI, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import {
  DIA_PEDIDO,
  ID_PEDIDO,
  itemLista,
  pedidoOrcadoCliente,
  pedidoSolicitadoMotorista,
  pendenciaFalsa,
  simularPedidos,
} from './apoio/pedidosFalsos.ts'
import { escolherDiaNaAgenda } from './apoio/escolherDia.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'
import { esperarInicioComAviso } from './apoio/areaIndisponivel.ts'

const AAL2 = { aal: 'aal2' as const }
const MOTORISTA = { papel: 'MOTORISTA' as const, nome: 'Bruno Lima', tem_2fa: true }

test.describe('motorista', () => {
  test('início: aguardando seu orçamento (contagem, URGENTE, Revisão), próximos vazio e atalho da agenda', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularPedidos(page, {
      pendencias: {
        aguardando_orcamento: [
          pendenciaFalsa({ urgente: true, empresa_nome: 'Umi San' }),
          pendenciaFalsa({
            id: 'outro',
            numero: 39,
            revisao: true,
            empresa_nome: 'Umi San',
            prazo: new Date(Date.now() + 26 * 3600_000).toISOString(),
          }),
        ],
      },
      detalhes: [pedidoSolicitadoMotorista()],
    })
    await page.goto('/')
    const grupo = page.getByTestId('grupo-orcar')
    await expect(grupo.getByRole('heading', { name: /Aguardando seu orçamento/ })).toContainText('2')
    const cartoes = grupo.getByTestId('pendencia-orcar')
    await expect(cartoes).toHaveCount(2)
    await expect(cartoes.nth(0)).toContainText('URGENTE')
    await expect(cartoes.nth(0)).toContainText(/Pedido #0042.*Umi San/)
    await expect(cartoes.nth(0).getByTestId('contagem')).toHaveText(/^Responder em (4|5) h/)
    await expect(cartoes.nth(1)).toContainText('Revisão')
    await expect(cartoes.nth(1).getByTestId('contagem')).toHaveText(/^Responder em 1 dia/)
    await expect(page.getByTestId('grupo-proximo')).toContainText('Nenhum serviço agendado por enquanto.')
    await expect(page.getByTestId('atalho-agenda')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('link')).toHaveText([
      'Início',
      'Pedidos',
      'Agenda',
      'Tabela',
    ])
    await cartoes.nth(0).click()
    await expect(page).toHaveURL(new RegExp(`/pedidos/${ID_PEDIDO}/orcar$`))
    expect(csp).toEqual([])
  })

  test('orçar: quantidades com preços travados, total ao vivo do servidor e envio confirmado', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, {
      detalhes: [pedidoSolicitadoMotorista()],
      respostas: { enviar_orcamento: [{ ok: false, codigo: 'PRAZO_VENCIDO' }] },
    })
    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await page.getByRole('link', { name: 'Orçar este pedido' }).click()

    await expect(page.getByText('Orçar · Umi San')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedido #0042' })).toBeVisible()
    await expect(page.getByTestId('contagem')).toHaveText(/^Responder em (4|5) h/)
    await expect(page.getByTestId('precos-travados')).toHaveText('Preços do contrato Umi San — não editáveis')
    const quantidades = page.getByTestId('quantidades')
    await expect(quantidades.getByRole('group', { name: 'Km rodados' })).toContainText(/× R\$\s3,50\/km/)
    await expect(quantidades).toContainText('Trecho único: o servidor soma o retorno de 50% sobre os km.')
    // Nenhum campo de preço unitário editável.
    await expect(page.getByRole('textbox', { name: /preço|unitário/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enviar orçamento' })).toBeDisabled()

    // Km: digitado e em passos de 0,1.
    await page.getByRole('textbox', { name: 'Quilometragem' }).fill('120')
    await page.getByRole('button', { name: 'Aumentar km rodados' }).click()
    await expect(page.getByRole('textbox', { name: 'Quilometragem' })).toHaveValue('120,1')
    await page.getByRole('button', { name: 'Diminuir km rodados' }).click()
    await page.getByRole('button', { name: 'Aumentar espera' }).click()
    await page.getByRole('button', { name: 'Aumentar espera' }).click()
    await expect(page.getByRole('group', { name: 'Espera' })).toContainText('1 h')
    await page.getByLabel('Pedágio/balsa').fill('35,80')
    const total = page.getByTestId('total-ao-vivo')
    await expect(total).toContainText(/R\$\s495,80/)
    await expect(page.getByTestId('previa').getByTestId('memorial').getByRole('listitem')).toHaveCount(3)

    // Reboque troca o preço do km (vem do servidor).
    await page.getByRole('switch', { name: 'Usa reboque' }).click()
    await expect(quantidades.getByRole('group', { name: 'Km rodados' })).toContainText(/× R\$\s5,20\/km/)
    await expect(total).toContainText(/R\$\s849,80/)

    // Outros com descrição.
    await page.getByRole('button', { name: 'Adicionar outro custo' }).click()
    await page.getByLabel('Descrição 1').fill('Balsa extra')
    await page.getByLabel('Valor 1').fill('20')
    await expect(total).toContainText(/R\$\s869,80/)

    // Debounce: só a última combinação conta; nenhuma prévia leva preço.
    const previas = chamadas.filter((c) => c.rpc === 'calcular_orcamento')
    expect(previas.length).toBeLessThan(12)
    for (const c of previas) expect(JSON.stringify(c.corpo)).not.toMatch(/_cent":\s*\d+.*unit|km_sem|preco/)
    const ultima = previas.at(-1)!.corpo
    expect(ultima).toEqual({
      p_atividade: ID_PEDIDO,
      p: {
        modalidade: 'VEICULO_PROPRIO',
        km: 120,
        usa_reboque: true,
        espera_horas: 1,
        pedagio_cent: 3580,
        hospedagem_diarias: 0,
        outros: [{ descricao: 'Balsa extra', valor_cent: 2000 }],
      },
    })

    // Enviar: erro do servidor fica na tela; depois confirma e volta ao pedido.
    await page.getByRole('button', { name: 'Enviar orçamento' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'O prazo deste pedido venceu.' })).toBeVisible()
    await page.getByRole('button', { name: 'Enviar orçamento' }).click()
    await expect(page).toHaveURL(new RegExp(`/pedidos/${ID_PEDIDO}$`))
    await expect(page.getByRole('status').filter({ hasText: 'Orçamento enviado.' })).toBeVisible()
    const envio = chamadas.filter((c) => c.rpc === 'enviar_orcamento').at(-1)!.corpo
    expect(envio).toEqual({ p_atividade: ID_PEDIDO, p: ultima.p, p_horario_sugerido: null })
    expect(csp).toEqual([])
  })

  test('orçar após revisão: pré-preenchido com o orçamento anterior e o motivo do cliente', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    const entrada = {
      modalidade: 'VEICULO_PROPRIO',
      km: 100,
      usa_reboque: false,
      espera_horas: 0,
      pedagio_cent: 3580,
      hospedagem_diarias: 0,
      outros: [{ descricao: 'Balsa extra', valor_cent: 2000 }],
    }
    const chamadas = await simularPedidos(page, {
      detalhes: [
        {
          ...pedidoSolicitadoMotorista(),
          orcamento_anterior: {
            versao: 1,
            modalidade: 'VEICULO_PROPRIO',
            entrada,
            linhas: [],
            total_cent: 41080,
            motivo_revisao: '<b>A distância real é 80 km</b>',
          },
        },
      ],
    })
    await page.goto(`/pedidos/${ID_PEDIDO}/orcar`)
    const revisao = page.getByTestId('revisao-pedida')
    await expect(revisao.getByRole('status')).toContainText('Revisão pedida: <b>A distância real é 80 km</b>')
    await expect(revisao).toContainText(/Preenchido com a versão 1 \(R\$\s410,80\)/)
    await expect(page.getByRole('textbox', { name: 'Quilometragem' })).toHaveValue('100')
    await expect(page.getByLabel('Pedágio/balsa')).toHaveValue('35,80')
    await expect(page.getByLabel('Descrição 1')).toHaveValue('Balsa extra')
    await expect(page.getByTestId('total-ao-vivo')).toContainText(/R\$\s405,80/)
    expect(chamadas.filter((c) => c.rpc === 'calcular_orcamento').at(-1)!.corpo).toEqual({ p_atividade: ID_PEDIDO, p: entrada })
    // O motorista ajusta só o km pedido pelo cliente.
    await page.getByRole('textbox', { name: 'Quilometragem' }).fill('80')
    await expect(page.getByTestId('total-ao-vivo')).toContainText(/R\$\s335,80/)
    expect(csp).toEqual([])
  })

  test('orçar: modalidade veículo do cliente troca os campos; recusar exige motivo', async ({ page }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    const chamadas = await simularPedidos(page, { detalhes: [pedidoSolicitadoMotorista()] })
    await page.goto(`/pedidos/${ID_PEDIDO}/orcar`)
    await page.getByRole('radio', { name: 'Veículo do cliente' }).click()
    await expect(page.getByRole('textbox', { name: 'Quilometragem' })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Usa reboque' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Diárias do motorista' })).toContainText(/× R\$\s450,00\/diária/)
    await expect(page.getByTestId('total-ao-vivo')).toContainText(/R\$\s450,00/)
    const ultima = chamadas.filter((c) => c.rpc === 'calcular_orcamento').at(-1)!.corpo.p as Record<string, unknown>
    expect(Object.keys(ultima).sort()).toEqual(['diarias', 'hospedagem_diarias', 'modalidade', 'pedagio_cent'])

    await page.getByRole('button', { name: 'Recusar pedido' }).click()
    const folha = page.getByRole('dialog', { name: 'Recusar pedido' })
    await folha.getByRole('button', { name: 'Recusar pedido' }).click()
    expect(chamadas.map((c) => c.rpc)).not.toContain('recusar_pedido')
    await folha.getByLabel('Motivo').fill('Sem disponibilidade de reboque')
    await folha.getByRole('button', { name: 'Recusar pedido' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pedido recusado.' })).toBeVisible()
    expect(chamadas.find((c) => c.rpc === 'recusar_pedido')?.corpo).toEqual({
      p_atividade: ID_PEDIDO,
      p_motivo: 'Sem disponibilidade de reboque',
    })
  })

  test('orçar: pedido que não aguarda orçamento e cliente que força a rota', async ({ page, browser }) => {
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularPedidos(page, { detalhes: [{ ...pedidoOrcadoCliente(), acoes: { orcar: false } }] })
    await page.goto(`/pedidos/${ID_PEDIDO}/orcar`)
    await expect(page.getByText('Este pedido não está aguardando orçamento')).toBeVisible()

    const contexto = await browser.newContext({ ...test.info().project.use })
    try {
      const cliente = await contexto.newPage()
      await comSessaoFalsa(cliente, { papel: 'CLIENTE', nivel: 1 })
      await simularApi(cliente)
      await cliente.goto(`/pedidos/${ID_PEDIDO}/orcar`)
      await esperarInicioComAviso(cliente)
    } finally {
      await contexto.close()
    }
  })

  test('agenda da equipe: blocos de todas as empresas com detalhes', async ({ page }) => {
    const csp = await vigiarCsp(page)
    await comSessaoFalsa(page, MOTORISTA, AAL2)
    await simularApi(page)
    await simularPedidos(page, { equipe: true })
    await page.goto('/agenda')
    await escolherDiaNaAgenda(page, DIA_PEDIDO)
    const dia = page.getByTestId('agenda-dia')
    await expect(dia.getByTestId('bloco-proprio')).toHaveCount(2)
    await expect(dia.getByTestId('bloco-proprio').nth(0)).toContainText(/Pedido #0042.*Umi San/)
    await expect(dia.getByTestId('bloco-proprio').nth(1)).toContainText(/Pedido #0007.*Porto Azul/)
    await expect(dia.getByTestId('bloco-ocupado')).toHaveCount(0)
    // Janelas livres aparecem, mas só o cliente pede por elas.
    await expect(dia.getByTestId('janela-livre').first()).toBeVisible()
    await expect(dia.getByRole('link', { name: /fazer pedido/ })).toHaveCount(0)
    expect(csp).toEqual([])
  })
})

test.describe('ADM e gestor de frota', () => {
  test('ADM: lista de pedidos com a empresa; pode orçar', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }, AAL2)
    await simularApi(page)
    await simularPedidos(page, {
      lista: [itemLista({ empresa_nome: EMPRESA_UMI.nome, status: 'SOLICITADA', total_cent: null })],
    })
    await page.goto('/pedidos')
    await expect(page.getByTestId('lista-pedidos').getByRole('listitem')).toContainText('Pedido #0042 · Umi San')
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)
  })

  test('gestor de frota: início com a agenda da frota e pendências sem valores', async ({ page }) => {
    await comSessaoFalsa(page, { papel: 'GESTOR_FROTA', nome: 'Gil Frota', tem_2fa: true }, AAL2)
    await simularApi(page)
    await simularPedidos(page, {
      pendencias: { aguardando_orcamento: [pendenciaFalsa({ empresa_nome: 'Umi San' })] },
    })
    await page.goto('/')
    await expect(page.getByTestId('atalho-agenda')).toContainText('Agenda da frota')
    await expect(page.getByTestId('grupo-acompanhar')).toContainText('Pedido #0042 · Umi San')
    expect(await page.locator('main').innerText()).not.toMatch(/R\$/)
    await page.getByTestId('atalho-agenda').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  })
})
