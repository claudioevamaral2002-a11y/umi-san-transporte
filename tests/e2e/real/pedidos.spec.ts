import { devices, expect, test, type Page } from '@playwright/test'
import {
  ORIGEM_APP,
  comBanco,
  criarPessoa,
  empresaComContrato,
  entrarComDoisFatores,
  entrarComSenha,
} from './apoio.ts'

// Fase 2A contra o Supabase real do CI: cliente cria o pedido → motorista orça pela calculadora → cliente vê o
// memorial e pede revisão → motorista reenvia → cliente reprova. Status chegam por tempo real (sem recarregar).
// Contrato de teste (CONTRATO_TESTE): km R$ 2,50, retorno em trecho único 50%.

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const diaSp = (n: number) => FORMATO_DIA.format(new Date(Date.now() + n * 86_400_000))

async function escolherDia(page: Page, dia: string) {
  const calendario = page.getByTestId('calendario')
  await expect(calendario.locator('[data-dia]').first()).toBeVisible({ timeout: 20_000 })
  const botao = calendario.locator(`[data-dia="${dia}"]`)
  if ((await botao.count()) === 0) await calendario.getByRole('button', { name: 'Próximo mês' }).click()
  await botao.click()
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
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
    await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible({ timeout: 30_000 })
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
      await expect(orcamento.getByRole('button', { name: 'Aprovar' })).toBeDisabled()
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
