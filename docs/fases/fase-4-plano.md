# Fase 4: plano de implementação (IVO no estilo Uber, MVP em PWA)

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (recomendada) ou superpowers:executing-plans, tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar.

**Objetivo:** construir um segundo app (PWA próprio, num endereço de teste) com o fluxo no estilo Uber: mapa, categorias com preço, chamada ao motorista com contraproposta, confirmação com centro de custo, viagem com rota desenhada e acompanhamento. Ele usa o mesmo banco, e o app atual não muda.

**Arquitetura:** o banco só **acrescenta** coisas: tabelas, colunas e RPCs novas, além de versões novas de RPCs que aceitam campos opcionais. A interface nova fica em `src/novo/` e reaproveita `src/design` e `src/lib`. Ela é gerada pelo mesmo `vite build` em modo `novo` (`dist-novo/`). O mesmo Deploy da `main` publica `dist/` em `umi-san-transporte` e `dist-novo/` num segundo projeto do Cloudflare Pages, `ivo-novo`.

**Tecnologia:** Postgres/Supabase (pgTAP, só no CI), Edge Functions em Deno, React 19 + react-router (`createBrowserRouter`), Vite + vite-plugin-pwa, Leaflet + Google Map Tiles, Playwright, Vitest.

**Especificação:** [`fase-4-ivo-estilo-uber-desenho.md`](fase-4-ivo-estilo-uber-desenho.md), aprovada em 19/10/2026. Mockups: [`../redesign/mockups-fase-4.html`](../redesign/mockups-fase-4.html). Quem executa lê os dois.

O banco só é verificado no CI, porque não há Docker na máquina do dono. Cada tarefa de banco termina com um push no branch `fase-4` e o CI do PR verde (`gh run watch <id> --exit-status`). **Um PR só** para a `main`, e o merge é do dono.

## Restrições globais

- **Migrations:** só novas (`20261020…`), e nenhuma publicada é editada. A guarda `0001_privilegios` continua verde.
- **RPCs:** `security definer set search_path = ''`, devolvem `{ok, codigo}`, auditam as negações (Adendo A2) e usam o padrão de privilégios `revoke all on function … from public, anon, authenticated, service_role; grant execute … to authenticated;`.
- **Compatibilidade:** o app atual chama `criar_pedido`, `enviar_orcamento`, `aprovar_orcamento`, `pedido` e `extrato` exatamente como hoje, e tudo continua funcionando. As chaves novas são opcionais.
- **Dinheiro:** em centavos; o preço vem **sempre** do contrato; nenhuma UI otimista em aceitar, propor, confirmar ou sair. Correção só por estorno.
- **Termos do Google:** do Google, guarda-se só o `place_id`. A linha da rota **não** vai para o banco, e não há instrução curva a curva.
- **Localização:** só durante a corrida. "Disponível para chamadas" não envia posição.
- **Valores fixados pela especificação:**
  - categorias `PASSAGEIROS`, `CARGA_LEVE`, `CARGA_PESADA`;
  - ajuste do motorista de **−50% a +100%** do total da tabela, com motivo de 3 a 200 caracteres;
  - `centro_custo` com até 80 caracteres, opcional;
  - avaliação de 1 a 5, comentário com até 500 caracteres;
  - "Agora" = primeiro horário livre a partir de **agora + 60 min**, com **15 min** para o Ivo responder e **15 min** para o cliente confirmar;
  - o mapa tenta de novo a cada **15 s**.
- **Texto da interface** (exato):
  - "Pedir {categoria} · {dia hh:mm}";
  - "Enviado ao Ivo";
  - "Aceitar por R$ {valor}";
  - "Propor outro valor";
  - "Confirmar corrida · R$ {valor}";
  - "Indisponível no momento";
  - "Corridas do mês";
  - "No Waze, o cliente vê \"sinal perdido\". Volte ao IVO quando puder.";
  - "Nova versão · Atualizar".
- **Português do Brasil** em todo texto e código novo, no estilo do repositório.

## Foco da revisão

1. **App atual depois da migration:** criar, orçar e aprovar sem os campos novos. Tem de funcionar como antes; o teste está na Tarefa 3.
2. **Contrato antigo sem preço por categoria:** o pedido com categoria cai nos campos atuais, e o total é igual ao da prévia de hoje (Tarefa 1).
3. **Proposta exatamente no limite** (−50% e +100%) é aceita; **um centavo além** é recusada com `AJUSTE_FORA_DO_LIMITE` (Tarefa 2).
4. **"Agora" às 23h30:** o primeiro horário livre cai no dia seguinte. O pedido nasce com `prazo_orcar_ate` ≤ início e não expira na criação (Tarefa 2).
5. **Cliente abre o acompanhamento com o motorista parado há 10 min:** aparece a última posição gravada, com o carro cinza e "Sinal do motorista perdido", nunca "—" (Tarefa 9).

---

## Tarefas

