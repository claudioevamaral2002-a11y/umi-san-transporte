# v2.1: plano de implementação (ajustes do Master e do pedido, faturamento por NF)

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (escolhida pelo dono, com revisor por tarefa). Os passos usam caixas (`- [ ]`).

**Objetivo:** a v2 ganha quatro coisas:
- Categorias e preços abre só para ver, com lápis para editar e Excluir/Desativar;
- pedir com diárias e outros custos, sem "Ida e volta";
- a volta à origem não paga retorno;
- a forma de cobrança **Faturado (NF)**, com faturas quinzenais que o Master gera, anexando a NF emitida na prefeitura.

**Arquitetura:**
- **Banco:** só acrescenta. A forma de cobrança é um campo do contrato. As faturas são tabelas novas que **agrupam lançamentos** do livro-razão já existente. O pagamento entra como um tipo novo de lançamento. Reserva e débito continuam iguais.
- **Front:** em `src/novo` e `src/lib`. As telas da v1 reaproveitadas pela v2 (Contratos, Créditos, Extrato) mudam só com props opcionais ou campos que a v1 também pode mostrar.

**Tecnologia:** Postgres/Supabase (pgTAP no CI), Supabase Storage, React 19, Vite, Playwright, Vitest.

**Especificação:** [`v2-1-ajustes-faturamento-nf-desenho.md`](v2-1-ajustes-faturamento-nf-desenho.md), aprovada em 23/10/2026, incluindo a §9.

