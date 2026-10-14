# Fase 3A: endereços reais, distância e prévia do orçamento

Estado: **especificação para revisão do dono** (14/10/2026). Desenho aprovado em conversa: parte 1 (arquitetura) e parte 2 (telas, regras e testes).

> **Nome da fase.** O dono chamou esta rodada de "fase 2". As fases 2A e 2B já existem e estão em produção, então esta vira a **fase 3**, que reúne mapas e execução:
> - **3A** (este documento): endereços, distância e prévia;
> - **3B** (documento próprio, depois): saída e viagem em andamento, com o rastreio do motorista.
>
> A fase 3 do backlog (execução) entra na 3B.

## 1. Objetivo

Quem pede um transporte escolhe a origem e o destino entre endereços reais, vê a distância da rota e, em "Confira o pedido", recebe uma prévia do orçamento calculada pela tabela do contrato da sua empresa. O motorista continua dono do orçamento oficial.

**Sucesso é:**
- o cliente acha o porto, a marina ou o endereço em poucos toques, inclusive locais sem número de rua;
- a prévia bate com o que o motorista calcularia para os mesmos km;
- o motorista já recebe os km preenchidos;
- nenhuma chave do Google fica exposta;
- a CSP continua rígida.

## 2. Decisões do dono (14/10/2026)

| Tema | Decisão |
|---|---|
| Fornecedor | **Google Maps Platform** |
| Uso da distância | **Só estimativa.** O motorista confirma ou ajusta os km no orçamento oficial, e a cobrança não muda |
| Km da prévia | **Só da origem até o destino.** O retorno de 50% (trecho único) vem da tabela, como hoje |
| Local sem endereço | **Marcar no mapa** (pino) |
| Locais já usados | **Sim, locais da empresa** aparecem primeiro na busca |
| Quem vê a prévia | **N1 e N2.** O N2 vê o valor estimado, não a tabela de preços |
| Referência externa | Estudo **público** da Uber: blog de engenharia, projetos abertos e documentação. Nada descompilado (ver §11) |

## 3. Fora de escopo

- Preço fechado automático, sem o orçamento do motorista.
- Base ou garagem da IVO no cálculo dos km.
- Rastreio e mapa durante a viagem (fase 3B).
- Rotas com várias paradas.

## 4. Arquitetura

```
PWA ──(JWT)──► Edge Function `enderecos` ──(chave de servidor)──► Google Places API (New) e Routes API
 │                    │  limite por usuário (interno.checar_limite), sem URL vinda do usuário (SSRF)
 │                    └─► Postgres: api.locais_da_empresa (busca local, sem custo)
 ├──► RPC api.previa_orcamento ──► interno.calcular_linhas (a mesma conta do orçamento do motorista)
 └──► Folha "Marcar no mapa": Leaflet (carregado sob demanda) + blocos do mapa da Google Map Tiles API
```

1. **Busca:** o campo consulta primeiro `api.locais_da_empresa(p_texto)`, no banco e sem custo. Com 3 letras ou mais e 250 ms sem digitar, chama a função `enderecos`, ação `sugerir`, que repassa ao Places Autocomplete (New) com:
   - `sessionToken` (UUIDv4 por sessão de busca);
   - `includedRegionCodes: ["br"]`, `languageCode: "pt-BR"`;
   - `locationBias` no estado de Santa Catarina.
2. **Escolha:** a ação `detalhar` chama o Place Details (New) com o mesmo `sessionToken`, para o Google cobrar a sessão inteira e não cada letra, e com `fieldMask=id,formattedAddress,location`, todos campos da faixa Essentials. O nome vem do texto principal da própria sugestão, porque pedir `displayName` jogaria a cobrança para a faixa Pro. Devolve `{ nome, endereco, lat, lng, place_id }`.
3. **Marcar no mapa:** abre uma folha com o mapa centrado no último ponto buscado (ou em Itajaí) e um pino fixo no centro. A pessoa move o mapa, escreve um nome curto e confirma. O app guarda `{ nome, endereco: null, lat, lng, place_id: null }`.
4. **Distância:** com os dois pontos escolhidos, a ação `rota` chama o Routes `computeRoutes` com:
   - `travelMode: DRIVE`;
   - `fieldMask=routes.distanceMeters,routes.duration`.

   Devolve `{ km, minutos }`. Se falhar ou não houver rota, devolve `{ km: null }`, e a prévia não aparece.
