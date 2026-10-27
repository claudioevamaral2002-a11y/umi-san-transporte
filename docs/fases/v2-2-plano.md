# v2.2: plano de implementação (correções da auditoria externa)

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (escolhida pelo dono, com revisor por tarefa). Os passos usam caixas (`- [ ]`).

**Objetivo:** corrigir os nove itens da auditoria aprovados pelo dono:
- capacidade;
- destino apagado;
- preços;
- resumo do pedido;
- agenda;
- telas "em breve";
- início do Master;
- filtro da auditoria;
- cancelada sem cobrança.

**Arquitetura:**
- **Banco:** só acrescenta, numa tarefa só. Entram uma coluna (`categorias.pessoas_max`), uma recusa nova em `criar_pedido`, chaves novas em leituras existentes e seis RPCs novas pequenas.
- **Front:** em `src/novo` e `src/lib`. Telas da v1 reaproveitadas (Contratos, Configurações, Auditoria, Agenda, Pedido, Extrato) mudam só onde a especificação manda e continuam funcionando na v1.

**Tecnologia:** Postgres/Supabase (pgTAP no CI), React 19, Vite, Playwright, Vitest.

**Especificação:** [`v2-2-correcoes-auditoria-desenho.md`](v2-2-correcoes-auditoria-desenho.md), aprovada em 27/10/2026, incluindo a §9.