Branch `v2-1`, a partir de `fase-v2` (PR #42, v2.0). Se o #42 for mesclado antes, rebase em `origin/main`. **Um PR só**, e o merge é do dono. O repositório está público, então o CI é grátis. O banco só é verificado no CI: faça push e acompanhe com `gh run watch`. Junte os pushes para não repetir rodadas à toa.

## Restrições globais

- **Migrations:** só novas (`20261023…`); pgTAP novos a partir de `0046`. A guarda `0001_privilegios` fica verde.
- **RPCs:** `security definer set search_path = ''`, devolvem `{ok, codigo}`, negações por `interno.negar`, padrão `revoke all … grant execute … to authenticated`. Operações de dinheiro travam a conta (`interno.travar_conta`) e usam idempotência quando gravam lançamento.
- **Compatibilidade:** nada do que a v1 e a v2.0 em cache enviam passa a ser recusado. `validar_contrato` aceita o jsonb **sem** `forma_cobranca` (herda da vigente).
- **Dinheiro:** em centavos; nenhuma UI otimista; o livro-razão é imutável; a fatura nunca é apagada.
- **Enum:** `alter type app.tipo_lancamento add value 'PAGAMENTO_FATURA'` fica **sozinho** numa migration, antes da que o usa: o valor novo não pode ser usado na mesma transação.
- **Quinzena:** dias 1–15 e 16–último dia, em `America/Sao_Paulo`. Um lançamento é da quinzena pela data local de `criado_em`.
- **Limites:** diárias ao pedir 0–30; outros custos até 120 caracteres; PDF da NF até 5 MB, só `application/pdf`; motivo de cancelamento de 3 a 200 caracteres; número da NF de 1 a 30 caracteres.
- **Texto da interface** (exato):
  - "Diárias (hospedagem)", "Outros custos (opcional)", "+ outros custos no orçamento";
  - "Forma de cobrança", "Crédito (pré-pago)", "Faturado (NF)";
  - "A faturar", "Em aberto", "Vencidas", "Faturas", "Gerar fatura", "Marcar como paga", "Cancelar fatura", "Trocar PDF", "Baixar NF (PDF)", "CSV da fatura";
  - etiquetas "Aberta", "Vencida", "Paga", "Cancelada";
  - "Será cobrada na fatura da quinzena (NF)", "Entra na fatura da quinzena quando a corrida começar";
  - "Editar <nome>", "Cancelar", "Desativar", "Excluir", "Reativar", "Inativas (N)".
- Português do Brasil; CSP sem estilos inline; acessível; claro e escuro; 390 px sem rolagem lateral.

## Foco da revisão

1. **Empresa no Crédito:** criar, aprovar, sair e cancelar se comportam **exatamente** como antes, com os mesmos códigos de recusa (Tarefa 1).
2. **Estorno depois do fechamento:** cai na fatura seguinte e nunca altera uma fatura já gerada (Tarefa 2).
3. **Cancelar uma fatura e gerar de novo** a mesma quinzena: os mesmos itens voltam, sem duplicar, e a fatura cancelada continua no histórico (Tarefa 2).
4. **Pedido antigo de ida e volta** (`trazer = true`): continua com preço, chamada e "Pedir de novo" funcionando, e o "Pedir de novo" abre como trecho único (Tarefas 3, 6 e 7).
5. **Rascunho em Categorias e preços:** cancelar a edição devolve os valores publicados, e o Publicar só fica ativo com diferença real (Tarefa 5).

---

## Tarefas

| # | Tarefa | Verificação |
|---|---|---|
| 1 | Banco: forma de cobrança no contrato; pedir e aprovar sem saldo no Faturado | pgTAP `0046` |
| 2 | Banco: faturas, pagamento, NF no storage, leituras e reconciliação | pgTAP `0047` + integração |
| 3 | Banco: diárias, outros custos e volta à origem no pedido; excluir categoria | pgTAP `0048` |
| 4 | Bibliotecas do front (faturas, quinzena, volta à origem, contratos, categorias) | Vitest |
| 5 | Master: Categorias e preços em modo ver/editar, Excluir e Desativar | e2e simulado |
| 6 | Cliente: pedir com diárias e outros custos, sem Ida e volta | e2e simulado |
| 7 | Motorista: a calculadora começa com as diárias e mostra os outros custos do cliente | e2e simulado |
| 8 | Empresa no Faturado: Painel, aba Faturas, confirmar e acompanhar | e2e simulado |
| 9 | Master: forma de cobrança no contrato, tela Faturas, pendências | e2e simulado |
| 10 | e2e contra o banco real (fatura de ponta a ponta) | CI |
| 11 | Fechamento: roteiro, RUNBOOK, HANDOFF, versão 2.1.0, PR | revisão |

**Ordem e paralelismo:**
- **Banco:** 1 → 2 → 3, em série no worktree principal, porque mexem nas mesmas funções. T1 e T3 redefinem `criar_pedido`; T3 parte da versão da T1.
- **Front:** a T4 sai primeiro. Depois, T5, T6, T7, T8 e T9 rodam em worktrees isolados, em paralelo com o banco, contra mocks.
- **Final:** a T10 roda depois de tudo mesclado.

---

### Tarefa 1: forma de cobrança e pedir/aprovar sem saldo

**Arquivos:** criar `supabase/migrations/20261023120000_forma_cobranca.sql`; teste `supabase/tests/0046_forma_cobranca.test.sql`.

**Interfaces:**
- **Muda em `app.contratos_versoes`:** entra `forma_cobranca text not null default 'CREDITO' check (forma_cobranca in ('CREDITO','FATURADO'))`.
- **`interno.validar_contrato`:** aceita os 13 campos de hoje mais o opcional `forma_cobranca`, com valor inválido → detalhe `forma_cobranca`.
- **`interno.inserir_contrato`:**
  - grava a forma recebida ou, se faltar, a da versão vigente da mesma empresa;
  - sem vigente, usa a do modelo; sem modelo, `CREDITO`.
- **`publicar_tarifas`:** já copia os campos comuns. Basta confirmar que a forma vai junto.
- **`interno.forma_cobranca(p_empresa uuid) returns text`:** a forma do contrato vigente.
- **Versões novas de `api.criar_pedido`** (corpo de `20261022120100_paradas_pedido.sql:307`): o bloco `SEM_CREDITO` só roda quando a forma é `CREDITO`.
- **Versões novas de `api.aprovar_orcamento`** (corpo de `20261009141000_endurecimento_saldo.sql:388`): o `SALDO_INSUFICIENTE` só roda no `CREDITO`. A reserva e o lançamento `RESERVA` continuam sempre. `confirmar_corrida` não muda, porque chama esta.
- **`interno.saldos`:** devolve `forma_cobranca` também. Por isso `api.saldo_empresa` a devolve.
- **`api.painel_empresa`:** o resumo traz `forma_cobranca`.
- **`api.contratos…`:** as leituras de contrato que o front usa trazem `forma_cobranca`.

- [ ] **Passo 1: escrever o `0046`:**
  - publicar sem a chave herda a forma; com `FATURADO`, grava; `'BOLETO'` → `CAMPOS_INVALIDOS`;
  - `publicar_tarifas` mantém a forma;
  - empresa `FATURADO` com saldo 0 e limite 0 → `criar_pedido` ok e `aprovar_orcamento` ok;
  - depois disso há RESERVA e o saldo disponível fica negativo; `registrar_saida` gera o DEBITO;
  - a mesma empresa no `CREDITO` → `SEM_CREDITO` e `SALDO_INSUFICIENTE`, como antes;
  - `saldo_empresa` traz `forma_cobranca`.
- [ ] **Passo 2:** push; o CI falha no `0046`. **Passo 3:** migration. **Passo 4:** push; o CI fica verde.
- [ ] **Passo 5:** commit `feat(v2.1): forma de cobrança no contrato e pedido sem saldo no faturado`.

### Tarefa 2: faturas

**Arquivos:**
- criar `supabase/migrations/20261023120100_pagamento_fatura_tipo.sql` (só o enum);
- criar `supabase/migrations/20261023120200_faturas.sql`;
- testes `supabase/tests/0047_faturas.test.sql` e `tests/integracao/faturas.test.ts` (o upload do PDF e a leitura com o papel certo).

**Interfaces:**
- **Enum:** `app.tipo_lancamento` ganha `PAGAMENTO_FATURA`, um crédito (> 0) com efeito só no contábil.
  - `lancamento_validar` e as CHECKs de sinal passam a aceitar o tipo novo;
  - `estornar_lancamento` **não** estorna esse tipo, porque a fatura tem cancelamento próprio.
- **`app.faturas`:**
  - `id uuid pk`, `empresa_id`, `numero int` (sequencial por empresa, único com a empresa), `inicio date`, `fim date`;
  - `total_cent bigint > 0`;
  - `nf_numero text`, `nf_emitida_em date`, `nf_pdf_caminho text`, `vencimento date`;
  - `status text check in ('ABERTA','PAGA','CANCELADA')`;
  - `paga_em date`, `pagamento_lancamento_id bigint unique references app.lancamentos`;
  - `cancelada_motivo text`, `criada_por uuid`, `criada_em timestamptz`;
  - RLS ligado, sem acesso direto.
- **`app.faturas_itens`:**
  - `(fatura_id, lancamento_id)` pk;
  - `ativa boolean`, copiada da fatura e desligada no cancelamento;
  - índice único parcial `(lancamento_id) where ativa`.
- **Storage:**
  - bucket `notas-fiscais`, privado, 5 MB, `application/pdf`;
  - caminho `<empresa_id>/<uuid>.pdf`;
  - **insert e update:** só ADM;
  - **select:** ADM, ou CLIENTE N1 cuja empresa é o primeiro segmento do caminho;
  - modelo em `20261018120100_rastreio_fotos.sql:251`.
- **`interno.quinzena_valida(p_inicio date, p_fim date) returns boolean`:** (1, 15) ou (16, último dia), no mesmo mês.
- **`interno.itens_a_faturar(p_empresa uuid, p_ate timestamptz)`:**
  - devolve os lançamentos DEBITO, MULTA, AJUSTE e ESTORNO da empresa;
  - criados a partir do `vigente_desde` da **primeira** versão `FATURADO` dela e até `p_ate`;
  - sem item ativo em fatura.
  - O total da fatura é `-Σ valor_cent`.
- **RPCs:**
  - `api.previa_fatura(p_empresa, p_inicio, p_fim)` → `{ok, total_cent, itens:[{lancamento_id, criado_em, tipo, valor_cent, numero, solicitante_nome, origem, paradas, destino, categoria_nome, centro_custo}]}`. Só ADM.
  - `api.gerar_fatura(p_empresa, p_inicio, p_fim, p_nf jsonb)`, com `p_nf = {numero, emitida_em, pdf_caminho, vencimento?}`:
    - o vencimento padrão é `emitida_em + 30`;
    - recusa: `NAO_FATURADO`, `QUINZENA_INVALIDA`, `QUINZENA_EM_ANDAMENTO` (`fim` ≥ hoje local), `NADA_A_FATURAR` (sem itens ou total ≤ 0), `CAMPOS_INVALIDOS` (inclui um caminho que não começa com a empresa);
    - devolve `{ok, fatura, numero}`.
  - `api.marcar_fatura_paga(p_fatura, p_paga_em date)`:
    - lança `PAGAMENTO_FATURA = total`, com `idempotencia` e trava da conta;
    - recusa: `JA_PROCESSADO` (já paga), `FATURA_CANCELADA`.
  - `api.cancelar_fatura(p_fatura, p_motivo)`: só da `ABERTA`; desliga os itens. Recusa: `FATURA_PAGA`.
  - `api.trocar_pdf_fatura(p_fatura, p_caminho)`: só se não estiver paga.
  - `api.faturas(p_empresa)`, para ADM ou o N1 da empresa:
    - `{ok, forma_cobranca, a_faturar:{total_cent, itens}, em_aberto_cent, vencidas_cent, faturas:[{id, numero, inicio, fim, total_cent, nf_numero, nf_emitida_em, nf_pdf_caminho, vencimento, status, situacao, paga_em}]}`;
    - `situacao` vale `ABERTA`, `VENCIDA` (aberta com vencimento < hoje local), `PAGA` ou `CANCELADA`.
  - `api.fatura(p_fatura)`: o cabeçalho mais os itens, no formato da prévia.
  - `api.faturas_resumo()`, só ADM: `[{empresa_id, empresa_nome, a_faturar_cent, em_aberto_cent, vencidas_cent, quinzena_pronta:{inicio, fim} | null}]` para cada empresa cuja vigente é `FATURADO`. `quinzena_pronta` = a última quinzena fechada que ainda tem itens.
- **`api.painel_empresa` no `FATURADO`:** o resumo ganha `a_faturar_cent`, `em_aberto_cent` e `vencidas_cent`.
- **`interno.reconciliar`:** passa a marcar `FATURA_TOTAL_DIVERGENTE` e `LANCAMENTO_EM_DUAS_FATURAS`.

- [ ] **Passo 1: escrever o `0047`:**
  - itens certos: entram DEBITO, MULTA, AJUSTE e ESTORNO; não entram RECARGA, RESERVA nem PAGAMENTO; lançamentos de antes do Faturado ficam fora;
  - cada recusa: `QUINZENA_INVALIDA`, `QUINZENA_EM_ANDAMENTO`, `NADA_A_FATURAR`, `NAO_FATURADO`;
  - gerar duas vezes a mesma quinzena → `NADA_A_FATURAR`;
  - cancelar e gerar de novo → os mesmos itens, e a cancelada continua listada;
  - um estorno com data depois do `fim` vai para a fatura seguinte;
  - paga → `PAGAMENTO_FATURA` e o saldo sobe pelo total; na segunda vez, `JA_PROCESSADO`;
  - `estornar_lancamento` de `PAGAMENTO_FATURA` → recusado;
  - `situacao` fica `VENCIDA` com o vencimento passado;
  - quem lê: N1 lê `faturas`; N2, N3 e o motorista → `SEM_PERMISSAO`;
  - `faturas_resumo` é só ADM;
  - a reconciliação continua sem divergências.
- [ ] **Passo 2:** integração: o ADM sobe o PDF, o N1 da empresa baixa por link assinado, e o N1 de outra empresa não consegue.
- [ ] **Passo 3:** vermelho → migrations → verde no CI.
- [ ] **Passo 4:** commit `feat(v2.1): faturas quinzenais com NF e pagamento`.

### Tarefa 3: diárias, outros custos, volta à origem e excluir categoria

**Arquivos:** criar `supabase/migrations/20261023120300_pedido_diarias_categorias.sql`; teste `supabase/tests/0048_pedido_diarias.test.sql`.

**Interfaces:**
- **Pedido:**
  - colunas novas em `app.atividades`: `diarias_estimadas smallint check 0..30`, `outros_custos text check length ≤ 120`, `volta_a_origem boolean not null default false`;
  - `validar_pedido` aceita as três chaves, opcionais;
  - `criar_pedido` (a versão da T1) grava as três;
  - as leituras de detalhe e de chamada (`detalhe_pedido` e a da chamada do motorista) devolvem as três.
- **Preço:**
  - `interno.linhas_da_tarifa` ganha o parâmetro `p_volta_a_origem boolean default false`: com ele, não entra RETORNO;
  - `linhas_para_categoria` repassa o parâmetro;
  - `categorias_disponiveis` aceita `diarias` (0–30) e `volta_a_origem`. As diárias viram `hospedagem_diarias` na entrada;
  - `interno.linhas_do_pedido`: quando a entrada não tem `hospedagem_diarias`, usa as `diarias_estimadas` do pedido; e sempre usa o `volta_a_origem` do pedido;
  - o `diarias` da entrada antiga continua sendo descartado, como hoje.
- **Categoria:**
  - `api.excluir_categoria(p_codigo text)`, só `GERIR_CONTRATOS`;
  - apaga só se nenhuma atividade, nenhuma `contratos_categorias`, nenhuma `tarifas_categoria` e nenhum veículo usam o código; senão `CATEGORIA_EM_USO`;
  - `api.categorias_adm` traz `pode_excluir boolean` em cada categoria.

- [ ] **Passo 1: escrever o `0048`:**
  - pedido com `diarias_estimadas` 2 → a prévia e o orçamento sem `hospedagem_diarias` trazem HOSPEDAGEM 2 × diária;
  - 31 → `CAMPOS_INVALIDOS`;
  - `outros_custos` com 121 caracteres → recusado;
  - `volta_a_origem` com `retorno_bp` > 0 → sem RETORNO; sem a flag → com RETORNO;
  - pedido antigo com `trazer` continua com o preço de antes;
  - `excluir_categoria` de uma categoria nova → ok; de `PASSAGEIROS` → `CATEGORIA_EM_USO`; N1 recusado;
  - `pode_excluir` coerente;
  - a v1 sem as chaves novas continua igual.
- [ ] **Passo 2:** vermelho → migration → verde no CI.
- [ ] **Passo 3:** commit `feat(v2.1): diárias, outros custos e volta à origem no pedido; excluir categoria sem uso`.

### Tarefa 4: bibliotecas do front

**Arquivos:**
- criar `src/lib/faturas.ts` e `src/lib/faturas.test.ts`;
- modificar `src/lib/categorias.ts`, `src/lib/categoriasAdm.ts`, `src/lib/contratos.ts`, `src/lib/saldo.ts`, `src/lib/painelEmpresa.ts`, `src/lib/erros.ts`, `src/novo/telas/cliente/rotaComParadas.ts`, com os testes ao lado.

**Interfaces:**
- **`faturas.ts`:**
  - tipos `Fatura`, `ItemFatura`, `ResumoFaturas`, `SituacaoFatura = 'ABERTA'|'VENCIDA'|'PAGA'|'CANCELADA'`;
  - wrappers das RPCs da T2;
  - `quinzenaDe(d: Date): {inicio: string; fim: string}` e `ultimaQuinzenaFechada(agora: Date)`, em `America/Sao_Paulo`;
  - `vencimentoPadrao(emitidaEm: string): string` (+30 dias);
  - `enviarPdfNota(empresa: string, arquivo: File): Promise<{ok: true; caminho} | {ok: false; codigo}>`, que recusa um arquivo que não é PDF ou passa de 5 MB antes de enviar;
  - `linkNota(caminho): Promise<string>`, link assinado de 60 s;
  - `csvDaFatura(f, itens)` com as colunas do CSV do mês.
- **`categorias.ts`:**
  - `pedidoDaCategoria` e `disponiveis` aceitam `diarias` e `voltaAOrigem` e passam a mandar sempre `trazer: false`;
  - `outrosCustos` vai no pedido aparado e só se não estiver vazio.
- **`voltaAOrigem(de, para): boolean`** (em `rotaComParadas.ts`): mesmo `place_id`, ou pontos a menos de 300 m (haversine).
- **`categoriasAdm.ts`:** `excluir(codigo)` e o campo `pode_excluir`.
- **`contratos.ts`:** o campo `forma_cobranca` e os rótulos "Crédito (pré-pago)" e "Faturado (NF)".
- **`saldo.ts` e `painelEmpresa.ts`:** os tipos ganham `forma_cobranca` e os totais da fatura.
- **`erros.ts`:** mensagens para `NAO_FATURADO`, `QUINZENA_INVALIDA`, `QUINZENA_EM_ANDAMENTO`, `NADA_A_FATURAR`, `FATURA_PAGA`, `FATURA_CANCELADA` e `CATEGORIA_EM_USO`.

- [ ] **Passo 1: testes:**
  - `quinzenaDe` em 15/10 23:30 BRT (= 16/10 02:30 UTC) → 01–15;
  - em 16/02/2027 → 16–28; em 2028 → 16–29;
  - `ultimaQuinzenaFechada` em 01/11 → 16/10–31/10;
  - `vencimentoPadrao('2026-10-16')` → `'2026-11-15'`;
  - `voltaAOrigem`: mesmo `place_id` → sim; 250 m → sim; 400 m → não;
  - o pedido manda `trazer: false`, `diarias_estimadas` e `volta_a_origem`;
  - `enviarPdfNota` recusa um `.png` e um PDF de 6 MB sem chamar o storage.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): bibliotecas de faturas, quinzena e volta à origem`.

### Tarefa 5: Master — Categorias e preços em modo ver/editar

**Arquivos:** modificar `src/novo/telas/adm/CategoriasPrecos.tsx`; teste `tests/e2e/novo-categorias-ver-editar.spec.ts` (ajuste `novo-categorias-tarifas.spec.ts` ao modo novo).

- [ ] **Passo 1: e2e:**
  - não há "Com reboque" nem "Leva:" no cabeçalho; "Veículo do cliente" continua;
  - abre só para ver, sem nenhum `input` editável, com uma lista só com os valores > 0;
  - "Editar IVO Carga Leve" abre os campos daquele cartão, e "Cancelar" volta aos valores publicados;
  - "Publicar tabela" fica desabilitado sem diferença e se habilita ao mudar um valor; a revisão continua igual;
  - "Excluir" só na categoria com `pode_excluir`, com confirmação, chamando `excluir_categoria`; "Desativar" nas outras;
  - as inativas ficam em "Inativas (N)", recolhida, com "Reativar";
  - sair com rascunho pede confirmação;
  - axe sem violações e 390 px sem rolagem lateral.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): categorias e preços abre para ver, com lápis para editar`.