| # | Tarefa | Verificação |
|---|---|---|
| 1 | Banco: categorias, preço por categoria, veículos | pgTAP `0027` |
| 2 | Banco: pedido com categoria, "Agora", proposta, confirmação, avaliação, atraso automático, leituras | pgTAP `0028` |
| 3 | Compatibilidade e concorrência (integração) | CI integração |
| 4 | Rota com linha (`enderecos`) | integração + unidade |
| 5 | Segundo site: build `novo`, PWA com aviso, Deploy | e2e `novo-pwa` + CI |
| 6 | Bibliotecas do front novo | Vitest |
| 7 | Moldura do app novo: mapa base e menu | e2e simulado |
| 8 | Cliente pede, aguarda e confirma | e2e simulado |
| 9 | Acompanhar e fim (cliente) | e2e simulado |
| 10 | Motorista: chamada, contraproposta e viagem com rota | e2e simulado |
| 11 | Veículos e telas do ADM (categorias e preços) | e2e simulado |
| 12 | e2e contra o banco real | CI |
| 13 | Fechamento: segurança, roteiro, RUNBOOK, HANDOFF, PR | revisão |

---

### Tarefa 1: categorias, preço por categoria e veículos

**Arquivos:**
- Criar: `supabase/migrations/20261020120000_categorias_veiculos.sql`
- Teste: `supabase/tests/0027_categorias_veiculos.test.sql`

**Interfaces:**
- Produz (tabelas):
  - `app.categorias(codigo text pk check in ('PASSAGEIROS','CARGA_LEVE','CARGA_PESADA'), nome text, descricao_curta text, carga app.tipo_carga, reboque app.reboque, ordem int, ativa bool default true)`. Semente: Passageiros = (PESSOAS, NAO, "até 4 pessoas"); Carga Leve = (EQUIPAMENTO, NAO, "até 800 kg"); Carga Pesada = (EQUIPAMENTO, SIM, "com reboque").
  - `app.contratos_categorias(contrato_id bigint references app.contratos_versoes(id), categoria text references app.categorias, km_cent bigint >= 0, taxa_fixa_cent bigint >= 0, primary key(contrato_id, categoria))`. É imutável, com trigger igual ao de `contratos_versoes`.
  - `app.veiculos(id uuid pk, motorista_id uuid references app.perfis(usuario_id), modelo text 1..60, cor text 1..30, placa text ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' unique, lugares int 0..60, carga_max_kg int 0..50000, reboque_desc text null ≤60, categorias text[] not empty (cada uma em app.categorias), situacao text check in ('ATIVO','MANUTENCAO','INATIVO') default 'ATIVO', criado_em timestamptz)`.
  - Usuários não leem nem escrevem nenhuma das três diretamente.
- Produz (funções):
  - `interno.contrato_da_categoria(c app.contratos_versoes, p_categoria text) returns app.contratos_versoes`. Devolve uma cópia de `c` com os preços da categoria:
    - Passageiros e Carga Leve trocam `km_sem_reboque_cent`;
    - Carga Pesada troca `km_com_reboque_cent` e `taxa_fixa_reboque_cent`;
    - sem linha em `contratos_categorias`, devolve `c` sem mudança (é o fallback).
  - `interno.linhas_da_categoria(c app.contratos_versoes, p_levar bool, p_trazer bool, p_categoria text, e jsonb) returns jsonb`. Chama `interno.calcular_linhas(interno.contrato_da_categoria(c,p_categoria), p_levar, p_trazer, 'VEICULO_PROPRIO', e || jsonb_build_object('usa_reboque', reboque da categoria = 'SIM'))`.
  - `interno.veiculo_atende(p_motorista uuid, p_categoria text) returns uuid`: o primeiro veículo ATIVO do motorista que atende a categoria (o mais antigo), ou null.
  - `api.categorias_disponiveis(p jsonb) returns jsonb`:
    - chaves: `km` (mesma regex da `previa_orcamento`), `levar`, `trazer`;
    - permissão `PREVIA_ORCAMENTO`; limite `checar_limite('CATEGORIAS',300,'1 hour')`;
    - devolve `{ok, categorias:[{codigo, nome, descricao_curta, disponivel bool, total_cent|null, linhas|null}]}`, na ordem de `ordem`;
    - `disponivel = veiculo_atende(motorista_padrao(), codigo) is not null`, e categoria indisponível vem sem preço;
    - km dobrado com levar e trazer, como na prévia.
  - `api.meus_veiculos() returns jsonb`: os veículos do motorista logado. Para o ADM, os de todos, com `motorista_nome`.
  - `api.salvar_veiculo(p jsonb) returns jsonb`:
    - chaves: `id?`, `modelo`, `cor`, `placa` (gravada em maiúsculas, sem hífen), `lugares`, `carga_max_kg`, `reboque_desc?`, `categorias`;
    - quem: o MOTORISTA (só os próprios) ou o ADM, que informa `motorista_id`;
    - códigos: `VEICULO_INVALIDO`, `PLACA_DUPLICADA`, `SEM_PERMISSAO`;
    - devolve `{ok, id}`.
  - `api.mudar_situacao_veiculo(p_id uuid, p_situacao text) returns jsonb`: mesma regra de quem pode.
  - `api.salvar_categoria(p jsonb) returns jsonb`: só ADM (`GERIR_CONTRATOS`). Muda `nome`, `descricao_curta`, `ativa` e `ordem`, nunca o `codigo` nem a correspondência carga/reboque.
  - `api.publicar_contrato_categorias(p_empresa uuid, p jsonb, p_categorias jsonb, p_vigente_desde timestamptz) returns jsonb`:
    - mesmas regras de `publicar_contrato`, que reaproveita: `validar_contrato` e `inserir_contrato`;
    - `p_categorias` = `{"PASSAGEIROS":{"km_cent":"…","taxa_fixa_cent":"…"}, …}`, com as 3 chaves exatas e inteiros pela mesma regex;
    - insere as 3 linhas em `contratos_categorias` na mesma transação;
    - devolve `{ok, versao}`.
  - **`api.publicar_contrato` não muda.**

