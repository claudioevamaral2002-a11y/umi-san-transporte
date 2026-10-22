# Fase 4.1: o que testar no IVO novo (roteiro no celular)

> **Quando executar:** depois que o Deploy da `main` ficar verde com o PR da fase 4.1. **Antes de tudo, o Master publica a tabela de preços (parte A).** Até lá, os preços continuam os de hoje e a categoria **IVO Motorista** aparece como "Indisponível no momento".

Aplicativo novo: **https://ivo-novo.pages.dev**. Use **dois celulares** e **o computador**:
- **Celular 1: cliente.** Entra como Administrador ou Solicitante da Umi San.
- **Celular 2: Ivo.** Entra como motorista.
- **Computador: Master.** Entra como o ADM.

Marque cada item. **Se algo falhar, pare e anote a tela e a mensagem** (sem links nem senhas). Não tente "consertar" no meio: o que falhou é justamente o que preciso saber.

**Antes de começar:** feche o app nos dois celulares e abra de novo. Se aparecer **"Nova versão · Atualizar"**, toque nele. Sem isso, o celular pode estar usando a versão antiga.

## A. Master: publicar a tabela de cada categoria (computador)
1. **Abrir.** Menu ☰ › **Categorias e preços**. Devem aparecer **IVO Passageiros**, **IVO Carga Leve** e **IVO Motorista**. A **Carga Pesada** fica desligada (inativa).
2. **Conferir os valores que já vêm.** Na primeira vez, cada categoria já vem preenchida com os **preços que valem hoje**. Nada fica zerado por esquecimento.
3. **Entender o "zerado".** Cada campo tem uma ajuda curta: *deixe zerado se não cobra*. Zerado = **não cobra**.
4. **Preencher a IVO Motorista.** Coloque o **valor por hora**. Ela é a categoria "Ivo dirige o carro da sua empresa", por isso não tem campo de reboque.
5. **Ver a Carga Leve.** Agora ela usa **reboque**. Confira a **taxa de reboque** dela: a partir da publicação, **o reboque passa a ser cobrado** na Carga Leve (antes não era).
6. **Publicar.** Toque em **Publicar tabela**. Abre uma **revisão** com o que muda em cada categoria (antes → depois). Na primeira vez, **todas as categorias ativas entram**.
   - Se você colocou valor por hora em Passageiros ou Carga Leve, aparece um **aviso**: o app do cliente que ainda não atualizou não manda as horas, e esses pedidos seriam recusados até ele atualizar. Se não é o que você quer, volte e zere o valor por hora.
   - Confira a data em que a tabela passa a valer e confirme.
7. **Conferir.** Aparece "Tabela publicada: versão N". No celular 1, as categorias passam a mostrar o preço novo.

## B. Master: nova categoria e novo nome
8. **Criar.** Toque em **+ Nova categoria**, escreva o nome (por exemplo, "IVO Executivo"), a descrição curta e salve.
9. **Ela ainda não pode ser pedida.** No celular 1, a categoria nova aparece como **"Indisponível no momento"**. Isso é o esperado: ela só fica disponível depois de ganhar tabela.
10. **Dar preço.** Preencha a tabela dela e toque em **Publicar tabela** de novo. No celular 1 ela passa a poder ser pedida (desde que haja veículo ativo).
11. **Renomear.** Mude o nome de uma categoria (por exemplo, "IVO Passageiros" para "IVO Conforto") e salve. O nome novo aparece no celular 1, na lista de categorias.
12. **Veículo.** No celular 2, menu ☰ › **Meus veículos** › **Cadastrar veículo**. As categorias que aparecem para marcar são as **ativas, com os nomes novos**, e não aparece a IVO Motorista (ela não usa veículo da IVO).

## C. Cliente pede (celular 1)
13. **Sem origem pronta.** Ao abrir, o campo **De** vem **vazio** (não vem mais um endereço fixo). Escolha a origem. Os locais da empresa aparecem primeiro na busca.
14. **Paradas.**
    - Escolha o **Para** (destino). Toque em **+ Adicionar parada** e escolha um lugar. Repita até **3 paradas**.
    - Na terceira, o botão **+ Adicionar parada** some. Cada parada tem um **×** para remover.
    - O mapa desenha **De → paradas → Para**, e o **preço estimado** de cada categoria já considera as paradas (uma taxa por parada nas categorias que cobram).
