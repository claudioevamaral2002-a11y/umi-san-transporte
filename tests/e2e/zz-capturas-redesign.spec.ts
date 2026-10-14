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
