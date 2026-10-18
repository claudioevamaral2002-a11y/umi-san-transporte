# Fase 3B: o que testar em produção (roteiro no celular)

> **Quando executar:** depois do merge do PR da 3B na `main` e do **Deploy verde**. As chaves do Google da 3A já estão cadastradas; sem elas o mapa mostra "não está disponível", mas a viagem, a posição e o resumo funcionam igual.

Aplicativo: https://umi-san-transporte.pages.dev. Use **dois celulares**: um como **motorista** e outro como **cliente N2** (quem fez o pedido). Marque cada item. Se algo falhar, pare e anote a tela e a mensagem (sem links nem senhas).

**Preparação:**
- contrato vigente da Umi San e saldo suficiente;
- um pedido **agendado** (orçado e aprovado) para daqui a **menos de 1 hora**;
- um N3 da Umi San, para o item 11;
- se der, um **segundo pedido agendado** logo depois do primeiro, para o item 7.

## A. Deploy
1. **Migrations e função.** No log do workflow **Deploy** da `main`:
   - o passo de migrations aplicou `20261018120000_execucao` e `20261018120100_rastreio_fotos`;
   - a lista de funções publicadas inclui `enviar-foto`.

## B. Saída (motorista)
2. **Cartão no Início.** O Início do motorista mostra **Próximo serviço** com a rota e o trilho **Deslize para sair**. Se faltar mais de 1 hora para o início, o trilho fica apagado com "Disponível a partir de HH:MM".
3. **Deslizar.**
   - Arraste a pickup até o fim do trilho e solte. Aparece "Registrando a saída…" e, em seguida, o pedido abre com "Saída registrada. Boa viagem!".
   - No celular do cliente, sem recarregar, a linha do tempo passa para **Saiu**.
4. **Débito no extrato.** No **Extrato** do cliente (ou em **Créditos** no ADM) aparece o débito do serviço com o valor aprovado. A reserva some e o disponível não muda.

## C. Viagem em andamento
5. **Compartilhar a localização.**
   - Na primeira viagem aparece a explicação "Compartilhar sua localização". Toque em **Começar a compartilhar** e permita a localização no navegador.
   - O selo verde "Compartilhando sua localização" aparece. Em instantes aparece a **Chegada ao destino ~HH:MM**.
   - Deixe o app aberto e ande um pouco (ou dirija até perto).
6. **O cliente acompanha.**
   - No celular do cliente, o pedido mostra o **mapa** com o carro e o triângulo do destino. O carro anda a cada poucos segundos, e o texto diz "Atualizado agora".
   - Apague a tela do motorista por **mais de 1 minuto**: no cliente, o carro fica **cinza**, com "Sinal do motorista perdido".
   - Acenda de novo a tela do motorista com o app aberto: o carro volta a andar.
7. **Nova previsão** (se houver o segundo pedido).
   - No motorista, toque em **Nova previsão de término** e escolha um horário **depois** do início do segundo pedido. Aparece "Previsão salva … O cliente do pedido #NNNN foi avisado do atraso.".
   - No celular de quem fez o segundo pedido: o detalhe e as pendências mostram "O motorista está terminando outro serviço. Previsão de chegada ~HH:MM".
   - Informe de novo um horário **antes** do segundo pedido: o aviso some.

## D. Conclusão
8. **Concluir com fotos.**
   - No motorista, toque em **Concluir serviço**. Tire **2 fotos** pelo botão da câmera: cada uma aparece em miniatura e sai do "Enviando…".
   - Escreva uma observação e toque em **Concluir serviço**. Aparece "Serviço concluído…" com o **Resumo da viagem**: saída, chegada, duração e km rodados.
9. **O cliente vê o resumo.** No cliente, sem recarregar:
   - a linha do tempo chega a **Concluído**;
   - aparecem o resumo, as **fotos** (abra uma: carrega pela URL assinada) e a observação.
10. **Nada cobrado na conclusão.** O extrato continua com **um só** débito para esse pedido.

## E. Quem vê
11. **N3 sem mapa.** O N3 da Umi San abre um pedido em andamento: vê o status e a linha do tempo, **sem** o mapa.
12. **ADM.** O **Painel** do ADM, em **Corridas**, lista a viagem em andamento com o término previsto; o toque abre o mapa.

**No dia seguinte:**
- confira, no Painel do ADM, que a **reconciliação das 03:00** está "Tudo confere";
- no Google Cloud, em **Faturamento** › **Relatórios**, o uso da Routes e da Map Tiles segue dentro da cota gratuita.
