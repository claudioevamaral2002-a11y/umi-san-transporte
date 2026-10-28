# IVO Transportes — repasse de interface e preservação funcional

Versão do repasse: 28/10/2026.

## 1. O que fazer com este material

Aplicar a direção visual aprovada ao sistema IVO existente, preservando e verificando suas funcionalidades. Não substituir o aplicativo de produção pelo protótipo. O escopo é frontend e comportamento das telas; não redesenhar banco de dados, autenticação ou integrações como efeito colateral desta reforma.

Repositório original informado pelo usuário: https://github.com/claudioevamaral2002-a11y/umi-san-transporte

Aplicação original: https://umi-san-transporte.pages.dev/

Referência visual: https://ivo-cliente-conceito.nutmeggoby34.chatgpt.site/ (acesso privado; os arquivos anexos dispensam acesso ao link).

O pacote contém uma cópia do código do protótipo publicado, não o código do repositório original. Commit de referência do protótipo: `755516b54ed0a5b59535845b78b7f51b21795c84`.

O usuário prefere o novo modelo visual e quer mantê-lo sem perder variáveis de corrida, diárias, acompanhamento do motorista e os perfis motorista/administrador. A aparência do cliente é a referência; a estrutura operacional de cada perfil deve continuar adequada à sua função.

## 2. Prompt para iniciar o trabalho no Claude

> Quero reformar o frontend do meu sistema IVO Transportes usando o protótipo anexo como referência visual e de navegação. Trabalhe no repositório original, em uma branch separada, preservando as funcionalidades existentes.
>
> Leia este documento inteiro e os arquivos do protótipo. Antes de alterar telas, inspecione o código original e produza uma matriz com rotas, perfis, ações, campos, validações, cálculos, permissões e integrações. Para cada item, registre onde está no código, sua situação e como será preservado. Não use apenas a aparência de uma tela como prova de funcionamento.
>
> O protótipo tem somente a área do cliente e dados simulados. Ele não é a especificação completa do produto. Não transporte o localStorage, preços, capacidades, datas fixas, mapa SVG ou controles de simulação para o fluxo real de produção. Mantenha as chamadas, contratos e regras existentes, adaptando os componentes visuais ao framework do repositório.
>
> Preserve cliente, motorista e administrador. Preserve variáveis de orçamento, incluindo diárias, quilometragem, retorno, espera, pedágio/balsa, hospedagem, reboque e demais campos encontrados no sistema original. Campos ausentes devem ser registrados como lacunas; não declare que já existem. Dê uma interface clara a todas as variáveis pertinentes à modalidade, sem escondê-las permanentemente para simplificar o layout.
>
> Para cliente, a entrada principal deve ser mapa e solicitação. No celular, use painel inferior e navegação com o polegar; no desktop, painel de solicitação junto ao mapa. Mantenha navegação lateral estável, transições discretas e filtros suaves, preservando rascunhos e foco. Expanda a mesma identidade visual para motorista e administrador, com telas específicas para cada tarefa.
>
> A localização real do motorista depende da integração existente. Se ela existir, preserve-a e teste-a. Se estiver ausente, implemente a interface e os estados necessários com um adaptador demonstrativo claramente identificado; não invente rastreamento real, não peça chave real e não apresente uma animação como posição recebida do motorista.
>
> Implemente e valide por módulos. Não remova páginas, campos, permissões, ações, estados ou cálculos para encaixar o protótipo. Não altere backend ou banco sem apontar primeiro a necessidade concreta e o contrato faltante. Entregue alterações revisáveis, matriz de cobertura, testes executados, limitações e diferenças visuais. Não publique em produção nem faça merge automático; deixe a branch/PR pronta para revisão.

## 3. Fontes de verdade e limites

| Fonte | Serve para | Não serve para |
|---|---|---|
| Código e comportamento do app original, verificados nesta implementação | Inventário de funcionalidades existentes, contratos, integrações, rotas e permissões | Presumir que bugs existentes são requisitos corretos |
| Decisões explícitas do usuário e requisitos de negócio confirmados | Comportamento esperado | Inventar valores ou aprovações não definidos |
| Protótipo anexo | Layout, hierarquia, navegação, componentes e interações visuais | Definir o escopo completo ou substituir o domínio de negócio |
| Este repasse | Guardas de preservação, lacunas e critérios de aceite | Atestar que o app original foi integralmente auditado ou já implementa tudo |

Se as fontes divergirem, registre a divergência. Preserve o comportamento verificado durante a reforma visual e trate mudanças de regra como trabalho separado e explícito. Não perpetue falhas de segurança ou erros financeiros em nome da fidelidade visual.

