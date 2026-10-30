# v2.3 · M0 — Moldura, identidade e navegação

Base: `e7ec62a` (v2.2.1). Referências: [requisitos](../../../redesenho/REQUISITOS_PRESERVACAO.md), [desenho](../../../redesenho/v2-3-desenho.md) e [matriz](../../../redesenho/MATRIZ_PRESERVACAO.md). Entrega no PR #48; sem merge ou deploy.

## Implementação

- Paleta v2 do desenho, DM Sans para corpo e Manrope para títulos/números, com fontes e licenças OFL locais. CSS separado da v1; temas claro, escuro e alto contraste.
- Lateral fixa a partir de 768 px: compacta até 1023 px e completa no desktop, com indicador deslizante em CSS externo e respeito a movimento reduzido.
- Mesma lista autorizada `itensDoMenu`, preservando diferenças entre cliente N1/N2/N3, motorista e Master. Solicitar/Início no topo, perfil no rodapé, disponibilidade do motorista compartilhada entre menu e lateral.
- Barra móvel: cliente Solicitar/Corridas/Agenda/Mais; motorista Início/Corridas/Agenda/Mais; Master Início/Painel/Faturas/Mais. Somente rotas de topo, sem cobrir ações do detalhe ou da calculadora. Mais abre o diálogo existente, com retorno de foco ao acionador.
- Mapa e painel separados no desktop; folha móvel acima da barra inferior. Marca oficial no topo sem cobrir zoom. Contato abre `/ajuda`, que já consulta os dados reais de contato.
- Ajustes de contraste no avatar, selo de chamada e estados laranja das faturas. Seletores E2E de campos foram tornados exatos para não confundirem inputs com os novos links da lateral.

## Capturas

Capturas reais do build com fixtures, sem contas ou viagens reais. Tiles deliberadamente indisponíveis: a área cinza mostra o estado de erro do mapa. Imagens “depois” regeneradas com a identidade final. Viewports 390 × 900 e 1440 × 900.

| Tela | Antes | Depois |
|---|---|---|
| Desktop | [1440 px](antes-1440.png) | [1440 px](depois-1440.png) |
| Celular | [390 px](antes-390.png) | [390 px](depois-390.png) |

## Preservação

Diff sem mudanças em `src/lib`, `supabase`, roteadores, autenticação ou workflows. Regras e valores continuam nos serviços existentes; nenhuma simulação foi adicionada ao produto. Carteira no menu e Locais salvos não foram restaurados. Versão 2.3.0 alterada apenas na raiz de package/lock, sem atualizar dependências.

A matriz registra destinos M0 de C-01–C-07, M-01–M-05, A-01–A-11, X-08–X-16 e X-49. IDs não cobertos por execução específica permanecem explicitamente pendentes. As demais jornadas não são declaradas preservadas apenas por ausência de diff.

## Validação em 30/10/2026

- TypeScript e lint: aprovados.
- Unitários: **738 aprovados**, incluindo contraste/tokens das duas interfaces.
- E2E integrado: **322 aprovados e 1 falha** na rolagem por setas da agenda desktop. A mesma falha foi reproduzida contra o build da base v2.2.1 neste ambiente; o teste não foi removido nem afrouxado. O diagnóstico local mostrou `pointer:fine=false`, `pointer:coarse=false`, `maxTouchPoints=0`. A validação deste caso no navegador oficial do CI permanece obrigatória.
- A rodada anterior teve erro de gravação de trace por concorrência de execuções no mesmo diretório. Repetição com saída isolada eliminou esse erro; o teste de 36 horários passou também isoladamente.
- Capturas, axe, CSP, temas, fontes locais, teclado, movimento reduzido e navegação nos três perfis cobertos pelos testes M0. Layouts verificados em 360, 390, 768 e 1440 px.
- Build v2 de teste gerado. Carga inicial de JS + CSS: **246,7 KB gzip**, contra 244,0 KB na base. Acima da meta de 150 KB já antes do M0; o orçamento no CI mede a v1 (`dist`), não a v2 (`dist-novo`). Fontes não entram nesse cálculo.

Ambiente local: Chromium Headless Shell 140 instalado separadamente, pois o download da versão 156 do Playwright retorna arquivo inválido. Wrangler falha em `uv_interface_addresses`; um servidor temporário aplica os mesmos `_headers` aos builds. Nenhuma adaptação local entra no repositório. O CI usa as ferramentas oficiais e Supabase local real.

O CI anterior de `ca60314` passou ([40761203877](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/runs/40761203877)), incluindo banco, integração, E2E, migrações e segredos. **Não certifica esta revisão posterior.** Conferir o CI no novo head antes do merge.

## Limites e diferenças do desenho

- Sino omitido: não há contrato existente de central de notificações ou leitura/não leitura. Não foi criado contador fictício.
- M1–M4 continuam separados: solicitação, filtros/listas, operação/calculadora e administração. Agrupamento detalhado do menu Master pertence ao M4.
- O desenho cita C-36–C-75 para solicitação, mas a matriz situa início/categorias principalmente em C-08–C-35 e acompanhamento a partir de C-38. Usar ação e ID real.
- X-14 (ErroGeral) não tem teste específico; não foi certificado por execução. Testes de autenticação externa, GPS de motorista e financeiro em produção não foram realizados.
- V1: rodada anterior selecionada teve 28 testes aprovados e um bloqueio de token Turnstile externo; CI anterior depois passou. Não usar esse resultado para certificar automaticamente a revisão atual.
- Aprovação final exige o CI da revisão atual. Merge a cargo do proprietário.

### CI de 32a82bb e correção do teste de virada de mês

As execuções [41134060859](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/runs/41134060859) e [41134054545](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/runs/41134054545) aprovaram lint, TypeScript, 738 unitários, pgTAP, 115 testes de integração, builds e varreduras de segredos. E2E: **520 aprovados, 22 ignorados e 4 falhas**. O teste das setas da agenda da v2 passou no Chromium oficial.

As quatro falhas eram o mesmo teste mensal da v1, nos dois temas e aparelhos. O fixture coloca o pedido em hoje + 2 dias; em 30/10, ele cai em novembro. O teste procurava legenda em outubro, que não tinha marcadores. O produto corretamente omite legenda quando não há marcadores. Corrigido somente `toque-agenda.spec.ts`: conferir o destaque de hoje com outro dia do mesmo mês, navegar ao mês do pedido e manter todas as verificações de legenda, resumo, abertura do dia e retorno a Hoje. Nenhuma alteração no calendário, no backend ou nos fixtures compartilhados.

Repetição local após essa correção: **16 testes de toque aprovados**, em Pixel/iPhone e temas claro/escuro; lint aprovado. A checagem final de migração não executou nos runs acima porque depende do E2E aprovado. O novo head exige nova execução completa do CI; consultar o PR #48 para o resultado atualizado.
