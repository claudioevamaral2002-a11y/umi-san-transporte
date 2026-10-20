# Fase 4: o que testar no IVO novo (roteiro no celular)

> **Quando executar:** depois que o Deploy da `main` ficar verde com o PR da fase 4 e **depois dos passos do dono** do [RUNBOOK §18.9](../RUNBOOK.md) (chave do mapa e Turnstile). Sem eles, o login ou o mapa não funcionam no endereço novo.

Aplicativo novo: **https://ivo-novo.pages.dev**. O app atual (https://umi-san-transporte.pages.dev) continua no ar e serve de comparação. Os dois usam o **mesmo banco**: o que você fizer num aparece no outro.

Use **dois celulares** e **o computador**:
- **Celular 1: cliente.** Entra como Administrador ou Solicitante da Umi San (quem pede a corrida).
- **Celular 2: Ivo.** Entra como motorista.
- **Computador: Master.** Entra como o ADM (no app novo, o ADM aparece como "Master").

Marque cada item. **Se algo falhar, pare e anote a tela e a mensagem** (sem links nem senhas). Não tente "consertar" no meio: o que falhou é justamente o que preciso saber.

**Preparação:**
- contrato vigente da Umi San e **saldo suficiente** (confira em Créditos);
- o Ivo com **GPS permitido** no navegador do celular 2;
- um segundo pedido agendado logo depois do primeiro é opcional (só para ver o atraso automático).

## A. Instalar e entrar
1. **Instalar nos dois celulares.**
   - Abra https://ivo-novo.pages.dev no navegador e use **Adicionar à tela inicial** (Android: menu ⋮; iPhone: botão de compartilhar).
   - O ícone novo convive com o do app atual. Abra pelo ícone novo.
2. **Entrar.** Entre com seu e-mail e senha. Se pedir o código de 6 dígitos (2FA), digite. Cada pessoa cai no que é seu: o cliente no **mapa**, o Ivo no **início do motorista**, o Master no menu ☰.

## B. Master: preços e contato (computador)
3. **Categorias e preços.**
   - Menu ☰ › **Categorias e preços**.
   - Confira que aparecem **IVO Passageiros**, **IVO Carga Leve** e **IVO Carga Pesada**, todas ativas.
   - Escolha o contrato (o modelo ou o da Umi San), preencha o **preço por km** (e a taxa fixa da Carga Pesada) de cada categoria e toque em **Publicar nova versão**.
   - Esta é a **única** forma de publicar com preço por categoria. Não publique pela tela de Contratos do app atual, porque ela apaga esses preços.
4. **Contato para recarga.** Menu ☰ › **Configurações** › **Contato para recarga**: digite o telefone ou WhatsApp da IVO e salve. Ele aparece no Painel da empresa (item 23).

## C. Ivo: telefone e veículos (celular 2)
5. **Telefone.** Menu ☰ › **Perfil e segurança**: digite seu telefone com DDD e toque em **Salvar telefone**. É ele que aparece no botão **Ligar** do cliente.
6. **Cadastrar veículos.** Menu ☰ › **Meus veículos** › **Cadastrar veículo**. Preencha modelo, cor, placa, lugares, carga máxima e marque as **categorias** que atende. Cadastre um que atenda Passageiros e outro que atenda Carga Leve e Carga Pesada (reboque, se tiver).
7. **Situação.** Ponha um veículo em **Em manutenção**. No celular 1, a categoria que só ele atende deve aparecer como **"Indisponível no momento"** e não poder ser pedida. Volte a **Ativo** depois.
8. **Disponível.** Menu ☰ › ligue **Disponível para chamadas**. Isso **não** envia sua localização.

## D. Cliente pede (celular 1)
9. **Mapa inicial.** Abre no mapa, centrado na empresa, com o menu ☰ no canto. A origem já vem preenchida.
10. **Agendar.**
    - Toque em **Para onde?** e escolha o destino. O trajeto aparece **desenhado** e sobe a folha com as 3 categorias e o **preço estimado** de cada uma (~R$).
    - O seletor abre em **Agendar** com um horário livre (a partir de amanhã). Mude o dia e a hora se quiser.
    - Toque em **Pedir {categoria} · {dia hh:mm}**. Aparece **"Enviado ao Ivo"** com o prazo de resposta.
11. **Agora.** Cancele o pedido anterior (sem custo nesta etapa). Troque o seletor para **Agora**: o horário deve ser o **primeiro livre a partir de 1 hora**. Peça. O prazo para o Ivo responder é de **15 minutos**.
12. **Detalhes opcionais.** Abra **Detalhes da corrida** e confira pessoas, carga, contato no local, ida e volta e observação.

