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

## Revisão de segurança (Task 4)

Revisão de `git diff main...fase-1b` com foco em: migração de dados em produção, autorização do N1, aal2 do gestor de frota, vazamento de preço/limite para cliente e gestor de frota, guardas do front e cobertura de testes.

**Produção conferida (somente leitura, 2026-10-09):** 1 empresa (`Umi San`, nome exato), 1 versão da tabela única (vigente; retenção 5 dias), perfis ADM + CLIENTE (Umi San) + MOTORISTA, nenhum convite pendente, última migration `20261008130900`. A linha de `parametros_versoes` tem exatamente as 13 chaves do contrato após remover `versao`, `vigente_desde`, `publicado_por`, `publicado_por_nome`, `publicado_em` e `retencao_fotos_dias`; faixas válidas; `publicado_por` é uuid. Logo `interno.migrar_parametros` aceita a linha e o `db push` cria modelo v1 + Umi San v1 e `configuracao.retencao_fotos_dias = 5`; o cliente existente vira N1.

**Migração no Supabase hospedado:** `ALTER TYPE ... ADD VALUE 'GESTOR_FROTA'` fica em arquivo próprio (`20261009120000`); o CLI aplica e confirma cada arquivo em transação separada, então o valor novo já está confirmado quando `20261009120100` cria políticas/funções que o usam. `DROP/CREATE POLICY` em `storage.objects` usa o mesmo privilégio que a fase 1 já usou em produção (`20261008130600_logos.sql`). Nenhum `DROP` tem dependentes fora dos que a migração remove antes. Na janela entre o `db push` e a publicação do front, o front antigo chamaria `parametros_vigentes`/`permissoes` (removidas) — sem usuários reais, aceito; a Edge Function `convidar` antiga segue funcionando (`p_nivel` tem default).

**Correções (migração `20261009120200_revisao_1b.sql`, testes em `supabase/tests/0010_revisao_1b.test.sql`):**
- **R1 — N1 substituía convite pendente alheio.** `preparar_convite` apaga o convite pendente do mesmo e-mail antes de criar o novo; um N1 podia trocar um convite pendente do ADM (motorista, gestor de frota, ADM ou cliente de outra empresa) por um convite de cliente da própria empresa. Agora, para o N1, convite pendente que não seja CLIENTE da própria empresa responde `EMAIL_EM_USO` e fica intacto; o ADM continua substituindo qualquer um.
- **R2 — a migração de dados nunca rodava no CI.** O CI parte de banco vazio, então o ramo "existe versão publicada" do bloco `do $$` não era exercitado (o pgTAP chama `migrar_parametros` com jsonb montado à mão). Novo passo no fim do CI: `supabase db reset --version 20261008130900`, semeia um estado igual ao de produção (`scripts/migracao-producao/antes.sql`), roda `supabase migration up` (como o `db push`) e confere tudo (`scripts/migracao-producao/depois.sql`: valores, versão 1, autor, vigência, retenção, níveis, estruturas antigas removidas, empresa sem contrato continua sem).

**Verificado sem achado:** N1 sempre forçado à própria empresa e ao papel CLIENTE (convite, desativar/reativar, gerar link, listar); nunca age sobre si, não-clientes ou outra empresa (respostas `SEM_PERMISSAO` sem revelar existência do alvo); `RESETAR_2FA` só ADM. `app.pode_acessar` exige aal2 para GESTOR_FROTA (e o front o inclui em `EXIGE_2FA`). `app.contratos_versoes` e `app.configuracao` sem GRANT a `authenticated`; leituras só por funções DEFINER com checagem: cliente só `regras_do_servico` (sem preço, limite, versão, autor); `precos_para_orcar` só ADM/MOTORISTA (gestor de frota e cliente recebem vazio) e sem limites; `listar_contratos`/`historico_contrato`/`ler_configuracao` só ADM; `meu_perfil` expõe só o booleano `empresa_tem_contrato`. Storage só tem o bucket `logos` (sem dados de contrato). Guardas do front (`GuardaPapel` com `niveis`) batem com o banco; o banco decide de novo em toda chamada.

**Riscos aceitos:**
- **N1 gera link de recuperação para colegas da própria empresa**, o que equivale a assumir a conta deles (como o ADM já pode com não-ADMs). Sem e-mail próprio (sem domínio) não há "esqueci a senha"; o link do N1 é o caminho de recuperação da equipe. Restrito à própria empresa e ao papel CLIENTE, limitado a 20/dia e auditado com `gestor_empresa = true`.
- **N1 reativa colega da própria empresa que o ADM desativou** (e N1s se desativam entre si, exceto a si mesmos). Auditado; o ADM pode desativar o próprio N1 e trocar o nível pelo **Trocar perfil**. Revisar se surgir "suspensão pelo ADM" como regra de negócio (ex.: inadimplência por empresa, fase 2).
- **N1 descobre se um e-mail já tem conta** (`JA_CADASTRADO`/`EMAIL_EM_USO` no convite), como o ADM. Limitado a 10 tentativas/dia (o limite conta antes da checagem) e auditado.
- **Motorista lê preços de qualquer empresa** passando o id (`precos_para_orcar`): por desenho o motorista atende todas as empresas e já lista todas; sem limites, versão ou autor.
- **Só a versão vigente da tabela única é migrada** (produção tem exatamente uma). Uma versão futura agendada seria perdida; não é o caso.
- `interno.migrar_parametros` permanece no banco (sem EXECUTE para `authenticated`), usado pelo pgTAP.
