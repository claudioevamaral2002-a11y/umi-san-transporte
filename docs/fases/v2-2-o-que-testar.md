# v2.2: o que testar (roteiro no celular)

> **Quando executar:** a parte "Antes da v2.2" vale **já**, na v2.1. O resto, depois que o Deploy da `main` ficar verde com o PR da v2.2.

Use o endereço principal, **https://umi-san-transporte.pages.dev**, com **dois celulares** e **o computador**:
- **Celular 1: cliente.** Entra como Solicitante da Umi San. Nos itens que pedem, entre como Administrador.
- **Celular 2: Ivo.** Entra como motorista.
- **Computador: Master.** Entra como o ADM.

Marque cada item. **Se algo falhar, pare e anote a tela e a mensagem** (sem links nem senhas).

## Antes da v2.2 (pode fazer agora)
1. **Cancelar o pedido de teste #0018** (05/11, 09:00, 5 pessoas), feito na auditoria. Entre como o cliente que pediu (ou como Master), abra o pedido e toque em **Cancelar**. O app diz **"Sem custo nesta etapa"**. Confirme.
2. **Contato da IVO.** No computador, em ☰ › **Configurações**, preencha o **contato para recarga** com o telefone ou WhatsApp da IVO e salve. Ele aparece no Painel da empresa, e na v2.2 também na Ajuda e na Carteira.

**Depois do deploy:** feche o app nos dois celulares e abra de novo. Se aparecer **"Nova versão · Atualizar"**, toque nele.

## A. Master (computador)
3. **Início.** O Início não diz mais "As telas novas chegam em breve". Em cima aparecem as **pendências** (aguardando orçamento, aguardando aprovação, em andamento, faturas, saldo baixo), cada uma com atalho. Embaixo, o resumo do painel.
4. **Até quantas pessoas.** ☰ › **Categorias e preços**. O cartão da **IVO Passageiros** mostra **"até 4 pessoas"**. Toque no lápis: o campo **"Até quantas pessoas"** está com 4. Confira as outras categorias e preencha o limite se quiser (vazio = sem limite). Toque em **Salvar categoria**.
5. **Contato da IVO.** ☰ › **Configurações**: o bloco agora se chama **"Contato da IVO (aparece na Ajuda e na Carteira)"** e mostra o contato do item 2. Se estiver vazio, aparece um aviso.
6. **Nota no contrato.** ☰ › **Contratos** › Umi San. Junto dos km "sem/com reboque" aparece a nota: *"Pedidos por categoria usam os preços de Categorias e preços…"*, com um link. O link abre **Categorias e preços**.
7. **Filtro da auditoria.** ☰ › **Auditoria**.
   - Abra **Ação**: aparecem as ações de verdade (por exemplo, criar pedido e aprovar orçamento), separadas por assunto (Acesso, Pedidos, Dinheiro, Faturas, Cadastros).
   - Digite uma data pela metade em **De** e toque em **Filtrar**: aparece **"Data inválida"**, e a lista não muda.
   - Ponha **De** depois de **Até**: aparece **"A data inicial é depois da final"**.
   - Com datas certas, a lista filtra e as datas continuam nos campos.

## B. Cliente pede (celular 1, Solicitante)
8. **O Para não some.** No Início, digite o **De** e, logo em seguida, o **Para**, sem esperar. Quando o De termina de carregar, o texto do **Para** continua lá. Faça o mesmo com uma parada.
9. **Limite de pessoas.** Escolha **IVO Passageiros** e abra **Detalhes da corrida**. Ao lado de **Pessoas** aparece **"até 4 pessoas"**, e o **+** para em 4.
   - Escolha uma categoria sem limite e ponha 6 pessoas. Volte para a Passageiros: o número desce para 4 e aparece um aviso curto.
