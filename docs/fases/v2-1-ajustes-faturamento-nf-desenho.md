# v2.1: ajustes do Master e do pedido, e faturamento por Nota Fiscal

Estado: **aprovada pelo dono em 23/10/2026**. Base: v2.0, em que o app novo assume o endereço principal (PR #42, RUNBOOK §20). Origem: pedidos do dono em 23/10, depois do primeiro teste da 4.1, e a proposta comercial **IVO-P26-001 v2** (Umi San).

## 1. O que o dono pediu (23/10)

1. **Tirar as etiquetas "Com reboque" e "Leva: equipamento"** do cartão da categoria em **Categorias e preços**.
2. **Categorias e preços:**
   - hoje a página já abre editável, e não há como excluir categoria;
   - ela deve abrir **só para ver**, com um **lápis** para entrar no modo de edição.
3. **Detalhes da corrida:**
   - o solicitante já pode indicar, ao pedir, se precisa de **diárias** ou de **outros custos**, "bem simples";
   - sai o **"Ida e volta"**, porque agora dá para sair, fazer uma parada e voltar.
4. **Faturamento por Nota Fiscal para a Umi San**, em vez do crédito pré-pago, conforme a proposta. Respostas do dono:
   - o adiantamento de R$ 15.000 é **só controle interno**, sem aparecer no app;
   - as notas são emitidas **de 15 em 15 dias, sem teto**;
   - tudo entra junto nesta versão.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Etiquetas do cartão | Saem "Com reboque" e "Leva: …". Ficam "Veículo do cliente" e "Inativa", que mudam o comportamento da categoria *(decisão minha)* |
| Modo de ver e de editar | Cada cartão abre **só para ver**: nome, descrição e os valores preenchidos. O **lápis** edita **aquele** cartão e mostra **Cancelar**, que desfaz o rascunho. **Publicar tabela** só fica ativo quando há alguma mudança |
| Excluir categoria | **Excluir** só aparece na categoria que **nunca foi usada**: nenhum pedido e nenhuma tabela publicada. Nas outras aparece **Desativar**, que tira a categoria da tela do cliente sem apagar o histórico. As inativas ficam juntas, recolhidas no fim da lista |
| Diárias ao pedir | Um contador **"Diárias (hospedagem)"** de 0 a 30, que só aparece se a categoria cobra diária. Já entra na prévia do preço, e o Ivo pode ajustar na calculadora |
| Outros custos ao pedir | Um campo de texto **"Outros custos (opcional)"**, por exemplo "pedágio da BR-101, balsa", de até 120 caracteres. **Não tem valor**: o Ivo põe o valor no orçamento, e só é cobrado se o cliente aprovar (proposta, §4.2: despesas não previstas) |
| Ida e volta | **Sai** da tela de pedir da v2. Para ir e voltar, o solicitante põe a parada e repete a saída no **Para**. Exemplo: De Glória → Parada Porto de Vitória → Para Glória |
| Volta à origem não paga retorno | Quando o **Para** é o mesmo lugar do **De**, a corrida conta como circuito fechado: **não** cobra o "retorno de trecho único" *(decisão minha; sem isso, a volta pela parada sairia mais cara do que o "Ida e volta" de hoje)* |
| Forma de cobrança | Novo campo do **contrato**: **Crédito (pré-pago)**, como é hoje, ou **Faturado (NF)**. A Umi San passa a Faturado, e as outras empresas não mudam |
| Faturado: pedir e aprovar | O pedido **não exige saldo** e a aprovação **não recusa por saldo**. Continua o resto: orçamento com memorial, aprovação antes da viagem e multa de cancelamento |
| Faturado: o que é cobrado | Cada corrida que sai e cada multa entra no **"A faturar"**. A cobrança acontece na saída, como hoje; a fatura é que muda |
| Quinzena | Do dia **1 ao 15** e do **16 ao último dia** do mês, no horário de Brasília |
| Fechar a quinzena | Só o **Master**, com o botão **"Gerar fatura"** da empresa. A fatura leva tudo o que ainda não foi faturado até o fim da quinzena |
| NF | O dono emite a NF **no site da prefeitura**, fora do app. No portal ele informa o **número**, a **data de emissão** e anexa o **PDF**. O app não emite NF *(sem custo; a emissão automática fica para depois, se valer a pena)* |
| Vencimento | **Emissão + 30 dias** (proposta, §8), calculado pelo app. O Master pode trocar a data numa fatura |
| Pago | O Master marca **"Paga"**, com a data. Fatura não paga depois do vencimento aparece como **Vencida** |
| Teto | **Nenhum** (dono). Fatura vencida só avisa, sem bloquear pedidos |
| Adiantamento de R$ 15.000 | **Fora do app** (dono) |
| Quem vê as faturas | Na empresa, quem vê a Carteira hoje. O **Administrador** (N1) vê a aba **Faturas** no Painel da empresa, e o Master vê as faturas de todas as empresas |

## 3. Fora de escopo

- Emissão automática de NF, boleto, Pix e cobrança automática.
- Juros, multa por atraso e bloqueio por fatura vencida.
- Período diferente de quinzena, ou um por empresa.
- Fatura com várias NFs: é **uma NF por fatura**. Se o dono precisar dividir, gera faturas de quinzenas separadas.
- O adiantamento de mobilização.
- O app v1 ganhar telas de fatura. A v1 continua funcionando, mas sem elas (§7).

## 4. Dados (migrations novas; nenhuma antiga é editada)

### 4.1 Forma de cobrança no contrato
- `app.contratos_versoes` ganha `forma_cobranca text not null default 'CREDITO'`, com o check `in ('CREDITO','FATURADO')`.
- `interno.validar_contrato` e `interno.inserir_contrato` passam a aceitar a chave. **Sem a chave**, o que acontece com o app v1 e com a tela de hoje, a versão nova **herda** a forma da versão vigente. Nada do que se envia hoje passa a ser recusado.
- `publicar_tarifas` já copia os campos comuns, então copia a forma também.
- **Faturado:** o limite de saldo negativo e o alerta de saldo baixo **não se aplicam**. O formulário os esconde, e o banco os ignora.

### 4.2 Pedir e aprovar sem saldo
- `api.criar_pedido`: no Faturado, pula a checagem `SEM_CREDITO`.
- `api.aprovar_orcamento` e `api.confirmar_corrida`, que a chama: no Faturado, pulam `SALDO_INSUFICIENTE`. **A reserva continua**, porque a agenda, a reconciliação e o débito na saída dependem dela; o saldo fica negativo, e é esse o valor devido.
- `api.saldo_empresa` e `api.painel_empresa` devolvem `forma_cobranca`, para a tela escolher o que mostrar.

### 4.3 Faturas
- `app.faturas`:
  - id, empresa, número sequencial por empresa e período (`inicio`, `fim`, a quinzena);
  - `total_cent`;
  - NF: `nf_numero`, `nf_emitida_em`, `nf_pdf_caminho`;
  - `vencimento`;
  - `status` ABERTA, PAGA ou CANCELADA (Vencida não é um status: é ABERTA com o vencimento já passado);
  - `paga_em`, `cancelada_motivo`, `criada_por` e `criada_em`.
- `app.faturas_itens`: (fatura, lançamento). **Um lançamento entra em uma única fatura ativa**: o índice único vale para as faturas não canceladas.
- **Entram na fatura** os lançamentos DEBITO, MULTA, AJUSTE e ESTORNO da empresa, criados a partir do **início da primeira versão Faturado**, ainda não faturados e com data até o fim da quinzena. Um estorno que chega depois do fechamento entra na fatura seguinte.
- **Pagamento:** novo tipo de lançamento `PAGAMENTO_FATURA`, um crédito igual ao total da fatura. Ele zera o que a fatura somou no saldo e aparece no extrato. Nunca entra numa fatura.
- **Storage:** bucket privado `notas-fiscais`, só com PDF de até 5 MB. O Master envia; o Master e o N1 da empresa leem.

### 4.4 RPCs novas (só Master, exceto as leituras)
- `api.previa_fatura(p_empresa, p_inicio, p_fim)`: o que entraria, com a lista e o total. Não grava nada.
- `api.gerar_fatura(p_empresa, p_inicio, p_fim, p_nf)`, em que p_nf = {numero, emitida_em, pdf_caminho, vencimento?}.
  - Grava a fatura e os itens.
  - Recusa: `NADA_A_FATURAR` (total zero ou nenhum item), `QUINZENA_EM_ANDAMENTO` (o fim ainda não passou), `NAO_FATURADO` (empresa no Crédito), `CAMPOS_INVALIDOS`.
- `api.marcar_fatura_paga(p_fatura, p_paga_em)`: cria o lançamento `PAGAMENTO_FATURA`. Recusa: `JA_PROCESSADO`.
- `api.cancelar_fatura(p_fatura, p_motivo)`: só da ABERTA. Os itens voltam para o "A faturar". Serve para a NF cancelada na prefeitura.
- `api.faturas(p_empresa)` (leitura): Master e N1 da empresa. Devolve:
  - o **A faturar**, que é a quinzena atual mais o que sobrou de antes;
  - as faturas, com o status calculado (Aberta, Vencida, Paga, Cancelada).
- `api.fatura(p_fatura)` (leitura): o detalhe, com as corridas (data, quem pediu, De → Para, categoria, centro de custo e valor).
- Valem as regras de sempre: `security definer`, `search_path = ''`, negações auditadas por `interno.negar`, idempotência e trava da conta. A reconciliação diária ganha duas checagens:
  - o total de cada fatura bate com a soma dos itens;
  - nenhum lançamento está em duas faturas ativas.

### 4.5 Pedido: diárias, outros custos e circuito
- `validar_pedido` aceita `diarias_estimadas` (inteiro de 0 a 30), `outros_custos` (texto até 120) e `volta_a_origem` (booleano). As três são opcionais e são gravadas no pedido.
- Prévia (`categorias_disponiveis`): aceita `diarias` e `volta_a_origem`.
  - Com diárias e categoria que cobra diária, entra a linha HOSPEDAGEM.
  - Com `volta_a_origem`, não entra a linha RETORNO.
- Orçamento do Ivo: a calculadora **começa** com as diárias do pedido e mostra o texto de outros custos acima dos itens "Outros", com o lembrete "O cliente avisou: …". O caminho de categoria hoje descarta `diarias` (`linhas_do_pedido`); passa a usar as do pedido quando a entrada não traz `hospedagem_diarias`.
- O app v1 e o app em cache da 4.1 não mandam nada disso e continuam iguais.

## 5. Telas

### 5.1 Categorias e preços (Master)
- Sem as etiquetas "Com reboque" e "Leva: …".
- **Cartão em modo de ver:** nome, descrição, as etiquetas que ficam e uma lista curta só com os valores **maiores que zero** (ex.: "Km R$ 4,80 · Reboque R$ 100,00 · Diária R$ 400,00"). Botão **lápis** ("Editar IVO Carga Leve").
- **Modo de editar:** os campos de hoje, mais **Cancelar**, e **Desativar** ou **Excluir** (§2), com confirmação. Pode haver mais de um cartão em edição ao mesmo tempo.
- **Publicar tabela:** fica no topo e só se ativa quando algum cartão mudou. A revisão e a data "Vale a partir de" continuam como na 4.1.
- **Inativas:** no fim da lista, numa seção recolhida "Inativas (N)", com **Reativar** dentro do lápis.
- Sair da página com rascunho não publicado pede confirmação.

### 5.2 Pedir (cliente)
- "Detalhes da corrida" perde o **Ida e volta** e ganha:
  - **Diárias (hospedagem)** `− 0 +`, só nas categorias que cobram diária, com a dica "Viagem com pernoite";
  - **Outros custos (opcional)**, com a dica "Pedágio, balsa… O valor vem no orçamento".
- O preço da prévia já soma as diárias. Quando há outros custos, embaixo do preço aparece "+ outros custos no orçamento".
- **Pedir de novo** traz as diárias. Pedidos antigos de ida e volta abrem como trecho único.
- O Ivo continua vendo "ida e volta" nos pedidos antigos que foram feitos assim.

### 5.3 Empresa no Faturado
- **Painel da empresa:**
  - os cartões de saldo, "Disponível agora", "Reservado" e "Para recarregar, fale com a IVO" dão lugar a **A faturar (quinzena atual)**, **Em aberto** e **Vencidas**;
  - a aba **Carteira** vira **Faturas**.
- **Aba Faturas:**
  - um cartão "A faturar", com o total e a lista das corridas;
  - abaixo, a lista de faturas: número, quinzena, total, NF, vencimento e uma etiqueta Aberta, Vencida, Paga ou Cancelada;
  - em cada fatura: **Baixar NF (PDF)** e **CSV da fatura**, com as colunas do CSV do mês.
- **Confirmar a corrida:** sai "Disponível no saldo". Entra "Será cobrada na fatura da quinzena (NF)".
- **Acompanhar a corrida:** "Reservado no saldo · a cobrança acontece na saída" vira "Entra na fatura da quinzena quando a corrida começar".
- **Início do cliente:** nunca mostra "sem crédito".
- **Extrato** (☰ › Carteira da empresa): continua, mas com o título "Lançamentos". O saldo negativo aparece como "Em aberto".

### 5.4 Master
- **Contratos:** o formulário ganha **Forma de cobrança** (Crédito ou Faturado). No Faturado, o limite e o alerta de saldo somem.
- **Nova tela ☰ › Faturas:**
  - uma linha por empresa no Faturado, com A faturar, Em aberto e Vencidas;
  - ao abrir a empresa, aparece **Gerar fatura**, que leva a uma folha com:
    1. a quinzena, já escolhida a última que fechou;
    2. a prévia com as corridas e o total;
    3. o número da NF, a data de emissão, o PDF e o vencimento (já preenchido com emissão + 30);
    4. **Confirmar**.
  - em cada fatura: **Marcar como paga**, **Cancelar fatura** (com motivo) e **Trocar PDF**. Trocar o PDF só é possível enquanto a fatura não estiver paga.
- **Início/Painel do Master:** quando houver, mostra a pendência "Quinzena fechada: Umi San pronta para faturar" e "Faturas vencidas".
- **Créditos:** as empresas no Faturado aparecem com a etiqueta "Faturado (NF)", e a Recarga fica escondida para elas.

## 6. Segurança e regras

- **Valem as regras de ouro de sempre:**
  - toda regra no banco;
  - RPCs `security definer` com `search_path = ''`;
  - negações auditadas;
  - dinheiro em centavos;
  - nenhuma UI otimista no dinheiro;
  - livro-razão imutável;
  - migrations só novas.
- **Faturas:**
  - a fatura nunca é apagada: o cancelamento guarda o motivo;
  - o pagamento é um lançamento a mais, e nada é reescrito;
  - o PDF da NF fica em bucket privado, aberto por link assinado de curta duração;
  - o N2 (Solicitante) não vê faturas.
- **Compatibilidade:** nada do que o app v1 e a v2.0 em cache enviam passa a ser recusado. A v1, numa empresa Faturada, mostra o saldo negativo como hoje e consegue aprovar sem saldo, porque a regra está no banco.

## 7. Testes

- **pgTAP:**
  - a forma é herdada quando a chave falta;
  - no Faturado, o pedido sem saldo é aceito e a aprovação sem saldo também;
  - no Crédito, nada muda (SEM_CREDITO e SALDO_INSUFICIENTE como hoje);
  - gerar fatura com os itens certos (DEBITO, MULTA, AJUSTE e ESTORNO, sem RECARGA nem PAGAMENTO);
  - cada recusa: QUINZENA_EM_ANDAMENTO, NADA_A_FATURAR e NAO_FATURADO;
  - o mesmo lançamento não entra em duas faturas;
  - a fatura cancelada devolve os itens;
  - marcar como paga cria o PAGAMENTO_FATURA e, na segunda vez, devolve JA_PROCESSADO;
  - o estorno depois do fechamento cai na fatura seguinte;
  - N1 lê, N2 não lê e o motorista não lê;
  - a reconciliação com as duas checagens novas;
  - diárias e volta à origem na prévia (HOSPEDAGEM entra, RETORNO sai);
  - os campos novos do pedido e os limites deles;
  - a guarda `0001`.
- **Unidade:**
  - o cálculo da quinzena, inclusive na virada de mês e em fevereiro, no horário de Brasília;
  - a detecção de volta à origem (mesmo place_id, ou ponto a menos de 300 m);
  - o vencimento em emissão + 30;
  - o cartão de ver da categoria só com os valores maiores que zero.
- **e2e:**
  - Categorias abre só para ver, o lápis edita, o Cancelar desfaz e o Publicar fica inativo sem mudança;
  - Excluir só aparece na categoria nova;
  - pedir com diárias e outros custos;
  - não há mais o Ida e volta;
  - o Painel e a aba Faturas no Faturado;
  - o Master gera a fatura com o PDF, marca como paga e cancela.
- **e2e contra o banco real:** uma empresa Faturada pede sem saldo; a corrida sai; o Master gera a fatura da quinzena com o PDF; o N1 baixa a NF e o CSV; o Master marca como paga, e o extrato mostra o PAGAMENTO_FATURA.

## 8. O que o dono faz depois

1. Em **Contratos**, publique uma versão nova do contrato da **Umi San** com **Forma de cobrança: Faturado**, valendo a partir do início da próxima quinzena (dia 1 ou 16).
2. Se a Umi San tiver saldo de recarga antigo (positivo ou negativo), acerte antes com um **Ajuste** em Créditos, para a primeira fatura começar do zero. O app avisa na troca se o saldo não estiver zerado.
3. A cada dia **1** e **16**: emita a NF da quinzena que fechou no site da prefeitura e, em ☰ › **Faturas** › Umi San, use **Gerar fatura** com o número e o PDF.
4. Quando o pagamento cair, marque a fatura como **Paga**.

## 9. Decisões minhas (conferir na leitura)

- **A reserva continua no Faturado.** A agenda, a reconciliação e o débito na saída já dependem dela; trocar isso seria mais arriscado do que deixar o saldo ficar negativo.
- **A cobrança continua na saída do Ivo, e não na conclusão.** Assim, uma corrida que começa no dia 15 às 23h entra na quinzena 1–15.
- **Cancelamento com multa no Faturado:** a multa entra na fatura, como manda a proposta (§4.4).
- **Volta à origem:** o mesmo place_id, ou pontos a menos de 300 m um do outro.
- **Diárias até 30 ao pedir.** O Ivo pode ir até 60 na calculadora, como hoje.
- **Uma NF por fatura**, e o PDF é obrigatório para gerar a fatura. Assim, o N1 sempre consegue baixar a nota.
- **Versão:** `package.json` vai para **2.1.0** neste trabalho.

## 10. Desvios na implementação

Notas do que saiu diferente do aprovado. As decisões acima não mudaram.

- **O que entra na fatura (§4.3):**
  - entram as cobranças (DEBITO, MULTA, ADITIVO e AJUSTE) **criadas enquanto o contrato em vigor era Faturado**, e não "a partir do início da primeira versão Faturado". Assim, uma empresa que volta ao Crédito não é faturada pelo que pagou no saldo;
  - um ESTORNO só entra quando a cobrança que ele estorna entraria.
- **Forma herdada (§4.1):** sem a chave, a versão nova herda a forma da versão **em vigor na data escolhida**; na falta dela, a da versão mais alta. A tela de Contratos pré-preenche o seletor com a forma da versão de partida, mas **só manda a chave quando o Master a troca**: publicar sem mexer não desfaz uma troca já agendada.
- **Volta à origem (§4.5):** `api.criar_pedido` não confia no aparelho: grava `volta_a_origem` true só quando o De e o Para têm o mesmo `place_id` ou os dois têm coordenadas a menos de 300 m; senão grava false, sem recusa. A prévia (`categorias_disponiveis`) só estima e aceita a que a tela manda.
- **Ajuste no Faturado:** um Ajuste feito com o contrato em vigor no Faturado entra na próxima fatura. O saldo do Crédito se zera **antes** de a troca valer.
- **Uma fatura por quinzena:** o banco não aceita duas faturas ativas para a mesma quinzena da mesma empresa. Para refazer, cancela-se a anterior.
- **Data do pagamento:** não pode ser futura nem anterior à emissão da NF.
- **Empresa que voltou ao Crédito:** continua em ☰ › Faturas enquanto tiver fatura aberta ou algo a faturar, e o Master ainda consegue gerar a última fatura.
- **Lançamentos (§5.3):** o cartão do extrato chama-se **"Total devido"** (faturado e a faturar), e não "Em aberto". No Painel, "Em aberto" são só as faturas emitidas e não pagas: com o mesmo nome, os dois valores diferentes confundiriam.
- **Baixar NF:** baixa o arquivo direto, sem abrir aba nova. Navegadores de celular bloqueiam janela aberta depois de esperar o link.
- **v1:** a tela de aprovação, Créditos e Contratos (compartilhadas) também mostram a forma de cobrança e o aviso do Faturado.
