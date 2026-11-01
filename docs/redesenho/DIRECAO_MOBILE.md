# Direção mobile — 01/11/2026

Direção solicitada pelo proprietário: aproximar a organização do aplicativo do protótipo aprovado e usar as capturas da Uber como referência de hierarquia, navegação e progressão das tarefas, preservando a identidade e as funções do IVO.

## Estrutura pretendida

- Navegação inferior estável entre as áreas principais. Na correção inicial, permanecem os atalhos atuais de cada perfil e o botão Mais, que dá acesso aos demais destinos autorizados. Mais fica destacado nessas áreas.
- Cliente abre com solicitação e mapa em evidência. Destino é a ação principal, seguido de origem/paradas, categoria, data/horário e revisão. A referência da Uber não substitui as regras corporativas.
- Etapas de endereço, orçamento, confirmação e execução priorizam voltar/continuar e as ações operacionais. A navegação global não deve competir nem sobrepor essas ações.
- Corridas com hierarquia clara de rota, estado, data e preço; filtros Todos/Em aberto/Agendadas/Encerradas e busca com comportamento real. Agenda e conta/ajuda com o mesmo padrão de navegação.
- Visual mais sóbrio: títulos claros, cartões funcionais, espaço consistente, estados selecionados legíveis, contraste validado em claro/escuro e movimento reduzido. Não reproduzir marca, ofertas ou serviços próprios da Uber.

## Preservação obrigatória

Manter permissões de cliente N1/N2/N3, motorista e Master; diárias, retorno, paradas, pedágio/balsa, hospedagem, espera, outros custos, capacidade, centro de custo, aprovações, cancelamento e modalidades de faturamento/crédito existentes. Preços e operações financeiras continuam nos serviços atuais. Não criar saldos, localização de motorista, contadores, mensagens ou funcionalidades simuladas. Carteira e informações empresariais seguem a autorização e os destinos existentes, sem novo atalho universal de carteira.

## Correção inicial: barra persistente

A regra anterior renderizava a barra apenas nos três destinos de seus atalhos. Isso deixava Perfil, Ajuda, Equipe, veículos e áreas administrativas sem navegação inferior. A nova regra também considera os destinos reais de `itensDoMenu` e as abas do Painel da empresa. Cadastros, detalhes de cobrança/pedido, orçamento e execução continuam com seus controles próprios.

A moldura reserva espaço inferior nessas páginas e Mais identifica a seção atual. Sem mudanças em banco, RPCs, serviços, autenticação ou roteadores.

Validação local: TypeScript, lint, 8 testes unitários de navegação e 41 E2E de moldura/navegação aprovados. Os E2E exercitam cliente N1, motorista e Master navegando por Mais entre quatro áreas e voltando ao início, sem recarregar, sem transbordamento horizontal e com espaço reservado para a barra. CI do PR será a validação integrada final.

Esta correção não representa a conclusão do redesenho das telas. Solicitação/mapa (M1), corridas/filtros (M2), operação do motorista (M3) e gestão (M4) seguem módulos separados, com matriz e regressão.