- [ ] **Passo 1: escrever `0027_categorias_veiculos.test.sql`**, no padrão do `0025`: setup inline com empresa `…e1`, usuários `a1` (ADM), `a4` (MOTORISTA), `a5` (N2), `a6` (N3) e contrato pelo `inserir_contrato`. Asserções:
  - `categorias_disponiveis` sem veículo: as 3 com `disponivel=false` e `total_cent` nulo;
  - depois de `salvar_veiculo` (Hilux, `['PASSAGEIROS','CARGA_LEVE']`): Passageiros e Carga Leve disponíveis e Carga Pesada não;
  - **fallback:** sem `contratos_categorias`, o `total_cent` de Passageiros com km=42 é igual ao de `api.previa_orcamento('{"km":"42","usa_reboque":false,"levar":true,"trazer":false,"modalidade":"VEICULO_PROPRIO"}')`;
  - com `publicar_contrato_categorias` (Carga Leve `km_cent` 500), a Carga Leve com km=10 dá a linha VEICULO_PROPRIO = 10×500 mais o retorno do contrato;
  - Carga Pesada usa `km_com_reboque` e a taxa da categoria (linhas KM_COM_REBOQUE e REBOQUE);
  - veículo em MANUTENCAO deixa a categoria indisponível;
  - N2 não salva veículo (`SEM_PERMISSAO`, auditado); motorista não edita veículo de outro; placa duplicada dá `PLACA_DUPLICADA`; placa `ABC-1D23` é gravada `ABC1D23`;
  - `publicar_contrato_categorias` sem uma das 3 chaves dá `CAMPOS_INVALIDOS`; N1 não publica;
  - N3 não chama `categorias_disponiveis`;
  - `contratos_categorias` imutável: update levanta exceção.
- [ ] **Passo 2:** push; o CI deve falhar no `0027` (funções inexistentes).
- [ ] **Passo 3:** escrever a migration com as interfaces acima.
- [ ] **Passo 4:** push; o CI fica verde, inclusive `0001_privilegios`.
- [ ] **Passo 5:** commit `feat(fase 4): categorias com preço no contrato e veículos do motorista`.

### Tarefa 2: pedido no estilo Uber

**Arquivos:**
- Criar: `supabase/migrations/20261020120100_pedido_estilo_uber.sql`
- Teste: `supabase/tests/0028_pedido_estilo_uber.test.sql`

**Interfaces:**
- Consome: Tarefa 1.
- Produz (colunas em `app.atividades`, todas anuláveis ou com padrão):
  - `categoria text references app.categorias`;
  - `veiculo_id uuid references app.veiculos`;
  - `agora boolean not null default false`;
  - `centro_custo text check (char_length ≤ 80)`;
  - `avaliacao smallint check 1..5`, `avaliacao_comentario text ≤ 500`, `avaliado_em timestamptz`.
- Produz (versões novas, mesma assinatura):
  - **`interno.validar_pedido(p)`** aceita também `categoria` e `agora`:
    - com `categoria`, exige `modalidade='VEICULO_PROPRIO'` e `carga` e `reboque` iguais aos da categoria; senão, detalhe `categoria`;
    - categoria inativa ou sem veículo: `CATEGORIA_INDISPONIVEL`.
  - **`api.criar_pedido(p)`** grava `categoria` e `agora`:
    - com `agora=true`: exige `inicio` entre `now()+55 min` e `now()+36 h`, e `prazo_orcar_ate = least(now()+15 min, inicio)`;
    - sem `agora`: igual a hoje.
  - **`api.enviar_orcamento(p_atividade, p, p_horario_sugerido)`** aceita em `p` as chaves opcionais `veiculo_id`, `ajuste_cent` (texto inteiro com sinal) e `ajuste_motivo`, e retira as três antes do cálculo:
    - pedido com categoria: calcula por `interno.linhas_da_categoria` e exige `veiculo_id` ATIVO, do motorista e que atenda a categoria; senão, `VEICULO_INVALIDO`;
    - pedido sem categoria: igual a hoje, e `veiculo_id` é opcional;
    - com ajuste ≠ 0: acrescenta a linha `{codigo:'AJUSTE_MOTORISTA', descricao: ajuste_motivo, quantidade:1, unitario_cent: ajuste, valor_cent: ajuste}` e soma ao total;
    - o ajuste precisa ficar em `[−total/2, +total]`, com o arredondamento de hoje; senão, `AJUSTE_FORA_DO_LIMITE`. Motivo vazio ou fora de 3..200 dá `MOTIVO_INVALIDO`;
    - grava `atividades.veiculo_id`;
    - `valido_ate = least(now()+15 min, inicio)` quando `agora`; senão, igual a hoje.
  - **`api.pedido(p_id)`** acrescenta ao `pedido`:
    - `categoria`, `categoria_nome`;
    - `veiculo:{modelo, cor, placa}|null`, visível só a partir de ORCADA;
    - `centro_custo`, `agora`, `avaliacao`;
    - `ultima_posicao:{lat, lng, em}|null`, só se `pode_ver_rastreio` e EM_ANDAMENTO, a partir da última linha de `app.posicoes`;
    - e em `acoes`: `avaliar`.
  - **`api.extrato(p_empresa, p_filtro)`**: cada lançamento ligado a uma atividade ganha `centro_custo`.
  - **`api.pendencias()`**: os itens ganham `categoria_nome` e `agora`.