5. **Prévia:** `api.previa_orcamento(p jsonb)` lê o contrato vigente **agora** da empresa de quem chama (`interno.contrato_vigente`), a mesma regra de `api.calcular_orcamento`, para a prévia bater com o orçamento do motorista, e chama `interno.calcular_linhas`:
   - com `{ km, usa_reboque }` e as demais quantidades zeradas;
   - levar/trazer e modalidade vêm do formulário.

   Devolve as linhas e o total. Com "Usa reboque? Não sei", o app chama duas vezes e mostra os dois valores.
6. **Gravação:** `api.criar_pedido` passa a aceitar e gravar coordenadas, endereço formatado, `place_id` e `km_estimado`. Ao criar o pedido, grava ou atualiza os dois locais em `app.locais_empresa`.

### 4.1 Mapa sem afrouxar a CSP

O mapa oficial do Google para web (Maps JavaScript API) injeta `<style>` na página e exigiria `style-src 'unsafe-inline'`, contrariando a CSP rígida, uma regra de ouro do projeto. Por isso:
- **Leaflet** (código aberto, cerca de 40 KB gzip): carregado só quando a folha do mapa abre, fora do bundle inicial. Ele aplica estilos pelo CSSOM, o que a CSP permite.
- **Blocos do mapa da Google Map Tiles API (2D, roadmap):** com uma chave **de navegador** restrita ao domínio do app e só a essa API, e com a atribuição do Google visível no canto do mapa.
- **CSP:** acrescenta `https://tile.googleapis.com` em `img-src` e em `connect-src` (criação da sessão de blocos). Nenhum `script-src` novo.

## 5. Dados (migration nova; nenhuma antiga é editada)

- **`app.pedidos`:** colunas novas, todas opcionais, para o pedido antigo continuar válido:
  - `origem_lat`, `origem_lng`, `destino_lat`, `destino_lng` (`numeric(9,6)`);
  - `origem_endereco`, `destino_endereco` (`text`, até 300 caracteres);
  - `origem_place_id`, `destino_place_id` (`text`);
  - `km_estimado` (`numeric(7,1)`);
  - `minutos_estimados` (`int`).

  Checagens: latitude entre -90 e 90, longitude entre -180 e 180, km entre 0 e 5000.
- **`app.locais_empresa`:**
  - colunas: `empresa_id`, `nome`, `endereco`, `lat`, `lng`, `place_id`, `usos`, `ultimo_uso`;
  - unicidade: (`empresa_id`, `place_id`) quando houver `place_id`, senão (`empresa_id`, `nome`, lat e lng arredondados a 5 casas);
  - sem escrita para usuários: grava só por `criar_pedido` e lê só por `api.locais_da_empresa`.
- **`api.locais_da_empresa(p_texto)`:** até 5 locais da empresa de quem chama, por `usos` e `ultimo_uso`, com filtro por nome ou endereço sem acento. A equipe da IVO não usa essa busca.
- **`api.previa_orcamento(p)`:**
  - liberada para o cliente N1 e N2 e com limite de uso;
  - entradas validadas: km de 0 a 5000, `usa_reboque` booleano, levar/trazer, modalidade, `inicio`;
  - recusa auditada, como as outras RPCs (Adendo A2);
  - **nunca grava orçamento.**
