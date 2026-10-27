# v2.2: correções da auditoria externa

Estado: **rascunho para o dono aprovar** (27/10/2026). Base: v2.1 no ar (versão 2.1.0, PRs #42, #43 e #44). Origem: o relatório *Auditoria_IVO_Transportes_Consolidada* (testes de 26/10, perfis Master e Cliente/Administrador da Umi San) e o pedido do dono em 27/10 para corrigir:
- capacidade;
- destino apagado;
- preços;
- resumo do pedido;
- agenda;
- telas "em breve";
- início do Master;
- filtro da auditoria;
- cancelada sem cobrança.

Cada item abaixo diz o achado, a causa encontrada no código e a correção. Os códigos A01–A10 são os do relatório.

## 1. Resumo

| # | Item | Achado (relatório) | Causa no código | Gravidade |
|---|---|---|---|---|
| 1 | Capacidade | A02: o pedido com 5 pessoas em "IVO Passageiros (até 4)" foi aceito (#0018) | A capacidade da categoria só existe no texto da descrição. O app e o banco aceitam de 1 a 99 pessoas em qualquer categoria | Alta |
| 2 | Destino apagado | A03: o texto do **Para** some quando a origem termina de carregar | `InicioCliente.tsx` grava os três campos de uma vez com valores de um render antigo. Ao terminar a busca da origem, o destino volta a ficar vazio | Média |
| 3 | Preços | A01: o contrato mostra R$ 3,50/km, e a categoria R$ 3,80/km | Não é erro de cobrança. Desde a 4.1 o pedido por categoria usa a tabela de **Categorias e preços**, e o km do contrato só vale para pedidos da v1 (sem categoria). A tela do contrato não diz isso. A prévia também não mostra o cálculo (Carga Leve R$ 314,24) | Alta (confusão) |
| 4 | Resumo do pedido | A06: depois de enviado, o cliente não vê o número, as pessoas, as observações nem o centro de custo | `TrilhoCorrida` mostra só De, Para, data e categoria. Os dados já vêm em `api.pedido`. E o pedido **Agendado** ainda abre a tela antiga | Média |
| 5 | Agenda | A04: o mês diz "2 pedidos seus" e o dia aparece vazio | O mês conta pedidos **concluídos**, mas o dia só desenha blocos de agenda **ativos**, e o bloco é desativado ao concluir | Média |
| 6 | Telas "em breve" | A05, A08: **Ajuda** e **Locais salvos** não têm conteúdo, e o contato para recarga não aparece | `EmBreve` em `Provisorias.tsx`. Os locais já são guardados sozinhos, mas não há tela nem RPC para listar, renomear ou excluir. O contato de recarga só aparece no Painel da empresa | Média |
| 7 | Início do Master | A09: "As telas novas chegam em breve" | O Master cai em `InicioProvisorio`. O painel e as pendências já existem em outras telas | Média |
| 8 | Filtro da auditoria | A07: o filtro de **Ação** não tem CRIAR_PEDIDO, APROVAR_ORCAMENTO etc. Datas digitadas somem | A lista de ações é fixa no código (`ACOES`, 23 ações de acesso). Uma data incompleta no campo de data vira vazio sem aviso | Média |
| 9 | Cancelada sem cobrança | A10: cancelada mostra R$ 49,10 sem ter cobrado nada. "Corridas" diz "canceladas com cobrança" | A lista mostra o **orçamento**, não a cobrança. O detalhe (tela da v1) destaca o orçamento e as faixas de multa mesmo depois de cancelado | Baixa |

## 2. Decisões

| Tema | Decisão |
|---|---|
| Limite de pessoas | Nova coluna **"Até quantas pessoas"** na categoria, que o Master edita no lápis de **Categorias e preços**. Vazio = sem limite. Valores iniciais: **IVO Passageiros = 4**. As outras ficam vazias, e o Master preenche se quiser *(decisão minha)* |
| Contador de pessoas | Para em `pessoas_max` e mostra "até 4 pessoas". Ao trocar para uma categoria menor, o número desce até o limite e aparece um aviso curto |
| Banco recusa | `api.criar_pedido` passa a recusar com o código novo **`ACIMA_DA_CAPACIDADE`** quando há mais pessoas do que o limite. **É a única recusa nova desta versão:** um app v2.0/2.1 que ainda não atualizou e mande 5 pessoas recebe "não foi possível" em vez de criar o pedido. Os pedidos da v1 (sem categoria) não mudam *(decisão minha; aceitar 5 num carro de 4 é o defeito)* |
| Peso | Fora desta versão: o app novo não pede peso. "Até 800 kg" continua só como texto |
| Destino | Cada campo (De, paradas, Para) passa a ser atualizado **sozinho**, a partir do valor mais recente. A resposta atrasada de uma busca não apaga o que foi digitado em outro campo |
| Preço no contrato | No cartão do contrato, os km "sem/com reboque" ganham a nota: *"Pedidos por categoria usam os preços de **Categorias e preços**. Estes valores valem para pedidos sem categoria (app v1)."*, com um link. A nota só aparece quando a versão tem tabela de categorias |
| Cálculo na prévia | No cartão da categoria escolhida, **"Ver cálculo"** abre as linhas da prévia (km, fixo, retorno, reboque, diárias, espera), as mesmas do memorial do orçamento |
| Resumo do pedido | Todas as telas da corrida passam a mostrar o **número** (#0018) no topo. **"Detalhes do pedido"**, recolhido, mostra pessoas ou carga, paradas, diárias, outros custos, observações, centro de custo e contato. **Agendada** passa a abrir a tela nova `/corrida/{id}` |
| Agenda | O dia passa a mostrar também as corridas **em andamento** e **concluídas** da própria empresa, em cinza e com o selo "Concluída", tocando para abrir. O número do mês e o dia contam a mesma coisa *(decisão minha: o dia vazio é que estava errado, porque o histórico na agenda é útil)* |
| "3 dias" | Sem mudança no código, porque não achei o defeito lendo. Entra no roteiro de teste com a tela cheia. Se repetir, vira correção |
| Ajuda | Tela real para todos os perfis: **"Falar com a IVO"** (o contato de Configurações, que passa a se chamar "Contato da IVO") e respostas curtas por perfil. Cliente: orçamento, aprovação, cancelamento com as faixas **do contrato da empresa**, recarga ou fatura. Motorista: orçar, sair e concluir. Master: onde fica cada coisa |
| Contato | Também aparece na **Carteira** do cliente, no lugar de "fale com a IVO" sem canal. Se o Master não preencheu, a Ajuda diz "Contato ainda não cadastrado" e o Master vê um aviso em Configurações |
| Locais salvos | Tela real: lista **todos** os locais da empresa, mais usados primeiro, com **"Pedir daqui"**, que abre o pedido com o De preenchido. O **Administrador** da empresa pode **renomear** e **excluir**; os outros níveis só veem *(decisão minha)* |
| Início do Master | Sai o texto provisório. Em cima ficam as **pendências** com atalho: aguardando orçamento, aguardando aprovação, em andamento, faturas a gerar e vencidas, empresas com saldo baixo. Embaixo, o resumo do painel (`PainelResumo`). Os componentes já existem |
| Filtro de ação | As opções vêm do **banco**: as ações que já aparecem na auditoria, com nomes legíveis e agrupadas por assunto (Acesso, Pedidos, Dinheiro, Faturas, Cadastros). Ação sem nome conhecido aparece com o código |
| Datas do filtro | Data incompleta ou inválida mostra "Data inválida" e não filtra. "De" depois de "Até" mostra "A data inicial é depois da final". Nada de ignorar o período em silêncio |
| Cancelada | Na lista de pedidos, cancelada ou expirada mostra **"Sem cobrança"**, ou **"Multa R$ X"** quando houve. O detalhe de cancelada ou expirada mostra no topo **"Cancelada sem cobrança · reserva de R$ X devolvida"** (ou a multa). O orçamento fica embaixo, como "Orçamento (não cobrado)", sem a caixa "Se precisar cancelar depois". O texto de **Corridas** da empresa vira "Corridas em andamento, concluídas e canceladas (com a multa, quando houve)" |

## 3. Fora de escopo

- Os itens de layout e identidade visual do relatório: navegação lateral no desktop, ícones próprios por categoria, densidade dos cartões (§7 e §13). Eles mudam muitas telas e merecem uma versão própria, **v2.3**, com protótipo para o dono escolher.
- Os testes que o relatório não fez: motorista, cadeia completa, segurança do servidor e isolamento entre empresas. Já são cobertos pelos testes automáticos de cada fase. Um novo teste guiado do motorista entra no roteiro (§7).
- Limite de peso e escolha automática de veículo por capacidade.
- Exportações (CSV/PDF), que não mudam.

## 4. Dados (migrations novas; nenhuma antiga é editada)

### 4.1 Capacidade
- `app.categorias` ganha `pessoas_max smallint null`, com o check `between 1 and 99`. A migration põe 4 em `PASSAGEIROS`.
- A RPC que o lápis de **Categorias e preços** já usa para salvar a categoria aceita a chave `pessoas_max`. Sem a chave, mantém o valor de hoje: o que a v2.1 manda continua valendo.
- `api.categorias_disponiveis` devolve `pessoas_max` em cada categoria (chave nova).
- `api.criar_pedido`: com categoria, `carga` em PESSOAS ou AMBOS e `pessoas_qtd > pessoas_max`, recusa `ACIMA_DA_CAPACIDADE` com `{pessoas_max}`, via `interno.negar` e auditado. O erro novo entra em `src/lib/erros.ts`.
- `api.criar_pedido` é recriada a partir da versão de `20261026120000` e **mantém a trava da agenda**.

### 4.2 Agenda
- `api.agenda(p_dia)` ganha a chave nova `concluidas`: as atividades EM_ANDAMENTO ou CONCLUIDA daquele dia que a pessoa pode ver (`interno.pode_ver_atividade`), com id, número, início, duração, De, Para, categoria e status. Os blocos continuam como hoje.
- `api.dias_do_mes` não muda: já conta esses status.

### 4.3 Locais da empresa
- `api.locais_empresa_todos()`: lista os locais da empresa de quem chama (nome, usos, último uso, place_id/lat/lng), mais usados primeiro, até 200. Para cliente de qualquer nível.
- `api.renomear_local(p_id, p_nome)` e `api.excluir_local(p_id)`: só o Administrador (N1) da própria empresa. O nome tem de 2 a 80 caracteres. Excluir apaga o local e não mexe nos pedidos.
- Seguem o padrão de sempre: `security definer`, `{ok,codigo}`, `interno.negar`, limite de chamadas e revoke/grant, com o guard `0001_privilegios`.

### 4.4 Contato e ajuda
- `api.contato_ivo()`: devolve `{ok, contato}` (`app.configuracao.contato_recarga`) para qualquer perfil logado. A coluna não muda de nome; só o rótulo na tela vira "Contato da IVO".
- `api.ajuda_cliente()`: devolve, do contrato vigente da empresa de quem chama, as faixas de cancelamento, o prazo de orçar, a validade do orçamento e a forma de cobrança, para a Ajuda falar com números reais.

### 4.5 Auditoria
- `api.acoes_auditoria()`: só o Master. Devolve as ações distintas de `interno.auditoria` com a contagem, a partir de um índice em `acao`, se ainda não houver.

### 4.6 Cobrança do pedido
- `api.meus_pedidos`: cada item ganha `multa_cent` (lançamentos MULTA da atividade, ou nulo).
- `api.pedido`: ganha `cobranca` = `{debito_cent, multa_cent, liberado_cent}`, somados dos lançamentos da atividade. Fica nulo para o motorista, como a forma de cobrança.

**Compatibilidade:** todas as mudanças de resposta são **chaves novas**, que os apps v1 e v2.0/2.1 ignoram. A única recusa nova é a de §4.1. Os pgTAP que comparam o jsonb exato (0004, 0016 e outros) ganham as chaves novas.

## 5. Telas

### 5.1 Pedir (cliente)
- **Destino:** `InicioCliente.tsx` troca `mudar(o, ps, d)` por atualizações **por campo** (`setDestino(v)` só no Para, e assim por diante). O mesmo vale para "Marcar no mapa".
- **Pessoas:** o `Contador` de `EscolherCategoria.tsx` usa `max = pessoas_max ?? 99`, com o texto "até N pessoas" ao lado. Ao trocar de categoria, desce até o limite e mostra o aviso.
- **Ver cálculo:** no cartão escolhido, mostra as linhas da prévia com o mesmo componente do memorial.

### 5.2 Corrida (cliente)
- `TrilhoCorrida` mostra o número.
- Novo bloco **"Detalhes do pedido"**, recolhido, em Aguardando, ConfirmarCorrida, CorridaConfirmada e Acompanhar.
- `destinoNoAppNovo` passa a mandar **AGENDADA**, **CANCELADA** e **EXPIRADA** para `/corrida/{id}`. Cancelada e expirada ganham a tela **"Encerrada"**: resultado no topo (sem cobrança ou multa, reserva devolvida, motivo do histórico), depois o resumo, o "Orçamento (não cobrado)" e o histórico.
- A tela da v1 (`Pedido.tsx`) recebe só o ajuste de não mostrar "Se precisar cancelar depois" em pedido encerrado, e o selo "Sem cobrança".

### 5.3 Listas
- `CartaoPedido` (lista de pedidos): encerrado mostra "Sem cobrança" ou "Multa R$ X" no lugar do orçamento.
- `AbaCorridas`: troca o texto da descrição (§2).

### 5.4 Agenda
- Os cartões cinza das concluídas e em andamento entram em `GradeHoras` e em `ResumoDoDia`, com toque que abre a corrida.

### 5.5 Ajuda, Locais e Carteira
- **Ajuda:** uma tela por perfil, com "Falar com a IVO" (link de telefone ou WhatsApp quando o contato for número) e perguntas que abrem e fecham. O texto fica no código, e os números vêm de `ajuda_cliente`.
- **Locais salvos:** lista, "Pedir daqui", e o lápis para renomear ou excluir só no N1.
- **Carteira** (`/extrato` e a aba Carteira): para empresa no Crédito, "Para recarregar, fale com a IVO: **contato**".
- O `EmBreve` sai das rotas. O componente fica, sem uso, para telas futuras.

### 5.6 Master
- **Início:** um bloco de pendências com atalhos e, embaixo, o `PainelResumo`. Sai o `InicioProvisorio` para o ADM.
- **Configurações:** "Contato para recarga" vira "Contato da IVO (aparece na Ajuda e na Carteira)", com aviso se estiver vazio.
- **Categorias e preços:** no lápis, o campo "Até quantas pessoas" (vazio = sem limite). O cartão mostra "até N pessoas" quando preenchido.
- **Contratos:** a nota dos km (§2).
- **Auditoria:** a lista de ação vem de `acoes_auditoria`, agrupada e com os nomes de `ACOES`, que é completado com as ações de pedido, dinheiro e fatura. As datas ganham a validação (§2).

## 6. Segurança e regras
- Os locais são escritos só por RPC, e só o N1 da própria empresa renomeia ou exclui. Um id de outra empresa recebe `NAO_ENCONTRADO`, sem dizer que existe.
- `contato_ivo` e `ajuda_cliente` não devolvem nada além do que o cliente já vê no contrato e no painel.
- `acoes_auditoria` é só do Master.
- `cobranca` em `api.pedido` segue a visibilidade do pedido e é nula para o motorista.
- O limite de pessoas é conferido **no banco**. A tela só ajuda.

## 7. Testes
- **pgTAP (novo `0050`):**
  - capacidade: 4 entra, 5 é recusado, categoria sem limite aceita 99, pedido v1 sem categoria não muda;
  - a trava da agenda continua (repete o 0049);
  - `pessoas_max` em `categorias_disponiveis`;
  - `agenda.concluidas` respeita a visibilidade, sem pedido de outra empresa e com o N3 vendo só os próprios;
  - locais: listar, renomear e excluir, com N2/N3 e outra empresa recusados;
  - `contato_ivo`, `ajuda_cliente` e `acoes_auditoria` com a permissão de cada perfil;
  - `multa_cent` e `cobranca`;
  - guard `0001_privilegios`.
- **Unitários:**
  - a atualização por campo do pedido, com a resposta atrasada da origem que não apaga o destino;
  - o limite do contador ao trocar de categoria;
  - a validação das datas da auditoria (incompleta e invertida);
  - o texto "Sem cobrança" ou "Multa".
- **e2e (mock):**
  - `novo-destino-nao-apaga`, que segura a resposta da origem e digita o Para;
  - `novo-capacidade`;
  - `novo-resumo-pedido` (número e detalhes; agendada abre `/corrida`);
  - `novo-encerrada`;
  - `novo-agenda-concluidas`;
  - `novo-ajuda`, `novo-locais` e `novo-inicio-master`;
  - `adm-auditoria-filtro`.
- **e2e real:** um pedido com 5 pessoas recusado e com 4 aceito; um cancelado mostra "Sem cobrança".
- **Roteiro do dono:** `docs/fases/v2-2-o-que-testar.md`, incluindo a "3 dias" em tela cheia e uma rodada guiada como **motorista**.

## 8. O que o dono faz
1. **Agora, antes da v2.2:** cancelar o pedido de teste **#0018** da auditoria (05/11, 09:00, 5 pessoas), como Master ou entrando como o cliente. O app diz "Sem custo nesta etapa".
2. **Agora:** em ☰ › **Configurações**, preencher o **contato para recarga**, com telefone ou WhatsApp. Isso já resolve o A08 na v2.1, no Painel da empresa.
3. Depois do deploy da v2.2: conferir em **Categorias e preços** o "Até quantas pessoas" de cada categoria e seguir o roteiro.

## 9. Decisões minhas (conferir na leitura)
- O limite de pessoas fica na **categoria** (Passageiros = 4), não no veículo. O banco passa a recusar acima disso, e um app desatualizado que mande mais pessoas recebe erro.
- A agenda passa a **mostrar** as concluídas, em vez de deixar de contá-las.
- Só o **Administrador** da empresa renomeia ou exclui locais salvos.
- O contato de recarga vira **"Contato da IVO"**, usado na Ajuda e na Carteira.
- O redesenho visual fica para a **v2.3**.
- Versão do app: **2.2.0**.
