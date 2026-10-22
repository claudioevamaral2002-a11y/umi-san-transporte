# Fase 4.1: categorias livres com tabela própria, paradas e ajustes do app novo

Estado: **aprovada pelo dono em 22/10/2026**, com os mockups. As decisões vieram do primeiro teste do dono no app novo (ivo-novo.pages.dev), feito no mesmo dia. Mockups: [`../redesign/mockups-fase-4-1.html`](../redesign/mockups-fase-4-1.html). Base: fase 4, já em produção ([`fase-4-ivo-estilo-uber-desenho.md`](fase-4-ivo-estilo-uber-desenho.md)).

## 1. O que o dono pediu (22/10)

1. **Categorias livres, cada uma com a própria tabela de preço.** Toda a precificação é feita categoria por categoria, para dar flexibilidade na criação e na edição. As iniciais são **IVO Passageiros**, **IVO Carga Leve** e **IVO Motorista**. Em cada uma ele preenche, individualmente, taxa fixa, valor por km, hora de espera e as outras variáveis.
2. **IVO Motorista** é o Ivo dirigindo o carro da empresa cliente, **cobrado por hora**. Toda categoria tem o campo **valor por hora**: preenchido quando se aplica, zerado quando não.
3. **Paradas:** o percurso **origem → paradas → destino** é cobrado inteiro, pelo km, mais uma **taxa fixa por parada** de cada categoria. Se a categoria não cobra parada, o valor fica zerado.
4. **Centro de custo:** campo **escrito** (não uma lista) para alocar a corrida, visível já ao pedir.
5. **O cadastro de veículo** não mostrava os nomes novos das categorias. Corrigir.
6. **Agenda expandida** "meio zoada": ajustar o layout e criar uma **barra de rolagem lateral personalizada**.
7. **Painel da empresa:** Corridas, Pessoas e Carteira levavam para páginas diferentes. Elas devem ser **abas** entre as quais se alterna com facilidade.
8. **Menu lateral "unidirecional":** de qualquer página deve dar para alternar e **voltar à tela inicial de pedir corrida**.
9. **Corridas:** origem em cima do destino, no formato **De → Para**.
10. **Sem origem pré-preenchida** (hoje vinha "Rua Araguaia, 49").

## 2. Decisões

| Tema | Decisão |
|---|---|
| Categorias | Livres. O Master **cria novas** (dono, 22/10), renomeia, ativa e desativa. Iniciais: IVO Passageiros, IVO Carga Leve (com reboque) e IVO Motorista; Carga Pesada desligada. Uma categoria já usada em pedidos **não é apagada**, só desativada |
| Tabela por categoria | **Os mesmos campos em toda categoria**: taxa fixa, valor por km, valor por hora, hora de espera, taxa por parada, retorno de trecho único (%), taxa de reboque e diária de hospedagem. **Zerado = não cobrado** (dono) |
| IVO Motorista | Cobrada **por hora**, com o carro do cliente (dono). Em termos de cadastro, é uma categoria com "veículo do cliente" marcado e valor por hora preenchido |
| Paradas | Trajeto inteiro pelo km + taxa fixa por parada (dono). **Até 3 paradas** *(decisão minha)* |
| Ida e volta com paradas | A ida passa pelas paradas; a **volta vai direto** do destino para a origem *(decisão minha)* |
| Corrida por hora | O cliente informa as **horas estimadas**; o Ivo confirma ou ajusta na calculadora, como faz com os km *(decisão minha)* |
| Centro de custo | Texto livre de até 80 caracteres, **opcional**, preenchido **ao pedir** (já vem o último usado) e editável na confirmação (dono: "campo escrito e não lista") |
| Versões do contrato | Continuam imutáveis. Editar a tabela de uma categoria **publica uma versão nova** do contrato, com a tabela de todas as categorias |

## 3. Fora de escopo

- Lista fixa de centros de custo, ou centro de custo obrigatório por empresa.
- Mais de 3 paradas e reordenar paradas arrastando (dá para remover e adicionar de novo).
- Preço por categoria diferente por empresa **pela tela nova**: a tabela vale para o contrato modelo e para o contrato da empresa escolhida no topo (Master), como hoje.
- App de loja, notificações (fase 5) e vários motoristas.

## 4. Dados (migrations novas; nenhuma antiga é editada)

### 4.1 Categorias livres

- `app.categorias`:
  - remove a trava que só aceitava três códigos;
  - o `codigo` passa a ser um identificador gerado do nome (ex.: `MOTORISTA`), único e **imutável**;
  - acrescenta `veiculo_cliente boolean not null default false`, que vale true para a IVO Motorista: não exige veículo da IVO e não cobra reboque;
  - mantém `carga` e `reboque`, que continuam preenchendo os campos do pedido como hoje.
