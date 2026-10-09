# Fase 2B — Saldo, aprovação e painel do ADM (desenho + plano)

Fontes: `docs/especificacao.md` §4.3 (aprovação), §4.6 (cancelamento de AGENDADA), §6 (saldo — núcleo crítico), §9 (testes de concorrência/cobrança/saldo), §12.2 (sem UI otimista em dinheiro; contagem animada do saldo); Adendos A2, A10 (crédito por contrato da empresa; **só o ADM altera saldo, por cliente**). Branch `fase-2b` sobre `fase-2a`. Publicação conjunta 1B + 2A + 2B ao final desta fase.

## Escopo
Entra: livro-razão imutável por empresa, recarga/ajuste/estorno pelo ADM, reserva e liberação, **aprovação do orçamento** (validade, permissão, horário, limite de crédito, reserva, AGENDADA, registro com hash), **cancelamento de AGENDADA** (cliente: multa pelas faixas do snapshot, mostrada antes de confirmar; motorista: sem custo, motivo obrigatório), saldo/extrato (filtros, CSV/PDF), reconciliação diária, **painel do ADM**.
Fica para a fase 3: saída (débito), previsão de término, conclusão, fotos, aditivo, revisão de contrato já aprovado (§4.4), notificações.

## Banco
- `app.contas(empresa_id pk, saldo_contabil_cent bigint, reservado_cent bigint, atualizado_em)` — linha travada com `FOR UPDATE` em toda operação de saldo; valores mantidos pelas funções e conferidos pela reconciliação.
- `app.lancamentos` (imutável: sem grants, trigger recusa UPDATE/DELETE/TRUNCATE): `id`, `empresa_id`, `tipo` (`RECARGA, DEBITO, MULTA, ADITIVO, AJUSTE, ESTORNO, RESERVA, LIBERACAO_RESERVA`), `valor_cent` (com sinal: créditos +, débitos −; RESERVA/LIBERACAO com efeito zero no contábil, só no reservado), `atividade_id`, `orcamento_id`, `estorna_id` (para ESTORNO; único), `motivo`, `comprovante` (texto: ID do Pix/observação; arquivo fica para a fase 4), `chave_idempotencia` (única por empresa), `criado_por`, `criado_em`.
  - Unicidade de regra de negócio: 1 RESERVA ativa por atividade (`app.reservas(atividade_id unique where ativa)`), 1 DEBITO por atividade, 1 MULTA por atividade, 1 ESTORNO por lançamento → chaves diferentes não duplicam efeito.
- Saldos: contábil = soma dos financeiros; reservado = soma das reservas ativas; disponível = contábil − reservado; limite e alerta do **contrato vigente** da empresa.
- RPCs (definer, `{ok,codigo}`, auditadas, com `p_chave uuid` de idempotência; repetição com a mesma chave devolve o mesmo resultado):
  | Função | Quem | Regras |
  |---|---|---|
  | `lancar_recarga(p_empresa, p_valor_cent, p_motivo, p_comprovante, p_chave)` | ADM | valor > 0; motivo obrigatório |
  | `lancar_ajuste(p_empresa, p_valor_cent, p_motivo, p_chave)` | ADM | valor ≠ 0 (crédito ou débito) |
  | `estornar_lancamento(p_lancamento, p_motivo, p_chave)` | ADM | só tipos financeiros; uma vez; valor oposto |
  | `aprovar_orcamento(p_atividade, p_versao, p_hash, p_chave, p_dispositivo)` | dono (N2) ou N1 | numa transação: trava atividade e conta; `now() < valido_ate`; versão+hash conferem; permissão; bloco PRE_RESERVA vira RESERVA (sem conflito); disponível − total ≥ −limite (`SALDO_INSUFICIENTE` com valores no retorno); cria reserva; AGENDADA; grava aprovação (usuário, data/hora, IP, dispositivo, versão, hash) |
  | `simular_cancelamento(p_atividade)` | quem pode cancelar | devolve faixa aplicável e multa (centavos) — mostrada antes de confirmar |
  | `cancelar_agendado(p_atividade, p_motivo, p_chave)` | cliente (dono/N1): libera reserva + MULTA pela faixa do **snapshot**; motorista/ADM: libera reserva, sem custo, motivo obrigatório | trava a atividade (serializa com a futura saída) |
  | leituras: `saldo_empresa(p_empresa)` (cliente da própria; ADM qualquer), `extrato(p_empresa, p_filtro)` (todos os clientes da empresa veem data, tipo, valor, nº do pedido e solicitante; `pode_abrir` só para quem pode ver o pedido), `painel_adm()` |
