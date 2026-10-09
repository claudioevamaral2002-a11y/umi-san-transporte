# Roteiro de produção — fases 1B + 2A + 2B (publicação conjunta)

> **Este é o único roteiro a seguir depois da publicação.** Ele substitui os roteiros [fase-1b-o-que-testar.md](fase-1b-o-que-testar.md) e [fase-2a-o-que-testar.md](fase-2a-o-que-testar.md) (a fase 2B não tem roteiro próprio). Aqueles ficam só como referência de detalhes.

**Quando fazer:** logo depois do merge do PR conjunto na `main` **e** do workflow **Deploy** verde. Leva cerca de 1 hora (mais uma olhada no dia seguinte, item 25).

- Aplicativo: https://umi-san-transporte.pages.dev
- Workflows (Actions): https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions
- Como funciona cada tela: [RUNBOOK](../RUNBOOK.md) — itens 7 a 14 (papéis, contratos, equipe, configurações, pedidos, **saldo e dinheiro**, **divergência de saldo**, tempo real).

Marque cada item. Se algo falhar, **pare**, anote a tela e a mensagem (print sem links nem senhas) e peça ajuda antes de continuar.

> **Várias contas ao mesmo tempo:** o app guarda **uma sessão por navegador**. Para ser ADM, cliente e motorista ao mesmo tempo use **perfis diferentes do navegador** (Chrome: ícone do perfil no canto superior direito → *Adicionar*; Edge: *Perfis* → *Adicionar perfil*) ou **janelas anônimas de navegadores diferentes** (uma anônima do Chrome + uma InPrivate do Edge). **Duas janelas anônimas do mesmo navegador compartilham a sessão** e não servem. O celular também conta como outro navegador. Sugestão:
>
> | Janela | Quem |
> | --- | --- |
> | Perfil 1 do navegador | **ADM** (você, senha + 2FA) |
> | Perfil 2 | **Cliente N1** da Umi San (o cliente que já existia) |
> | Perfil 3 (ou celular) | **Motorista** (senha + 2FA) |
> | Perfis 4 e 5 (ou anônimas de outros navegadores) | **N2** e **N3**, convidados no item 22 |

