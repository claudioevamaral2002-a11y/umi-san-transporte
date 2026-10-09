# Fase 2A — Solicitação, agenda/calendário e orçamento (desenho + plano)

Fontes: `docs/especificacao.md` §4 (fluxo), §4.1, §4.2, §5 (agenda), §6 (centavos/arredondamento), §12.3; Adendos A1, A2, A10 (contrato por empresa, preço travado, papéis/níveis). Mockups aprovados em 2026-10-09 (novo pedido em 4 passos, orçamento-calculadora do motorista, orçamento recebido). Decisão do usuário: **trajeto = duas escolhas independentes "Levar" e "Trazer"** (ao menos uma; as duas = ida e volta).

Branch `fase-2a` (sobre `fase-1b`, ainda não publicada). **Publicação conjunta 1B + 2A + 2B** quando o fluxo pedido→aprovação estiver completo. Execução: subagentes + CI (sem Docker local).

## Escopo
Entra: pedido do cliente, pré-reserva de horário com conflito impedido no banco, prazos com contagem regressiva e expiração (sem depender do cron), orçamento do motorista calculado no servidor a partir do contrato (quantidades × preço travado, "Outros" com descrição), orçamento recebido pelo cliente (memorial + regras), pedir revisão, reprovar, recusar (motorista), cancelar sem custo (SOLICITADA/ORCADA), calendário do mês/dia por perfil, pendências no início, status em tempo real.
Fica para 2B: **aprovação** (limite de crédito + reserva de saldo + AGENDADA), saldo/extrato, painel do ADM. Fase 3: execução, cancelamento com multa, anexos/fotos, "Repetir pedido", notificações.

## Banco (schema `app`, regras da fase 1 valem: RPCs `api.*` definer + `{ok,codigo}` + auditoria; guarda 0001)