### Tarefa 6: Cliente — pedir com diárias e outros custos

**Arquivos:** modificar `src/novo/telas/cliente/EscolherCategoria.tsx`, `InicioCliente.tsx`, `src/novo/pedirDeNovo.ts`, `ConfirmarCorrida.tsx` e `Corrida.tsx` (só o que depende de `trazer`); teste `tests/e2e/novo-pedir-diarias.spec.ts` (ajuste `novo-pedir-paradas.spec.ts` e `novo-cliente.spec.ts`).

- [ ] **Passo 1: e2e:**
  - não existe "Ida e volta";
  - "Diárias (hospedagem)" só aparece na categoria com `hospedagem_diaria_cent` > 0 (vem de `categorias_disponiveis`; se faltar o campo, acrescente-o na T3), vai de 0 a 30 e muda o preço da prévia (`diarias` na chamada);
  - "Outros custos (opcional)" vai em `criar_pedido` como `outros_custos` e mostra "+ outros custos no orçamento";
  - De = Para (mesmo `place_id`) manda `volta_a_origem: true`;
  - "Pedir de novo" traz as diárias, e um pedido antigo com `trazer` abre sem erro;
  - 390 px sem rolagem lateral.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): pedir com diárias e outros custos, sem ida e volta`.

### Tarefa 7: Motorista — diárias e outros custos do cliente

**Arquivos:** modificar `src/novo/telas/motorista/ProporValor.tsx`, `chamada.ts`, `Chamada.tsx`; teste: ampliar `tests/e2e/novo-motorista-tarifa.spec.ts`.

- [ ] **Passo 1: e2e:**
  - a calculadora abre com a Hospedagem = `diarias_estimadas` do pedido;
  - acima dos "Outros" aparece "O cliente avisou: <outros_custos>";
  - a chamada mostra "Diárias: N" e os outros custos quando houver;
  - um pedido antigo com `trazer` continua mostrando "ida e volta".
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): calculadora com as diárias e os outros custos do cliente`.

