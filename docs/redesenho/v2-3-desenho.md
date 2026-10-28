# v2.3: reforma visual do app (cliente, motorista e Master)

Estado: **rascunho para o dono aprovar** (28/10/2026). Base: v2.2.1 no ar (`e7ec62a`).

Fontes:
- o repasse [`REPASSE.md`](REPASSE.md), de 28/10/2026;
- o protótipo [`prototipo/`](prototipo/) (commit de referência `755516b`), que é só **referência visual** e cobre só o cliente;
- o inventário do app de hoje, com 350 linhas por perfil: [`MATRIZ_PRESERVACAO.md`](MATRIZ_PRESERVACAO.md).

## 1. O que muda e o que não muda

- **Muda:** a aparência e a navegação das telas do app novo (`src/novo` e as telas da v1 que ele reaproveita): cores, letras, moldura, menu, a tela de pedir em duas etapas, as listas e os filtros.
- **Não muda:**
  - banco, regras, preços, permissões, autenticação e integrações. Nenhuma migration nesta versão;
  - o app v1 (ivo-v1.pages.dev);
  - os textos de regra que o dono já aprovou nas fases anteriores.
- **Regra de ouro:** cada linha da matriz tem um destino no novo layout e um teste. Uma tela só conta como "preservada" com o teste verde, e não por aparência.

## 2. Divergências entre o protótipo e o app (o app vence)

| Protótipo | Decisão |
|---|---|
| **Carteira** no menu e na barra de baixo | **Não volta.** O dono tirou em 27/10 (v2.2.1). O saldo fica para o Administrador, em Painel da empresa › Carteira |
| **Locais salvos** (tela) | **Não volta** (v2.2.1). "Seus lugares" da etapa 1 vira **"Últimos lugares"**, que o banco já devolve |
| Cartão **"Disponível R$ 7.820"** sobre o mapa | Só para o **Administrador (N1)** e só no Crédito *(decisão minha: coerente com tirar o saldo do Solicitante)* |
| "Visão geral" do cliente | **Não entra.** O N1 já tem o Painel da empresa, e o cliente abre direto no pedido, como o repasse pede |
| Mapa SVG ilustrativo | Continua o **mapa do Google** de hoje, só com o estilo novo |
| Preços, capacidades, multas e datas de exemplo | **Nunca** entram. Tudo continua vindo do banco |
| Botão "Protótipo" / simular início e conclusão | **Não entra.** O motorista é quem sai e conclui de verdade |
| "Carga pesada" | Só aparece se existir e estiver ativa em Categorias e preços |

## 3. Identidade visual

**Cores:** os tokens passam para a paleta do protótipo.

| Token de hoje | Hoje | Novo | Para quê |
|---|---|---|---|
| `--cor-marinho` | `#0a2540` | `#102d3d` (azul-petróleo) | barra lateral, títulos, botões escuros |
| `--cor-texto` | `#0a2540` | `#183342` | texto |
| `--cor-laranja` | `#ff6a00` | `#eb6028` | ação principal e destaque |
| `--cor-papel` | `#f6f4ee` | `#f6f5f0` | fundo |
| `--cor-borda` | `#e1e6ed` | `#e2e5df` | bordas |

- Laranja **como texto** continua com uma variante escura de contraste (`--cor-alerta-texto`).
- O teste automático de contraste (`src/design/contraste.test.ts`) continua obrigatório, nos modos claro e escuro.
- O modo escuro ganha a mesma família de cor.

**Letras:**
- **Manrope** nos títulos e números, e **DM Sans** no texto.
- As duas são **servidas pelo próprio app** (arquivos `woff2` em `public/`), sem Google Fonts. Assim a CSP de hoje não abre para outro domínio e não há custo nem rastreio *(decisão minha)*.

**Marca:** o logotipo IVO oficial que já está no app, na barra lateral e no topo do celular.

**Movimento:**
- transições de 180 a 280 ms;
- indicador que desliza no menu e nos filtros;
- tudo desligado com "reduzir movimento".

## 4. Moldura e navegação (todos os perfis)

- **Computador (≥ 1024 px):**
  - **barra lateral fixa** azul-petróleo, com logotipo, empresa e nível, itens do perfil com o indicador que desliza, "Fale com a IVO" e, no pé, a pessoa;
  - a barra **não remonta** ao trocar de página.
- **Celular:**
  - topo com logotipo e sino;
  - **barra de baixo** para o polegar.
- **Telas médias (768 px):** a lateral recolhe para ícones.
- **Itens por perfil:** os mesmos de hoje (matriz C-, M-, A-), só reorganizados:
  - **Cliente:**
    - Solicitar · Minhas corridas · Agenda · Ajuda;
    - o **N1** também tem Equipe · Painel da empresa;
    - no pé, Perfil e segurança.
    - A barra de baixo do celular é Solicitar · Corridas · Agenda · Mais.
  - **Motorista:**
    - Início (próxima viagem) · Minhas corridas e Pendências · Agenda · Meus veículos · Corridas do mês · Ajuda;
    - o interruptor **Disponível** fica no topo, como hoje.
  - **Master:** a lateral agrupa os 13 itens de hoje em seções:
    - Operação: Início, Painel, Faturas, Créditos;
    - Cadastros: Empresas, Usuários, Veículos, Categorias e preços, Contratos;
    - Sistema: Configurações, Auditoria;
    - mais o Painel da empresa.
- Voltar e avançar do navegador, links diretos e o "Nova versão · Atualizar" continuam funcionando.

## 5. Cliente

### 5.1 Pedir em duas etapas (`/`)
- **Etapa 1, "Para onde vamos?":**
  - campos De, paradas (até 3) e Para, com a busca de hoje e "Marcar no mapa";
  - **"Últimos lugares"** do banco;
  - "Viagem agendada" leva direto à etapa 2 com data e hora;
  - botão **Continuar** sempre alcançável.
