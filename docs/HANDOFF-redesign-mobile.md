# Handoff — redesign mobile do app IVO Transportes

Estado em **13/10/2026**. Leia antes o [`HANDOFF.md`](../HANDOFF.md), com as regras gerais e a forma de trabalhar.

## 1. Onde estamos

- **Produção:** fases 0, 1, 1B, 2A e 2B no ar (https://umi-san-transporte.pages.dev).
- **Branch `melhorias-mobile`** (CI verde, run 38478482092; **sem PR e sem merge ainda**). Contém 5 correções pedidas pelo dono:
  1. Perfil com menos permissões **sempre abre no Início**. Uma rota proibida redireciona para `/` com o aviso "Essa área não está disponível para o seu perfil". A tela "Sem permissão" foi removida (`src/lib/guardas.tsx`; teste em `tests/e2e/abertura.spec.ts`).
  2. **Seleção de data e hora invisível no modo noturno** (o selecionado e o fundo eram ambos `#0A2540`). Foram criados os tokens `--cor-selecao` e `--cor-selecao-texto`: marinho no modo claro, off-white no escuro. Testes de toque em Pixel e iPhone, nos modos claro e escuro (`tests/e2e/toque-novo-pedido.spec.ts`).
  3. **Legenda do calendário** com fonte única: `src/telas/agenda/marcadores.tsx`. Cada marcador tem forma e cor: bolinha `#1E4B7A` = seu pedido; triângulo `#C2410C` = aguardando você; bolinha cinza = ocupado; número riscado = dia sem horário.
  4. **Crédito ao criar o pedido** (Adendo A11). Se disponível + limite ≤ 0, retorna `SEM_CREDITO` e o "Novo pedido" fica bloqueado com explicação. Abaixo do alerta do contrato, o pedido passa com aviso no passo 4. A aprovação continua sendo a checagem final.
  5. **Código do autenticador pedido ao reabrir.** Antes de pedir o código, o app agora renova o token uma vez, porque um token antigo anterior ao 2FA causava o pedido indevido (`src/lib/sessao.tsx`). O teste com o banco real mostra a sessão mantendo aal2 em recarga, nova aba, token expirado e renovação. **Pendente:** se o dono ainda vir o código depois de publicar, perguntar se foi no app instalado ou numa aba do navegador, e se a senha também foi pedida. Isso indicaria uma sessão encerrada por reuso do refresh token (RUNBOOK §15).
- **Decisão sobre a publicação:** combinar com o dono se essas correções vão para produção antes do redesign (são correções de bugs) ou junto com ele. O dono costuma preferir publicar fluxos completos.

## 1.1 Atualização em 14/10/2026

- **PR #24** (`melhorias-mobile` → `main`) aberto com as 5 correções, para publicar antes do redesign (decisão do dono). Merge com o dono.
- **Redesign implementado na branch `redesign-mobile`** (a partir de `melhorias-mobile`), seguindo `docs/redesign/plano-implementacao.md` e os mockups aprovados em `docs/redesign/mockups-mobile.html` (carrinho opção A, barco).
  - Tokens novos com teste AA de todos os pares nos modos claro, escuro e alto contraste (`src/design/tokens.test.ts`). Corrigidos: cinza do ocupado (2,3:1), alto contraste no celular escuro (seleção off-white sobre branco), azul dos links no escuro (`--cor-link`).
  - Agenda estilo Lark (Dia, 3 dias, Mês) com a linha do agora e o triângulo; Novo pedido com faixa de dias, horários em grade e frase de confirmação; moldura com abas em pílula e botão "+"; Início com saldo em bloco marinho; carrinho novo.
  - Guarda `scripts/varrer-estilo.ts`: o teste falha se uma tela voltar a usar " · " ou "→".
  - Capturas para o dono: `CAPTURAS=1 npx playwright test zz-capturas-redesign.spec.ts --project=celular` (saem em `test-results/capturas-redesign/`).
- **Fica para depois (decisões registradas):** Extrato, Créditos e Painel foram só restilizados pelos tokens (sem o seletor em pílula, ícones por lançamento e gráfico do mockup); "ocupado" no passo Quando também cobre horários que não cabem na duração escolhida; ver a lista de pendências menores no PR do redesign.

## 2. O pedido de redesign (palavras do dono)

> "Aplicativo com bom funcionamento, focando no app de celular, gostaria que a gente melhorasse o front conforme tipografia e system design informado." · "Aba calendário ser similar a do Lark." · "Preciso de um design melhor até para o carrinho da tela de carregamento."

Use a skill **`frontend-design:frontend-design`**. Referências obrigatórias: `docs/marca/` (SVGs oficiais, `TIPOGRAFIA.md`, `IDENTIDADE-E-USO.md`) e `docs/especificacao.md` (Adendo A7 sobre a marca e §12 sobre interface, animações e o "carrinho").

## 3. Plano de design aprovado pelo dono (mockups em 13/10)

**Paleta, com uma função por cor:**
- Azul Profundo `#0A2540`: barras de comando e selecionado forte no modo claro.
- Off White `#F6F4EE`: fundo.
- Branco: folhas e cartões.
- **Laranja Sinal `#FF6A00`: uma única ação principal por tela, mais o marcador de "agora".**
- Azul Maré `#1E4B7A`: status agendado e seleção suave.
- Névoa `#E1E6ED`: linhas.
- Texto laranja só com `#C2410C` (contraste).

**Tipografia:** só Manrope, na escala de `TIPOGRAFIA.md`. Títulos 700 com espaçamento apertado, valores 700 com números tabulares, nada de 300 em controles.

**Assinatura:** o **triângulo laranja do logo** é o marcador de "agora", usado na linha da hora atual do calendário, na rota (círculo → triângulo) e na linha do tempo do pedido. É a única ousadia; o resto fica disciplinado.

**Remover, por soarem genéricos:**
- rótulos em MAIÚSCULAS espaçadas acima de tudo (manter só onde agrupam conteúdo);
- textos unidos por " · ";
- setas "→" em botões;
- o mesmo canto arredondado em tudo. Usar a hierarquia: folhas 24 px, cartões 16, campos 12, pílulas 999.

**Telas aprovadas:**
1. **Início do cliente:**
   - saldo num bloco azul-marinho único (disponível grande, barra, reservado e limite);
   - "Aguardando você", o único elemento com borda laranja;
   - "Próximo serviço", com a rota;
   - **botão flutuante laranja "+"** para Novo pedido, presente nas telas principais;
   - barra inferior branca com a aba ativa em pílula azul-marinho.
2. **Agenda estilo Lark:**
   - topo com o nome do mês (toque abre o mês) e o botão "Hoje";
   - seletor **Dia / 3 dias / Mês** e faixa da semana deslizável;
   - **grade de horas** com blocos: seu pedido com borda de 3 px na cor do status e fundo claro; "Ocupado" hachurado com cadeado; "Livre" tracejado em verde, que abre o pedido ao toque;
   - **linha laranja do "agora", com o triângulo da marca.**
3. **Agenda, mês:** marcadores de `marcadores.tsx`, legenda fixa logo abaixo do mês e resumo do dia tocado.
4. **Novo pedido, passo "Quando":**
   - faixa de dias deslizável + "Ver mês inteiro";
   - horários em grade de 4 colunas;
   - **selecionado em cor cheia com contorno laranja, SEM ícone de ✓** (decisão do dono);
   - ocupado riscado e em cinza;
   - stepper de duração;
   - frase de confirmação: "Terça, 13 de outubro, das 07:30 às 09:30".
5. **Modo noturno** (pedido do dono): o selecionado vira off-white cheio, com texto azul-marinho e contorno laranja. O mesmo princípio vale para dias, abas e o seletor de visualização. Conferir AA de todos os pares nos dois modos.

**Novo pedido:** redesenhar o **carrinho da tela de carregamento** (`src/design/componentes/CarregandoPickup.tsx`). Ele deve ser uma pickup com reboque estilizada e coerente com o símbolo da IVO (curvas e ondas do V, triângulo laranja), com rodas girando, estrada tracejada e balanço leve. Regras da §12.2:
- SVG com menos de 50 KB, em loop, sem dependência nova;
- aparece só em carregamentos acima de 400 ms;
- respeita o modo de movimento reduzido;
- é usado também na splash e no "deslize para sair" da fase 3.

Mostrar o mockup ao dono antes de implementar.

## 4. Como conduzir

1. Ler este arquivo, o `HANDOFF.md` e `docs/marca/`.
2. Mockups de todas as telas mobile para aprovação, incluindo o carrinho. Telas: Início de cada perfil, Pedidos, Detalhe, Novo pedido (4 passos), Orçar, Agenda (dia, 3 dias, mês), Extrato, Créditos e Painel do ADM, Login e 2FA, nos modos claro e escuro.
3. Implementar a partir de `melhorias-mobile`, mantendo `--cor-selecao` e `marcadores.tsx` como fontes únicas.
4. Testes e2e de toque (Pixel e iPhone, claro e escuro), zero violações de CSP, bundle inicial ≤ 150 KB gzip.
5. Capturas para o dono e PR **sem merge**: o merge é decisão dele e dispara o deploy.

## 5. Texto para colar no novo chat

> Continue o projeto do app IVO Transportes em `C:\dev\umi-san-transporte`, branch `melhorias-mobile`. Leia `HANDOFF.md` e `docs/HANDOFF-redesign-mobile.md` e siga o plano de design aprovado: redesign mobile-first com a tipografia e o design system da marca IVO, agenda no estilo Lark, seleção clara também no modo noturno e um novo carrinho da tela de carregamento. Use a skill frontend-design. Mostre mockups antes de implementar. Fale comigo em português.