Branch `v2-2`, a partir de `origin/main` (v2.1 + PR #44). **Um PR só**, e o merge é do dono. O banco só é verificado no CI: faça push e acompanhe com `gh run watch`. Junte os pushes para não repetir rodadas à toa. O teste instável conhecido (`pedidos.test.ts`, deadlock) foi corrigido no #44. Se voltar, é defeito: investigue em vez de rodar de novo.

## Restrições globais

- **Migrations:** só novas (`20261027…`); pgTAP novos a partir de `0050`. A guarda `0001_privilegios` fica verde.
- **RPCs:** `security definer set search_path = ''`, devolvem `{ok, codigo}`, negações por `interno.negar`, limite com `interno.checar_limite`, padrão `revoke all … grant execute … to authenticated`.
- **`api.criar_pedido`:** é recriada **a partir do corpo de `20261026120000_criar_pedido_trava_agenda.sql`** e mantém o `pg_advisory_xact_lock` da agenda. O pgTAP `0049` continua verde.
- **Compatibilidade:**
  - toda mudança de resposta é **chave nova**;
  - a única recusa nova é `ACIMA_DA_CAPACIDADE` (especificação §9);
  - `api.salvar_categoria` aceita o jsonb **sem** `pessoas_max` e, nesse caso, mantém o valor.
- **pgTAP de jsonb exato** (0004, 0016 e outros que quebrarem): acrescente as chaves novas. Não afrouxe o teste.
- **Texto da interface** (exato):
  - "até N pessoas", "Até quantas pessoas", "Ver cálculo", "Detalhes do pedido";
  - "Sem cobrança", "Multa R$ X", "Cancelada sem cobrança", "Orçamento (não cobrado)", "Concluída";
  - "Falar com a IVO", "Contato ainda não cadastrado", "Contato da IVO (aparece na Ajuda e na Carteira)";
  - "Pedir daqui", "Locais salvos", "Ajuda";
  - "Data inválida", "A data inicial é depois da final";
  - "Corridas em andamento, concluídas e canceladas (com a multa, quando houve).";
  - "Pedidos por categoria usam os preços de Categorias e preços. Estes valores valem para pedidos sem categoria (app v1).".
- Português do Brasil; CSP sem estilos inline; acessível; claro e escuro; 390 px sem rolagem lateral.

## Foco da revisão

1. **Resposta atrasada:** a origem resolve depois de o usuário digitar o Para, ou de trocar uma parada. Nenhum campo volta a um valor antigo (Tarefa 3).
2. **Troca de categoria com pessoas acima do limite:** o contador desce, e o pedido enviado nunca passa do limite. O banco recusa mesmo se o app mandar mais (Tarefas 1 e 3).
3. **Agenda:** um pedido concluído de **outra empresa**, ou de outro solicitante para o N2, nunca aparece em `concluidas` (o N3, visualizador, vê os da empresa toda). O número do mês bate com o dia (Tarefas 1 e 5).
4. **Encerrado com multa versus sem multa:** a lista, o detalhe novo e a tela da v1 dizem a mesma coisa, e o orçamento nunca aparece como valor cobrado (Tarefas 1 e 4).
5. **Locais:** o N2/N3, ou um N1 de outra empresa, não renomeia nem exclui. Excluir um local não mexe em pedidos (Tarefas 1 e 5).

---

## Tarefas

| # | Tarefa | Verificação |
|---|---|---|
| 1 | Banco: capacidade, agenda.concluidas, locais, contato/ajuda, ações da auditoria, cobrança do pedido | pgTAP `0050` |
| 2 | Bibliotecas do front: tipos, wrappers, erros, ações, datas e texto de cobrança | Vitest |
| 3 | Cliente, pedir: destino não apaga, limite de pessoas, Ver cálculo | Vitest + e2e simulado |
| 4 | Cliente, corrida: número, Detalhes do pedido, Encerrada, listas | e2e simulado |
| 5 | Agenda com concluídas; Ajuda, Locais salvos, contato na Carteira | e2e simulado |
| 6 | Master: início, Configurações, pessoas na categoria, nota no contrato, filtro da auditoria | e2e simulado |
| 7 | e2e real e fechamento: roteiro, RUNBOOK §22, HANDOFF §5F, versão 2.2.0, PR | CI + revisão |

**Ordem e paralelismo:**
- **T1 e T2 em paralelo**, porque a T2 só depende dos contratos de interface abaixo.
- Depois **T3, T4, T5 e T6** em worktrees isolados e em paralelo, contra mocks.
- A **T7** vem depois de tudo mesclado.

---

### Tarefa 1: banco

**Arquivos:** criar `supabase/migrations/20261027120000_capacidade_categoria.sql` (coluna, `salvar_categoria`, `categorias_disponiveis`, `criar_pedido`) e `supabase/migrations/20261027120100_leituras_auditoria.sql` (o resto); teste `supabase/tests/0050_v2_2_correcoes.test.sql`.

**Interfaces:**
- **`app.categorias.pessoas_max smallint null`**, com check `between 1 and 99`. A migration faz `update … set pessoas_max = 4 where codigo = 'PASSAGEIROS'`; confira o código real no seed.
- **`api.salvar_categoria`:** a chave opcional `pessoas_max` aceita inteiro de 1 a 99 ou `null`, que significa sem limite. **Chave ausente** mantém o valor. Inválido → `CAMPOS_INVALIDOS` com o detalhe `pessoas_max`.
- **`api.categorias_disponiveis`:** cada categoria ganha `pessoas_max`. As linhas da prévia **já vêm** (`linhas`), e o front usa essas.
- **As leituras de categoria do Master** (as que `src/lib/categoriasAdm.ts` usa) trazem `pessoas_max`.
- **`api.criar_pedido`:** com `categoria`, `carga` em `PESSOAS`/`AMBOS` e `pessoas_qtd > pessoas_max`, retorna `interno.negar('CRIAR_PEDIDO','pedido','ACIMA_DA_CAPACIDADE', {pessoas_max})`. A checagem vem depois de `validar_pedido` e antes da trava da agenda.
- **`api.agenda(p_dia)`:** ganha `concluidas`: um array de `{id, numero, inicio, duracao_min, origem, destino, categoria_nome, status}` das atividades `EM_ANDAMENTO` ou `CONCLUIDA` com `inicio` naquele dia local (America/Sao_Paulo) e `interno.pode_ver_atividade(v, a)`. Para o motorista, as dele; para o Master, todas.
- **`api.locais_empresa_todos()`:** `{ok, locais:[{id, nome, usos, ultimo_uso, place_id, lat, lng}]}`, só cliente, ordenado por `usos desc, ultimo_uso desc`, até 200.
- **`api.renomear_local(p_id uuid, p_nome text)`** e **`api.excluir_local(p_id uuid)`:**
  - só o N1 da empresa do local; outro perfil → `SEM_PERMISSAO`;
  - um id de outra empresa → `NAO_ENCONTRADO`;
  - o nome é aparado e tem de 2 a 80 caracteres; se colidir com a `chave` de outro local da mesma empresa → `JA_EXISTE`; confira a regra de `chave` em `termos_google.sql`;
  - as duas são auditadas.
- **`api.contato_ivo()`:** `{ok, contato}` para qualquer perfil ativo (`app.pode_acessar()`).
- **`api.ajuda_cliente()`:** `{ok, cancelamento:{…faixas como no contrato}, prazo_orcar_horas, validade_orcamento_horas, forma_cobranca}` do contrato vigente da empresa de quem chama. Só cliente; sem contrato → `SEM_CONTRATO`.
- **`api.acoes_auditoria()`:** `{ok, acoes:[{acao, total}]}`, só quem tem a permissão de ver a auditoria (o mesmo teste de `api.listar_auditoria`). Crie um índice em `interno.auditoria(acao)` se ainda não houver; confira o nome real da tabela.
- **`api.meus_pedidos`:** cada item ganha `multa_cent`, a soma de `-valor_cent` dos lançamentos `MULTA` da atividade, ou `null`.
- **`api.pedido`:** ganha `cobranca:{debito_cent, multa_cent, liberado_cent}`, somas positivas dos lançamentos `DEBITO`, `MULTA` e `LIBERACAO_RESERVA` da atividade, cada uma `null` se zero. Para o motorista, `cobranca` é `null`.
- **Recrie as funções a partir da última definição de cada uma** (procure com `grep -l "function api.<nome>"` e use o arquivo mais novo).

- [ ] **Passo 1: escrever o `0050`:**
  - 4 pessoas em Passageiros → ok; 5 → `ACIMA_DA_CAPACIDADE` com `pessoas_max = 4`;
  - categoria sem limite aceita 99;
  - pedido sem categoria (v1) com 5 → ok;
  - `salvar_categoria` sem a chave mantém o 4; com `null`, sem limite; com 0 ou 100 → `CAMPOS_INVALIDOS`;
  - `categorias_disponiveis` traz `pessoas_max`;
  - `agenda.concluidas`: a do próprio N1 aparece; a de outra empresa não; o N2 (solicitante) vê só os próprios pedidos e o N3 (visualizador) os da empresa;
  - locais: listar como N2 ok; renomear como N2 → `SEM_PERMISSAO`; id de outra empresa → `NAO_ENCONTRADO`; renomear e excluir como N1 ok, e o pedido continua;
  - `contato_ivo` como motorista ok; `ajuda_cliente` como motorista → `SEM_PERMISSAO`; `acoes_auditoria` como cliente → `SEM_PERMISSAO` e, como Master, traz `CRIAR_PEDIDO`;
  - `meus_pedidos.multa_cent` e `pedido.cobranca`, com e sem multa; o motorista recebe `cobranca` nulo;
  - `0049` intocado.
- [ ] **Passo 2:** push; o CI falha no `0050`. **Passo 3:** as migrations e o ajuste dos pgTAP de jsonb exato. **Passo 4:** push; o CI fica verde.
- [ ] **Passo 5:** commit `feat(v2.2): capacidade da categoria, agenda com concluídas, locais, ajuda e cobrança do pedido`.

### Tarefa 2: bibliotecas do front

**Arquivos:**
- modificar `src/lib/erros.ts`, `src/lib/administracao.ts` (`ACOES`), `src/lib/pedidos.ts` (tipos), `src/lib/categorias.ts`, `src/lib/categoriasAdm.ts` e `src/lib/api.ts`;
- criar `src/lib/locais.ts`, `src/lib/ajuda.ts` e `src/lib/cobrancaPedido.ts`;
- testes `src/lib/*.test.ts`, ao lado de cada módulo (com `vi.mock` do `supabase.ts` quando importar módulo que lê env).

**Interfaces:**
- **`erros.ts`:** `ACIMA_DA_CAPACIDADE` → "Esta categoria leva até {pessoas_max} pessoas." (use o detalhe). A guarda de erros do CI exige que todo código do banco tenha mensagem.
- **Tipos:**
  - `CategoriaDisponivel.pessoas_max: number | null`;
  - `ItemPedido.multa_cent?: number | null`;
  - `RespostaPedido.cobranca?: {debito_cent: number|null; multa_cent: number|null; liberado_cent: number|null} | null`;
  - `DiaAgenda.concluidas?: ConcluidaAgenda[]`.
- **`locais.ts`:** `listarLocais()`, `renomearLocal(id, nome)`, `excluirLocal(id)`.
- **`ajuda.ts`:** `contatoIvo()`, `ajudaCliente()` e `linkContato(contato: string): string | null`. Só dígitos com 10 ou 11 números → `tel:`; começa com `wa.me` ou `https://wa.me` → esse link; senão `null`.
- **`api.ts`:** `acoesAuditoria()`.
- **`administracao.ts`:**
  - `ACOES` ganha os nomes legíveis das ações de pedido, dinheiro, fatura e cadastro;
  - liste-as a partir de `grep -ho "interno.negar('[A-Z_]*'\|auditar('[A-Z_]*'" supabase/migrations`;
  - `GRUPO_ACAO: Record<string, 'Acesso'|'Pedidos'|'Dinheiro'|'Faturas'|'Cadastros'>`;
  - `opcoesDeAcao(lista: {acao,total}[])`, agrupada, com o código como rótulo quando o nome é desconhecido.
- **`src/lib/valores.ts`:** `validarPeriodo(de: {valor: string; invalido: boolean}, ate: {...}): 'Data inválida' | 'A data inicial é depois da final' | null`.
- **`cobrancaPedido.ts`:** `textoCobranca(status, multa_cent): string | null`. Para `CANCELADA`, `EXPIRADA`, `RECUSADA` e `REPROVADA`, dá "Sem cobrança" ou "Multa R$ X"; nos outros status, `null`.
- **`limitarPessoas(qtd, pessoas_max): {qtd, ajustou: boolean}`** em `src/lib/limitesPedido.ts`.

- [ ] Vitest de cada função nova (vermelho → verde). Commit `feat(v2.2): bibliotecas do front para as correções da auditoria`.

### Tarefa 3: Cliente, pedir

**Arquivos:**
- modificar `src/novo/telas/cliente/InicioCliente.tsx`, `EscolherCategoria.tsx` e o componente de memorial que for reaproveitado (procure onde `ConfirmarCorrida` mostra as linhas);
- e2e: `tests/e2e/novo-destino-nao-apaga.spec.ts` e `tests/e2e/novo-capacidade.spec.ts`.

- [ ] **Passo 1:**
  - O e2e segura a resposta do detalhe da origem (rota do Places/mapa mockada com atraso), digita "Porto de Itajaí" no Para e libera. O Para continua com o texto.
  - Faça o mesmo com uma parada.
  - Um teste unitário do novo `mudar` por campo, se ele for extraído para uma função pura.
- [ ] **Passo 2:** em `InicioCliente.tsx`, cada `mudarX` usa só o setter do próprio campo (`setDestino(v)`). O `completo` e a rota são calculados a partir do estado atual, não de parâmetros capturados. O mesmo vale para o `aoUsar` de "Marcar no mapa".
- [ ] **Passo 3:** e2e de capacidade:
  - com Passageiros (`pessoas_max: 4` no mock), o "+" para em 4 e aparece "até 4 pessoas";
  - em Carga Leve (sem limite) põe 6 e troca para Passageiros: desce a 4 com o aviso;
  - um mock que responde `ACIMA_DA_CAPACIDADE` mostra a mensagem de `erros.ts`;
  - 390 px sem rolagem lateral.
- [ ] **Passo 4:** "Ver cálculo" no cartão escolhido abre as `linhas` da prévia com o mesmo componente do memorial. O e2e confere que a linha de km aparece.
- [ ] **Passo 5:** commit `fix(v2.2): destino não apaga, limite de pessoas e cálculo na prévia`.

### Tarefa 4: Cliente, corrida

**Arquivos:**
- modificar `src/novo/telas/cliente/Aguardando.tsx` (`TrilhoCorrida`), `Corrida.tsx`, `ConfirmarCorrida.tsx` e `src/novo/destinoPedido.ts`;
- criar `src/novo/telas/cliente/DetalhesPedido.tsx` e `Encerrada.tsx`;
- modificar `src/telas/pedidos/componentes.tsx` (`CartaoPedido`), `src/telas/pedidos/Pedido.tsx` e `src/novo/telas/empresa/AbaCorridas.tsx`;
- e2e: `tests/e2e/novo-resumo-pedido.spec.ts` e `tests/e2e/novo-encerrada.spec.ts`; ajuste os e2e que dependem do redirecionamento.

- [ ] **Passo 1:**
  - `TrilhoCorrida` mostra o número, `#0018`, formatado como nas listas.
  - `DetalhesPedido` é um `<details>`, ou um botão com `aria-expanded`, chamado "Detalhes do pedido", com só o que existe:
    - pessoas ou carga, com descrição e peso;
    - paradas (`paradasDoDetalhe`);
    - diárias e outros custos;
    - observações;
    - centro de custo;
    - contato.
  - Ele entra em Aguardando, ConfirmarCorrida, CorridaConfirmada e Acompanhar.
- [ ] **Passo 2:** `destinoNoAppNovo` para o CLIENTE inclui `AGENDADA`, `CANCELADA` e `EXPIRADA`. `Corrida.tsx` passa a usar `Encerrada` para `CANCELADA`, `EXPIRADA`, `RECUSADA` e `REPROVADA`. Na tela `Encerrada`:
  - no topo, "Cancelada sem cobrança" (ou a multa), "reserva de R$ X devolvida" quando `cobranca.liberado_cent`, e o motivo do último histórico;
  - depois `TrilhoCorrida` e `DetalhesPedido`;
  - depois "Orçamento (não cobrado)" com o memorial, quando houver orçamento e nenhum débito;
  - por fim o histórico.
- [ ] **Passo 3:**
  - `CartaoPedido` mostra `textoCobranca` no lugar do total quando ele não for nulo;
  - `Pedido.tsx` (v1) esconde "Se precisar cancelar depois de aprovado" em status encerrado e mostra o selo `textoCobranca`;
  - `AbaCorridas` usa o texto novo.
- [ ] **Passo 4:**
  - e2e de resumo: número e detalhes em `SOLICITADA`; agendada abre `/corrida/{id}`;
  - e2e de encerrada: com e sem multa, mais a lista com "Sem cobrança";
  - 390 px sem rolagem lateral.
- [ ] **Passo 5:** commit `feat(v2.2): resumo do pedido e cancelada sem cobrança`.

### Tarefa 5: Agenda, Ajuda, Locais e Carteira

**Arquivos:**
- modificar `src/telas/agenda/Agenda.tsx`, `GradeHoras.tsx` e `ResumoDoDia` (onde estiver);
- criar `src/novo/telas/Ajuda.tsx` e `src/novo/telas/cliente/LocaisSalvos.tsx`;
- modificar `src/novo/rotas.tsx` (tirar o `PROVISORIAS` de `locais` e `ajuda`), `src/telas/extrato/Extrato.tsx` ou `CartaoSaldo` e `src/novo/telas/empresa/AbaCarteira.tsx`;
- e2e: `novo-agenda-concluidas`, `novo-ajuda` e `novo-locais`.

- [ ] **Passo 1: agenda.**
  - Os itens de `concluidas` são desenhados na grade como cartões cinza com o selo "Concluída" ("Em andamento" quando for o caso), com link para a corrida. `ResumoDoDia` os lista.
  - Sem `concluidas` na resposta (banco antigo), nada muda.
  - O e2e confere que o mês "2 pedidos seus" e o dia têm 2 cartões, e confere a "3 dias" com três colunas de cabeçalho.
- [ ] **Passo 2: Ajuda.**
  - Uma tela por perfil, com "Falar com a IVO" (`contatoIvo` + `linkContato`, ou o texto sem link; vazio → "Contato ainda não cadastrado").
  - Perguntas em `<details>`:
    - **Cliente:** orçamento e aprovação; cancelamento com as faixas de `ajudaCliente` (formate as horas e os percentuais); recarga, ou fatura quando `forma_cobranca = FATURADO`.
    - **Motorista:** orçar, sair, concluir.
    - **Master:** onde ficam Contratos, Categorias, Créditos, Faturas e Auditoria.
- [ ] **Passo 3: Locais salvos.**
  - A lista vem de `listarLocais`. "Pedir daqui" navega para `/` com o De preenchido: use o mesmo mecanismo do "Pedir de novo" (`pedirDeNovo.ts`).
  - Para o N1, o lápis renomeia e o Excluir pede confirmação; os outros níveis não veem os botões.
  - Lista vazia: "Os lugares dos seus pedidos aparecem aqui."
- [ ] **Passo 4:** na Carteira, para empresa no Crédito: "Para recarregar, fale com a IVO: contato", com link quando houver.
- [ ] **Passo 5:** e2e e 390 px; commit `feat(v2.2): agenda com concluídas, Ajuda, Locais salvos e contato na Carteira`.

### Tarefa 6: Master

**Arquivos:**
- modificar `src/novo/telas/Provisorias.tsx` ou criar `src/novo/telas/adm/InicioMaster.tsx` (e `InicioDoPerfil` em `rotas.tsx`);
- modificar `src/telas/adm/Configuracoes.tsx` (rótulo e aviso), `src/novo/telas/adm/CartaoCategoria.tsx` (campo e exibição), `src/telas/contratos/CartoesContrato.tsx` (nota) e `src/telas/adm/Auditoria.tsx` (opções e datas);
- e2e: `novo-inicio-master` e `adm-auditoria-filtro`; ajuste `adm.spec.ts` e `novo-categorias-ver-editar.spec.ts` se mudarem.

- [ ] **Passo 1: início do Master.**
  - Em cima, as pendências com atalho, vindas de `dinheiro.painel` (`api.painel_adm` do mês atual) e de `faturas.resumo`:
    - aguardando orçamento;
    - aguardando aprovação;
    - em andamento;
    - faturas a gerar e vencidas (`PendenciasFaturas`);
    - empresas abaixo do alerta.
  - Embaixo, o `PainelResumo`.
  - Sem pendências: "Nada pendente agora."
  - Sai o texto "As telas novas chegam em breve".
- [ ] **Passo 2:** Configurações: o rótulo novo e, se vazio, o aviso "Sem contato, a Ajuda e a Carteira mostram 'Contato ainda não cadastrado'."
- [ ] **Passo 3:** `CartaoCategoria`:
  - no modo editar, o campo "Até quantas pessoas" (vazio = sem limite; 1–99) vai em `salvar_categoria`;
  - no modo ver, "até N pessoas" quando preenchido;
  - o rascunho e o Cancelar seguem a regra da v2.1.
- [ ] **Passo 4:** `CartoesContrato`: a nota exata junto aos km, com link para `/adm/categorias`, só quando a versão tem tabela de categorias. Use o mesmo critério `comTarifas` de `PublicarContrato.tsx`. Na v1, a rota do link é a da v1.
- [ ] **Passo 5:** Auditoria.
  - As opções de Ação vêm de `acoesAuditoria()` + `opcoesDeAcao`, agrupadas em `<optgroup>`. Se a RPC falhar, usa `ACOES`.
  - Datas:
    - no submit, leia `input.validity.badInput`;
    - com `validarPeriodo`, mostre o erro ligado ao campo (`aria-invalid` e `aria-describedby`) e não filtre;
    - as datas válidas ficam no campo depois de Filtrar.
  - O e2e digita "31/02" com `pressSequentially` (data incompleta) e espera "Data inválida", depois espera um intervalo invertido dar erro e o válido filtrar.
- [ ] **Passo 6:** commit `feat(v2.2): início do Master, pessoas na categoria, nota no contrato e filtro da auditoria`.

### Tarefa 7: e2e real e fechamento

- [ ] `tests/e2e/real/v2-2-auditoria.spec.ts` (projeto `real`, padrão de `real/v2-1-faturas.spec.ts`):
  - o Master põe Passageiros em 4;
  - o N2 tenta 5 (o contador para em 4) e pede com 4;
  - o motorista orça, o N2 confirma, o N2 cancela, e a lista e o detalhe mostram "Sem cobrança";
  - a agenda do dia de um pedido concluído mostra o cartão.
- [ ] `docs/fases/v2-2-o-que-testar.md`: roteiro no celular. Começa pelos §8.1 e §8.2 da especificação: cancelar o #0018 e preencher o contato. Inclui a "3 dias" em tela cheia e uma rodada guiada como **motorista**.
- [ ] RUNBOOK §22 "Correções da auditoria (v2.2)": limite de pessoas, contato da IVO, locais salvos, como ler a cobrança de um cancelado e problemas comuns.
- [ ] HANDOFF §5F. `package.json` e `package-lock.json` em **2.2.0**, mudando só o campo `version` no lockfile.
- [ ] Revisão final do branch inteiro. Abrir **um PR** para a `main` com o checklist do dono. O merge é do dono.

## Autorrevisão (feita)

- **Cobertura da especificação:**

  | Item da especificação | Tarefas |
  |---|---|
  | 1 Capacidade (§2, §4.1) | 1, 2, 3 e 6 |
  | 2 Destino | 3 |
  | 3 Preços: nota e Ver cálculo | 3 e 6 |
  | 4 Resumo do pedido (§5.2) | 4 |
  | 5 Agenda (§4.2, §5.4) | 1 e 5 |
  | 6 Ajuda, Locais e contato (§4.3, §4.4, §5.5) | 1, 2 e 5 |
  | 7 Início do Master | 6 |
  | 8 Filtro da auditoria (§4.5) | 1, 2 e 6 |
  | 9 Cancelada (§4.6, §5.3) | 1, 2 e 4 |
  | §6 Segurança | 1 |
  | §7 Testes | 1–7 |
  | §8 Dono | 7 |

- **Nomes conferidos entre as tarefas:**
  - `pessoas_max`, `ACIMA_DA_CAPACIDADE`, `concluidas`;
  - `locais_empresa_todos`, `renomear_local`, `excluir_local`;
  - `contato_ivo`, `ajuda_cliente`, `acoes_auditoria`;
  - `multa_cent`, `cobranca{debito_cent, multa_cent, liberado_cent}`;
  - `textoCobranca`, `limitarPessoas`, `validarPeriodo`, `linkContato`, `opcoesDeAcao`.
