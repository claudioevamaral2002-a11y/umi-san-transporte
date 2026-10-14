# Fase 2A — o que testar em produção (roteiro manual)

> **Substituído:** a publicação é conjunta (1B + 2A + 2B). Siga o roteiro único [roteiro-producao-1b-2a-2b.md](roteiro-producao-1b-2a-2b.md); este arquivo fica só como referência de detalhes.

> **Quando executar:** a 2A **não** vai sozinha para produção. A publicação é **conjunta 1B + 2A + 2B** (o fluxo pedido → aprovação só fica completo com a 2B). Execute este roteiro **depois** do merge conjunto na `main` e do deploy verde, **logo após** o roteiro da 1B ([fase-1b-o-que-testar.md](fase-1b-o-que-testar.md)) e **antes** do roteiro da 2B. Os itens que dependem da aprovação (botão **Aprovar**) estão marcados **(2B)**: na 2A o botão aparece desabilitado com "disponível em breve"; depois da 2B ele funciona e é testado no roteiro da 2B.

Aplicativo: https://umi-san-transporte.pages.dev. Como funciona cada perfil: [RUNBOOK](../RUNBOOK.md), item 11. Marque cada item. Se algo falhar, pare e anote a tela e a mensagem (sem links nem senhas).

> **Várias contas ao mesmo tempo:** use **perfis diferentes do navegador** (ou navegadores diferentes; o celular também conta). Duas janelas anônimas do mesmo navegador compartilham a sessão. Para os itens de tempo real deixe as duas telas **visíveis lado a lado** e **não recarregue**.

**Preparação:** contrato vigente da Umi San (roteiro 1B); um **motorista** ativo com 2FA (o mais antigo atende os pedidos novos); na Umi San um **N1**, dois **N2** (N2-a e N2-b) e um **N3**; uma **empresa de teste** com contrato e um N1 próprio (cliente B). Anote o prazo para orçar e a validade do orçamento do contrato da Umi San.

## A. Deploy
1. **Migrations.** No log do workflow **Deploy** da `main`, o passo de migrations aplicou as da 2A: `20261009130000`, `20261009130100`, `20261009130200`, `20261009131000`, `20261009131100` e `20261009132000` (além das da 1B e da 2B).
2. **Cron.** No painel Supabase, *Integrations → Cron* (ou *Database → Cron Jobs*): existe o job `expirar-vencidos`, a cada 15 min (`*/15 * * * *`), e as últimas execuções aparecem como *succeeded*.