- Produz (novas):
  - `api.confirmar_corrida(p_atividade uuid, p_versao int, p_hash text, p_chave uuid, p_centro_custo text default null, p_dispositivo text default null) returns jsonb`:
    - normaliza o centro de custo com `btrim`, sendo vazio = null; com mais de 80 caracteres, `CENTRO_CUSTO_INVALIDO`;
    - chama `api.aprovar_orcamento(...)`; se `ok`, grava `centro_custo`;
    - devolve o resultado da aprovação.
  - `api.avaliar(p_atividade uuid, p_nota int, p_comentario text default null) returns jsonb`:
    - quem: `interno.pode_decidir` (N1 ou o N2 dono);
    - só CONCLUIDA e uma vez só (`JA_AVALIADO`);
    - nota fora de 1..5: `NOTA_INVALIDA`.
  - **Atraso automático:** `api.enviar_posicao` (versão nova, mesma assinatura) e o payload com `eta`. Quando `eta + (duracao_min − minutos desde saiu_em, mínimo 0)` passar do início do próximo bloco ativo do mesmo motorista, aplica a mesma marcação do `informar_previsao`:
    - `atraso_anterior_ate` no próximo pedido;
    - publicação no tópico dele.
    - Extrair essa parte para `interno.marcar_atraso(a app.atividades, p_fim timestamptz)`, usada pelos dois.
    - Só remarca quando o valor muda mais de 5 min, e limpa quando volta para antes do início do próximo.
    - **`informar_previsao` continua** (o ADM usa).

- [ ] **Passo 1: escrever `0028_pedido_estilo_uber.test.sql`.** Asserções:
  - **criar com categoria:**
    - grava `categoria`;
    - Passageiros com `carga='EQUIPAMENTO'` dá `CAMPOS_INVALIDOS` (detalhe `categoria`);
    - categoria sem veículo dá `CATEGORIA_INDISPONIVEL`;
  - **"Agora":**
    - `inicio=now()+61 min` dá `prazo_orcar_ate` ≤ `now()+15 min` e ≤ inicio;
    - `inicio=now()+30 min` dá `CAMPOS_INVALIDOS`;
    - com `inicio=now()+20 h` (o caso das 23h30), `prazo_orcar_ate = now()+15 min` e o pedido segue SOLICITADA depois de `interno.expirar_vencidos()` rodado na hora;
  - **enviar sem veículo** num pedido com categoria: `VEICULO_INVALIDO`. Com veículo de outra categoria, também;
  - **ajuste:**
    - +100% exato: ok, total = 2× a tabela, linha `AJUSTE_MOTORISTA` presente;
    - +100% + 1 centavo: `AJUSTE_FORA_DO_LIMITE`;
    - −50% exato: ok;
    - −50% − 1 centavo: recusado;
    - motivo `"ab"`: `MOTIVO_INVALIDO`;
  - **`valido_ate` com agora:** ≤ `now()+15 min`;
  - **`confirmar_corrida`:**
    - grava `centro_custo='Operações 4.100'`, lança RESERVA e passa a AGENDADA;
    - 81 caracteres: `CENTRO_CUSTO_INVALIDO` sem reserva;
    - hash errado: o código da aprovação e `centro_custo` continua nulo;
  - **extrato:** o DEBITO depois da saída traz `centro_custo`;
  - **`avaliar`:**
    - ok uma vez; a segunda dá `JA_AVALIADO`;
    - N3 dá `SEM_PERMISSAO`;
    - antes de concluir: `STATUS_INVALIDO`;
    - nota 6: `NOTA_INVALIDA`;
  - **atraso automático:** dois pedidos do mesmo motorista; saída do 1º; `enviar_posicao` com `eta` depois do início do 2º marca `atraso_anterior_ate`; com `eta` antes, a marcação é limpa;
  - **`api.pedido`:**
    - traz `veiculo.placa` para o N2 dono a partir de ORCADA;
    - `ultima_posicao` para o N1 em andamento e nula para o N3.
- [ ] **Passo 2:** push; o CI falha no `0028`.
- [ ] **Passo 3:** escrever a migration.
- [ ] **Passo 4:** push; o CI fica verde (`0001` a `0028`).
- [ ] **Passo 5:** commit `feat(fase 4): pedido por categoria, Agora, contraproposta, centro de custo, avaliação e atraso automático`.

### Tarefa 3: compatibilidade e concorrência