- **Dados iniciais** (aplicados por migration):
  - IVO Passageiros continua como está;
  - **IVO Carga Leve passa a usar reboque** (dono, 22/10: "carga leve que usará reboque"): fica marcada "com reboque", e a taxa de reboque entra na tabela dela;
  - a antiga `CARGA_PESADA` (que o dono renomeou para "IVO Motorista" na tela, mas ainda é "com reboque") é **desativada** (dono: "no momento off") e mantida para o histórico. Pode ser reativada pelo Master;
  - entra uma categoria nova, **`MOTORISTA`** ("IVO Motorista", "Ivo dirige o carro da sua empresa"), com `veiculo_cliente = true`;
  - os pedidos antigos continuam válidos.
- `api.salvar_categoria(p)` passa a **criar** categorias (sem `codigo`: ele é gerado do nome) e a editar, incluindo `veiculo_cliente`. Só o Master.

### 4.2 Tabela de preço por categoria

- Tabela nova `app.tarifas_categoria (contrato_id, categoria, taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent, parada_cent, retorno_bp, reboque_cent, hospedagem_diaria_cent)`:
  - todos os valores ≥ 0;
  - imutável, como `contratos_categorias`;
  - uma linha por categoria por versão de contrato.
- **Compatibilidade:** versões sem tarifa de uma categoria caem na tabela antiga (`contratos_categorias` e os campos do contrato), como hoje. Nenhum preço em produção muda até o Master publicar a tabela nova.
- **Publicar:** `api.publicar_tarifas(p_empresa, p_tarifas jsonb, p_vigente_desde)`:
  - cria uma versão nova do contrato, copiando os campos comuns da versão vigente (prazos, faixas de cancelamento, limite de crédito);
  - grava a tarifa de **todas as categorias ativas**;
  - mesmas regras e auditoria de hoje.
- **Copiar adiante:** `publicar_contrato` (app atual) e `publicar_contrato_categorias` copiam as tarifas da versão anterior, como já fazem com os preços por categoria.

### 4.3 Cálculo

Uma função nova `interno.linhas_da_tarifa(t, p_levar, p_trazer, e)`:
- **Entrada:** `km` (trajeto total), `horas`, `espera_horas`, `paradas` (quantidade), `usa_reboque`, `pedagio_cent`, `hospedagem_diarias` e `outros`.
- **Linhas**, só quando o valor da tarifa e a quantidade são maiores que zero:
  - `TAXA_FIXA`;
  - `KM` = km × km_cent;
  - `RETORNO` = retorno_bp sobre a linha KM, só em trecho único;
  - `HORAS` = horas × hora_cent;
  - `ESPERA`;
  - `PARADAS` = paradas × parada_cent;
  - `REBOQUE`;
  - `PEDAGIO`, `HOSPEDAGEM` e `OUTROS`, como hoje.
- **Total zero é recusado** (`VALOR_INVALIDO`), como na fase 4.
- **Onde é usada:** `categorias_disponiveis`, `calcular_orcamento` e `enviar_orcamento` usam essa função quando a versão tem tarifa da categoria; senão, o caminho atual.
- **Ida e volta:** km = ida pelas paradas + volta direta (§5). O cliente manda os dois trechos e o servidor confere a soma.

### 4.4 Pedido

- **Tabela nova** `app.atividades_paradas (atividade_id, ordem 1..3, texto, place_id, lat, lng)`. De um ponto do Google guarda **só o `place_id`** (termos do Google); de um ponto marcado no mapa, lat/lng.
- **`criar_pedido`** aceita ainda:
  - `paradas` (lista de até 3);
  - `horas_estimadas` (0,5 a 24, quando a categoria cobra por hora);
  - `centro_custo` (até 80 caracteres).
- **`confirmar_corrida`** pode **trocar** o centro de custo, e não só gravar quando está vazio.
- **Disponibilidade:** uma categoria com `veiculo_cliente` fica disponível se houver motorista ativo; as outras continuam exigindo um veículo ativo que a atenda.

## 5. Rota com paradas

- A ação `rota` da função `enderecos` aceita `paradas: PontoRota[]` (até 3), que vão para a Routes API como **pontos intermediários** na mesma chamada. Ela devolve o km total, os minutos e a linha do trajeto.
- **Ida e volta:** uma segunda chamada, destino → origem direto, soma os km da volta.
- **O que não é gravado:** a linha nem os endereços formatados.
- **Custo:** a chamada com paradas conta como uma chamada (com volta, duas), dentro do teto diário da empresa.

## 6. Telas