## B. Cliente cria o pedido
3. **Sem contrato.** O N1 da empresa de teste **sem** contrato (ou antes de publicar) vê **Novo pedido** indisponível com a explicação. Depois de publicar o contrato, o botão funciona.
4. **N3 não cria.** O N3 da Umi San não vê **Novo pedido**; forçando `/pedidos/novo` volta ao **Início** com o aviso “Essa área não está disponível para o seu perfil”.
5. **Novo pedido em 4 passos (N2-a).** **Quando?**: o calendário esmaece os dias cheios e mostra chips de horários livres (de 30 em 30 min, 05:00–22:00) para a duração escolhida. **Onde?**: origem, destino, **Levar** e/ou **Trazer** (ao menos um; os dois = ida e volta) e contato opcional. **O quê?**: pessoas/equipamento/ambos, modalidade, reboque, observações. **Revisar**: resumo e "o motorista orça em até X horas" (X = prazo do contrato). **Enviar pedido** → tela de sucesso com o número (#00NN).
6. **Texto não vira código.** Num pedido de teste, escreva nas observações `<b>teste</b>`: no detalhe aparece literalmente `<b>teste</b>` (sem negrito).
7. **Horário ocupado.** Com o N2-b, tente pedir **o mesmo horário** do item 5: o horário não aparece mais como livre. (Se duas pessoas enviarem ao mesmo tempo, só uma entra; a outra vê "Esse horário acabou de ser ocupado. Escolha outro.")
8. **Detalhe do pedido.** O N2-a abre o pedido: linha do tempo em **Solicitado**, contagem regressiva "o motorista responde em …", dados do pedido e **Cancelar pedido**.

## C. Quem vê o quê
9. **N2 só os próprios.** O N2-b em **Pedidos** não vê o pedido do N2-a; na **Agenda**, no dia do pedido do N2-a, o bloco aparece só como **Ocupado** (sem número, sem endereço, sem abrir).
10. **N1 e N3 veem a empresa.** O N1 e o N3 da Umi San veem o pedido do N2-a em **Pedidos** e na **Agenda** (com detalhes) e conseguem abri-lo. O N3 não tem botões de ação.
11. **Outra empresa.** O cliente B não vê o pedido em **Pedidos**; na **Agenda** o horário aparece só como **Ocupado**. Abrindo o endereço do pedido (`/pedidos/<id>` copiado de outra sessão) aparece **Pedido não encontrado**.

## D. Motorista orça
12. **Pendência com contagem.** O motorista (senha + 2FA) vê no **Início** "Aguardando seu orçamento" com o pedido, a empresa e "Responder em …"; perto do fim do prazo (limiar de urgente do contrato) aparece **URGENTE**.
13. **Tempo real na equipe.** Com o **Início** (ou **Pedidos**) do motorista aberto, crie outro pedido com o N2-a: a pendência aparece **sem recarregar** (em poucos segundos). Idem na **Agenda** do motorista e do ADM.
14. **Calculadora.** Toque na pendência → **Orçar**: preços com cadeado ("Preços do contrato Umi San — não editáveis"), km com 1 casa, reboque, espera em meias horas, pedágio, hospedagem e até 5 "Outros" com descrição. O total muda ao vivo (calculado no servidor). Confira uma conta à mão: km × preço do contrato (+ retorno em trecho único, se só Levar ou só Trazer).
15. **Enviar.** **Enviar orçamento** → volta ao pedido com "Orçamento enviado. O cliente já pode ver o memorial."

## E. Cliente recebe, pede revisão, reprova
16. **Orçamento chega sozinho.** Com o detalhe do pedido aberto no N2-a desde o item 8, o orçamento aparece **sem recarregar**: memorial (linhas), total, validade com contagem, regras de cancelamento do contrato e **Aprovar** desabilitado ("disponível em breve") **(2B: funciona)**.
17. **Pedir revisão.** **Pedir revisão** com o motivo "A distância real é 80 km" → "Revisão pedida…"; o orçamento some e o pedido volta a **Solicitado** com novo prazo.
18. **Orçar de novo (pré-preenchido).** O motorista abre o pedido → **Orçar**: aparece **"Revisão pedida: A distância real é 80 km"** e a calculadora vem com as quantidades do orçamento anterior (km, pedágio, outros…) e a versão anterior com o total. Ajuste só o km e envie.
19. **Versão 2.** O cliente vê a **versão 2** com o novo total.
20. **Reprovar.** **Reprovar** (motivo opcional) → "Orçamento reprovado. O pedido foi encerrado."; a linha do tempo mostra **Reprovada** e o histórico, o motivo. O horário volta a ficar livre na **Agenda**.
21. **Recusar (motorista).** Crie outro pedido; o motorista, no **Orçar**, **Recusar pedido** exige motivo; o cliente vê **Recusada** com o motivo e o horário fica livre.
22. **Cancelar (cliente).** Crie outro pedido e cancele com o N1 (motivo opcional): **Cancelada**, sem custo, horário livre.

## F. Expiração (sem depender do cron)
23. **Prazo vencido.** Peça ao ADM para publicar, numa empresa de teste, um contrato com **prazo para orçar = 1 hora**. Crie um pedido e não orce. Depois de 1 hora: o pedido aparece como prazo vencido, o motorista não consegue mais orçar ("O prazo deste pedido venceu."), o horário aparece **livre** para outros clientes mesmo antes do cron e, em até 15 min, o status vira **Expirada**.
24. **Orçamento vencido.** Idem com **validade do orçamento = 1 hora**: orçado e não decidido, depois de 1 hora **Pedir revisão**/**Reprovar** respondem que o prazo venceu e o pedido expira.

## G. ADM e gestor de frota
25. **ADM.** Vê todos os pedidos com a empresa, a **Agenda** com tudo e pode orçar, recusar e cancelar (com motivo).
26. **Gestor de frota.** (Opcional) Entra com 2FA: **Agenda da frota** e pendências **sem nenhum valor em R$** (nem no detalhe do pedido).
27. **Auditoria.** Como ADM, em **Auditoria**: `CRIAR_PEDIDO`, `ENVIAR_ORCAMENTO`, `PEDIR_REVISAO`, `REPROVAR_ORCAMENTO`, `RECUSAR_PEDIDO`, `CANCELAR_PEDIDO` e, após o cron, `EXPIRAR_VENCIDOS`.

## H. Fechamento
28. **Limpeza.** Cancele os pedidos de teste que ainda estiverem abertos (o horário fica livre) e desative as contas de teste. Pedidos encerrados ficam no histórico (nada é apagado).