**Arquivos:**
- Criar: `tests/integracao/estilo-uber.test.ts`, no padrão de `tests/integracao/execucao.test.ts` e `ajuda.ts`.

**Interfaces:**
- Consome: Tarefas 1 e 2.

- [ ] **Passo 1: escrever os testes:**
  - `'app atual: criar → enviar → aprovar sem campos novos continua igual'`. Usa o payload exato de `montarPedido` (`src/lib/novoPedido.ts`) e o `enviar_orcamento` com as chaves de hoje. Espera: AGENDADA, uma RESERVA e o total igual ao de antes da migration, calculado pelo contrato do teste;
  - `'confirmar × cancelar simultâneos: um só vence'`: 10 `confirmar_corrida` com a mesma chave dão 1 RESERVA;
  - `'proposta: cliente vê a linha AJUSTE_MOTORISTA no api.pedido'`.
- [ ] **Passo 2:** push; o CI de integração fica verde.
- [ ] **Passo 3:** commit `test(fase 4): compatibilidade do app atual e concorrência da confirmação`.

### Tarefa 4: rota com a linha do trajeto

**Arquivos:**
- Modificar: `supabase/functions/enderecos/google.ts` (ação `rota`, :141-161)
- Teste: `tests/integracao/funcoes.test.ts` (ou o arquivo onde a ação `rota` já é testada) e `src/lib/rotaDesenhada.test.ts`
- Criar: `src/lib/rotaDesenhada.ts`

**Interfaces:**
- Produz:
  - resposta da ação `rota`: `{ok:true, km, minutos, polyline: string|null}`, com o field mask acrescido de `routes.polyline.encodedPolyline`. A linha não é gravada em lugar nenhum;
  - `decodificarPolyline(codificada: string): Array<{lat:number; lng:number}>`, no algoritmo padrão de *encoded polyline* do Google, precisão 1e5;
  - `rotaAte(origem: PontoRota, destino: PontoRota): Promise<{km:number; minutos:number|null; pontos: Array<{lat;lng}>}|null>` em `src/lib/rotaDesenhada.ts`, chamando a função `enderecos`.

- [ ] **Passo 1:** escrever o teste de unidade `decodificarPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')`, que deve dar `[{lat:38.5,lng:-120.2},{lat:40.7,lng:-120.95},{lat:43.252,lng:-126.453}]` (o exemplo da documentação do Google).
- [ ] **Passo 2:** `npx vitest run src/lib/rotaDesenhada.test.ts` falha.
- [ ] **Passo 3:** implementar. Na função, só acrescentar o campo; o app atual ignora `polyline`.
- [ ] **Passo 4:** o Vitest passa. Push; a integração (resposta com `polyline` string quando o Google falso devolve uma) fica verde.
- [ ] **Passo 5:** commit `feat(fase 4): rota devolve a linha do trajeto (sem gravar)`.

### Tarefa 5: segundo site, PWA com aviso de versão e Deploy

**Arquivos:**
- Modificar:
  - `vite.config.ts`: com `mode === 'novo'`, usar `outDir: 'dist-novo'`, `input` = `novo.html`, manifesto `name: 'IVO Transportes (novo)'`, `short_name: 'IVO novo'`, `registerType: 'prompt'`;
  - `package.json`: script `"build:novo": "vite build --mode novo && node scripts/gerar-headers.ts production dist-novo"`;
  - `scripts/gerar-headers.ts`: aceitar a pasta como 2º argumento, com padrão `dist`;
  - `.github/workflows/deploy.yml`: depois do deploy atual, `npm run build:novo`, `node scripts/varrer-segredos.ts dist-novo`, `wrangler pages project create ivo-novo --production-branch main || true`, `wrangler pages deploy dist-novo --project-name ivo-novo --branch main`, e a mesma checagem de CSP com curl em `https://ivo-novo.pages.dev`;
  - `.github/workflows/ci.yml`: rodar `npm run build:novo` junto do build.
- Criar:
  - `novo.html`;
  - `src/novo/main.tsx`;
  - `src/novo/rotas.tsx`;
  - `src/novo/AvisoNovaVersao.tsx`, com `useRegisterSW` de `virtual:pwa-register/react`. Mostra "Nova versão · Atualizar" quando `needRefresh`, e o botão chama `updateServiceWorker(true)`.
- Teste: `tests/e2e/novo-pwa.spec.ts`, com projeto Playwright `novo` em `playwright.config.ts` servindo `dist-novo`.

**Interfaces:**
- Produz:
  - `roteadorNovo` (`createBrowserRouter`) em `src/novo/rotas.tsx`, com as rotas das Tarefas 7 a 11;
  - `src/novo/main.tsx` monta `<StrictMode><SessaoProvider><RouterProvider router={roteadorNovo}/><AvisoNovaVersao/>`. Entrada e sessão (`/entrar`, `/definir-senha`, `/seguranca/2fa`, `/c/:codigo`) **reusam** as telas de `src/telas/entrada`.

- [ ] **Passo 1: escrever `novo-pwa.spec.ts`:**
  - o manifesto tem `name` "IVO Transportes (novo)";
  - os headers trazem a mesma CSP do app atual (usar `vigiarCsp`);
  - simular um SW novo (`needRefresh`) mostra "Nova versão · Atualizar".