- **`api.criar_pedido`:** passa a aceitar os campos novos e continua aceitando o pedido sem eles.
- **`api.pedido` (detalhe):**
  - devolve os campos novos a quem já vê o pedido;
  - o "Orçar" do motorista recebe `km_estimado`.

## 6. Edge Function `enderecos`

- **Entrada (POST, JWT obrigatório):**
  - `{ acao: "sugerir", texto, sessao }`
  - `{ acao: "detalhar", place_id, sessao }`
  - `{ acao: "rota", origem: {lat,lng}, destino: {lat,lng} }`
- **Validação:**
  - `texto` de 3 a 120 caracteres;
  - `place_id` só com `[A-Za-z0-9_-]` e até 300 caracteres;
  - coordenadas dentro do Brasil (caixa aproximada);
  - `sessao` é um UUID.
- **Limites:** por usuário, com `interno.checar_limite`: 60 sugestões e 20 rotas por minuto. Por empresa, há um teto diário de 2.000 chamadas ao Google, ajustável pelo ADM em Configurações. Acima dele, a busca cai no texto livre.
- **Segurança:**
  - chave de servidor só em segredo da função;
  - URLs do Google fixas no código (nada vindo do usuário), com tempo limite de 5 s;
  - CORS só para a origem do app;
  - a resposta não ecoa a chave nem cabeçalhos do Google;
  - erros genéricos ao usuário e detalhe no log, sem dados pessoais.
- **Custo:** session tokens no autocompletar, field mask mínimo e locais da empresa antes do Google. A rota é recalculada só quando origem ou destino mudam.

## 6.1 Custo esperado (preços oficiais conferidos em 14/10/2026)

Cada serviço do Google tem uma cota gratuita mensal própria, somada por conta de faturamento.

| Serviço | Grátis por mês | Acima disso, a cada 1.000 |
|---|---|---|
| Autocomplete (New) | 10.000 | US$ 2,83 |
| Place Details Essentials | 10.000 | US$ 5,00 |
| Compute Routes Essentials | 10.000 | US$ 5,00 |
| Map Tiles 2D | 100.000 | US$ 0,60 |

Detalhes da cobrança:
- **Sessão concluída:** quando termina num Place Details, a partir da 13ª consulta de autocompletar da sessão o Google não cobra mais.
- **Sessão abandonada:** cada consulta é cobrada separadamente.
- **Estimativa (nossa):** com 300 pedidos por mês, o uso fica dentro das cotas. O primeiro limite a ser passado é o do autocompletar, por volta de 1.000 a 1.200 pedidos por mês.
- **Freio:** o teto diário por empresa (§6) e o alerta de orçamento no Google Cloud (§9) evitam conta surpresa.

Fontes:
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/documentation/places/web-service/preview-billing

## 7. Telas

1. **Novo pedido, passo "Onde?"**
   - Campos "Origem" e "Destino" com a lista em folha:
     - primeiro "Locais da empresa", com ícone de prédio;
     - depois as sugestões do Google, em duas linhas (nome e endereço);
     - no fim, "Não achou? Marcar no mapa".
   - Escolhidos os dois pontos, aparece a linha "38 km, cerca de 45 min" no trilho da rota (círculo, depois triângulo).
   - Teclado: setas e Enter na lista, que usa `role="listbox"`. Leitor de tela: anuncia "5 sugestões".
   - Sem internet ou com o Google fora do ar: o campo vira texto livre com o aviso "Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km.", e o pedido segue sem prévia.
2. **Folha "Marcar no mapa":** mapa em tela quase cheia, pino fixo no centro com o triângulo da marca na ponta, campo "Nome do local" e botão principal "Usar este ponto". Com o movimento reduzido ligado, o mapa não anima.
3. **"Confira o pedido", só para N1 e N2:**
   - bloco "Prévia do orçamento" abaixo das informações principais;
   - valor estimado, com as linhas expansíveis;
   - aviso: "Estimativa pela tabela do contrato. O valor final vem no orçamento do motorista.";
   - com "Não sei" no reboque: "Sem reboque R$ X" e "Com reboque R$ Y";
   - sem km: o bloco não aparece.
