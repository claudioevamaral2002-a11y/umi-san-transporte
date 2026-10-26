// Crédito ao criar pedido (decisão do dono): sem crédito nenhum (disponível + limite ≤ 0) → "Novo pedido"
// indisponível com explicação em todas as entradas; abaixo do alerta → pode pedir, com aviso na revisão.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { saldoFalso } from './apoio/dinheiroFalso.ts'
import { DIA_PEDIDO, ID_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { escolherDiaNaAgenda, escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const CLIENTE_N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }
const SEM_CREDITO = 'Sua empresa está sem crédito. Fale com a IVO Transportes para recarregar.'

async function comSaldo(page: Page, saldo: Record<string, unknown>) {
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/saldo_empresa`, (route) => json(route, saldoFalso(saldo)))
}

test.describe('crédito ao criar pedido', () => {
  test('sem crédito: Início, Pedidos, Agenda e /pedidos/novo explicam e não deixam pedir', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    const chamadas = await simularPedidos(page)
    // Disponível −1.000,00 com limite de 1.000,00: nada de crédito.
    await comSaldo(page, { saldo_contabil_cent: -100000, reservado_cent: 0, disponivel_cent: -100000, abaixo_alerta: true })

    await page.goto('/')
    const bloco = page.getByTestId('novo-pedido-indisponivel')
    await expect(bloco.getByRole('button', { name: 'Novo pedido' })).toBeDisabled()
    await expect(bloco).toContainText(SEM_CREDITO)
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)

    await page.goto('/pedidos')
    await expect(page.getByTestId('novo-pedido-indisponivel')).toContainText(SEM_CREDITO)
    await expect(page.getByRole('link', { name: 'Novo pedido' })).toHaveCount(0)

    await page.goto('/agenda')
    await expect(page.getByTestId('agenda-pedido-indisponivel')).toHaveText(SEM_CREDITO)
    await escolherDiaNaAgenda(page, DIA_PEDIDO)
    await expect(page.getByTestId('janela-livre').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /fazer pedido neste horário/ })).toHaveCount(0)

    await page.goto('/pedidos/novo')
    await expect(page.getByTestId('novo-pedido-sem-credito')).toContainText(SEM_CREDITO)
    await expect(page.getByTestId('faixa-dias')).toHaveCount(0)
    expect(chamadas.map((c) => c.rpc)).not.toContain('criar_pedido')
  })

  test('saldo baixo (abaixo do alerta): pede normalmente, com aviso e o disponível na revisão', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page)
    await comSaldo(page, { saldo_contabil_cent: 12345, reservado_cent: 0, disponivel_cent: 12345, abaixo_alerta: true })

    await page.goto('/')
    await page.getByRole('link', { name: 'Novo pedido' }).first().click()
    await escolherDiaNoPedido(page, DIA_PEDIDO)
    await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByLabel('Origem').fill('Porto de Itajaí')
    await page.getByLabel('Destino').fill('Base Navegantes')
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'O que vamos levar?' })).toBeVisible()
    // Sem aviso antes da revisão.
    await expect(page.getByTestId('aviso-saldo-baixo')).toHaveCount(0)
    await page.getByRole('button', { name: 'Revisar' }).click()
    const aviso = page.getByTestId('aviso-saldo-baixo')
    await expect(aviso).toContainText('Saldo baixo.')
    await expect(aviso).toContainText(/R\$\s?123,45/)
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByTestId('pedido-enviado')).toBeVisible()
  })

  test('saldo acima do alerta: sem aviso na revisão', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page)
    await page.goto('/pedidos/novo')
    await escolherDiaNoPedido(page, DIA_PEDIDO)
    await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByLabel('Origem').fill('Porto de Itajaí')
    await page.getByLabel('Destino').fill('Base Navegantes')
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByTestId('resumo-pedido')).toBeVisible()
    await expect(page.getByTestId('aviso-saldo-baixo')).toHaveCount(0)
  })

  test('o banco recusa com SEM_CREDITO no envio (crédito acabou no meio do pedido): mensagem clara', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page, { respostas: { criar_pedido: [{ ok: false, codigo: 'SEM_CREDITO' }] } })
    await page.goto('/pedidos/novo')
    await escolherDiaNoPedido(page, DIA_PEDIDO)
    await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByLabel('Origem').fill('Porto de Itajaí')
    await page.getByLabel('Destino').fill('Base Navegantes')
    await page.getByRole('checkbox', { name: 'Levar' }).check()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('button', { name: 'Revisar' }).click()
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByRole('alert').filter({ hasText: SEM_CREDITO })).toBeVisible()
    await expect(page.getByTestId('pedido-enviado')).toHaveCount(0)
  })

  test('v2.1, Faturado (NF): o saldo negativo não bloqueia o pedido e o recibo da aprovação não mostra saldo nem falta', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N2)
    await simularApi(page)
    await simularPedidos(page)
    // O banco, no Faturado: limite e alerta zerados e o disponível negativo (o valor devido).
    await comSaldo(page, {
      forma_cobranca: 'FATURADO',
      saldo_contabil_cent: -450000,
      reservado_cent: 0,
      disponivel_cent: -450000,
      limite_cent: 0,
      alerta_cent: 0,
      abaixo_alerta: false,
    })

    await page.goto('/')
    await expect(page.getByTestId('novo-pedido-indisponivel')).toHaveCount(0)
    await expect(page.getByText(SEM_CREDITO)).toHaveCount(0)

    await page.goto(`/pedidos/${ID_PEDIDO}`)
    await page.getByRole('button', { name: 'Aprovar' }).click()
    const recibo = page.getByRole('dialog', { name: 'Recibo da aprovação' })
    await expect(recibo.getByTestId('recibo-faturado')).toHaveText('Será cobrada na fatura da quinzena (NF)')
    await expect(recibo.getByTestId('recibo-saldo')).toHaveCount(0)
    await expect(recibo).not.toContainText('faltariam')
  })
})
