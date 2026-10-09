# Fase 1B — Contratos por empresa, papéis e visibilidade (desenho + plano)

Fonte: `docs/especificacao.md` Adendo A10 (v6). Execução: subagentes + CI (sem Docker local), branch `fase-1b`, merge só com o usuário.

## Objetivo
Reorganizar o que a fase 1 entregou para o modelo comercial decidido: **contrato por empresa publicado só pelo ADM**, **papéis do prestador e níveis do cliente** no lugar da matriz de delegação, e **visibilidade por perfil** (cliente sem tabela de preços; motorista sem dados financeiros).

## Desenho

### Banco
1. **Contratos** — nova tabela `app.contratos_versoes` (imutável, como a anterior):
   - `empresa_id uuid null` (nulo = **tabela modelo**), `versao` (identity), `vigente_desde`, `publicado_por`, `publicado_por_nome`, `publicado_em`;
   - preços (centavos/pontos-base) e regras: as mesmas colunas de `parametros_versoes` **exceto** `retencao_fotos_dias`;
   - **crédito da empresa**: `limite_saldo_negativo_cent`, `alerta_saldo_baixo_cent` (já existiam; passam a ser por contrato).
   - Migração: a versão publicada hoje vira **modelo v1** e **contrato Umi San v1** (mesmos valores, vigentes desde agora). A tabela `parametros_versoes`, suas views e `api.publicar_parametros` são removidas (nenhum orçamento referencia ainda).
   - `app.configuracao` (linha única): `retencao_fotos_dias` (global, só ADM).
2. **Papéis** — `app.papel` ganha `GESTOR_FROTA` (exige aal2, como ADM/motorista). Cliente ganha `nivel smallint` 1|2|3 em `perfis` e `convites` (obrigatório para CLIENTE, nulo para os demais).
3. **Matriz removida** — `app.permissoes_delegadas`, `api.permissoes`, `api.definir_permissao` saem. `app.pode_fazer` passa a ser só por papel/nível:
   | Ação | Quem |
   |---|---|
   | `GERIR_CONTRATOS`, `LANCAR_SALDO`, `GERIR_EMPRESAS`, `VER_AUDITORIA`, `GERIR_USUARIOS` (todos) | ADM |
   | `GERIR_EQUIPE_EMPRESA` (convidar/desativar/gerar link de colegas **da própria empresa**, só papel CLIENTE) | CLIENTE N1 |
   | `VER_AGENDA_FROTA` (fase 3) | ADM, GESTOR_FROTA |
4. **RPCs/views por perfil**
   - `api.publicar_contrato(p_empresa uuid, p jsonb, p_vigente_desde)` — só ADM; `p_empresa` nulo publica o modelo; mesmas validações robustas de `publicar_parametros`.
   - ADM: `api.listar_contratos()` (vigente por empresa + modelo) e `api.historico_contrato(p_empresa)`.
   - Cliente: `api.regras_do_servico()` — do contrato vigente da própria empresa, **somente** faixas de cancelamento, prazo para orçar, validade do orçamento e limiar de urgente (sem preços, sem limites, sem versão/autor).
   - Motorista/gestor: `api.precos_para_orcar(p_empresa)` — preços unitários e prazos do contrato vigente da empresa (sem limites de saldo, sem versão/autor).
   - `api.preparar_convite`: ADM convida qualquer papel; CLIENTE N1 convida só CLIENTE da **própria** empresa (empresa forçada pelo servidor), qualquer nível. `definir_ativo` e `autorizar_operacao_usuario` aceitam N1 sobre colegas da própria empresa (nunca sobre si, nunca sobre não-clientes). `api.listar_usuarios()` para N1 retorna só a própria empresa.
   - `api.meu_perfil()` inclui `nivel`.
   - Empresa sem contrato vigente: `api.meu_perfil()` expõe `empresa_tem_contrato` (o front usa na fase 3 para bloquear "Novo pedido").

### Front
- **ADM → Contratos** (substitui "Tabela"): lista de empresas com contrato vigente + "Tabela modelo"; abrir uma empresa mostra o contrato vigente, histórico e "Publicar nova versão" (pré-preenchido do vigente ou do modelo); "Nova empresa" cria a empresa e já abre o contrato a partir do modelo.
- **ADM → Permissões** sai do menu; **Usuários** ganha papel Gestor de frota e nível do cliente (N1/N2/N3) no convite e na troca de perfil.
- **Cliente N1 → Equipe**: lista e convida colegas da própria empresa (nível 1–3), gera link, desativa/reativa (mesmos componentes da tela de Usuários).
- **Cliente → Regras do serviço** (substitui "Tabela" para cliente): faixas de cancelamento em linguagem simples, prazos e validade.
- **Motorista → Tabela**: título por modalidade ("Modalidade veículo próprio", "Modalidade veículo do cliente"), só preços e prazos; sem versão, autor, limites ou fotos.
- Início: atalhos por perfil/nível atualizados.

### Testes obrigatórios
- pgTAP: migração preserva valores (modelo v1 = contrato Umi San v1 = versão antiga); imutabilidade; só ADM publica; guarda 0001 verde; matriz inexistente; `pode_fazer` por papel/nível; GESTOR_FROTA sem aal2 recusado.
- Integração: cliente não lê preços nem limites (nem por RPC de motorista); motorista não lê limites nem histórico; N1 convida colega da própria empresa e não consegue convidar para outra empresa nem papel não-cliente; N2/N3 não convidam; N1 não desativa a si nem não-clientes; N3 não age.
- E2E (simulado + real): ADM publica contrato da Umi San; cliente vê "Regras do serviço" sem preços; motorista vê tabela sem limites; N1 convida colega.

## Plano (tarefas)
1. **Banco**: migration(s) + pgTAP + ajuste da integração existente (helpers `criarPessoa` com nível) — commit `feat(db): contratos por empresa, papéis do prestador e níveis do cliente`.
2. **Edge Functions**: `convidar`/`gerir-usuario` aceitam N1 (autorização continua 100% nas RPCs) + testes — commit `feat(funcoes): gestor da empresa convida e gerencia a própria equipe`.
3. **Front**: telas acima + remoção da matriz + `erros.ts` atualizado + e2e simulados — commit `feat(front): contratos, equipe do cliente, regras do serviço e visibilidade por perfil`.
4. **E2E real, docs (RUNBOOK, checklist `fase-1b-o-que-testar.md`, desenho fase 1 marcado como substituído onde conflitar), revisão de segurança, PR** (sem merge).
