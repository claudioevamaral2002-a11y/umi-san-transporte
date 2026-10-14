import { randomUUID } from 'node:crypto'
import { devices, expect, test, type Page } from '@playwright/test'
import {
  CONTRATO_TESTE,
  ORIGEM_APP,
  comBanco,
  criarPessoa,
  empresaComContrato,
  empresaNova,
  entrarComDoisFatores,
  entrarComSenha,
} from './apoio.ts'
import { escolherDiaNoPedido } from '../apoio/escolherDia.ts'

// Fase 2A contra o Supabase real do CI: cliente cria o pedido → motorista orça pela calculadora → cliente vê o
// memorial e pede revisão → motorista reenvia → cliente reprova. Status chegam por tempo real (sem recarregar).
// Contrato de teste (CONTRATO_TESTE): km R$ 2,50, retorno em trecho único 50%.

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const diaSp = (n: number) => FORMATO_DIA.format(new Date(Date.now() + n * 86_400_000))

/** Novo pedido (redesign): espera a faixa de dias carregar do banco real e escolhe o dia (faixa ou mês inteiro). */
async function escolherDia(page: Page, dia: string) {
  await expect(page.getByTestId('faixa-dias').locator('[data-dia]').first()).toBeVisible({ timeout: 20_000 })
  await escolherDiaNoPedido(page, dia)
}