- Reconciliação diária (`pg_cron`): recalcula e compara contábil/reservado por empresa; reserva ativa só em AGENDADA; toda cobrança aponta para aprovação válida; nenhum pedido com >1 débito/multa. Resultado em `app.reconciliacoes` (data, ok, divergências jsonb) visível no painel.
- Endurecimento (revisão independente, migration `20261009141000_endurecimento_saldo.sql`):
  - travas de `app.atividades` sempre `FOR NO KEY UPDATE` (não bloqueiam o `FOR KEY SHARE` da FK ao gravar lançamento/reserva) e ordem atividade → conta em todo lugar, inclusive no estorno de lançamento com atividade (sem deadlock estorno × cancelamento);
  - `cancelar_agendado(p_atividade, p_motivo, p_chave, p_multa_esperada_cent)`: o cliente envia a multa da prévia (obrigatória); faixa calculada pelo relógio (`clock_timestamp`) sobre o orçamento da **reserva**; se mudou, `MULTA_ALTERADA` com `{multa_cent, faixa}` e nada é feito (a tela mostra o valor novo e pede nova confirmação, com chave nova); `disponivel_cent` só para cliente e ADM. Validade da aprovação também pelo relógio;
  - triggers de coerência no livro-razão e nas reservas (mesma empresa, orçamento da atividade, valor/estado da reserva, estorno = −original de tipo estornável) → 23514; `app.contas` só muda pelo trigger do livro-razão (sem UPDATE direto, DELETE, TRUNCATE; INSERT só zerada); conta sumida com histórico = erro de integridade;
  - reconciliação também aponta `RESERVA_SEM_PAR`, `RESERVA_VALOR_DIVERGENTE`, `EMPRESA_DIVERGENTE`, `ESTORNO_DIVERGENTE`, `AGENDADA_SEM_APROVACAO`; `COBRANCA_SEM_APROVACAO` exige a aprovação do mesmo orçamento;
  - evento `saldo` no tópico `saldo:<empresa_id>` (só ADM e clientes da empresa; a equipe do prestador assina `empresa:<id>`/`equipe` e não vê saldo);
  - idempotência de recarga/ajuste/estorno confere também motivo (e comprovante); `painel_adm` recusa datas infinitas.

## Front
- **Cliente**: cartão de saldo no Início (disponível, reservado, total; barra disponível/reservado; valor animado contando até o novo — respeita movimento reduzido); **Aprovar** no detalhe do pedido: recibo com memorial + saldo após aprovação → "Confirmar aprovação" → animação de processamento → resultado **só após o servidor** → check animado vira o card "Agendado"; `SALDO_INSUFICIENTE` explica quanto falta e o limite. **Cancelar agendado**: mostra a multa calculada antes de confirmar. **Extrato** (`/extrato`): filtros (período, tipo), lista/tabela, exportar CSV e PDF (impressão), privacidade do detalhe.
- **ADM**: **Clientes e crédito** (`/adm/creditos`): por empresa disponível/reservado/limite/alerta, botões Recarga / Ajuste / Estornar (motivo obrigatório, confirmação com valores, chave de idempotência gerada no cliente), extrato por empresa. **Painel** (`/adm/painel`, também no Início do ADM): crédito por cliente (com alerta), corridas agendadas/em andamento, valor aprovado no período (realizado chega com a fase 3), pendências, última reconciliação.
- Nenhuma ação financeira otimista.

## Testes obrigatórios (§9)
pgTAP + integração com concorrência real: 10 aprovações simultâneas → 1 reserva; dois pedidos disputando o mesmo saldo → limite respeitado; aprovação × expiração simultâneas → resultado único; chaves de idempotência diferentes → 1 efeito; reserva não altera o contábil; limite negativo respeitado; multa correta em cada faixa usando o snapshot mesmo após mudar o contrato; cancelamento × (cancelamento) simultâneos → um vence; arredondamento em centavos; nenhum perfil edita/apaga lançamento; extrato não vaza detalhe sem permissão; cliente nunca lança saldo; reconciliação detecta divergência injetada. E2E simulado + real: ADM recarrega → cliente cria → motorista orça → cliente aprova (saldo reservado) → cliente cancela agendado com multa (extrato mostra liberação + multa).

## Plano
1. Banco: contas, lançamentos, reservas, recarga/ajuste/estorno, saldos, extrato, reconciliação + testes.
2. Banco: aprovação, simulação e cancelamento de agendado + testes de concorrência e cobrança.
3. Front cliente: saldo, aprovar, cancelar agendado, extrato (CSV/PDF).
4. Front ADM: clientes e crédito, painel.
5. E2E real, revisão de segurança (foco em dinheiro), docs (RUNBOOK: divergência de saldo; roteiro de produção 1B+2A+2B), PR conjunto 1B+2A+2B para `main` (sem merge).