15. **Horas (IVO Motorista).** Escolha a **IVO Motorista**. Aparece **Horas estimadas** com **−** e **+**, de meia em meia hora (de 0,5 a 24). O preço muda a cada mudança. A IVO Motorista aparece **mesmo sem nenhum veículo cadastrado**, porque o Ivo dirige o carro da empresa.
16. **Centro de custo.** Logo acima do botão de pedir, o campo **Centro de custo (opcional)** (texto livre, até 80 letras). Ele já vem com o **último que você usou**. Escreva um e peça a corrida da IVO Motorista com 4 horas.
17. **Ida e volta com paradas.** Peça uma corrida de ida e volta com 1 parada. A ida passa pela parada e a **volta vai direto** (o valor deve ser coerente com isso).
18. **Nada estoura.** Com 3 paradas na tela do celular, nada deve passar da borda nem rolar de lado.

## D. Agenda
19. **Abrir a agenda.** No **Agendar**, os dias ficam numa faixa com **rolagem lateral** (barra fina nas cores do IVO; no computador, também setas). Os horários aparecem em colunas alinhadas, em **Manhã / Tarde / Noite**.
20. **Tela pequena.** Com a agenda aberta e 3 paradas no pedido, a folha **não estoura** a tela, e a página não rola de lado.

## E. Ivo responde (celular 2)
21. **A chamada.** A corrida aparece com **De**, a(s) **Parada(s)** e **Para**, nessa ordem. Mostra o valor pela tabela.
22. **Aceitar a IVO Motorista.** Toque em **Aceitar por R$ …**. **Não pede veículo** (o carro é da empresa).
23. **Calculadora do motorista.** Em outro pedido, toque em **Propor outro valor**. A calculadora mostra **só o que tem preço na tabela da categoria**: km, **horas**, espera, **paradas**, pedágio, hospedagem e "Outros". O total é recalculado a cada mudança. Ajuste as horas e envie.

## F. Cliente confirma e o Ivo viaja
24. **Confirmar.** No celular 1, confirme a corrida. Dá para **trocar o centro de custo** nesta tela. O valor fica **reservado**.
25. **Viagem com paradas.** No dia (ou liberando a saída), o Ivo desliza para sair. No mapa, a rota **passa pelas paradas**. **Abrir no Waze** leva à **próxima parada** (e, depois da última, ao destino).
26. **Previsão de chegada.** Atenção: até chegar na última parada, a previsão pode ser **otimista**. Anote se estranhar.
27. **Concluir.** Ao concluir, o **extrato** mostra **um débito** igual ao valor da corrida (horas × valor por hora, mais as linhas que se aplicam) e o **centro de custo**.
28. **Corrida com paradas (Passageiros).** Repita com a IVO Passageiros e 2 paradas: o débito inclui o **km do trajeto inteiro** e **2 × a taxa por parada**.

## G. Listas de corrida: De → Para
29. **Formato.** Nas corridas do cliente, do Ivo e no painel, a **origem (De)** fica **em cima** e o **destino (Para)** embaixo, com as **Paradas** no meio quando houver.
30. **Pedir de novo.** Numa corrida concluída, toque em **Pedir de novo**. Abre com a mesma rota e categoria, mas **sem as paradas e sem as horas**: coloque de novo.

## H. Navegação
31. **← Início.** Abra qualquer página pelo menu ☰ (Corridas, Agenda, Carteira, Veículos, Categorias e preços…). Todas têm o cabeçalho com **← Início** e o **título da página**. Ao tocar em **← Início**, volta ao pedir corrida (o Ivo volta ao Início dele).
32. **Menu.** O ☰ continua no canto **esquerdo** em toda página, e a página atual aparece **destacada**.
33. **Barra do cliente (celular).** Em Corridas, Agenda e Extrato aparece uma barra fixa embaixo: **Pedir · Corridas · Agenda · Carteira**.

## I. Painel da empresa com abas (computador)
34. **Abas.** Entre como **Administrador** da Umi San (ou como Master, escolhendo a empresa) e abra ☰ › **Painel da empresa**. Em cima há as abas **Painel · Corridas · Pessoas · Carteira**. Alterne entre elas: o cabeçalho e o seletor de empresa ficam no lugar.
35. **Corridas.** Lista completa com filtros (mês, status e centro de custo). Toque em **Exportar CSV do mês**, abra no Excel e confira as colunas **De, Paradas, Para**, **Horas** e **Centro de custo**.
36. **Pessoas** mostra a equipe. **Carteira** mostra saldo e extrato.
37. **Quem não pode.** Um Solicitante ou Visualizador **não** vê "Painel da empresa" no menu.

## J. O app atual não mudou
38. **Comparar.** Abra https://umi-san-transporte.pages.dev: continua igual a antes. Crie um pedido por ele: funciona como sempre. O app atual não usa categorias e segue com os campos antigos do contrato.

**No dia seguinte:** no Painel do ADM, a **reconciliação das 03:00** deve estar "Tudo confere".

**Depois do teste:** diga o que você quer mudar.