### 6.1 Pedir (cliente) — mockup 1

- **Campos:** **De** (origem, **vazia** ao abrir; os locais da empresa continuam aparecendo primeiro na busca) e **Para** (destino). Entre os dois, **"+ Adicionar parada"** (até 3), cada parada com um × para remover.
- **O mapa** desenha origem → paradas → destino.
- **Nas categorias,** o preço estimado já considera as paradas. Para a categoria cobrada por hora, aparece **"Horas estimadas"** com − / +, e o preço considera as horas.
- **Logo acima do botão Pedir,** o campo **"Centro de custo (opcional)"**, texto livre, já com o último usado.

### 6.2 Motorista

- **Chamada e calculadora:** os itens seguem a tabela da categoria (km, horas, espera, paradas, pedágio, hospedagem, outros). Só aparece o que tem preço maior que zero na tarifa.
- **Viagem:** a rota desenhada passa pelas paradas, e "Abrir no Waze" vai para a **próxima** parada.
- **Cadastro de veículo:** as categorias vêm **do banco**, com os nomes atuais, e só aparecem as que usam veículo da IVO.

### 6.3 Master — Categorias e preços (mockup 2)

- **Lista de categorias** em cartões, cada um com **nome**, **descrição**, **ativa**, **veículo do cliente** e a **tabela**: taxa fixa, por km, por hora, hora de espera, por parada, retorno (%), reboque e diária de hospedagem.
- **Uma ajuda curta** em cada campo: "deixe zerado se não cobra".
- **"+ Nova categoria"** abre um cartão em branco.
- **"Publicar tabela"** publica a versão nova com todas as categorias. Antes, uma revisão mostra **o que mudou** em cada categoria.

### 6.4 Navegação (mockup 3)

- **Cabeçalho comum:** toda página aberta pelo menu ☰ ganha um cabeçalho com **"← Início"** (volta à tela de pedir corrida; ao Início do motorista, para ele) e o **título da página**.
- **O menu ☰** continua disponível em todas as páginas, com a **página atual destacada**, para trocar de uma para outra direto.
- **No celular, cliente:** uma barra fixa embaixo com **Pedir · Corridas · Agenda · Carteira** *(decisão minha: troca rápida entre as mais usadas)*.

### 6.5 Painel da empresa com abas (mockup 4)

- **Painel · Corridas · Pessoas · Carteira** viram **abas da mesma página** (`/empresa`, `/empresa/corridas`, `/empresa/pessoas` e `/empresa/carteira`), com o mesmo cabeçalho e o mesmo seletor de empresa do Master.
- **Conteúdo de cada aba:**
  - Corridas: a lista completa com filtros (mês, status, centro de custo) e o CSV;
  - Pessoas: a Equipe;
  - Carteira: saldo e extrato.
- Tudo no tom executivo já aprovado.

### 6.6 Ajustes

- **Agenda:**
  - os dias da semana ficam numa faixa com **rolagem lateral personalizada** (barra fina nas cores do IVO, setas no computador e encaixe por dia);
  - a grade de horários fica em colunas alinhadas;
  - a folha não estoura a tela no celular.
- **Listas de corrida:** **De** (origem) em cima e **Para** (destino) embaixo, com as paradas entre os dois quando houver. Vale para as corridas do cliente, as do motorista, o painel e o CSV.

## 7. Segurança e regras

- **Valem as regras de ouro de sempre:**
  - toda regra no banco;
  - RPCs `security definer` com `search_path = ''`;
  - negações auditadas;
  - dinheiro em centavos;
  - nenhuma UI otimista no dinheiro;
  - livro-razão imutável;
  - migrations só novas.
- **O app atual continua funcionando:** ele cria pedidos sem categoria, e o caminho antigo de preço permanece.
- **Termos do Google:** das paradas, só `place_id` ou o ponto marcado.

## 8. Testes

- **pgTAP:**
  - criar e editar categoria, com o código imutável;
  - a categoria antiga desativada não some do histórico;
  - tarifa por categoria;
  - fallback sem tarifa;
  - cada linha nova (taxa fixa, horas, paradas) aparece só quando o valor é maior que zero;
  - total zero recusado;
  - IVO Motorista disponível sem veículo;
  - pedido com 3 paradas (com a 4ª recusada);
  - centro de custo ao pedir e trocado na confirmação;
  - publicar tarifas copia os campos comuns;
  - o app atual sem mudança;
  - a guarda `0001`.
