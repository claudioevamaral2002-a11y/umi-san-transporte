// Capturas do redesign mobile (claro e escuro) para o dono conferir. Só roda com CAPTURAS=1.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { escolherDiaNaAgenda, escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { EMPRESA_PORTO, EMPRESA_UMI } from './apoio/apiFalsa.ts'
import { saldoFalso, simularDinheiro } from './apoio/dinheiroFalso.ts'
import {
  DIA_PEDIDO,
  ID_PEDIDO,
  pedidoOrcadoCliente,
  pedidoSolicitadoMotorista,
  pendenciaFalsa,
  simularPedidos,
} from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'
import { simularBlocosDoMapa, simularMapas, simularPrevia } from './apoio/mapasFalsos.ts'

const PASTA = process.env.PASTA_CAPTURAS ?? 'test-results/capturas-redesign'
const CLIENTE = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }

test.skip(!process.env.CAPTURAS, 'só sob demanda')
test.beforeEach(async ({ page }) => page.emulateMedia({ reducedMotion: 'reduce' }))

for (const tema of ['light', 'dark'] as const) {
  const sufixo = tema === 'light' ? 'claro' : 'escuro'
  const foto = (page: Page, nome: string) => page.screenshot({ path: `${PASTA}/${nome}-${sufixo}.png`, fullPage: true })

  test.describe(`capturas ${sufixo}`, () => {
    test.use({ colorScheme: tema })

    test('início e pedido', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularDinheiro(page, { saldos: [saldoFalso()] })
      await simularPedidos(page, {
        detalhes: [pedidoOrcadoCliente()],
        pendencias: {
          aguardando_aprovacao: [pendenciaFalsa({ status: 'ORCADA', prazo: new Date(Date.now() + 20 * 3600_000).toISOString(), total_cent: 185000 })],
          proximos: [pendenciaFalsa({ id: 'p', numero: 36, status: 'AGENDADA' })],
        },
      })
      await page.goto('/')
      await expect(page.getByTestId('cartao-saldo')).toBeVisible()
      await foto(page, '01-inicio-cliente')
      await page.goto('/pedidos')
      await expect(page.getByTestId('lista-pedidos')).toBeVisible()
      await foto(page, '06-pedidos')
      await page.goto(`/pedidos/${ID_PEDIDO}`)
      await expect(page.getByTestId('orcamento-recebido')).toBeVisible()
      await foto(page, '07-pedido-detalhe')
    })

    test('entrada e 2FA', async ({ page }) => {
      await comSessaoFalsa(page, { papel: 'ADM', tem_2fa: true }, { semSessaoInicial: true })
      await simularApi(page)
      await page.goto('/entrar')
      await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
      await foto(page, '11-entrar')
    })

    test('2FA', async ({ page }) => {
      await comSessaoFalsa(page, { papel: 'ADM', tem_2fa: true }, { aal: 'aal1' })
      await simularApi(page)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible()
      await foto(page, '12-2fa')
    })

    test('extrato', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularDinheiro(page)
      await page.goto('/extrato')
      await expect(page.getByTestId('lista-extrato')).toBeVisible()
      await foto(page, '13-extrato')
    })

    test('motorista: início e orçar', async ({ page }) => {
      await comSessaoFalsa(page, { papel: 'MOTORISTA', nome: 'João Reis', tem_2fa: true }, { aal: 'aal2' })
      await simularApi(page)
      await simularPedidos(page, {
        detalhes: [pedidoSolicitadoMotorista()],
        pendencias: { aguardando_orcamento: [pendenciaFalsa({ urgente: true })] },
      })
      await page.goto('/')
      await expect(page.getByTestId('pendencia-orcar')).toBeVisible()
      await foto(page, '02-inicio-motorista')
      await page.goto(`/pedidos/${ID_PEDIDO}/orcar`)
      await expect(page.getByTestId('total-ao-vivo')).toBeVisible()
      await foto(page, '14-orcar')
    })

    test('ADM: início, créditos e painel', async ({ page }) => {
      await comSessaoFalsa(page, { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }, { aal: 'aal2' })
      await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
      await simularDinheiro(page, { saldos: [saldoFalso()] })
      await simularPedidos(page)
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await foto(page, '03-inicio-adm')
      await page.goto('/adm/creditos')
      await expect(page.getByTestId('credito-empresa').first()).toBeVisible()
      await foto(page, '15-creditos')
      await page.goto('/adm/painel')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await foto(page, '16-painel')
    })

    test('novo pedido', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularPedidos(page)
      await page.goto('/pedidos/novo')
      await escolherDiaNoPedido(page, DIA_PEDIDO)
      await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
      await expect(page.getByTestId('frase-quando')).toBeVisible()
      await foto(page, '05-novo-pedido-quando')
    })

    test('fase 3A: endereços, mapa, prévia e orçar com km', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularPedidos(page)
      await simularMapas(page)
      await simularPrevia(page)
      await simularBlocosDoMapa(page)
      await page.goto('/pedidos/novo')
      await escolherDiaNoPedido(page, DIA_PEDIDO)
      await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).click()
      await page.getByRole('button', { name: 'Continuar' }).click()
      const origem = page.getByRole('combobox', { name: 'Origem' })
      await origem.fill('porto')
      await page.getByRole('option', { name: /Porto de Itajaí/ }).click()
      const destino = page.getByRole('combobox', { name: 'Destino' })
      await destino.fill('estaleiro nav')
      await expect(page.getByRole('option', { name: /Estaleiro Navship/ })).toBeVisible()
      await foto(page, '20-onde-sugestoes')
      await page.getByRole('option', { name: 'Não achou? Marcar no mapa' }).click()
      const folha = page.getByRole('dialog', { name: 'Marcar no mapa' })
      await expect(folha.getByTestId('mapa')).toHaveAttribute('data-pronto', 'sim')
      await folha.getByLabel('Nome do local').fill('Marina Itajaí, rampa 2')
      await page.screenshot({ path: `${PASTA}/21-marcar-no-mapa-${sufixo}.png` })
      await folha.getByRole('button', { name: 'Fechar' }).click()
      await destino.fill('estaleiro nav')
      await page.getByRole('option', { name: /Estaleiro Navegantes/ }).click()
      await expect(page.getByTestId('rota-estimada')).toBeVisible()
      await page.getByRole('checkbox', { name: 'Levar' }).check()
      await foto(page, '22-onde-rota')
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByRole('radio', { name: 'Sim' }).click()
      await page.getByRole('button', { name: 'Revisar' }).click()
      await expect(page.getByTestId('previa-orcamento')).toBeVisible()
      await foto(page, '23-confira-previa')
      await page.getByRole('button', { name: 'Editar modalidade' }).click()
      await page.getByRole('radio', { name: 'Não sei' }).click()
      await page.getByRole('button', { name: 'Revisar' }).click()
      await expect(page.getByTestId('previa-com-reboque')).toBeVisible()
      await foto(page, '24-confira-previa-nao-sei')
    })

    test('fase 3A: orçar com km da rota', async ({ page }) => {
      await comSessaoFalsa(page, { papel: 'MOTORISTA', nome: 'Bruno Lima', tem_2fa: true }, { aal: 'aal2' })
      await simularApi(page)
      await simularPedidos(page, { detalhes: [pedidoSolicitadoMotorista({ origem_place_id: 'ChIJpor', destino_place_id: 'ChIJdef', trechos_km: 1 })] })
      await simularMapas(page)
      await page.goto(`/pedidos/${ID_PEDIDO}/orcar`)
      await expect(page.getByTestId('km-estimado')).toBeVisible()
      await foto(page, '25-orcar-km-estimado')
    })

    test('agenda', async ({ page }) => {
      await comSessaoFalsa(page, CLIENTE)
      await simularApi(page)
      await simularPedidos(page)
      await page.goto('/agenda')
      await expect(page.getByTestId('linha-agora')).toBeVisible()
      await foto(page, '08-agenda-dia-hoje')
      await escolherDiaNaAgenda(page, DIA_PEDIDO)
      await expect(page.getByTestId('bloco-proprio')).toBeVisible()
      await foto(page, '08-agenda-dia')
      const visao = page.getByRole('radiogroup', { name: 'Visualização' })
      await visao.getByRole('radio', { name: '3 dias' }).click()
      await expect(page.getByTestId('grade-horas').locator('[data-coluna-dia]')).toHaveCount(3)
      await foto(page, '09-agenda-3-dias')
      await visao.getByRole('radio', { name: 'Mês' }).click()
      await expect(page.getByTestId('resumo-dia')).toContainText('Pedido')
      await foto(page, '10-agenda-mes')
    })
  })
}