- [ ] **Passo 2:** `npm run build:novo && npx playwright test --project novo novo-pwa` falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** o teste passa, e `npm run build` (o app atual) gera o `dist/` idêntico ao de antes, exceto pelo hash.
- [ ] **Passo 5:** commit `feat(fase 4): segundo site ivo-novo (PWA próprio, aviso de nova versão) no mesmo Deploy`.

### Tarefa 6: bibliotecas do front novo

**Arquivos:**
- Criar:
  - `src/lib/categorias.ts`, `src/lib/veiculos.ts`, `src/lib/corrida.ts`;
  - `src/lib/mapaComRetentativa.ts`.
- Teste: um `*.test.ts` ao lado de cada arquivo.

**Interfaces:**
- Produz:
  - `categorias.disponiveis(p:{km:string; levar:boolean; trazer:boolean}) => Promise<{categorias: CategoriaComPreco[]}>`, com `CategoriaComPreco = {codigo:'PASSAGEIROS'|'CARGA_LEVE'|'CARGA_PESADA'; nome; descricao_curta; disponivel:boolean; total_cent:number|null}`;
  - `pedidoDaCategoria(c: CategoriaComPreco & {carga; reboque}, base: FormPedido) => Record<string,unknown>`. Monta o payload de `criar_pedido` a partir do `montarPedido`, com `modalidade:'VEICULO_PROPRIO'` e `categoria`;
  - `primeiroHorarioAgora(livres: string[], agora: Date) => string|null`: o primeiro horário ≥ agora + 60 min;
  - `veiculos.meus()`, `veiculos.salvar(p)`, `veiculos.mudarSituacao(id, s)`;
  - `normalizarPlaca(s) => string`;
  - `corrida.enviarProposta(id, entrada, {veiculo_id, ajuste_cent, ajuste_motivo})`;
  - `corrida.confirmar(id, versao, hash, chave, centroCusto)`;
  - `corrida.avaliar(id, nota, comentario)`;
  - `limitesAjuste(totalTabelaCent) => {min:number; max:number}`, igual ao arredondamento do banco;
  - `sessaoTilesComRetentativa(chave, aoMudar:(s)=>void, intervaloMs=15000) => () => void`: tenta `criarSessaoTiles` até conseguir e devolve a função de cancelar.

- [ ] **Passo 1: escrever os testes:**
  - `primeiroHorarioAgora(['…T09:00','…T10:00'], 08:30)` → `'…T10:00'`;
  - às 23h30 sem horário no dia → null (a tela busca o dia seguinte);
  - `limitesAjuste(18000)` → `{min:-9000, max:18000}`;
  - `normalizarPlaca('abc-1d23')` → `'ABC1D23'`;
  - `pedidoDaCategoria` de CARGA_PESADA → `reboque:'SIM'`, `carga:'EQUIPAMENTO'`;
  - retentativa: 2 falhas e 1 sucesso com relógio falso (15 s) → `aoMudar` chamado com a sessão no 3º ciclo.
- [ ] **Passo 2:** `npx vitest run src/lib` falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(fase 4): bibliotecas de categorias, veículos, corrida e mapa com nova tentativa`.

### Tarefa 7: moldura do app novo (mapa base e menu)

**Arquivos:**
- Criar:
  - `src/novo/componentes/MapaBase.tsx`: Leaflet de tela cheia, com `sessaoTilesComRetentativa`, camadas de rota (linha laranja), carro e destino;
  - `src/novo/componentes/FolhaMapa.tsx`: folha inferior com alça;
  - `src/novo/componentes/Menu.tsx`: gaveta ☰, itens por perfil conforme a §6.7 da especificação;
  - `src/novo/MolduraNova.tsx`.
- Teste: `tests/e2e/novo-moldura.spec.ts`.

**Interfaces:**
- Produz:
  - `<MapaBase rota?={Ponto[]} carro?={{lat,lng,perdido:boolean}} destino?={Ponto} centro?={Ponto}/>`;
  - `<FolhaMapa>{children}</FolhaMapa>`;
  - `<Menu perfil={Perfil}/>`. Para o ADM, os itens apontam para as rotas do app atual (`https://umi-san-transporte.pages.dev/adm/...`), exceto "Categorias e preços" e "Veículos" (Tarefa 11).