### Tarefa 8: Empresa no Faturado

**Arquivos:**
- modificar `src/novo/telas/empresa/AbaPainel.tsx`, `PainelEmpresa.tsx` e `componentes.tsx`;
- criar `src/novo/telas/empresa/AbaFaturas.tsx` (rota `empresa/faturas`, que no Faturado substitui `carteira`; no Crédito, `faturas` redireciona para `carteira` e vice-versa);
- modificar `src/novo/telas/cliente/ConfirmarCorrida.tsx`, `Corrida.tsx` e `InicioCliente.tsx`, e o título do Extrato (prop opcional em `src/telas/extrato/Extrato.tsx`);
- teste `tests/e2e/novo-faturado.spec.ts`.

- [ ] **Passo 1: e2e:**
  - no Faturado, o painel mostra "A faturar", "Em aberto" e "Vencidas", e não mostra "Disponível agora", "Reservado" nem o contato de recarga;
  - a aba "Faturas" substitui "Carteira" e mostra o cartão "A faturar" com as corridas e a lista de faturas com as etiquetas;
  - "Baixar NF (PDF)" abre o link assinado, e "CSV da fatura" baixa `fatura-<numero>.csv`;
  - a confirmação mostra "Será cobrada na fatura da quinzena (NF)", sem saldo;
  - a corrida mostra "Entra na fatura da quinzena quando a corrida começar";
  - o início nunca mostra "sem crédito";
  - no Crédito, tudo como hoje;
  - axe sem violações.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): painel e faturas da empresa no faturado`.

### Tarefa 9: Master — forma de cobrança e Faturas

**Arquivos:**
- modificar `src/telas/contratos/PublicarContrato.tsx` e `CartoesContrato.tsx` (campo e rótulo; a v1 também mostra, o que é aceitável);
- criar `src/novo/telas/adm/Faturas.tsx` e `FaturasEmpresa.tsx` (rotas `adm/faturas` e `adm/faturas/:empresa`), mais o item no menu do Master em `src/novo/componentes/Menu.tsx`;
- pendências no início/painel do Master (`src/telas/adm/Painel.tsx` via prop opcional, ou um cartão na v2);
- etiqueta "Faturado (NF)" e Recarga escondida em `src/telas/adm/Creditos.tsx` (prop opcional);
- teste `tests/e2e/novo-faturas-adm.spec.ts`.

- [ ] **Passo 1: e2e:**
  - o formulário de contrato mostra "Forma de cobrança"; no Faturado, limite e alerta somem;
  - publicar manda `forma_cobranca`;
  - trocar para Faturado com saldo ≠ 0 mostra um aviso, sem bloquear;
  - ☰ › Faturas lista as empresas do `faturas_resumo`;
  - na empresa, "Gerar fatura" abre a folha com a última quinzena fechada, a prévia, o número, a emissão, o PDF e o vencimento (preenchido com +30);
  - confirmar sobe o PDF e depois chama `gerar_fatura`;
  - "Marcar como paga", "Cancelar fatura" (com motivo) e "Trocar PDF";
  - a pendência "Quinzena fechada: <empresa> pronta para faturar" aparece no início;
  - Créditos mostra a etiqueta "Faturado (NF)", sem Recarga;
  - N1 não acessa `adm/faturas`.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(v2.1): forma de cobrança no contrato e faturas do master`.