test.describe('pedido e orçamento (fase 2A)', () => {
  test.setTimeout(300_000)

  test('cliente cria → motorista orça → cliente pede revisão → motorista reenvia → cliente reprova', async ({ page, browser }) => {
    // O motorista deste teste passa a ser o que atende pedidos novos (o ativo mais antigo), sem desativar os de
    // outros testes que podem rodar em paralelo.
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Mauro Orçamento' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '30 years' where usuario_id = $1`, [motorista.id]),
    )
    const empresa = await empresaComContrato()
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Carla Pedido' })

    // 1. Cliente cria o pedido em 4 passos.
    await entrarComSenha(page, cliente.email, cliente.senha)
    await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Carla$/ })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Novo pedido' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Quando?' })).toBeVisible()
    await escolherDia(page, diaSp(12))
    const primeiro = page.getByTestId('horarios-livres').getByRole('radio').first()
    await expect(primeiro).toBeVisible({ timeout: 20_000 })
    await primeiro.click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByLabel('Origem').fill('Porto de Itajaí, berço 3')
    await page.getByLabel('Destino').fill('Base Navegantes')
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByTestId('aviso-prazo')).toContainText('em até 12 horas')
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByTestId('pedido-enviado')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Acompanhar pedido' }).click()
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/)
    const id = /\/pedidos\/([0-9a-f-]{36})$/.exec(page.url())![1]!
    await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Solicitado')

    const contexto = await browser.newContext({ ...devices['Pixel 7'], baseURL: ORIGEM_APP })
    try {
      const pm = await contexto.newPage()
      // 2. Motorista vê a pendência e orça pela calculadora.
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      const pendencia = pm.getByTestId('pendencia-orcar').filter({ hasText: 'Porto de Itajaí, berço 3' })
      await expect(pendencia).toBeVisible({ timeout: 20_000 })
      await pendencia.click()
      await expect(pm).toHaveURL(new RegExp(`/pedidos/${id}/orcar$`))
      await pm.getByRole('textbox', { name: 'Quilometragem' }).fill('100')
      // 100 km × R$ 2,50 = R$ 250,00 + retorno 50% (trecho único) = R$ 375,00, calculado no servidor.
      await expect(pm.getByTestId('total-ao-vivo')).toContainText(/R\$\s375,00/, { timeout: 20_000 })
      await expect(pm.getByTestId('previa')).toContainText('Retorno (50%)')
      await pm.getByRole('button', { name: 'Enviar orçamento' }).click()
      await expect(pm).toHaveURL(new RegExp(`/pedidos/${id}$`), { timeout: 20_000 })
      await expect(pm.getByText('Orçamento enviado. O cliente já pode ver o memorial.')).toBeVisible()

      // 3. Cliente (mesma tela aberta): o orçamento chega por tempo real, com memorial e regras.
      const orcamento = page.getByTestId('orcamento-recebido')
      await expect(orcamento).toBeVisible({ timeout: 30_000 })
      await expect(orcamento).toContainText(/R\$\s375,00/)
      await expect(orcamento.getByTestId('memorial')).toContainText('Km rodados (trecho único)')
      await expect(orcamento.getByTestId('memorial')).toContainText('Retorno (50%)')
      await expect(orcamento.getByTestId('faixas-cancelamento').getByRole('listitem')).toHaveText([
        '24 h ou mais antes: sem multa',
        'Menos de 24 h antes: multa de 100%',
      ])
      await expect(orcamento.getByRole('button', { name: 'Aprovar' })).toBeEnabled()
      await orcamento.getByRole('button', { name: 'Pedir revisão' }).click()
      const folha = page.getByRole('dialog', { name: 'Pedir revisão' })
      await folha.getByLabel('O que precisa mudar?').fill('A distância real é 80 km')
      await folha.getByRole('button', { name: 'Pedir revisão' }).click()
      await expect(page.getByText('Revisão pedida. O motorista vai enviar um novo orçamento.')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('orcamento-recebido')).toHaveCount(0)

      // 4. Motorista reenvia (o pedido voltou a aguardar orçamento): a calculadora vem com o orçamento anterior e o
      //    motivo do cliente.
      await pm.goto(`/pedidos/${id}/orcar`)
      await expect(pm.getByTestId('revisao-pedida')).toContainText('Revisão pedida: A distância real é 80 km', { timeout: 20_000 })
      await expect(pm.getByRole('textbox', { name: 'Quilometragem' })).toHaveValue('100')
      await expect(pm.getByTestId('total-ao-vivo')).toContainText(/R\$\s375,00/, { timeout: 20_000 })
      await pm.getByRole('textbox', { name: 'Quilometragem' }).fill('80')
      await expect(pm.getByTestId('total-ao-vivo')).toContainText(/R\$\s300,00/, { timeout: 20_000 })
      await pm.getByRole('button', { name: 'Enviar orçamento' }).click()
      await expect(pm).toHaveURL(new RegExp(`/pedidos/${id}$`), { timeout: 20_000 })

      // 5. Cliente vê a versão 2 e reprova.
      await expect(orcamento).toBeVisible({ timeout: 30_000 })
      await expect(orcamento).toContainText('versão 2')
      await expect(orcamento).toContainText(/R\$\s300,00/)
      await orcamento.getByRole('button', { name: 'Reprovar' }).click()
      const reprovar = page.getByRole('dialog', { name: 'Reprovar orçamento' })
      await reprovar.getByLabel('Motivo (opcional)').fill('Fechamos com outro horário')
      await reprovar.getByRole('button', { name: 'Reprovar orçamento' }).click()
      await expect(page.getByText('Orçamento reprovado. O pedido foi encerrado.')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Reprovada').first()).toBeVisible()
      await expect(page.getByTestId('historico-pedido')).toContainText('Fechamos com outro horário')

      // O motorista também vê o encerramento (tempo real) e não pode mais orçar.
      await expect(pm.getByText('Reprovada').first()).toBeVisible({ timeout: 30_000 })
      await expect(pm.getByRole('link', { name: 'Orçar este pedido' })).toHaveCount(0)
    } finally {
      await contexto.close()
    }
  })
})

