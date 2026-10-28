# v2.3 · M0 — Moldura e navegação

Base: `e7ec62a` (v2.2.1). Escopo: somente a moldura da v2, sem mudanças nos serviços, banco, autenticação ou deploy. Referência: [requisitos recebidos](../REQUISITOS_PRESERVACAO.md).

## Resultado visual

No computador, a navegação fica à vista em uma lateral fixa. Ela usa `itensDoMenu`, a mesma lista autorizada do menu móvel, incluindo as diferenças entre cliente N1/N2/N3, motorista e Master. O item atual também acompanha subpáginas. O conteúdo troca pelo React Router sem recarregar a aplicação.

As telas de mapa usam uma área própria para o mapa e outra para o painel, a partir de 1024 px. Isso evita centralizar o carro ou o destino atrás do formulário. No celular e tablet, permanecem o menu modal, a folha inferior e os fluxos existentes. A marca oficial foi adicionada ao topo sem cobrir o zoom. Os tokens de cor, fontes, modo escuro e alto contraste existentes foram preservados.

O menu do motorista e a lateral compartilham a preferência local de disponibilidade. Redimensionar a janela fecha o menu modal antes de exibir a lateral. Há um atalho de teclado para ir ao conteúdo e respeito a movimento reduzido.

## Antes e depois

Capturas reais do build, com as fixtures de teste existentes. Não representam viagens reais. As requisições de tiles foram deliberadamente respondidas com erro: o cinza é o estado de indisponibilidade do mapa, não um mapa ilustrativo. Nenhuma credencial ou dado de conta real foi usado. Viewports de 390 × 900 e 1440 × 900; a densidade de pixels segue o projeto de teste.

| Tela | Antes | Depois |
|---|---|---|
| Desktop | [1440 px](antes-1440.png) | [1440 px](depois-1440.png) |
| Celular | [390 px](antes-390.png) | [390 px](depois-390.png) |

## Preservação verificada neste módulo

Os três documentos oficiais foram localizados em `redesenho-v3/docs/redesenho` e incorporados em `docs/redesenho` nesta branch. Esta tabela ainda referencia números dos requisitos; o preenchimento da matriz por ID e a regressão completa continuam pendentes.

| Requisito | Destino / verificação | Resultado |
|---|---|---|
| 1–6, 14–17, 20–22 | Diff restrito a moldura/componentes de navegação da v2, testes, documentação e versão | Nenhuma alteração em `src/lib`, rotas, `supabase`, autenticação ou workflows |
| 9, 13 | `NavegacaoLateral` usa `itensDoMenu`; cinco casos por perfil em `novo-m0-navegacao.spec.ts` | Lista autorizada mantida, sem restaurar Carteira da empresa ou Locais salvos |
| 7–12 | Calculadoras, valores, botões financeiros e respostas permanecem nos componentes existentes | Nenhuma alteração de regra ou cálculo neste módulo; regressões E2E registradas abaixo |
| 18, 19, 24, 25 | CSS externo importado somente na v2; fonte e marca locais; axe, CSP, teclado e movimento reduzido | Testes de M0 claro/escuro passaram |
| 23 | Layout em 360, 390, 768 e 1440 px; menu longo do Master em tela baixa | Sem transbordamento horizontal nos casos de M0; zoom separado da marca |
| 26, 28 | `novo-painel-abas.spec.ts`: abertura e destaque do Painel da empresa agora pela lateral no desktop | A mesma regra é conferida na nova navegação; testes móveis mantidos |
| 29 | Este módulo trata apenas M0; capturas e lacunas nesta pasta | M1–M4 não implementados aqui |
| 30 | Branch própria e PR de rascunho | Sem merge ou publicação direta |
| 31 | `package.json` e somente os dois campos raiz `version` do lock | 2.3.0; dependências inalteradas |

## Validação

- Baseline: 637 testes unitários aprovados antes das alterações; builds de v1 e v2 gerados.
- TypeScript, lint e 637 testes unitários aprovados após a alteração.
- Primeira rodada: 45 E2E aprovados (M0, capturas, moldura e navegação existentes).
- Suíte completa da v2 e regressão selecionada da v1: resultados finais serão registrados antes de concluir a revisão.

Ambiente local: o download do Chromium 156 exigido pelo Playwright não concluiu. Foi usado Chromium Headless Shell 140, instalado separadamente, sem alterar dependências do projeto. O Wrangler local falhou em `uv_interface_addresses`; os builds foram servidos por um servidor HTTP temporário que aplica os cabeçalhos de `_headers`. Essas adaptações são locais e não entram no repositório. O CI mantém Chromium e Wrangler oficiais, além dos testes contra Supabase local real.

## Lacunas e limites

- O teste de login da v1 que depende do Turnstile externo não recebeu o token neste ambiente. Os outros 28 testes selecionados da v1 passaram. Autenticação não foi alterada. A validação integral do CI continua obrigatória.
- Não houve testes com contas reais, GPS de um motorista em viagem ou movimento financeiro em produção.
- O orçamento de 150 KB gzip deve ser verificado também na v2: a medição e comparação com a base ficam registradas ao final da validação.
- A reforma específica da solicitação pertence ao M1; a barra inferior faz parte do M0 segundo o desenho oficial; filtros/listas ao M2; calculadora e operação do motorista ao M3; telas de gestão ao M4. Não foram substituídas pelo protótipo.
- Antes de liberar o módulo para merge, completar o escopo M0 abaixo, preencher a matriz por ID e conferir o CI verde. O merge é do dono.

## Conferência com o desenho oficial (28/10/2026)

O M0 deste PR ainda é parcial. Faltam a paleta do protótipo aplicada somente à v2 com contraste validado, DM Sans local para o corpo, o indicador deslizante, a lateral compacta em 768 px e a barra inferior Solicitar/Corridas/Agenda/Mais. A organização por perfil e a posição do interruptor do motorista também devem ser alinhadas ao desenho. O sino e o contato precisam de ações reais disponíveis; não adicionar indicadores ou notificações fictícias. O agrupamento das telas Master é detalhado no M4.

Há inconsistência de IDs no desenho: ele chama C-36 a C-75 de pedido em duas etapas, mas a matriz situa início/categorias principalmente em C-08 a C-35 e começa acompanhamento em C-38. A rastreabilidade será feita por ação e ID real da matriz, sem marcar intervalos inteiros como preservados.

CI observado nesta conferência: execuções do commit 90bb8c3 ainda em andamento; resultados anteriores em 2a2aaca falharam e não representam o head corrigido. Não declarar CI verde até a conclusão do head correspondente.