## 4. O que o protótipo realmente entrega

| Item | Situação no protótipo |
|---|---|
| Cliente: mapa e pedido como tela inicial | Implementado; mapa SVG ilustrativo |
| Solicitação em duas etapas | Trajeto; depois categoria, capacidade, data/horário e detalhes opcionais |
| Paradas e locais salvos | Implementados com dados locais |
| Corridas, filtros, detalhes e agenda | Implementados em demonstração |
| Orçamento, reserva e débito | Simulados; não há transação real |
| Simular início/conclusão | Controle de teste explícito; não envia nada ao motorista |
| Carteira e extrato | Simulados no navegador |
| Rastreamento do motorista | Não implementado; carrinho no mapa é ilustração |
| Diárias e composição completa de orçamento | Não implementadas no protótipo |
| Área do motorista | Não implementada no protótipo |
| Área administrativa | Não implementada no protótipo |
| Autenticação, autorização de negócio e banco | Não implementados no protótipo |

O arquivo `prototipo/README.md` contém os testes realizados e suas limitações. Não transformar ausência no protótipo em remoção no app original.

## 5. Inventário obrigatório antes da reforma

Criar `MATRIZ_PRESERVACAO.md`, com uma linha por funcionalidade. Estrutura mínima:

| ID | Perfil | Rota/tela atual | Ação/campo | Regra/validação | Fonte no código | Serviço/contrato | Situação atual | Destino no novo layout | Teste de regressão | Resultado |
|---|---|---|---|---|---|---|---|---|---|---|
| EXEMPLO | Motorista | A descobrir | Quantidade de diárias | A verificar | A localizar | A identificar | Não verificado | Editor de orçamento | Quantidade e total preservados | Pendente |

Incluir páginas raramente acessadas, menus secundários, modais, estados vazios, filtros, exportações, anexos, aprovações e configurações. Diferenciar implementado, parcial, ausente, bloqueado e não verificado. Somente marcar preservado após teste apropriado. Não confundir ocultar um botão com impedir uma operação sem permissão.

## 6. Direção de UX/UI aprovada

### Cliente

- Entrada com mapa e “Para onde vamos?”. Nenhum dashboard obrigatório antes de solicitar.
- Desktop: navegação lateral, painel de solicitação e mapa como área principal.
- Celular: mapa visível, painel inferior com campos e ação de avanço acessível. O painel do protótipo é rolável; não possui gesto de arrastar implementado. Se adicionar gestos, oferecer também alternativa por botão/teclado.
- Etapa 1: origem, destino, paradas e locais salvos.
- Etapa 2: modalidade/categoria, passageiros ou carga, data, horário e detalhes. Mostrar campos adicionais quando forem necessários à modalidade.
- Não confundir categoria de carga com modalidade de cobrança ou propriedade do veículo.
- Revisão final com todos os dados relevantes antes do envio.
- Corridas, agenda, carteira e resumo continuam acessíveis.
- Rascunho preservado ao alternar páginas durante a sessão. Persistência além da sessão deve seguir a política existente, sem gravar dados sensíveis indiscriminadamente.

### Identidade visual

Usar como referência `prototipo/style.css`: azul-petróleo `#102d3d`, texto `#183342`, destaque laranja `#eb6028`, fundo `#f6f5f0`, bordas `#e2e5df`. Tipografia de referência: Manrope para títulos e DM Sans para texto. Preservar os ativos oficiais da marca quando presentes no original.

Componentes com hierarquia clara, contraste legível, ícones coerentes e texto direto. Evitar excesso de cards repetidos, gradientes decorativos, slogans em toda tela ou informações relevantes em letras pequenas. Conservar a direção visual aprovada sem copiar limitações do HTML demonstrativo.

### Fluidez

- Manter navegação lateral montada ao trocar conteúdo.
- Indicador de seleção deslizante no menu e nos filtros.
- Filtros atualizam apenas a lista; não remontam a página nem perdem busca/foco.
- Transições discretas de aproximadamente 180–280 ms; respeitar redução de movimento.
- Evitar animação de grandes áreas de mapa a cada tecla digitada.
- Voltar/avançar do navegador, links diretos e navegação rápida precisam funcionar.
- No celular, teclado virtual não pode esconder o campo ativo ou tornar o botão inalcançável; rolagem deve alcançar todos os campos e erros.

## 7. Variáveis de corrida e diárias: não perder a composição