### Tarefa 10: e2e contra o banco real

**Arquivos:** criar `tests/e2e/real/v2-1-faturas.spec.ts` (projeto `real`, 1 worker; padrão de `real/fase-4-1.spec.ts`).

- [ ] **Passo 1:** o fluxo inteiro:
  - o Master publica um contrato `FATURADO` para uma empresa sem saldo, com `vigente_desde` no passado;
  - o N2 pede com 1 diária e outros custos;
  - o motorista aceita, o N2 confirma, e há saída;
  - para fechar a quinzena, use datas de lançamento numa quinzena passada: via SQL de semente no `apoio.ts`, se precisar;
  - o Master gera a fatura com o PDF;
  - o N1 vê a fatura, baixa a NF e o CSV;
  - o Master marca a fatura como paga, e o extrato mostra `PAGAMENTO_FATURA`.
- [ ] **Passo 2:** push; o CI fica verde. Commit `test(v2.1): e2e real do faturamento por NF`.

### Tarefa 11: fechamento

- [ ] `docs/fases/v2-1-o-que-testar.md`: roteiro no celular cobrindo o §1 da especificação e o §8, os passos do dono.
- [ ] RUNBOOK §21 "Faturamento por NF (v2.1)":
  - trocar a forma no contrato;
  - gerar a fatura a cada dia 1 e 16;
  - marcar como paga e cancelar;
  - o que o cliente vê;
  - problemas comuns.