- [ ] **Passo 1: escrever os testes** (com `comSessaoFalsa` e `simularMapas`):
  - o cliente N1 vê no menu Minhas corridas, Agenda, Carteira da empresa, Locais salvos, **Equipe**, Perfil e segurança e Ajuda;
  - o N2 não vê Equipe;
  - o motorista vê "Disponível para chamadas", Meus veículos e **"Corridas do mês"**;
  - o ADM vê "Categorias e preços" e "Veículos";
  - a primeira `createSession` dá 500 e a segunda 200 → o mapa aparece depois de 15 s (relógio do Playwright);
  - claro e escuro;
  - `axe` sem violações.
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(fase 4): moldura do app novo com mapa de tela cheia e menu por perfil`.

### Tarefa 8: cliente pede, aguarda e confirma

**Arquivos:**
- Criar:
  - `src/novo/telas/cliente/InicioCliente.tsx` (mockup 1);
  - `src/novo/telas/cliente/EscolherCategoria.tsx` (mockup 2);
  - `src/novo/telas/cliente/Aguardando.tsx` (mockup 3);
  - `src/novo/telas/cliente/ConfirmarCorrida.tsx` (mockup 4).
- Reusar: `CampoEndereco`/`FolhaMarcarNoMapa` (3A) e `api.horarios_livres`.
- Teste: `tests/e2e/novo-cliente.spec.ts`.

**Interfaces:**
- Consome: `categorias.disponiveis`, `pedidoDaCategoria`, `primeiroHorarioAgora`, `rotaAte`, `corrida.confirmar` e `pedidos.criar`.

- [ ] **Passo 1: escrever os testes:**
  - escolher origem e destino desenha a rota e lista 3 categorias com "~R$ 180", "~R$ 230" e "~R$ 410";
  - categoria `disponivel:false` mostra "Indisponível no momento", sem botão;
  - "Agendar" é o padrão; o botão diz "Pedir IVO Passageiros · qua 08:30";
  - "Agora" envia `agora:true` e `inicio` = primeiro livre ≥ +60 min;
  - depois do envio, aparece "Enviado ao Ivo" com o prazo;
  - na confirmação com ajuste, aparece "Pela tabela R$ 180,00" e "Proposta do Ivo + R$ 40,00" com o motivo;
  - o centro de custo vem preenchido com o último usado (`localStorage` `ivo:ultimo-centro-custo`);
  - **sem UI otimista:** "Confirmar corrida · R$ 220" fica ocupado até a resposta, e `SALDO_INSUFICIENTE` mostra a mensagem de hoje;
  - "Pedir outro valor" chama `pedir_revisao`; "Recusar" chama `reprovar_orcamento`;
  - o N3 não vê o botão de pedir.
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(fase 4): cliente pede por categoria, aguarda o Ivo e confirma com centro de custo`.

### Tarefa 9: acompanhar e fim (cliente)

**Arquivos:**
- Criar:
  - `src/novo/telas/cliente/Acompanhar.tsx` (mockup 10);
  - `src/novo/telas/cliente/Concluida.tsx` (mockup 11).
- Reusar: `useTransmissao('rastreio:<id>')`, `aplicarPosicao`, `estadoDoSinal` e `interpolar` (`src/lib/rastreio.ts`).
- Teste: `tests/e2e/novo-acompanhar.spec.ts`.

- [ ] **Passo 1: escrever os testes:**
  - com `ultima_posicao` de 10 min atrás e sem transmissão, o carro aparece **na hora**, cinza, com "Sinal do motorista perdido"; a chegada prevista não fica em branco quando houve ETA;
  - a transmissão nova move o carro e mostra "atualizado agora";
  - veículo e placa aparecem;
  - o concluído mostra valor, centro de custo, km e fotos;
  - tocar a 4ª estrela e enviar chama `avaliar` com nota 4; depois disso, as estrelas ficam somente leitura;
  - "Pedir de novo" abre a escolha de categoria com a mesma origem, destino e categoria, sem data.
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(fase 4): acompanhamento em tela cheia e fim com avaliação e pedir de novo`.

### Tarefa 10: motorista (chamada, contraproposta e viagem)

**Arquivos:**
- Criar:
  - `src/novo/telas/motorista/InicioMotorista.tsx`: mapa, próxima corrida e `TrilhoSair` (reusar `SaidaMotorista`);
  - `src/novo/telas/motorista/Chamada.tsx` (mockup 5);
  - `src/novo/telas/motorista/ProporValor.tsx` (mockup 6);
  - `src/novo/telas/motorista/ViagemNoMapa.tsx` (mockup 7).
- Reusar: o envio de posição e o Wake Lock de `ViagemMotorista.tsx`, extraídos para um hook `useEnvioDePosicao(pedido)` em `src/telas/execucao/` **sem mudar o comportamento** do app atual (o `execucao.spec.ts` continua verde). Reusar também `FolhaConcluir`.
- Teste: `tests/e2e/novo-motorista.spec.ts`.

- [ ] **Passo 1: escrever os testes:**
  - pedido SOLICITADA com categoria → a chamada mostra o valor pela tabela (`calcular_orcamento`), a barra de prazo e o veículo sugerido;
  - "Aceitar por R$ 180" envia `enviar_orcamento` com `veiculo_id` e **sem** `ajuste_cent`;
  - "Propor outro valor":
    - mostra "+ R$ 40,00 (+22%)";
    - motivo vazio deixa o envio desabilitado;
    - valor acima do limite mostra o máximo;
    - envia com `ajuste_cent:"4000"` e o motivo;
  - com a chamada aberta, chega `status` no tópico `equipe` → toca o som (`HTMLAudioElement.play` chamado) e mostra a chamada;
  - viagem: a rota (`polyline` falsa) aparece desenhada e a chegada prevista fica grande;
  - **não existe** o botão "Nova previsão de término";
  - "Abrir no Waze" mostra o aviso exato da especificação;
  - "Concluir serviço" abre a `FolhaConcluir`;
  - "Disponível para chamadas" desligado → chamadas não tocam e nenhum `watchPosition` é iniciado.
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar. A `Disponível` é preferência local (`localStorage` `ivo:disponivel`) e não vai ao banco no MVP.
- [ ] **Passo 4:** passa, e o `execucao.spec.ts` do app atual continua verde.
- [ ] **Passo 5:** commit `feat(fase 4): chamada do motorista, contraproposta e viagem com rota desenhada`.

### Tarefa 11: veículos e telas do ADM

**Arquivos:**
- Criar:
  - `src/novo/telas/motorista/MeusVeiculos.tsx` (mockup 8);
  - `src/novo/telas/motorista/CadastrarVeiculo.tsx` (mockup 9);
  - `src/novo/telas/motorista/CorridasDoMes.tsx`: quantas corridas e o total cobrado, por mês, a partir de `meus_pedidos` concluídos;
  - `src/novo/telas/adm/CategoriasPrecos.tsx`: lista as categorias (nome, descrição, ativa) e publica a versão nova do contrato. Reaproveita o formulário de `PublicarContrato.tsx` mais 3 pares km/taxa, e chama `publicar_contrato_categorias`;
  - `src/novo/telas/adm/Veiculos.tsx`.
- Teste: `tests/e2e/novo-veiculos-adm.spec.ts`.

- [ ] **Passo 1: escrever os testes:**
  - cadastrar com a placa "abc-1d23" envia "ABC1D23" e as categorias marcadas;
  - `PLACA_DUPLICADA` mostra a mensagem;
  - "Em manutenção" chama `mudar_situacao_veiculo`;
  - o ADM publica categorias com km "5,00" → `p_categorias.CARGA_LEVE.km_cent` = "500";
  - o N1 não acessa `/adm/categorias`.
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(fase 4): veículos do motorista e categorias e preços do ADM`.