4. **"Orçar" (motorista):** km preenchidos com `km_estimado` e o aviso "Estimado pela rota. Confira." O valor continua editável.

## 8. Testes

- **pgTAP:**
  - `previa_orcamento` dá o mesmo total que `calcular_orcamento` para os mesmos km e opções;
  - N3, motorista e equipe são recusados, e a recusa é auditada;
  - empresa sem contrato recebe `SEM_CONTRATO`;
  - `locais_da_empresa` não mostra os locais de outra empresa;
  - não há escrita direta em `app.locais_empresa`;
  - os campos novos de `criar_pedido` são validados;
  - a guarda `0001_privilegios` continua verde.
- **Edge Function (Deno):**
  - validação de entrada;
  - a chave nunca aparece no que é devolvido;
  - limite de chamadas;
  - o Google simulado dá timeout e a função devolve `{ km: null }`.
- **Unidade:** debounce e session token do campo, e formatação de "38 km, cerca de 45 min".
- **E2E de toque (Pixel e iPhone, claro e escuro), com o Google e os blocos do mapa simulados:**
  - autocompletar com local da empresa e Google;
  - marcar no mapa;
  - prévia com reboque Sim, Não e Não sei;
  - sem prévia para N3 e sem km;
  - km preenchidos no "Orçar";
  - zero violações de CSP.
- **Fluxo real (CI):** cria um pedido com coordenadas e km estimado, o motorista vê os km preenchidos e a prévia confere com o orçamento. O Google é simulado na função no ambiente de teste.

## 9. O que o dono precisa fazer (passo a passo na hora da implementação)

1. Criar um projeto no Google Cloud e ativar o faturamento, com um alerta de orçamento mensal.
2. Ativar Places API (New), Routes API e Map Tiles API.
3. Criar a **chave de servidor**, restrita a Places (New) e Routes, e guardá-la como segredo do Supabase e do ambiente `producao` no GitHub.
4. Criar a **chave de navegador**, restrita a Map Tiles e ao domínio `umi-san-transporte.pages.dev`, e guardá-la como segredo de build.
5. Nunca colar chaves no chat.

## 10. Riscos aceitos

- **Custo variável do Google:** controlado com session tokens, cache de locais, limites e alerta de orçamento.
- **Estimativa diferente do real:** a rota do Google não considera rampa, balsa ou acesso restrito de porto. Por isso a prévia é só estimativa, e o motorista ajusta.
- **Mapa por blocos:** com a Map Tiles API e o Leaflet não há o mapa interativo completo do Google (Street View, camadas), e não precisamos disso.

## 11. Referência pública (Uber), aplicada aqui

- **Session tokens do Google:** uma sessão vai de várias chamadas de autocompletar até um único Place Details, e cobra uma vez. https://developers.google.com/maps/documentation/places/web-service/place-session-tokens
- **Locais sem endereço (portos, marinas):** a patente da Uber de embarque por ponto de interesse descreve escolher pelo lugar quando não há endereço e pedir entrada manual quando a precisão é baixa. É o nosso "Marcar no mapa". https://patents.google.com/patent/US11754411
- **ETA:** a Uber combina a rota calculada com uma correção aprendida (DeepETA). Aqui basta a duração do Routes, arredondada em minutos. https://www.uber.com/blog/deepeta-how-uber-predicts-arrival-times/
- **H3, a biblioteca aberta da Uber:** não usamos. Ela serve para agregar oferta e demanda em grande escala, o que é exagero para poucos motoristas e viagens agendadas. https://www.uber.com/blog/h3/
- O que serve à 3B (amostragem de GPS, push de localização, estados de "sinal perdido", retenção) fica registrado no documento da 3B.
