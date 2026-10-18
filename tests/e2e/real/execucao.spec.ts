import { randomUUID } from 'node:crypto'
import { devices, expect, test } from '@playwright/test'
import { ORIGEM_APP, comBanco, criarPessoa, empresaComContrato, entrarComDoisFatores, entrarComSenha, rpc } from './apoio.ts'

// Fase 3B contra o Supabase real do CI: pedido aprovado → motorista desliza para sair (débito) → compartilha a posição
// → o cliente recebe pelo canal rastreio:<id> → motorista conclui → resumo para o cliente, débito no livro-razão e
// posições apagadas. Sem chave do Google no CI: o mapa mostra o aviso de indisponível, mas o sinal chega igual.

test.describe('execução e rastreio (fase 3B)', () => {
  test.setTimeout(300_000)

  test('saída com débito → posição ao vivo para o cliente → conclusão com resumo', async ({ page, browser }) => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Márcio Viagem' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '31 years' where usuario_id = $1`, [motorista.id]),
    )
    const adm = await criarPessoa({ papel: 'ADM' })
    const empresa = await empresaComContrato()
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Clara Rastreio' })
    expect(
      await rpc(adm, 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 50000, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() }),
    ).toMatchObject({ ok: true })

    // Pedido daqui a 20 min (dentro da janela de saída), orçado e aprovado pelas RPCs.
    const inicio = new Date(Date.now() + 20 * 60_000)
    inicio.setUTCSeconds(0, 0)
    const criado = await rpc(cliente, 'criar_pedido', {
      p: {
        inicio: inicio.toISOString(),
        duracao_min: 60,
        origem: 'Porto de Itajaí',
        destino: 'Marina Itajaí, rampa 2',
        destino_lat: -26.9,
        destino_lng: -48.66,
        levar: true,
        trazer: false,
        carga: 'PESSOAS',
        pessoas_qtd: 1,
        modalidade: 'VEICULO_PROPRIO',
        reboque: 'NAO',
      },
    })
    expect(criado).toMatchObject({ ok: true })
    const id = criado.id as string
    expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: id, p: { pedagio_cent: 3210 } })).toMatchObject({ ok: true })
    const o = (await rpc(cliente, 'pedido', { p_id: id })).orcamento as { versao: number; hash: string }
    expect(
      await rpc(cliente, 'aprovar_orcamento', { p_atividade: id, p_versao: o.versao, p_hash: o.hash, p_chave: randomUUID(), p_dispositivo: 'e2e' }),
    ).toMatchObject({ ok: true })

    // Cliente abre o pedido (fica olhando).
    await entrarComSenha(page, cliente.email, cliente.senha)
    await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Clara$/ })).toBeVisible({ timeout: 30_000 })
    await page.goto(`/pedidos/${id}`)
    await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Agendado', { timeout: 20_000 })

    const contexto = await browser.newContext({
      ...devices['Pixel 7'],
      baseURL: ORIGEM_APP,
      geolocation: { latitude: -26.91, longitude: -48.67, accuracy: 10 },
      permissions: ['geolocation'],
    })
    try {
      const pm = await contexto.newPage()
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto(`/pedidos/${id}`)
      await pm.getByRole('slider', { name: 'Deslize para sair' }).press('End', { timeout: 20_000 })
      await expect(pm.getByText('Saída registrada. Boa viagem!')).toBeVisible({ timeout: 20_000 })
      await pm.getByRole('button', { name: 'Começar a compartilhar' }).click()
      await expect(pm.getByTestId('selo-localizacao')).toHaveText('Compartilhando sua localização', { timeout: 20_000 })

      // O cliente vê o pedido em andamento (tempo real) e recebe a posição pelo canal privado.
      await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"]')).toContainText('Saiu', { timeout: 20_000 })
      await expect(page.getByTestId('sinal-motorista')).toHaveText(/Atualizado (agora|há \d+ s)/, { timeout: 30_000 })

      // Livro-razão: reserva liberada e débito do valor aprovado.
      const lancamentos = await comBanco(async (db) =>
        (await db.query<{ tipo: string; valor: string }>('select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id', [id]))
          .rows.map((l) => `${l.tipo}:${l.valor}`),
      )
      expect(lancamentos).toEqual(['RESERVA:3210', 'LIBERACAO_RESERVA:3210', 'DEBITO:-3210'])

      // Motorista conclui.
      await pm.getByTestId('viagem-motorista').getByRole('button', { name: 'Concluir serviço' }).click()
      const folha = pm.getByRole('dialog', { name: 'Concluir serviço' })
      await folha.getByLabel('Observação (opcional)').fill('Passageiro entregue na rampa 2')
      await folha.getByRole('button', { name: 'Concluir serviço' }).click()
      await expect(pm.getByTestId('resumo-concluido')).toBeVisible({ timeout: 20_000 })

      await expect(page.getByTestId('resumo-concluido')).toContainText('Passageiro entregue na rampa 2', { timeout: 20_000 })
      const posicoes = await comBanco(
        async (db) => (await db.query<{ n: string }>('select count(*) as n from app.posicoes where atividade_id = $1', [id])).rows[0]!.n,
      )
      expect(Number(posicoes)).toBe(0)
    } finally {
      await contexto.close()
    }
  })
})