### Tarefa 12: e2e contra o banco real

**Arquivos:**
- Criar: `tests/e2e/real/estilo-uber.spec.ts`, no padrão de `tests/e2e/real/execucao.spec.ts`, rodando contra `dist-novo`.

- [ ] **Passo 1: escrever o fluxo:**
  - ADM publica preços por categoria;
  - motorista cadastra veículo;
  - N2 pede Carga Leve;
  - motorista propõe +10% com motivo;
  - N2 confirma com centro de custo;
  - saída;
  - 3 posições;
  - conclusão;
  - avaliação.
  - Espera: o extrato tem 1 DEBITO = total com ajuste, com `centro_custo`. No fim, o motorista é desativado, como no e2e da 3B.
- [ ] **Passo 2:** push; o CI fica verde.
- [ ] **Passo 3:** commit `test(fase 4): e2e real do fluxo no estilo Uber`.

### Tarefa 13: fechamento

- [ ] **Passo 1:** revisão de segurança (superpowers:requesting-code-review), focando em:
  - limites do ajuste;
  - quem vê veículo e posição;
  - nada do Google gravado;
  - CSP igual nos dois sites;
  - "Disponível" sem localização.
- [ ] **Passo 2:** escrever `docs/fases/fase-4-o-que-testar.md`, um roteiro no celular em `ivo-novo.pages.dev` com dois aparelhos, cobrindo os 13 mockups.
- [ ] **Passo 3:** `docs/RUNBOOK.md` §18 com:
  - os dois sites;
  - categorias e preços;
  - veículos;
  - contraproposta;
  - "Agora";
  - "o mapa não aparece no endereço novo" (referenciador da chave);
  - passo a passo do dono:
    - criar o projeto `ivo-novo` (se o Deploy não criar);
    - acrescentar `https://ivo-novo.pages.dev/*` na chave `navegador-mapa`;
    - acrescentar `https://ivo-novo.pages.dev/**` em Supabase › Auth › URL Configuration › Redirect URLs;
    - acrescentar o domínio no widget do Turnstile;
    - deixar a chave `navegador-mapa` só com a Map Tiles API.
- [ ] **Passo 4:** atualizar o `HANDOFF.md` (fase 4 em teste) e abrir **um PR** para a `main`, com o checklist do dono. O merge é do dono.

## Autorrevisão (feita)

- **Cobertura da especificação:**

  | Seção da especificação | Tarefas |
  |---|---|
  | §4 | 5 |
  | §5.1 | 1 |
  | §5.2 | 2 |
  | §5.3 | 1 e 11 |
  | §5.4 | 2 e 10 |
  | §5.5 | 1 e 2 |
  | §5.6 | 4 |
  | §6.1 | 8 |
  | §6.2 | 10 |
  | §6.3 | 8 |
  | §6.4 | 10 e 2 (atraso automático) |
  | §6.5 | 9 |
  | §6.6 | 9 e 10 |
  | §6.7 | 7 e 11 |
  | §6.8 | 11 |
  | §7 | 13 |
  | §8 | todas |
  | §9 | 13 |

- **Nomes conferidos entre tarefas:**
  - `linhas_da_categoria`, `veiculo_atende`, `confirmar_corrida`;
  - `publicar_contrato_categorias`, `categorias_disponiveis`;
  - `rotaAte`, `decodificarPolyline`, `sessaoTilesComRetentativa`;
  - `roteadorNovo`, `MapaBase`, `FolhaMapa`.
