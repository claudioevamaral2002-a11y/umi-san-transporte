# v2.1: o que testar (roteiro no celular)

> **Quando executar:** depois que o Deploy da `main` ficar verde com o PR da v2.1. Antes, é preciso ter mesclado a v2.0 (PR #42).

Use o endereço principal, **https://umi-san-transporte.pages.dev**, com **dois celulares** e **o computador**:
- **Celular 1: cliente.** Entra como Solicitante da Umi San. Para a parte D, entre como Administrador.
- **Celular 2: Ivo.** Entra como motorista.
- **Computador: Master.** Entra como o ADM.

Marque cada item. **Se algo falhar, pare e anote a tela e a mensagem** (sem links nem senhas).

**Antes de começar:** feche o app nos dois celulares e abra de novo. Se aparecer **"Nova versão · Atualizar"**, toque nele. Em ☰ › **Perfil e segurança**, o fim da página deve mostrar **versão 2.1.0**.

## A. Master: Categorias e preços (computador)
1. **Abre só para ver.** Menu ☰ › **Categorias e preços**. Os cartões mostram nome, descrição e só os valores preenchidos (ex.: "Km R$ 4,80 · Diária R$ 400,00"). Não há campos para digitar.
2. **Sem etiquetas antigas.** Os cartões **não** mostram "Com reboque" nem "Leva: …". A IVO Motorista continua com "Veículo do cliente".
3. **Lápis.** Toque no lápis de uma categoria. Os campos aparecem só naquele cartão. Mude um valor: **Publicar tabela** se ativa.
4. **Cancelar.** Toque em **Cancelar**: o valor volta ao publicado e o **Publicar tabela** se desativa de novo.
5. **Sair com rascunho.** Mude um valor e tente ir para o Início. O app pergunta **"Sair sem publicar?"**. Toque em **Continuar editando**.
6. **Excluir e Desativar.**
   - Crie uma categoria de teste (**+ Nova categoria**). No lápis dela aparece **Excluir**: exclua, com confirmação.
   - No lápis de uma categoria já usada (por exemplo, IVO Passageiros) aparece **Desativar**, não Excluir. **Não confirme** se não quiser desativá-la.
7. **Inativas.** No fim da lista, **Inativas (N)** abre as desativadas, e o lápis delas mostra **Reativar**.

## B. Pedir com diárias e outros custos (celular 1)
8. **Sem "Ida e volta".** Escolha origem e destino e abra **Detalhes da corrida**: não existe mais **Ida e volta**.
9. **Diárias.** Numa categoria com diária de hospedagem, aparece **Diárias (hospedagem)** `− 0 +`. Coloque 2: o preço da prévia sobe 2 diárias.
10. **Outros custos.** Escreva em **Outros custos (opcional)**, por exemplo "pedágio BR-101". Embaixo do preço aparece **"+ outros custos no orçamento"**.
11. **Ir e voltar pela parada.** Faça De = Glória, **+ Adicionar parada** = Porto de Vitória, Para = Glória (o mesmo endereço do De). O preço **não** cobra "retorno de trecho único".
12. **Pedir.** Peça a corrida.

## C. Ivo: diárias e outros custos (celular 2)
13. **Na chamada** aparece **"Diárias: 2"** e **"Outros custos: pedágio BR-101"**.
14. **Propor outro valor.** A calculadora já abre com **Hospedagem = 2** e, acima de "Outros", **"O cliente avisou: pedágio BR-101"**. Ponha o valor do pedágio em "Outros" e envie.
15. **No celular 1**, confirme a proposta. O memorial mostra a hospedagem e o pedágio.

## D. Faturamento por NF (Master no computador, cliente no celular 1)
16. **Trocar a forma.** Em ☰ › **Contratos** › Umi San, publique uma versão nova com **Forma de cobrança: Faturado (NF)**, valendo a partir do início da próxima quinzena (dia 1 ou 16).
    - O limite e o alerta de saldo somem do formulário.
    - Se a Umi San tiver saldo diferente de zero, aparece um aviso. Acerte o saldo com um **Ajuste** em ☰ › **Créditos** antes da troca valer.
17. **Créditos.** A Umi San aparece com a etiqueta **"Faturado (NF)"** e sem **Recarga**.
18. **Depois que a versão valer, pedir sem saldo.** No celular 1 (Solicitante), peça e confirme uma corrida. A confirmação mostra **"Será cobrada na fatura da quinzena (NF)"**, sem saldo. Depois da confirmação, a corrida mostra **"Entra na fatura da quinzena quando a corrida começar"**.
19. **Painel da empresa** (celular 1 como Administrador, ou o Master escolhendo a Umi San): aparecem **A faturar**, **Em aberto** e **Vencidas**, e a aba **Faturas** no lugar de Carteira.
20. **Gerar a fatura** (no dia 1 ou 16, depois da quinzena fechar):
    1. Emita a NF da quinzena no site da prefeitura.
    2. No app, entre em ☰ › **Faturas** › Umi San › **Gerar fatura**. A quinzena que fechou já vem escolhida, com as corridas e o total.
    3. Preencha o número da NF e a data de emissão. O vencimento já vem em +30 dias.
    4. Anexe o PDF e toque em **Confirmar**.
21. **Cliente vê a fatura.** No celular 1 (Administrador), em Painel › **Faturas** aparece a fatura **Aberta**. **Baixar NF (PDF)** baixa a nota, e **CSV da fatura** baixa a planilha.
22. **Pago.** Quando o pagamento cair, no computador toque em **Marcar como paga** com a data. A fatura vira **Paga**, e em ☰ › **Carteira da empresa** (agora "Lançamentos") aparece **Pagamento de fatura**.
23. **Cancelar fatura** (só se a NF for cancelada na prefeitura): **Cancelar fatura** pede o motivo. As corridas voltam para **A faturar**, e dá para gerar a fatura de novo.

## E. Outras empresas
24. Uma empresa no **Crédito** continua igual: saldo, recarga, "Disponível no saldo" e a aba **Carteira**.