- [ ] `package.json` e `package-lock.json` em **2.1.0**. HANDOFF §5E.
- [ ] Abrir **um PR** para a `main` com o checklist do dono. O merge é do dono.

## Autorrevisão (feita)

- **Cobertura da especificação:**

  | Seção da especificação | Tarefas |
  |---|---|
  | §1.1, §5.1 | 5 |
  | §1.2, §2 (excluir) | 3, 4 e 5 |
  | §1.3, §4.5, §5.2 | 3, 4, 6 e 7 |
  | §1.4, §4.1, §4.2 | 1 e 9 |
  | §4.3, §4.4 | 2 e 4 |
  | §5.3 | 8 |
  | §5.4 | 9 |
  | §6 | 1, 2 e 3 (compatibilidade e regras) |
  | §7 | 1–10 |
  | §8 | 11 |

- **Nomes conferidos entre as tarefas:**
  - `forma_cobranca`, `interno.forma_cobranca`;
  - `gerar_fatura`, `previa_fatura`, `marcar_fatura_paga`, `cancelar_fatura`, `trocar_pdf_fatura`, `faturas`, `fatura`, `faturas_resumo`;
  - `diarias_estimadas`, `outros_custos`, `volta_a_origem`;
  - `excluir_categoria`, `pode_excluir`;
  - `quinzenaDe`, `ultimaQuinzenaFechada`, `vencimentoPadrao`, `voltaAOrigem`, `enviarPdfNota`, `linkNota`, `csvDaFatura`.
