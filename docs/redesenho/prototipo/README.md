# IVO — Experiência do cliente

Protótipo independente de frontend para avaliação de interface e jornadas. Não altera nem acessa o sistema original. Dados fictícios, sem autenticação, integrações ou banco de dados. Persistência apenas em localStorage do navegador.

## Execução

Sirva a pasta `dist` com um servidor HTTP estático. Não há instalação nem build. O manifesto `.openai/hosting.json` configura a publicação.

## Escopo

Visão geral, solicitação com revisão, acompanhamento e pesquisa de pedidos, orçamento simulado, aprovação e reserva, simulação de início/conclusão, cancelamento com regras demonstrativas, agenda, carteira com extrato e CSV, locais salvos e ajuda. Apenas o perfil cliente está implementado.

Datas fixas para demonstração: 27/10/2026 às 15h. Preços, distâncias, capacidades e multas são exemplos a validar com o negócio. Use o botão Protótipo para orientação ou restauração dos exemplos. Não informe dados reais.

## Verificação executada em 27/10/2026

- Sintaxe JavaScript: `node --check dist/app.js`.
- Inspeção visual desktop e layout em iframe de 390 × 844 px (não equivale a teste em aparelho real).
- Bloqueio de solicitação sem origem.
- Limite de quatro passageiros com controle desabilitado no máximo.
- Criação do pedido #0105, revisão de detalhes e persistência após recarga.
- Simulação de orçamento e aprovação de R$145,90: disponível 7.820,00 → 7.674,10; reservado 620,00 → 765,90.
- Início e conclusão: reserva liberada, débito único de 145,90, saldo contábil 8.294,10, disponível mantido em 7.674,10 após recarga.
- Pedido concluído exibido no dia correto da agenda.
- Restauração dos exemplos pela interface.
- Corrigida incompatibilidade de crypto.randomUUID em contexto HTTP local; IDs do extrato demonstrativo não dependem de contexto seguro.

Não foi realizada certificação de acessibilidade, auditoria de segurança, teste em dispositivos físicos ou validação de integração. Fluxos secundários como exportação CSV e cancelamento estão implementados, mas não foram testados ponta a ponta nesta rodada.

## Atualização — mapa e solicitação como entrada

A rota inicial agora abre o pedido em duas etapas. Desktop: painel de solicitação junto ao mapa. Em largura móvel: mapa acima e painel inferior, com botão de avanço fixado na parte visível. O resumo financeiro continua em Visão geral/Resumo.

O mapa SVG é ilustrativo, sem GPS, geocodificação, distâncias reais ou disponibilidade de veículos. Controles de zoom e enquadramento alteram somente a ilustração.

A navegação principal permanece no DOM durante as trocas de conteúdo. Indicador lateral e marcadores dos filtros deslizam com CSS; animações respeitam prefers-reduced-motion. Os filtros de corridas e carteira atualizam somente seus resultados. Rascunhos são preservados durante a navegação da sessão, não após fechar/recarregar.

Verificações desta atualização:
- Rota raiz mostra solicitação e mapa.
- Primeira etapa bloqueia origem vazia; atalhos preenchem trajeto.
- Pedido de carga leve de 120 kg preservado após sair para Corridas e retornar; revisão e envio concluídos por interface.
- Agendadas retorna dois pedidos; Encerradas retorna três; Em aberto retorna o orçamento pendente no conjunto inicial.
- Layout e navegação em iframe de 390 × 844 px, avanço à segunda etapa e retorno com trajeto preservado. Não foi teste em aparelho físico.
- Filtro Reserva da carteira mostrou duas movimentações; largura do conteúdo não excedeu a largura móvel observada.
- Nenhum erro de aplicação observado no console durante essa rodada.