Esta lista é um requisito de cobertura para inspeção e desenho. Não afirma que cada campo já existe no app original. Não inventar taxas nem converter exemplos em regras comerciais.

| Grupo | Campos e decisões a preservar/verificar | Regra de interface |
|---|---|---|
| Modalidade | Veículo do prestador; motorista em veículo da empresa cliente; outras modalidades existentes | Explicar a modalidade e exibir somente campos aplicáveis, com possibilidade de rever a escolha |
| Categoria | Passageiros, carga leve, carga pesada; tipo de veículo e capacidades configuradas | Validar capacidade pela configuração real, não pelo exemplo do protótipo |
| Diárias | Quantidade, valor unitário, período/data de início e término se aplicável; frações e jornada conforme regra existente | Exibir quantidade × preço e subtotal; não eliminar diárias ao trocar de layout |
| Quilometragem | Distância, taxa por km e fonte do cálculo | Distinguir distância informada, calculada e estimada; preservar arredondamento e unidade |
| Retorno | Percentual, valor fixo ou outra regra existente; quando aplicável | Mostrar base de cálculo e evitar contabilizar o mesmo retorno duas vezes |
| Espera | Quantidade de horas, valor unitário e eventual franquia | Mostrar unidade, quantidade e subtotal |
| Reboque | Uso, categoria, valor fixo e/ou taxa por km conforme configuração | Impedir combinações contraditórias e conservar o cálculo existente |
| Despesas | Pedágio, balsa, hospedagem e demais despesas previstas | Mostrar estimativa e composição do orçamento; não criar adicional automático após aprovação |
| Paradas | Ordem, locais, quantidade e eventual custo | Preservar na revisão e no detalhe operacional |
| Carga/pessoas | Passageiros, peso, volumes, descrição, bagagens, acesso especial | Validar e mostrar ao motorista |
| Empresa | Solicitante, centro de custo, contato, observações | Preservar vínculo e permissões |
| Ajustes | Desconto, taxa, adicional ou ajuste manual já permitido | Exigir visibilidade do motivo, valor e autor quando a regra permitir |

A interface não decide a fórmula. Reutilizar o serviço de cálculo existente ou a mesma função de domínio testada. Se uma modalidade cobrar por diária e outra por km, não somar ambas automaticamente. Se uma combinação for válida, torná-la explícita. Não usar números do protótipo como fallback silencioso.

Preço exibido no cliente, motorista, administrador, confirmação, pedido e extrato deve se reconciliar. Tratar orçamento aprovado e revisões com rastreabilidade: valor, composição, versão, solicitante/aprovador e momento da decisão conforme suporte do sistema.

Se o negócio exigir preço fechado, custos posteriores devem seguir o fluxo de revisão/aditivo aprovado; não recalcular silenciosamente o valor autorizado. Não inventar permissão para editar cobranças.

## 8. Acompanhamento e posição do motorista

O usuário deseja essa possibilidade, mas ela não foi implementada neste protótipo e a situação atual do original precisa ser verificada.

Tela de acompanhamento deve comportar:

- Motorista/veículo atribuído e detalhes permitidos pelo perfil.
- Etapa da operação, origem, destino, paradas e horário.
- Posição recebida, momento da última atualização e precisão quando disponíveis.
- Previsão de chegada somente quando houver cálculo suportado; identificar estimativa.
- Estados: aguardando atribuição, aguardando início, a caminho da coleta, chegada, em viagem, concluída — mapear aos estados reais; não inventar transições de backend.
- Sem permissão de localização, sem sinal, localização desatualizada, integração indisponível e viagem encerrada.

Distinguir status de negócio de localização GPS. Um status “Em andamento” não prova que a posição está atualizada. Não mostrar a posição antiga como “ao vivo”. Não expor localização de outro motorista/empresa ou fora do escopo autorizado.

Se não existir integração, criar contrato/adaptador de apresentação documentado, usando dados fictícios apenas em modo demonstração e deixando os estados de indisponibilidade corretos em produção. Uma animação local pode demonstrar o layout, mas deve estar identificada como simulação. Não prometer rastreamento contínuo em segundo plano sem validação específica de plataforma e permissões.

## 9. Motorista e administrador também entram no trabalho

### Motorista

Inventariar e preservar serviços atribuídos, agenda, detalhes, construção/revisão de orçamento, seleção de modalidade/veículo, diárias e variáveis, início/conclusão, evidências e demais ações existentes. A entrada pode priorizar próxima viagem e ação operacional relevante; não copiar o formulário do cliente como home do motorista.