## E. Ivo responde (celular 2, com o app aberto)
13. **A chamada.** Em tela cheia, com **som e vibração**: mapa com o trajeto, empresa, dia e hora, km, tempo e o valor pela tabela. Se o som não tocar, anote (o celular pode estar no silencioso).
14. **Aceitar.** Num dos pedidos, toque em **Aceitar por R$ {valor}** (confira o veículo sugerido e troque-o uma vez para testar).
15. **Propor outro valor.** No outro pedido, toque em **Propor outro valor**:
    - abre a **calculadora** com km, espera, pedágio, hospedagem e "Outros";
    - o total é recalculado pelo contrato a cada mudança, com "Pela tabela R$ X" ao lado;
    - envie. O Ivo não digita valor livre.

## F. Cliente confirma (celular 1)
16. **Confirmar.**
    - Aparece a folha com motorista, veículo (modelo, cor, placa), dia e hora e o valor. No pedido com proposta, vem "Pela tabela … · Proposta do Ivo …" e **Ver o cálculo**.
    - Digite o **centro de custo** (opcional) e confira "Disponível no saldo".
    - Toque em **Confirmar corrida · R$ {valor}**. O valor fica **reservado** no saldo.
    - Se quiser, teste também **Pedir outro valor** e **Recusar** em outro pedido.

## G. No dia: saída e viagem (Ivo)
17. **Deslize para sair.** O pedido confirmado aparece no início com o trilho. Ele libera a partir de **1 hora antes** do início (o "Agora" já nasce liberado). Arraste até o fim. Aparece "Registrando a saída…".
18. **Débito.** Em Créditos (no computador), o extrato da Umi San mostra o **débito** do valor, e a reserva some. O disponível não muda.
19. **Dirigir pelo app.**
    - O mapa ocupa a tela, com o **trajeto desenhado**, a **chegada prevista** grande e o selo "Compartilhando localização" (aceite o aviso na primeira vez).
    - Toque em **Abrir no Waze** e confira o aviso: *No Waze, o cliente vê "sinal perdido". Volte ao IVO quando puder.* Volte ao IVO.
    - A tela deve ficar acesa.
    - Não há "vire à direita": é o esperado. A voz curva a curva é do app de loja.
20. **Concluir com fotos.** Toque em **Concluir**, tire 2 fotos (opcional), escreva uma observação e conclua. Aparece o valor da corrida.

## H. Cliente acompanha e avalia (celular 1)
21. **Acompanhar.**
    - Mapa em tela cheia com o carro, o trajeto e o destino; **chegada prevista** grande; "atualizado agora".
    - Toque em **Ligar**: deve discar para o telefone do item 5.
    - Apague a tela do Ivo por mais de 1 minuto: o carro fica **cinza** com **"Sinal do motorista perdido"**. Acenda de novo e ele volta a andar.
    - Feche e abra o acompanhamento no meio da viagem: aparece logo a **última posição**, nunca "—".
    - Se o mapa falhar, ele tenta de novo sozinho a cada 15 segundos.
22. **Fim.** Aparecem saída → chegada, km, valor, centro de custo e as fotos. Dê de **1 a 5 estrelas** (e um comentário) e envie. Toque em **Pedir de novo**: abre o pedido com a **mesma rota e categoria**, faltando só a data.

## I. Painel da empresa (computador)
23. **Painel da empresa.** Entre como **Administrador** da Umi San (ou como Master, escolhendo a empresa) e abra ☰ › **Painel da empresa**:
    - **Resumo do mês**: Gasto no mês, Disponível agora e Reservado (confira com o extrato);
    - **Próximas corridas** e **Corridas recentes**, com Quem pediu, Data, Roteiro, Categoria, Centro de custo, Status e Valor;
    - **Pessoas**: quantas ainda não pediram corrida e quantos convites não foram aceitos;
    - "Para recarregar, fale com a IVO" mostra o contato do item 4;
    - **Exportar CSV do mês**: baixe, abra no Excel e confira o centro de custo.
24. **Quem não pode.** Um Solicitante ou Visualizador **não** vê "Painel da empresa" no menu.

## J. O app atual não mudou
25. **Comparar.** Abra https://umi-san-transporte.pages.dev nos dois celulares: continua igual a antes, com o mesmo login. A corrida de teste aparece lá também. Crie um pedido pelo app atual: ele deve funcionar como sempre.

**No dia seguinte:**
- no Painel do ADM, a **reconciliação das 03:00** deve estar "Tudo confere";
- no Google Cloud, em **Faturamento** › **Relatórios**, o uso da Routes e da Map Tiles segue dentro da cota gratuita.

**Depois do teste:** diga o que você quer mudar. A troca do endereço principal para o app novo é decisão sua (ver o HANDOFF, "Próximos passos").