### Tabelas
- `app.atividades`: `id uuid`, `numero bigint` (sequencial legível, ex. #0042), `empresa_id`, `solicitante_id`, `motorista_id` (v1: atribuído automaticamente ao único motorista ativo; estrutura aceita vários — se houver 0 ativos, `SEM_MOTORISTA`; se houver >1, o primeiro por criação e o ADM/gestor redistribui na fase 3), `status app.status_atividade` (`SOLICITADA, ORCADA, AGENDADA, EM_ANDAMENTO, CONCLUIDA, RECUSADA, REPROVADA, EXPIRADA, CANCELADA`), `inicio timestamptz`, `duracao_min int` (30–1440), `origem`, `destino` (texto 3–200), `levar bool`, `trazer bool` (CHECK levar or trazer), `carga app.tipo_carga` (`PESSOAS, EQUIPAMENTO, AMBOS`), `pessoas_qtd int`, `equipamento_desc`, `peso_kg numeric`, `dimensoes text` (CHECKs coerentes com `carga`), `modalidade app.modalidade` (`VEICULO_PROPRIO, VEICULO_CLIENTE`), `reboque app.reboque` (`SIM, NAO, NAO_SEI`), `contato_nome`, `contato_telefone`, `observacoes` (≤1000), `prazo_orcar_ate timestamptz` (= menor entre criação + `prazo_orcar_horas` do contrato e `inicio`), `criada_em`, `atualizada_em`.
- `app.transicoes_permitidas(de, para)` com exatamente as setas da §4 (+ `ORCADA→SOLICITADA` revisão). `app.atividade_historico(atividade_id, de, para, por, em, observacao)` — toda mudança passa por `interno.transicionar(atividade, para, observacao)` que valida na tabela, trava a linha (`FOR UPDATE`) e grava histórico.
- `app.agenda_blocos(id, atividade_id unique, motorista_id, periodo tstzrange, tipo ('PRE_RESERVA','RESERVA'), ativo bool, expira_em)` + `EXCLUDE USING gist (motorista_id WITH =, periodo WITH &&) WHERE (ativo)` (extensão `btree_gist`). Período = [inicio, inicio + duração).
- `app.orcamentos(id, atividade_id, versao int, modalidade, linhas jsonb, total_cent bigint, contrato_versao, snapshot jsonb (cópia de TODO o contrato vigente da empresa, inclusive faixas), valido_ate (= menor entre envio + validade do contrato e `inicio`), horario_sugerido timestamptz null, status ('PENDENTE','APROVADO','REPROVADO','EXPIRADO','SUBSTITUIDO'), hash text (sha256 do conteúdo canônico: linhas, total, snapshot, horário, endereços), enviado_por, enviado_em)`; unique (atividade_id, versao); no máximo 1 PENDENTE por atividade (índice parcial). Imutável exceto `status` (trigger).
- Índice parcial: no máximo 1 atividade `EM_ANDAMENTO` por motorista (já para a fase 3).

### Cálculo (só no servidor) — `interno.calcular_orcamento(atividade, entrada jsonb) → {linhas, total_cent}`
- Preços unitários **sempre** do contrato vigente da empresa (nunca da entrada). Entrada = quantidades:
  - Veículo próprio: `km` (decimal com 1 casa; se só "Levar" ou só "Trazer", aplica `retorno_trecho_unico_bp` sobre a linha de km como linha própria "Retorno (x%)"; se Levar+Trazer, km já é ida e volta), `usa_reboque` (bool → km com reboque + taxa fixa), `espera_horas` (0,5 em 0,5), `pedagio_cent`, `hospedagem_diarias`.
  - Veículo do cliente: `diarias`, `pedagio_cent`, `hospedagem_diarias`.
  - `outros`: lista de {descricao (3–120), valor_cent > 0} (até 5).
  - Campos de outra modalidade → `CAMPOS_INCOMPATIVEIS`.
- Cada linha arredondada em centavos (meio para cima) no cálculo; total = soma das linhas; percentuais sobre centavos com o mesmo arredondamento (§6).
- Sem contrato vigente → `SEM_CONTRATO`.

### RPCs (`api.*`)
| Função | Quem | Regras |
|---|---|---|
| `criar_pedido(p jsonb)` | CLIENTE N1/N2 | limite 20/h; contrato vigente; valida campos; expira, na mesma transação, pré-reservas vencidas que colidem; cria atividade SOLICITADA + bloco PRE_RESERVA (expira em `prazo_orcar_ate`); conflito → `HORARIO_OCUPADO` (capturar a exclusion violation e devolver `{ok:false}` auditado, conforme A2) |
| `calcular_orcamento(p_atividade, p jsonb)` | MOTORISTA atribuído / ADM | prévia sem gravar (para a calculadora ao vivo) |
| `enviar_orcamento(p_atividade, p jsonb, p_horario_sugerido)` | MOTORISTA atribuído / ADM | status SOLICITADA e dentro do prazo (checado com `now()`, sem depender do cron); grava orçamento PENDENTE (substitui anterior), snapshot, hash; ORCADA; bloco estendido até `valido_ate` |
| `recusar_pedido(p_atividade, p_motivo)` | MOTORISTA atribuído / ADM | SOLICITADA→RECUSADA; motivo obrigatório; bloco inativo |
| `pedir_revisao(p_atividade, p_motivo)` | dono (N2) ou N1 da empresa | ORCADA→SOLICITADA; orçamento SUBSTITUIDO; novo prazo de orçar; limite 10/h |
| `reprovar_orcamento(p_atividade, p_motivo)` | dono ou N1 | ORCADA→REPROVADA; bloco inativo |
| `cancelar_pedido(p_atividade, p_motivo)` | dono/N1 (SOLICITADA/ORCADA); motorista atribuído/ADM com motivo | sem custo nesta fase (AGENDADA é 2B/3) |
| `interno.expirar_vencidos()` | pg_cron a cada 15 min (`cron.sql` versionado) | SOLICITADA com prazo vencido e ORCADA com orçamento vencido → EXPIRADA; blocos inativos |

Leituras (definer com checagem; nada de `select *`):
- `api.meus_pedidos(p_filtro)` — cliente: N2 os próprios; N1/N3 os da empresa; motorista: os atribuídos; ADM/gestor: todos.
- `api.pedido(p_id)` — detalhe + histórico + orçamento vigente (cliente vê memorial e regras do snapshot; nunca dados de outra empresa).
- `api.agenda(p_de, p_ate)` — blocos ativos no intervalo: cliente vê os da própria empresa com detalhes e os demais **só como "ocupado"** (sem empresa, endereço, número); motorista/ADM/gestor veem tudo.
- `api.horarios_livres(p_dia date, p_duracao_min)` — inícios possíveis em passos de 30 min entre 05:00 e 22:00 (America/Sao_Paulo) para o motorista da empresa, sem colidir com blocos ativos (considerando pré-reservas já vencidas como livres).
- `api.pendencias()` — motorista: "aguardando seu orçamento" (com prazo); cliente: "aguardando sua aprovação" (com validade), revisões, itens a <10% do prazo; ADM: tudo isso agregado.

### Tempo real
Substitui a prova da fase 0: triggers em `atividades` publicam `{id, status, em}` em `atividade:<id>` e `empresa:<empresa_id>` (privados). Política em `realtime.messages`: `atividade:<id>` para quem pode ver o pedido; `empresa:<id>` para usuários da empresa e equipe. O front relê `api.pedido`/`api.meus_pedidos` ao receber. Remover `app.prova_canal` e sua política.

## Front (IVO, mobile-first, mockups aprovados)
- **Cliente** (N1/N2): "+ Novo pedido" (4 passos: Quando — calendário do mês com dias cheios esmaecidos e chips de horários livres + duração; Onde — origem/destino, **Levar/Trazer como duas caixas**, contato; O quê — pessoas/equipamento/ambos, quantidades, modalidade, reboque, observações; Revisar — resumo + "o motorista orça em até X h" → Enviar). Sem contrato: botão indisponível com explicação. N3 não cria.
- **Pedidos** (lista com status ícone+texto, filtros) e **detalhe** (linha do tempo estilo rastreio, contagem regressiva do prazo, orçamento recebido com memorial, regras de cancelamento do snapshot, botões Pedir revisão/Reprovar/Cancelar; "Aprovar" aparece desabilitado com "disponível em breve" até a 2B).
- **Agenda** (`/agenda`): mês com marcadores (seu pedido, aguardando você, ocupado, dia cheio) + dia selecionado com blocos e janelas livres; tocar janela livre inicia pedido com data/hora (cliente).
- **Motorista**: Início com "Aguardando seu orçamento" (contagem regressiva, urgente destacado) e próximos serviços; **Orçar** (calculadora: +/− nas quantidades, preço com cadeado, total ao vivo via `calcular_orcamento` com debounce, "Outros" com descrição, sugestão de horário opcional, Enviar / Recusar com motivo); Agenda.
- **ADM / gestor**: Agenda com tudo; ADM vê todos os pedidos.
- Tempo real: status atualiza sem recarregar; nenhuma ação financeira aqui.

## Testes obrigatórios
- pgTAP: transições (todas as permitidas e proibidas), histórico, exclusion (blocos ativos colidem, inativos não), expiração inline e por `expirar_vencidos`, cálculo (cada modalidade, retorno em trecho único, reboque, espera, outros, arredondamento meio-para-cima, campos incompatíveis, preço nunca vem da entrada), snapshot/hash, permissões por papel/nível, leituras sem vazamento entre empresas.
- Integração (concorrência real): **dois pedidos no mesmo horário → só 1 entra**; criar pedido × pré-reserva vencida colidente → o novo entra e o antigo expira; cancelar × enviar orçamento simultâneos → um vence, estado coerente; 10 envios de orçamento simultâneos → 1 orçamento PENDENTE; cliente B não vê detalhes de pedido de A (só "ocupado"); canal realtime de pedido recusa quem não pode ver.
- E2E: simulado (fluxo completo de telas) + real (cliente cria → motorista orça → cliente vê orçamento, pede revisão → motorista reenvia → cliente reprova; conflito de horário mostrado como ocupado).

## Plano
1. **Banco: atividades, transições, agenda (exclusion), pedidos** — `criar_pedido`, `recusar`, `cancelar` (sem custo), expiração inline + `expirar_vencidos` + cron versionado; pgTAP.
2. **Banco: orçamento** — cálculo, `calcular/enviar_orcamento`, `pedir_revisao`, `reprovar`; snapshot/hash; pgTAP + integração de concorrência.
3. **Banco: leituras e tempo real** — `meus_pedidos`, `pedido`, `agenda`, `horarios_livres`, `pendencias`; realtime por pedido/empresa (remove prova); pgTAP + integração.
4. **Front cliente** — novo pedido (4 passos), pedidos, detalhe, agenda, início com pendências.
5. **Front motorista/ADM/gestor** — pendências, orçar (calculadora), agenda, lista de pedidos.
6. **E2E real, revisão de segurança e de concorrência, docs** (RUNBOOK, `fase-2a-o-que-testar.md`), PR (sem merge; publicação conjunta com 1B e 2B).

## Desvios do plano (registrados na Task 6)
- **`api.dias_do_mes(p_mes, p_duracao_min)`** (migration `20261009131100`): o calendário do mês numa consulta só (livre, dia cheio, meus, aguardando você, ocupado), em vez de uma chamada de `horarios_livres` por dia.
- **Orçamento `CANCELADO`**: além dos status do plano, o orçamento PENDENTE vira `CANCELADO` quando o pedido é cancelado.
- **Limite da prévia**: `calcular_orcamento` limitado a 600/h por usuário (a calculadora chama com debounce de 300 ms).
- **Orçamento anterior na revisão** (`20261009132000`): `api.pedido` devolve `orcamento_anterior` {versao, modalidade, entrada, linhas, total_cent, motivo_revisao} só para motorista atribuído/ADM e só em SOLICITADA depois de uma revisão; o **Orçar** pré-preenche a calculadora com a entrada anterior e mostra "Revisão pedida: <motivo>".
- **Tópico `equipe`** (`20261009132000`): toda mudança de status publica também `{id, status, em, empresa_id}` em `equipe`, autorizado por `app.pode_ver_equipe()` (ADM, gestor de frota e motorista, com aal2) dentro de `app.pode_ver_topico`. Início, Pedidos e Agenda da equipe assinam `equipe`; as do cliente, `empresa:<id>`. Cliente recebe `CHANNEL_ERROR`.
- **Sem PR nesta fase**: a publicação é conjunta 1B + 2A + 2B; a branch `fase-2a` fica pronta (CI verde) e o PR para `main` sai junto com a 2B. O roteiro de produção ([fase-2a-o-que-testar.md](fase-2a-o-que-testar.md)) é executado depois desse merge conjunto.

## Revisão de segurança e concorrência (Task 6)
Escopo: todo o `git diff fase-1b...fase-2a`. Atacante = qualquer JWT autenticado, de qualquer papel/nível (inclusive ADM/gestor/motorista em aal1, perfil inativo, sem perfil). Correções na migration `20261009132000_revisao_2a.sql`, testes em `supabase/tests/0015_revisao_2a.test.sql` (+ ajustes em 0013/0014 e na integração `leituras`/`realtime-privado`).

**Correções:**
- **R1 — N2 via endereço e número do pedido do colega na agenda.** `api.agenda` detalhava (número, status, origem, destino) todos os blocos da própria empresa; o N2, que só vê os próprios pedidos em todas as outras leituras, lia endereços dos colegas (contra §5: "o cliente vê só 'ocupado' nos pedidos de outros"). Agora o cliente só recebe detalhes de blocos de pedidos que `interno.pode_ver_atividade` permite (N1/N3: a empresa; N2: os próprios); os demais vêm como `{inicio, fim, ocupado}`.
- **R2 — estouro numérico no cálculo virava erro 500.** Preços do contrato aceitam até 16 dígitos; km (até 100 000) × preço ou diárias × preço podiam estourar `bigint` e abortar `calcular_orcamento`/`enviar_orcamento` com exceção. `interno.calcular_linhas` passou a envolver o cálculo (`interno.calcular_linhas_sem_teto`): estouro ou total acima de R$ 1 bilhão → `{ok:false, codigo:'VALOR_FORA_DO_LIMITE'}` (mensagem no front), nada gravado.
- **R3 — auditoria de negações sem teto.** Toda negação grava uma linha de auditoria; com as leituras novas (`pedido`, `agenda`…), qualquer usuário autenticado podia gerar linhas sem limite (ex.: `api.pedido` com ids aleatórios) e encher o banco. `interno.negar` agora audita até **300 negações por usuário por hora**; a 301ª grava uma linha `AUDITORIA_LIMITADA` e as seguintes continuam negadas sem gravar. Sem usuário (sistema/cron) audita sempre.

**Verificado sem achado:**
- **Vazamento entre empresas:** `meus_pedidos`, `pedido`, `pendencias`, `dias_do_mes` e `agenda` filtram por `interno.pode_ver_atividade` (mesma regra em todas); outra empresa só aparece como "ocupado" (sem id, número, endereço ou empresa) e só para o motorista que atende pedidos novos; `pedido` de outra empresa responde `NAO_ENCONTRADO` igual a id inexistente. Tempo real: `atividade:<id>` só para quem vê o pedido, `empresa:<id>` só para a empresa e a equipe, `equipe` só para a equipe; não existe política de INSERT em `realtime.messages` (cliente não publica); payloads só com id/status/horário (+ empresa na equipe).
- **Preço e limite:** cliente recebe memorial, total, hash e só as regras do snapshot (faixas, prazos, limiar); nunca limite de saldo, alerta, versão ou autor. Motorista recebe a entrada e só os preços do snapshot. Gestor de frota não recebe nenhum valor (`total_cent` nulo em listas e pendências; orçamento só com metadados). O snapshot completo só sai para o ADM. `orcamento_anterior` só para motorista atribuído/ADM.
- **Motorista fora do pedido:** `calcular`/`enviar_orcamento`, `recusar` e `cancelar` checam `motorista_id = auth.uid()` (ou ADM) com a linha travada; motorista não atribuído recebe `SEM_PERMISSAO`/`NAO_ENCONTRADO`. Gestor de frota não age. ADM/gestor/motorista em aal1 não passam de `app.pode_acessar`.
- **Entrada de `criar_pedido`:** só chaves conhecidas (desconhecidas → `CAMPOS_INVALIDOS`, eco limitado a 20 nomes × 60 caracteres); tipos JSON exatos; números por regex antes do cast (sem notação científica nem estouro); textos com limites de tamanho (também em CHECK na tabela); início ISO com fuso, no futuro, até 366 dias; carga e campos coerentes. **Entrada do orçamento:** idem, preços nunca aceitos, `outros` ≤ 5 com só `descricao`/`valor_cent`, valores ≤ 9 dígitos; `horario_sugerido` no futuro até 366 dias.
- **Limites:** `criar_pedido` 20/h, `pedir_revisao` 10/h, `calcular_orcamento` 600/h por usuário. `enviar_orcamento`, `recusar`, `cancelar` e `reprovar` não têm limite próprio: cada sucesso exige uma transição de status válida (no máximo uma por ciclo do pedido) e as negações ficam sob o teto da R3.
- **Concorrência:** conflito de agenda impedido pela exclusion constraint (`btree_gist`, só blocos ativos) — dois pedidos no mesmo horário: um entra, o outro recebe `HORARIO_OCUPADO` (violação capturada num subbloco, auditada). Toda ação trava a linha do pedido (`FOR UPDATE`) e checa o prazo com `now()`; `expirar_atividade` re-checa depois de travar (READ COMMITTED vê o estado já confirmado), então enviar × cancelar × revisão × expirar terminam num estado coerente. `criar_pedido` expira as pré-reservas vencidas colidentes travando em ordem de id antes do INSERT (sem ciclo de espera: só espera a exclusion depois de terminar suas travas). O cron usa `SKIP LOCKED` (não disputa com ações em andamento), lote de 5000, só pré-reservas vencidas; roda como `postgres` com funções `SECURITY DEFINER` e `search_path` vazio, sem EXECUTE para `authenticated`.
- **Snapshot/hash:** snapshot = cópia completa da versão do contrato usada no cálculo, com instantes canônicos (UTC); hash = sha256 do jsonb canônico (linhas, total, snapshot, validade, horário sugerido, início, duração, endereços, trajeto), calculado antes do INSERT sobre os mesmos valores gravados e recalculável (pgTAP); orçamento imutável exceto o status (só sai de PENDENTE).
- **Front:** nenhum `dangerouslySetInnerHTML`/`innerHTML`; textos do usuário (observações, motivos, "Outros", endereços) sempre como texto React (e2e com `<b>…</b>` literal); `tel:` só com dígitos e `+`; o evento de tempo real nunca é usado como dado (a tela relê o servidor).

**Riscos aceitos:**
- **Pré-reserva abusiva:** um cliente pode ocupar horários do motorista com pedidos sem intenção (até 20/h por pessoa, cada um vencendo no prazo para orçar). O motorista recusa (libera na hora) e o ADM pode desativar a conta.
- **Equipe vê o "movimento" de todos os pedidos:** pelos tópicos `equipe`/`empresa:<id>`, motorista e gestor recebem id, status e empresa de qualquer pedido (inclusive não atribuídos); os detalhes continuam negados nas leituras. Na v1 há um único motorista, que atende todas as empresas.
- **N2 recebe id e status dos pedidos dos colegas** no tópico `empresa:<id>` (usado para atualizar listas); abrir o pedido continua negado.
- **Início fora da grade:** pela API o cliente pode pedir qualquer minuto (a tela oferece só a grade de 30 min, 05:00–22:00); o motorista recusa se não servir.
- **`horario_sugerido`** é só uma sugestão no orçamento (não reserva nem checa a agenda).
- **Motorista padrão:** todo pedido novo vai ao motorista ativo mais antigo; desativá-lo não redistribui os abertos (o ADM cancela; redistribuição na fase 3).
- **Negações acima de 300/h por usuário** não ficam registradas uma a uma (uma linha `AUDITORIA_LIMITADA` por hora marca o abuso).
- **Preço unitário no memorial:** o cliente vê o preço unitário do próprio contrato nas linhas do orçamento recebido (§4.2), embora **Regras do serviço** não mostre a tabela.