No celular, mostrar etapa atual e próximo comando com clareza. Durante cotação, exibir editor de composição e total. Durante execução, detalhes operacionais e evidências. Pedir confirmação nas ações que já exigem confirmação e impedir duplicidade conforme contrato existente. Localização e seus estados devem ser visíveis quando houver suporte.

### Administrador

Inventariar e preservar empresas, usuários, motoristas, pedidos, orçamentos, atribuições, agenda, configurações, parâmetros, carteira, recargas/ajustes/estornos, histórico e auditoria, conforme implementação existente.

No desktop, privilegiar tabelas, filtros, busca, detalhes e tarefas pendentes. No celular, transformar ações em telas acessíveis sem remover funções. O administrador não deve perder acesso às configurações de cálculo por estarem ausentes na referência visual.

Não inferir que “Master”, “Admin” e “Administrador da empresa cliente” têm as mesmas permissões. Mapear nomes e capacidades reais no repositório.

## 10. Estratégia de implementação sem descaracterizar o app

1. Abrir branch e registrar referência da versão original. Fazer inventário e executar fluxos de base disponíveis.
2. Separar componentes de apresentação de estado, cálculo, serviços e autorização. Reutilizar arquitetura do repositório; não migrar stack como parte desta reforma.
3. Criar tokens e componentes compartilhados de navegação, campos, filtros, status, detalhe e confirmação.
4. Aplicar ao cliente e validar as jornadas sem perder campos.
5. Aplicar ao motorista, incluindo editor de orçamento completo e execução.
6. Aplicar ao administrador, incluindo parâmetros e operações financeiras existentes.
7. Implementar interfaces de funções ausentes como trabalho explícito; integrar somente serviços existentes e autorizados no escopo.
8. Validar regressões e responsividade; preparar PR com evidências e pendências. Revisar antes de produção.

Preferir mudanças pequenas por módulo. Não criar uma segunda fonte de verdade para saldos ou preços na camada visual. Não substituir persistência real por mocks para fazer a tela parecer funcional.

## 11. Critérios de aceite

### Navegação e visual

- Cliente abre diretamente em mapa e solicitação.
- Layout utilizável em 360, 390, 768 e 1440 px, incluindo segunda etapa, detalhes longos e teclado virtual em aparelho quando possível.
- Sem rolagem horizontal acidental ou campo/ação inacessível.
- Trocas rápidas de menu e filtros não perdem seleção, foco, busca ou rascunho esperado.
- Navegação por teclado, labels, erros, contraste e redução de movimento verificados.

### Regressão funcional

- Toda linha do inventário tem destino no novo layout e resultado de teste.
- Diárias: quantidade × valor, períodos e eventual fração seguem a regra real. Valores inválidos produzem erro útil.
- Categoria, modalidade, reboque, retorno, espera, despesas e descontos válidos mantêm cálculo e arredondamento.
- Revisão e aprovação mostram a mesma composição; cada perfil vê somente ações autorizadas.
- Reservas, saldo disponível, débitos, cancelamentos e ajustes seguem os serviços existentes, sem duplicidade após reenvio/duplo clique.
- Dados permanecem após recarregar quando a funcionalidade exige persistência real.
- Motorista consegue executar os fluxos anteriores; administrador consegue gerir e configurar os mesmos recursos.
- Rastreamento tem estados de ausência/atraso de dados, sem falsa indicação de tempo real.
- Estados de erro, carregamento, conexão indisponível e lista vazia possuem comportamento funcional.

### Evidência e entrega

Registrar teste, ambiente/perfil, entrada, comportamento esperado, observado e resultado. Separar observado, hipótese e não testado. Entregar screenshots das telas alteradas, matriz de preservação e lista de lacunas. Não declarar “sem regressões” apenas porque o build passou.

## 12. Como Claudio deve repassar

1. Entregar este MD e o ZIP do protótipo ao Claude.
2. Disponibilizar também o repositório original pelo ambiente de desenvolvimento usado com o Claude. Um link sozinho não garante acesso a repositório privado.
3. Se o Claude não aceitar ZIP, extrair e anexar `prototipo/index.html`, `prototipo/style.css`, `prototipo/app.js` e este MD. O código local é a referência mesmo se o link privado não abrir.
4. Colar o prompt da seção 2 e pedir que a primeira entrega seja a matriz de preservação e o plano por perfil; depois seguir a implementação na branch.
5. Revisar telas e jornadas dos três perfis antes de integrar a mudança.

Não enviar senhas reais, arquivos `.env`, tokens, cookies ou exports de dados pessoais. O pacote de referência não precisa disso.