## A. Depois do deploy
1. **Deploy verde.** Em [Actions → Deploy](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/deploy.yml), a execução da `main` está verde. Abra o passo **Configuração do Auth, migrations e Edge Functions** e confira que as migrations aplicadas vão de `20261009120000` a `20261009141000` (13 arquivos, nessa ordem) sem erro.
2. **Agendamentos do banco.** No [painel Supabase](https://supabase.com/dashboard) → projeto **umi-san-transporte** → *Integrations → Cron* (ou *Database → Cron Jobs*): existem `expirar-vencidos` (a cada 15 min, `*/15 * * * *`) e `reconciliar-saldos` (`0 6 * * *` = 03:00 de Brasília), ambos ativos. Depois de 15 min, `expirar-vencidos` mostra execuções *succeeded*.
3. **App novo no ar.** Abra o app e recarregue a página (Ctrl+F5 no computador; no celular, feche e abra o app de novo): o app se atualiza sozinho para a versão nova.

## B. ADM: contratos, retenção e recarga
4. **Entrar como ADM** (perfil 1): senha + 2FA. O menu tem **Contratos**, **Usuários**, **Painel**, **Créditos**, **Empresas**, **Configurações** e **Auditoria**. Não existem mais **Permissões** nem **Parâmetros**; abrir https://umi-san-transporte.pages.dev/parametros leva para **Contratos**.
5. **Contratos** (https://umi-san-transporte.pages.dev/adm/contratos): aparecem a **Tabela modelo v1** e **Umi San v1**, vigentes. Abra **Umi San**: os preços, faixas de cancelamento, prazos, validade, limiar de urgente, limite de saldo negativo e alerta de saldo baixo são **os mesmos da tabela antiga** (mesmo autor). Anote o **prazo para orçar**, a **validade** e as **faixas de cancelamento**.
6. **Retenção de fotos** (https://umi-san-transporte.pages.dev/adm/configuracoes): **Fotos guardadas após a entrega** mostra **5 dias** (veio da tabela antiga). Se quiser outro valor, altere e salve.
7. **Saldo zerado.** **Créditos** (https://umi-san-transporte.pages.dev/adm/creditos): a Umi San aparece com disponível **R$ 0,00**, reservado R$ 0,00 e o limite do contrato.
8. **Recarga.** Abra **Umi San** → **Recarga**: valor `2.000,00`, motivo "Recarga inicial — teste de produção", comprovante opcional → confira o resumo (R$ 0,00 → R$ 2.000,00) → **Confirmar recarga**. Aparece "Recarga lançada" e o extrato mostra **Recarga +R$ 2.000,00**.

## C. Cliente N1 pede, motorista orça
9. **Entrar como cliente** (perfil 2, o cliente da Umi San que já existia; sem 2FA). Ele virou **N1 — gestor da empresa**: o menu tem **Pedidos**, **Agenda**, **Regras do serviço**, **Extrato** e **Equipe**. No **Início**, o cartão de saldo mostra **disponível R$ 2.000,00** e o **limite de crédito** da empresa (o cliente vê o próprio limite). Ele **não** vê tabela de preços.
10. **Regras do serviço**: mostra as faixas de cancelamento, prazos e validade do contrato (sem preços). Veja qual faixa cobra multa (ex.: "menos de 24 h antes: 50%").
11. **Novo pedido pelo calendário.** **Pedidos** → **+ Novo pedido**. **Quando?**: escolha um dia e um horário livre **dentro da faixa com multa** do item 10 (ex.: se a multa vale com menos de 24 h, um horário daqui a umas 8 a 20 horas), para o teste de cancelamento do item 19 cobrar multa. **Onde?**, **O quê?** e **Revisar** → **Enviar pedido** → aparece o número (#00NN).
12. **Motorista orça** (perfil 3, senha + 2FA). No **Início** aparece "Aguardando seu orçamento" com o pedido e a contagem (sem recarregar). Toque → **Orçar**: os preços vêm travados do contrato; preencha km (e o que mais couber) → **Enviar orçamento**.
13. **Cliente vê o memorial** (perfil 2, com o pedido aberto): o orçamento aparece **sozinho** com o memorial (linha a linha), total, validade e regras de cancelamento.
14. **Pedir revisão.** **Pedir revisão** com o motivo "Conferir a distância". O pedido volta a **Solicitado**.
15. **Motorista reenvia.** No **Orçar** aparece "Revisão pedida: Conferir a distância", com as quantidades anteriores preenchidas. Ajuste o km → **Enviar orçamento**. O cliente vê a **versão 2**.

## D. Aprovação, agenda e cancelamento com multa
16. **Aprovar** (cliente N1). **Aprovar** → o recibo mostra o memorial, o total e o **saldo depois da aprovação** → **Confirmar aprovação**. Depois da animação, o pedido vira **Agendado**. O cartão de saldo mostra o valor em **Reservado** e o disponível menor; o **total continua R$ 2.000,00**.
17. **Agenda.** Na **Agenda** do cliente, do motorista e do ADM o horário aparece reservado (agendado). O motorista e o ADM veem o pedido como **Agendado**.
18. **Painel do ADM** (https://umi-san-transporte.pages.dev/adm/painel, perfil 1): **Umi San** com o reservado do pedido, **1 corrida agendada** e o valor no **aprovado no período**. Em **Créditos → Umi San → Extrato**: **Reserva** com o valor do orçamento.
19. **Cancelar com prévia da multa** (cliente N1). No pedido, **Cancelar agendamento**: **antes de confirmar**, aparece "Cancelando agora: multa de R$ X (faixa …)". Confira a conta: total do orçamento × percentual da faixa. Confirme. O pedido vira **Cancelada** e o horário fica livre na **Agenda**.
20. **Extrato.** No **Extrato** do cliente (e em **Créditos → Umi San** do ADM): **Reserva**, **Liberação de reserva** (mesmo valor) e **Multa de cancelamento** (−R$ X). O cartão de saldo: reservado R$ 0,00; total = R$ 2.000,00 − multa. Teste **Exportar CSV** e **PDF**.
21. **Estornar a multa (opcional).** ADM, **Créditos → Umi San → Extrato** → na linha da multa, **Estornar** → motivo "Teste de produção — devolução da multa" → **Confirmar estorno**. O extrato mostra **Estorno +R$ X** e o total volta a **R$ 2.000,00**; o botão **Estornar** some da linha da multa. Na **Auditoria**: `LANCAR_RECARGA`, `APROVAR_ORCAMENTO`, `CANCELAR_AGENDADO` e `ESTORNAR_LANCAMENTO`.

## E. Equipe da empresa (N1 convida N2 e N3)
22. **Convidar.** Cliente N1 → **Equipe** → **Convidar colega**: um colega como **N2 — Solicitante** e outro como **N3 — Visualizador** (e-mails reais dos colegas ou endereços seus com `+`, ex.: `seunome+n2@gmail.com`). Copie cada link e abra em outro perfil do navegador (perfis 4 e 5): **Continuar** → criar senha → entra (cliente não usa 2FA).
23. **O que cada um vê.**
    - **N2:** **Novo pedido** disponível; em **Pedidos** só os **próprios** (não vê o pedido do item 11); na **Agenda**, pedidos de colegas aparecem só como **Ocupado**; vê o saldo, o limite e o **Extrato** da empresa (as linhas do pedido do N1 aparecem, mas o pedido não abre); sem **Equipe**.
    - **N3:** **sem Novo pedido** (abrir https://umi-san-transporte.pages.dev/pedidos/novo mostra **Sem permissão**); vê **todos** os pedidos da empresa, sem botões de ação; vê saldo, limite e extrato; sem **Equipe**.
    - **N1:** vê tudo da empresa e, em **Equipe**, os dois colegas (pode gerar novo link e desativar/reativar com motivo).
24. **Tempo real com o N2.** Com o **Início** do motorista aberto, o N2 cria um pedido: a pendência aparece no motorista sem recarregar. Cancele esse pedido com o N2 (sem custo, ainda não aprovado).

## F. Reconciliação e fechamento
25. **Reconciliação (dia seguinte).** O banco confere os saldos todo dia às **03:00**. No dia seguinte, ADM → **Painel** → **Última reconciliação**: data de hoje, 03:00, "**Tudo confere**". Antes da primeira execução aparece "Ainda não houve reconciliação (roda todo dia às 03:00)". Se aparecer **divergência**, siga o [RUNBOOK, item 13](../RUNBOOK.md#13-divergência-de-saldo-reconciliação-diária) — **nunca** edite saldo; corrija só com ajuste/estorno com motivo.
26. **Limpeza.** Cancele pedidos de teste ainda abertos. Desative (Equipe → Gerenciar → **Desativar**) os colegas que eram só para teste. Se a recarga de R$ 2.000,00 não corresponde a um pagamento real, **estorne-a** (Créditos → Umi San → Extrato → **Estornar** na recarga, motivo "Recarga de teste"): o saldo volta a R$ 0,00 e tudo fica registrado. Nada é apagado.