- **Etapa 2, "Como vamos?":**
  - o resumo do trajeto com **Editar**;
  - os cartões de **categoria**, vindos do banco, com ícone, "até N pessoas" ou carga, e o preço da prévia;
  - os campos que a categoria pede: pessoas (com o limite), carga, diárias, outros custos, horas (IVO Motorista), quando e detalhes (contato, observações, centro de custo);
  - **"Ver cálculo"** com as linhas da prévia;
  - **Revisar solicitação** abre a revisão com tudo, e só então se faz o pedido.
- **Computador:** painel à esquerda do mapa, como no protótipo. **Celular:** mapa em cima e painel embaixo, rolável, com o botão de avanço preso ao pé visível.
- **Rascunho:** se a pessoa sai para Corridas e volta, o que já preencheu continua lá enquanto a sessão estiver aberta, como faz o protótipo. Não fica guardado no aparelho depois de fechar.
- Continua tudo da matriz C-36 a C-75:
  - capacidade, destino que não apaga, paradas, diárias, outros custos e volta à origem;
  - Faturado ("será cobrada na fatura");
  - saldo insuficiente, "Agora" e horário ocupado.

### 5.2 Corrida (`/corrida/:id`)
- Mesmas telas por situação (aguardando, confirmar orçamento, confirmada, acompanhar, concluída, encerrada), no visual novo.
- **Acompanhar:** os estados de rastreio de hoje (ao vivo, sinal atrasado, sinal perdido, só status para quem não pode ver o mapa) passam a mostrar **"atualizado há N s"**. Não há posição antes da saída, porque ela não existe no sistema (§8).

### 5.3 Minhas corridas e Agenda
- Os filtros (Em aberto, Agendadas, Encerradas) viram um **controle segmentado com o indicador que desliza**. Trocar de filtro atualiza só a lista, sem perder a rolagem nem o foco.
- A agenda (mês, dia e 3 dias) ganha o visual novo e não muda as regras.

## 6. Motorista
- **Início = próxima viagem:** cartão com horário, De → Para, cliente, categoria e o botão da etapa (Aceitar / Orçar / Sair / Acompanhar). Abaixo, as pendências.
- **Chamada e calculadora (ProporValor):** editor de composição com **todas** as variáveis de hoje:
  - km, fixo, retorno, espera, reboque, hospedagem/diárias, horas, paradas e outros;
  - o aviso do cliente sobre outros custos;
  - o total.
  Nada fica escondido. Linhas com zero ficam recolhidas, mas abrem com um toque.
- **Viagem:** "Deslize para sair", o compartilhamento de localização (com o aviso LGPD), a navegação, "Concluir serviço" e as fotos, como hoje, no visual novo e com a etapa atual sempre visível.
- Veículos, Corridas do mês e Agenda ficam no visual novo, sem mudar regras.

## 7. Master (computador primeiro)
- **Início:** as pendências da v2.2, com o visual novo.
- As telas da v1 reaproveitadas (Contratos, Créditos, Usuários, Empresas, Configurações, Auditoria, Painel) passam a usar **tabelas** com cabeçalho fixo, busca e filtros, e o detalhe ao lado ou em folha.
- No celular, cada tabela vira uma lista de cartões, sem tirar nenhuma ação.
- **Categorias e preços, Faturas e Veículos:** ficam no visual novo e mantêm as regras de rascunho, publicar e anexar NF.
- Nenhuma configuração de cálculo some, nem do contrato nem da categoria.

## 8. Lacunas (registradas, fora desta versão)

Essas lacunas vêm da matriz. Cada uma é **trabalho separado**, porque mexe no banco ou em regra:
- desconto (o banco tem `ajuste_cent`, sem tela);
- bagagens e volumes;
- peso e dimensões no pedido novo;
- posição do motorista **antes** da saída e mapa da frota;
- notificação com o app fechado;
- disponibilidade do motorista guardada só no aparelho;
- exportações que faltam, como CSV de corridas e da auditoria;
- "esqueci a senha";
- o limite de diárias, que é 30 para o cliente e 60 para o motorista.

## 9. Entrega por módulos (um PR por módulo; o merge é sempre do dono)

| Módulo | Conteúdo | Pronto quando |
|---|---|---|
| **M0** | Tokens, letras, moldura nova (lateral, topo e barra de baixo) para os três perfis | Todas as telas abrem na moldura nova; contraste, 360/390/768/1440 px e e2e de hoje verdes |
| **M1** | Cliente: pedir em duas etapas e revisão | Matriz C-36 a C-75 com teste; capturas no computador e no celular |
| **M2** | Cliente: corrida, acompanhar, corridas, agenda, ajuda e equipe | Matriz C- restante e Painel da empresa |
| **M3** | Motorista: início, chamada, calculadora, viagem, veículos e corridas do mês | Matriz M- inteira |
| **M4** | Master: lateral em seções e tabelas nas telas da v1 | Matriz A- inteira |

Cada módulo:
- marca na matriz o destino e o resultado de cada linha;
- traz capturas antes e depois;
- roda a suíte inteira no CI;
- passa por um revisor antes do PR.

O app só muda no ar quando o dono mescla, e um módulo de cada vez dá para testar no celular.

## 10. Decisões minhas (conferir na leitura)
1. Carteira e Locais salvos **não voltam** (§2).
2. O cartão de saldo sobre o mapa aparece **só para o N1**, e só no Crédito.
3. Sem "Visão geral" para o cliente.
4. As letras são **servidas pelo app**, sem Google Fonts.
5. Versão **2.3.0**, entregue em 5 módulos com um PR cada.
