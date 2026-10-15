# Fase 3A: o que testar em produção (roteiro no celular)

> **Quando executar:** depois do merge do PR da 3A na `main`, do **Deploy verde** e das chaves do Google criadas e cadastradas ([RUNBOOK](../RUNBOOK.md), item 16). Sem as chaves, só os itens 1 e 10 fazem sentido (o app fica em texto livre).

Aplicativo: https://umi-san-transporte.pages.dev. Use o **celular**. Marque cada item. Se algo falhar, pare e anote a tela e a mensagem (sem links nem senhas).

**Preparação:** contrato vigente da Umi San com preço de km e taxa de reboque; um **N2** e um **N3** da Umi San; o **motorista** ativo com 2FA.

## A. Deploy
1. **Migrations e função.** No log do workflow **Deploy** da `main`: o passo de migrations aplicou `20261015120000`, `20261015120100`, `20261015120200` e `20261015120300`, e a lista de funções publicadas inclui `enderecos`.

## B. Cliente pede com endereços reais (N2)
2. **Buscar um porto.** **Novo pedido**, escolha dia e horário, **Continuar**. Em **Origem**, digite `porto itaj`: aparecem sugestões do Google em duas linhas (nome e endereço). Toque em **Porto de Itajaí**: o campo mostra o nome e, embaixo, o endereço reconhecido.
3. **Marcar no mapa.** Em **Destino**, digite `marina` e toque em **Não achou? Marcar no mapa**. Arraste o mapa até a ponta do triângulo ficar sobre a marina, escreva `Marina Itajaí, rampa 2` em **Nome do local** e toque em **Usar este ponto**. O destino passa a ser esse nome.
4. **Km e tempo.** Com os dois pontos escolhidos, aparece a linha "NN km pela rota" e "cerca de NN min". Confira se o valor faz sentido para o trajeto.
5. **Prévia com reboque Sim.** Marque **Levar**, **Continuar**, Reboque **Sim**, **Revisar**. Em **Confira o pedido**, abaixo do resumo, aparece **Prévia do orçamento** com o valor, as linhas (abrem e fecham com um toque) e o aviso "Estimativa pela tabela do contrato. O valor final vem no orçamento do motorista.". O resumo mostra os km.
6. **Reboque Não sei.** Toque em **Editar** na Modalidade, escolha Reboque **Não sei**, **Revisar**: aparecem "Sem reboque" e "Com reboque", lado a lado. **Enviar pedido**.
7. **Local da empresa.** Comece outro pedido. Ao tocar em **Destino** (antes de digitar), aparece **Locais da empresa** com a **Marina Itajaí, rampa 2** do item 3, com o ícone de prédio. Feche sem enviar.

## C. Quem vê
8. **N3 sem prévia.** O N3 da Umi San não vê **Novo pedido** (e, portanto, nenhuma prévia).

## D. Motorista
9. **Km preenchidos.** O motorista abre o pedido do item 6 e toca em **Orçar**: em instantes o campo de km se preenche com a rota calculada agora e aparece o aviso "Estimado pela rota: … Confira." (em ida e volta, o dobro do trecho). Ajuste se precisar e envie normalmente. Um pedido antigo (de antes da 3A) abre o **Orçar** com os km vazios, sem aviso.

## E. Sem Google
10. **Google fora do ar.** No Google Cloud, em **Credenciais**, edite a chave `servidor-enderecos` e, em **Restrições de API**, desmarque temporariamente a **Places API (New)**; salve e aguarde 5 minutos. No app, ao digitar a origem aparece "Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km.", e o pedido segue até **Enviar pedido**, sem prévia. Depois **marque de novo** a Places API (New) e salve.

**No dia seguinte:** no Google Cloud, **Faturamento**, **Relatórios**, filtrando pelo projeto `ivo-transportes-mapas`: o uso aparece dentro da cota gratuita.