// Fase 2B contra o Supabase real do CI: ADM recarrega pela tela → cliente cria → motorista orça → cliente aprova
// (saldo reservado) → cliente cancela o agendamento com multa → extrato com RESERVA, LIBERAÇÃO e MULTA → painel do ADM.
// Contrato próprio: multa de 50% com menos de 720 h (30 dias) de antecedência, para o pedido de daqui a 12 dias pagar.
// Fica neste arquivo de propósito: os testes de um arquivo rodam em sequência, e os dois disputam o "motorista ativo
// mais antigo" (o que recebe pedidos novos).
test.describe('saldo, aprovação e cancelamento com multa (fase 2B)', () => {
  test.setTimeout(360_000)

  test('ADM recarrega → cliente aprova (reserva) → cliente cancela com multa → extrato e painel', async ({ page, browser }) => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Mauro Saldo' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '31 years' where usuario_id = $1`, [motorista.id]),
    )
    const nomeEmpresa = `Empresa Saldo ${randomUUID().slice(0, 6)}`
    const empresa = await empresaNova(nomeEmpresa)
    await comBanco((db) =>
      db.query(`select interno.inserir_contrato($1, $2::jsonb, now() - interval '1 minute', null, 'Teste')`, [
        empresa,
        JSON.stringify({
          ...CONTRATO_TESTE,
          faixas_cancelamento: [
            { antecedencia_min_horas: 720, multa_bp: 0 },
            { antecedencia_min_horas: 0, multa_bp: 5000 },
          ],
        }),
      ]),
    )
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Clara Saldo' })
    const adm = await criarPessoa({ papel: 'ADM', nome: 'Admin Saldo' })

    const contextoAdm = await browser.newContext({ ...devices['Pixel 7'], baseURL: ORIGEM_APP })
    const contextoMot = await browser.newContext({ ...devices['Pixel 7'], baseURL: ORIGEM_APP })
    try {
      // 1. ADM recarrega R$ 1.000,00 pela tela (confirmação com os valores antes de lançar).
      const pa = await contextoAdm.newPage()
      await entrarComDoisFatores(pa, adm.email, adm.senha, adm.segredoTotp!)
      await pa.goto('/adm/creditos')
      await pa.getByTestId('credito-empresa').filter({ hasText: nomeEmpresa }).click()
      await expect(pa.getByRole('heading', { level: 1, name: nomeEmpresa })).toBeVisible({ timeout: 20_000 })
      await pa.getByRole('button', { name: 'Recarga' }).click()
      const recarga = pa.getByRole('dialog', { name: 'Recarga' })
      await recarga.getByLabel('Valor').fill('1.000,00')
      await recarga.getByLabel('Motivo').fill('Pix de teste E2E')
      await recarga.getByLabel('Comprovante (opcional)').fill('E2E-PIX-1')
      await recarga.getByRole('button', { name: 'Revisar' }).click()
      await expect(recarga.getByTestId('confirmar-disponivel')).toHaveText(/R\$\s0,00 para R\$\s1\.000,00/)
      await recarga.getByRole('button', { name: 'Confirmar recarga' }).click()
      await expect(pa.getByRole('status').filter({ hasText: 'Recarga lançada' })).toContainText(
        /Disponível agora: R\$\s1\.000,00/,
        { timeout: 20_000 },
      )

      // 2. Cliente vê o saldo e cria o pedido.
      await entrarComSenha(page, cliente.email, cliente.senha)
      await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Clara$/ })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('saldo-disponivel')).toContainText(/R\$\s1\.000,00/, { timeout: 20_000 })
      await page.getByRole('link', { name: 'Novo pedido' }).first().click()
      await escolherDia(page, diaSp(12))
      const primeiro = page.getByTestId('horarios-livres').getByRole('radio').first()
      await expect(primeiro).toBeVisible({ timeout: 20_000 })
      await primeiro.click()
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByLabel('Origem').fill('Porto de Itajaí, berço 7')
      await page.getByLabel('Destino').fill('Base Navegantes')
      await page.getByRole('checkbox', { name: 'Levar' }).check()
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByRole('button', { name: 'Revisar' }).click()
      await page.getByRole('button', { name: 'Enviar pedido' }).click()
      await expect(page.getByTestId('pedido-enviado')).toBeVisible({ timeout: 30_000 })
      await page.getByRole('link', { name: 'Acompanhar pedido' }).click()
      await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/)
      const id = /\/pedidos\/([0-9a-f-]{36})$/.exec(page.url())![1]!

      // 3. Motorista orça: 100 km → R$ 375,00.
      const pm = await contextoMot.newPage()
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto(`/pedidos/${id}/orcar`)
      await pm.getByRole('textbox', { name: 'Quilometragem' }).fill('100')
      await expect(pm.getByTestId('total-ao-vivo')).toContainText(/R\$\s375,00/, { timeout: 20_000 })
      await pm.getByRole('button', { name: 'Enviar orçamento' }).click()
      await expect(pm).toHaveURL(new RegExp(`/pedidos/${id}$`), { timeout: 20_000 })

      // 4. Cliente aprova pelo recibo: disponível agora e depois; o resultado só vem do servidor.
      const orcamento = page.getByTestId('orcamento-recebido')
      await expect(orcamento).toBeVisible({ timeout: 30_000 })
      await orcamento.getByRole('button', { name: 'Aprovar' }).click()
      const recibo = page.getByRole('dialog', { name: 'Recibo da aprovação' })
      await expect(recibo.getByTestId('recibo-saldo')).toContainText(/Disponível agora\s*R\$\s1\.000,00/, { timeout: 20_000 })
      await expect(recibo.getByTestId('recibo-saldo-depois')).toHaveText(/R\$\s625,00/)
      await recibo.getByRole('button', { name: 'Confirmar aprovação' }).click()
      const card = page.getByTestId('cartao-agendado')
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(card.getByTestId('agendado-reservado')).toHaveText(/R\$\s375,00/)
      await expect(card.getByTestId('agendado-disponivel')).toHaveText(/R\$\s625,00/)
      await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Agendado', {
        timeout: 20_000,
      })

      // Saldo reservado no Início.
      await page.goto('/')
      await expect(page.getByTestId('saldo-reservado')).toHaveText(/R\$\s375,00/, { timeout: 20_000 })
      await expect(page.getByTestId('saldo-contabil')).toHaveText(/R\$\s1\.000,00/)

      // 5. Cliente cancela o agendamento: a multa aparece antes de confirmar.
      await page.goto(`/pedidos/${id}`)
      await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
      const cancelar = page.getByRole('dialog', { name: 'Cancelar agendamento' })
      await expect(cancelar.getByTestId('previa-multa')).toContainText(
        /Cancelando agora: multa de R\$\s187,50 \(50% — menos de 720 h antes\)/,
        { timeout: 20_000 },
      )
      await cancelar.getByRole('button', { name: 'Confirmar cancelamento' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado.' })).toHaveText(
        /Liberado: R\$\s375,00\. Multa: R\$\s187,50\./,
        { timeout: 30_000 },
      )

      // 6. Extrato: recarga, reserva, liberação e multa.
      await page.goto('/extrato')
      const itens = page.getByTestId('lista-extrato').getByTestId('item-extrato')
      await expect(itens).toHaveCount(4, { timeout: 20_000 })
      await expect(itens.nth(0)).toContainText('Multa de cancelamento')
      await expect(itens.nth(0)).toContainText(/− R\$\s187,50/)
      await expect(itens.filter({ hasText: 'Liberação de reserva' })).toContainText(/\+ R\$\s375,00/)
      await expect(itens.filter({ hasText: 'Reservado' })).toContainText(/− R\$\s375,00/)
      await expect(itens.filter({ hasText: 'Recarga' })).toContainText(/\+ R\$\s1\.000,00/)
      await expect(page.getByTestId('saldo-disponivel')).toContainText(/R\$\s812,50/)

      // 7. Painel do ADM: o crédito da empresa já reflete a multa.
      await pa.goto('/adm/painel')
      const linha = pa.getByTestId('painel-credito').getByRole('listitem').filter({ hasText: nomeEmpresa })
      await expect(linha).toContainText(/R\$\s812,50/, { timeout: 20_000 })
      await expect(pa.getByTestId('painel-aprovado-total')).toBeVisible()
    } finally {
      await contextoAdm.close()
      await contextoMot.close()
    }
  })
})