10. **Ver cálculo.** Embaixo da lista de categorias, toque em **Ver cálculo**: aparecem as linhas do preço (km, taxa fixa, retorno e o que mais houver). A soma é o preço mostrado.
11. **Pedir.** Peça a Passageiros com 4 pessoas, uma observação e um centro de custo.
12. **Resumo do pedido.** A tela da corrida mostra o **número** (#00xx) no topo. Toque em **Detalhes do pedido**: aparecem as pessoas, a observação e o centro de custo.

## C. Rodada guiada como motorista (celular 2)
13. **A chamada chega.** O pedido do item 11 abre sozinho no celular 2, com De, Para, categoria, **4 pessoas** e a observação.
14. **Orçar.** Toque em **Aceitar por R$ X** (ou em **Propor outro valor**, mude um valor e envie). Aparece **"Proposta enviada"**.
15. **No celular 1**, a proposta aparece. Confirme a corrida. A tela vira **"Corrida confirmada"**, ainda com o número e os Detalhes do pedido.
16. **Ajuda do motorista.** No celular 2, ☰ › **Ajuda**: aparece **"Falar com a IVO"** com o contato do item 2, e as perguntas sobre orçar, sair e concluir abrem e fecham.
17. **Sair e concluir** (só quando a corrida estiver a menos de 1 hora): abra a corrida, **deslize para sair**, aceite compartilhar a localização e, no fim, toque em **Concluir serviço**. Se não quiser esperar, faça os itens 18 a 20 com outro pedido e volte aqui depois.

## D. Cancelada sem cobrança (celular 1)
18. **Cancelar.** Faça outro pedido, para daqui a **2 dias ou mais**, e peça ao Ivo para orçar. Confirme. Na tela da corrida, toque em **Cancelar agendamento**. A folha diz **"Cancelando agora: sem multa"**. Confirme.
19. **Resultado.** O topo diz **"Cancelada sem cobrança · reserva de R$ X devolvida"**. Embaixo aparece **"Orçamento (não cobrado)"**, e **não** aparece "Se precisar cancelar depois".
20. **Na lista.** Em **Pedidos** › **Encerrados**, o pedido cancelado mostra **"Sem cobrança"**, e não o valor do orçamento.

## E. Agenda (celular 1)
21. **Concluída no dia.** Depois que o Ivo concluir uma corrida (item 17), abra a **Agenda** no dia dela: aparece um **cartão cinza** com o número e o selo **"Concluída"**. Tocar nele abre a corrida.
22. **Mês igual ao dia.** Em **Mês**, o dia diz "N pedidos seus", e a lista embaixo tem os mesmos N cartões.
23. **"3 dias" em tela cheia.** Toque em **3 dias** com o celular na vertical e depois na horizontal. Aparecem **três colunas**, cada uma com o dia no topo, sem precisar arrastar para o lado. Se algo cortar ou sumir, **tire um print** e anote o modelo do celular.

## F. Ajuda, Locais salvos e Carteira (celular 1)
24. **Ajuda do cliente.** ☰ › **Ajuda**: **"Falar com a IVO"** com o contato. As respostas falam de orçamento, aprovação, cancelamento (com as faixas de multa **do contrato da Umi San**) e recarga ou fatura.
25. **Locais salvos (Solicitante).** ☰ › **Locais salvos**: aparecem os locais da empresa, os mais usados primeiro. Toque em **Pedir daqui**: o Início abre com o **De** preenchido. O Solicitante **não** vê o lápis.
26. **Locais salvos (Administrador).** Entre como Administrador. Agora cada local tem o lápis: **renomeie** um local. **Excluir** pede confirmação; os pedidos antigos não mudam.
27. **Carteira.** Numa empresa no Crédito, a **Carteira** diz **"Para recarregar, fale com a IVO: …"** com o contato. A aba **Corridas** do Painel diz "Corridas em andamento, concluídas e canceladas (com a multa, quando houve)".

## G. Fim
28. **Versão.** Em ☰ › **Perfil e segurança**, nos dois celulares e no computador, o fim da página mostra **versão 2.2.0**.