- **Unidade:** a soma da ida com paradas e da volta direta; o formulário de tarifa (zerado = não cobra).
- **e2e:**
  - adicionar e remover parada;
  - preço com paradas;
  - categoria por hora com horas estimadas;
  - centro de custo ao pedir;
  - Master cria uma categoria e publica a tabela;
  - o cadastro de veículo mostra os nomes novos;
  - "← Início" e o menu em todas as páginas;
  - as abas do painel;
  - a agenda a 390 px sem rolagem horizontal da página;
  - De → Para nas listas.
- **e2e contra o banco real:** corrida da IVO Motorista por hora e corrida da IVO Passageiros com 2 paradas, até o débito no extrato.

## 9. O que o dono faz depois

Em **Categorias e preços**:
- confere as três categorias;
- preenche a tabela de cada uma;
- clica em **Publicar tabela**.

Até isso, os preços continuam os de hoje.

## 10. Decisões complementares (revisão do construtor; *decisões minhas*, conferir na leitura)

- **Reboque:**
  - a linha `REBOQUE` só é cobrada quando a categoria está marcada "com reboque" **e** a taxa de reboque é maior que zero;
  - nas categorias sem reboque e nas de veículo do cliente, o campo nem aparece.
- **Primeira tabela:**
  - ao abrir "Categorias e preços" pela primeira vez, cada categoria já vem **preenchida com os preços que valem hoje**: km da categoria, taxa, espera, hospedagem, retorno e reboque do contrato. Nada fica zerado por esquecimento;
  - uma revisão antes de publicar mostra o que mudou.
- **Categoria criada depois da última publicação:**
  - aparece ao cliente como **"Indisponível no momento"** até ganhar tabela numa publicação;
  - versões sem tarifa de uma categoria antiga continuam no caminho de preço de hoje.
- **Campos antigos do contrato:**
  - continuam valendo para os pedidos do app atual, que não usam categoria;
  - publicar a tabela copia os campos comuns (prazos, cancelamento, limite de crédito) da versão vigente.
- **Veículos:**
  - a trava que aceitava só três códigos sai;
  - as categorias do veículo passam a ser conferidas contra a tabela de categorias. Só valem as que usam veículo da IVO;
  - a disponibilidade lê as categorias do banco, sem lista fixa.
- **Código da categoria:**
  - gerado do nome, sem o prefixo "IVO", sem acentos e em maiúsculas (ex.: "IVO Motorista" vira `MOTORISTA`);
  - se repetir, ganha `_2`;
  - o nome é único entre as categorias ativas.
- **Categoria com km e hora preenchidos:**
  - cobra os dois, pela regra "zerado = não cobra";
  - as horas estimadas são obrigatórias quando o valor por hora é maior que zero;
  - o Ivo ajusta as horas na calculadora, como faz com os km.
- **Km com paradas e ida e volta:**
  - o km da tela do cliente é só estimativa da prévia, como hoje;
  - o preço que vale é o do orçamento do Ivo, que confirma os km na calculadora. O servidor não precisa refazer a rota.
- **Tabela por empresa:**
  - publicar com a empresa vazia vale para a **tabela modelo**; publicar com uma empresa vale **só para ela**;
  - a tabela modelo não se propaga para as empresas, como hoje.
- **CSV:** ganha as colunas "Paradas" e "Horas". "De" e "Para" ficam nessa ordem.
- **Último centro de custo:** guardado no aparelho, como hoje. O limite de 80 caracteres é conferido no banco.

## 11. Desvios na implementação

Notas do que saiu diferente do aprovado. As decisões acima não foram alteradas.

- **Menu ☰ na esquerda (§6.4):** fica à esquerda, porque a casca do app é fixa em todas as telas; o mockup o mostrava à direita.
- **Abas do painel (§6.5):** são `<nav>` com links (uma rota por aba), e não `tablist`.
- **"Pedir de novo":** não carrega paradas nem horas; abre com a rota e a categoria.
- **Paradas no mapa (§6.2):** a rota passa por elas, mas não há pinos nas paradas.
- **Previsão de chegada do motorista:** é otimista até a última parada, porque é calculada para o destino final.
- **Km em ida e volta (§4.3 e §5):** `categorias_disponiveis` ganhou `km_volta` opcional (migration `20261022120300`), para a prévia do cliente bater com o orçamento do motorista. O cliente só manda a volta quando há paradas.
- **Nomes de categoria para veículos (§6.2):** nova leitura `api.categorias_veiculo()` (migration `20261022120200`), porque `categorias_adm` é só do Master.
- **Compatibilidade de app em cache:** `diarias` é ignorada no caminho de categoria; a Carga Leve com reboque é aceita do app da fase 4; o app da fase 4 não manda horas (ver RUNBOOK §19.4).
- **Aviso ao publicar (§6.3):** a revisão avisa quando Passageiros ou Carga Leve passam a cobrar por hora, pelo motivo acima.
