# Especificação mestre — App de Transporte (Umi San) — v5

> Documento-fonte do projeto. Cada fase tem seu documento de desenho em `docs/fases/`.
> Decisões tomadas depois da v5 estão no **Adendo A** (fim deste arquivo) e prevalecem sobre o texto original quando houver conflito.

Crie um web app PWA (mobile-first, pt-BR, R$, fuso America/Sao_Paulo) para agendar, orçar, aprovar e executar serviços de transporte de pessoas e equipamentos, com cobrança em saldo pré-pago.

Prioridades, nesta ordem:
1. saldo sempre correto
2. aprovação válida e rastreável
3. dados e aplicativo recuperáveis
4. software que continue funcionando sem depender de uma pessoa
5. todos os parâmetros visíveis aos dois lados

## 1. Arquitetura e custo (teto: R$ 100/mês)
Arquitetura B: PWA estática + toda a lógica no Supabase. Não existe servidor de aplicação próprio.

```
[PWA React (Cloudflare Pages)]
   │  supabase-js (JWT curto, RLS) → só chama RPCs do schema `api` e lê views por perfil
   ▼
[Supabase sa-east-1]
   ├─ Postgres: tabelas + RLS + funções (toda regra de negócio)
   ├─ Auth: senha ≥10, confirmação de e-mail, TOTP (MFA), CAPTCHA Turnstile nativo
   ├─ Storage: bucket privado de fotos
   ├─ Realtime: Broadcast em canais privados (ver 1.2)
   ├─ pg_cron: expiração (15 min), lembretes, reconciliação diária, drenagem do outbox (1 min via pg_net)
   └─ Edge Functions (Deno): hibp-check, outbox-worker (push/e-mail), resend-webhook, upload-validate
[GitHub Actions] CI · backup diário → R2 · teste de restauração mensal · keep-alive
[Healthchecks.io / UptimeRobot] alertas externos
```

- Front: Vite + React + React Router + Tailwind + Motion, PWA (service worker com cache do app shell). Escolhido em vez de Next.js export, por causa das rotas dinâmicas (`/pedidos/:id`).
- Hospedagem do front: Cloudflare Pages (Free).
  - Headers de segurança (CSP, HSTS etc.) no arquivo `_headers`.
  - Deploy só via GitHub Actions, depois do CI verde.
- Banco/Auth/Storage/Realtime/cron/Edge Functions: Supabase Free, região sa-east-1 (São Paulo).
- E-mail: Resend Free. Push: Web Push (VAPID), enviado pela Edge Function.
- Backup externo: Cloudflare R2 (free até 10 GB).
- Monitoramento externo grátis: UptimeRobot (app no ar) e Healthchecks.io (aviso se backup/jobs não rodarem).
- Código: repositório PRIVADO no GitHub. Em repositório público, o GitHub desativa workflows agendados após 60 dias sem atividade; o Healthchecks cobre o caso de qualquer job parar.
- Testes:
  - pgTAP: regras de banco e RLS
  - Vitest + supabase-js: concorrência real (chamadas paralelas) contra Supabase local no CI
  - Playwright: fluxos de tela
- Custo esperado: R$ 0 de hospedagem + domínio (~R$ 40–60/ano).

### 1.1 Regras de projeto
- **Lógica no banco.**
  - O front nunca faz INSERT/UPDATE/DELETE direto. Toda escrita passa por funções do schema `api` (ex.: `api.aprovar_orcamento`, `api.registrar_saida`), que checam a permissão lendo a matriz e travam com lock.
  - O front lê apenas views mínimas por perfil.
- **Privilégios além do RLS (defesa em camadas).**
  - `REVOKE` de INSERT/UPDATE/DELETE nas tabelas de negócio para os papéis `anon` e `authenticated`; só as funções escrevem.
  - Schemas separados:
    - `api`: único exposto na API, contém só as RPCs e views do app
    - `app`: tabelas, NÃO exposto
    - `interno`: funções de sistema (reconciliação, worker do outbox, expiração, backup), NÃO exposto e sem GRANT para usuários
- **2FA verificado no banco.** Políticas e funções exigem `aal2` no JWT para ADM e MOTORISTA. Sem TOTP validado, o banco recusa, mesmo com a tela burlada.
- **Desativação imediata.** Toda função e política checa `perfis.ativo`. Usuário desativado perde acesso na próxima requisição, sem esperar o JWT expirar.
- **Configuração como código.** `supabase/migrations`, `supabase/config.toml` (Auth, MFA, CAPTCHA, buckets), `cron.sql` e o deploy das Edge Functions ficam versionados. O repositório recria um projeto do zero.

### 1.2 Realtime
- `postgres_changes` NÃO funciona sobre views e exporia linhas brutas. Por isso, usar **Realtime Broadcast em canais privados**.
- Triggers nas tabelas (ex.: mudança de status da atividade) publicam via `realtime.send` / `realtime.broadcast_changes` apenas um payload mínimo: id, status novo e horário.
- Canais por destinatário (ex.: `atividade:<id>`, `usuario:<id>`), autorizados por RLS em `realtime.messages`. Só entra no canal quem pode ver aquele pedido.
- Ao receber o evento, o front relê a view correspondente (que aplica as permissões). Nenhum dado sensível trafega pelo canal.
- Teste obrigatório: cliente B não consegue assinar o canal de pedido de A.

### 1.3 Rate limit (sem servidor intermediário)
- Tabela `interno.limites` com contadores por usuário + ação + janela de tempo, verificada no início de cada função `api.*` sensível (`interno.checar_limite(acao, max, janela)`).
- Limites configuráveis, com padrões:

| Ação | Limite |
|---|---|
| Criar pedido | 20/hora por usuário |
| Upload | 30/hora |
| Convite | 10/dia |
| Pedir revisão | 10/hora |

- Edge Functions com limite próprio por usuário/IP.
- Login e recuperação de senha cobertos pelos limites nativos do Supabase Auth + Turnstile.
- Excesso retorna erro genérico e é registrado na auditoria.

Limitações aceitas, com mitigação:

| Limitação | Mitigação |
|---|---|
| Supabase Free pode pausar projetos com baixa atividade | Keep-alive diário reduz o risco, mas NÃO garante; monitoramento externo alerta o ADM e o `RUNBOOK.md` ensina a reativar/restaurar |
| Supabase Free sem backup automático | Backup diário próprio (seção 10) |
| Supabase Free sem checagem nativa de senha vazada | Checagem própria via API HaveIBeenPwned (k-anonymity) |
| 500 MB de banco e 1 GB de storage | Fotos com retenção curta após entrega confirmada |
| Resend Free com limite diário/mensal | Push como canal principal; e-mails não urgentes agrupados |
| Edge Functions Free (cota mensal de invocações) | Volume do app muito abaixo da cota; monitorar no painel |

O README documenta quando migrar para planos pagos e o custo de cada um.

## 2. Perfis e permissões
Três perfis, cada pessoa com conta individual. Contas compartilhadas não são permitidas.

**ADM:**
- gerencia usuários e perfis (cria, desativa, troca perfil)
- edita a tabela geral de parâmetros e a matriz de permissões
- ALTERA O SALDO: recarga, ajuste (crédito ou débito) e estorno, sempre com motivo. Nunca edita valor diretamente; toda alteração é um novo lançamento auditado.
- vê auditoria, reconciliação e status de backup
- pode executar qualquer ação do motorista

**MOTORISTA:**
- orça, recusa, executa (saída, previsão de término, conclusão, fotos) e cancela com motivo
- SEMPRE tem todas as opções de parâmetros da corrida no orçamento (4.2), sem depender de delegação
- vê agenda, saldo, extrato e tabela geral (somente leitura)

**CLIENTE** (vários, empresa Umi San):
- cria e vê os PRÓPRIOS pedidos
- por padrão, aprova, reprova, pede revisão ou cancela SOMENTE pedidos que criou
- vê saldo e extrato da empresa
- vê a tabela geral (somente leitura)

**Matriz de permissões** (configurável pelo ADM, tudo desligado por padrão):
- MOTORISTA lançar recarga
- MOTORISTA editar a tabela geral
- CLIENTE aprovar/cancelar pedido de outro cliente da mesma empresa

Toda mudança na matriz é auditada e notificada. As regras acima valem "salvo delegação ativa na matriz".

**Privacidade do extrato:** todos os clientes veem todos os lançamentos da empresa (data, tipo, valor, nº da atividade e solicitante). O detalhe da atividade e da aprovação só abre para quem tem permissão de ver aquele pedido; para os demais, o link mostra só o resumo financeiro.

Toda permissão é garantida no BANCO (RLS + funções com checagem que leem a matriz), não só na tela.

## 3. Parâmetros (visíveis aos 2 lados)
Tabela geral de parâmetros, versionada com data de vigência:
- ADM edita (ou MOTORISTA, se delegado).
- MOTORISTA e CLIENTE veem a tabela vigente e o histórico, em tela própria: "Tabela de preços e regras".
- Toda alteração notifica os clientes e vale só para orçamentos criados após a vigência.
- A tabela define valores PADRÃO; em cada corrida o motorista pode ajustá-los (4.2).

**Modalidade VEÍCULO PRÓPRIO:**
- R$/km sem reboque; R$/km com reboque e/ou taxa fixa de reboque
- taxa de retorno padrão (%) para trecho único
- R$/hora de espera
- hospedagem (R$/diária)

**Modalidade VEÍCULO DA UMI SAN** (motorista conduz veículo do cliente):
- R$/diária do motorista × nº de diárias (sem km)
- hospedagem

**Comuns às duas modalidades:**
- Pedágio/balsa: valor estimado incluído no orçamento.
- Cancelamento: faixas de antecedência × % de multa (padrão: >24h = 0%; 24h–6h = 50%; <6h = 100%), aplicadas sobre o valor aprovado.
- Sem antecedência mínima para solicitar.
- Prazo para o motorista orçar (padrão 12h) e validade do orçamento (padrão 24h). Nenhum dos dois passa do horário de início.
- Limiar de URGENTE (padrão: início em menos de 6h).
- Limite de saldo negativo (R$) e limiar de alerta de saldo baixo (R$).
- Retenção de fotos após entrega confirmada (padrão 30 dias).

**Snapshot:** cada orçamento grava cópia imutável de TODOS os parâmetros usados, incluindo as faixas de cancelamento. Mudanças posteriores na tabela nunca alteram uma contratação existente.

## 4. Fluxo e estados
```
SOLICITADA   → ORCADA | RECUSADA | EXPIRADA | CANCELADA
ORCADA       → AGENDADA (aprovada) | REPROVADA | SOLICITADA (revisão pedida) | EXPIRADA | CANCELADA
AGENDADA     → EM_ANDAMENTO (saída) | CANCELADA
EM_ANDAMENTO → CONCLUIDA
```
- As transições são validadas no banco por tabela de transições permitidas.
- Cada transição registra usuário, data/hora e observação.
- No máximo 1 atividade EM_ANDAMENTO por motorista (unique index parcial).

### 4.1 Solicitação (cliente)
Campos:
- data/hora de início e duração estimada
- origem e destino
- tipo: pessoas / equipamento / ambos (quantidade, descrição, peso e dimensões)
- trajeto: LEVAR E TRAZER, SÓ LEVAR ou SÓ TRAZER
- modalidade: VEÍCULO PRÓPRIO ou VEÍCULO DA UMI SAN
- reboque: sim / não / não sei
- contato no local, observações e anexos

### 4.2 Orçamento (motorista) — PREÇO FECHADO
- O formulário mostra todas as opções da modalidade SELECIONADA. O motorista pode trocar a modalidade.
- O servidor rejeita campos incompatíveis com a modalidade.

**VEÍCULO PRÓPRIO:**
- km (LEVAR E TRAZER = ida e volta; trecho único = km do trecho + taxa de retorno em %, opcional)
- reboque
- espera estimada
- pedágio/balsa
- hospedagem

**VEÍCULO DA UMI SAN:** nº de diárias, pedágio/balsa e hospedagem.

Regras de preenchimento:
- Valores unitários vêm preenchidos com a tabela vigente. O motorista pode alterá-los SÓ para aquela corrida.
- Valor alterado aparece destacado no memorial ("padrão R$ X → nesta corrida R$ Y").
- Campo "outros" (descrição + valor) para custo não previsto na tabela.
- O SERVIDOR calcula o total e o memorial de cálculo. O motorista pode sugerir outro horário.

### 4.3 Aprovação
- Quem pode: quem criou o pedido (ou cliente delegado). A ação é aprovar, reprovar ou pedir revisão.
- A função de aprovação, numa única transação:
  1. verifica a validade do orçamento direto no banco (`now() < valido_ate`), sem depender do cron
  2. verifica permissão
  3. verifica que o horário segue livre
  4. verifica o limite de saldo
  5. cria a reserva
  6. muda o estado para AGENDADA
- A aprovação grava: usuário, data/hora, IP/dispositivo, versão do orçamento e hash do conteúdo (valores, parâmetros, horário, endereços).

### 4.4 Mudanças (revisão de contrato aprovado)
- O preço cobrado é EXATAMENTE o do orçamento aprovado.
- Qualquer mudança (horário, trajeto, carga, modalidade ou valor) gera uma NOVA VERSÃO PENDENTE.
- A versão aprovada CONTINUA VIGENTE (agendamento, horário e reserva) enquanto a nova aguarda aprovação.
- Se a nova for aprovada, numa única transação: substitui orçamento, horário e reserva (libera a antiga, cria a nova, checando limite de saldo e conflito de agenda).
- Se a nova for reprovada ou expirar, a versão anterior segue válida.
- Após a saída, só por ADITIVO: valor extra com justificativa, aprovado pelo cliente, sujeito ao limite de saldo e debitado separadamente. Sem aprovação, não há cobrança extra.

### 4.5 Execução e cobrança
- **SAÍDA**, numa única transação: libera a reserva, lança o DÉBITO do valor aprovado e muda o estado para EM_ANDAMENTO.
- **PREVISÃO DE TÉRMINO:** se a viagem atrasar, o motorista informa a nova previsão.
  - O bloqueio da agenda é estendido.
  - Se colidir com a próxima atividade, alerta o motorista e o cliente da próxima.
  - A atividade seguinte não pode sair enquanto houver outra EM_ANDAMENTO.
- **CONCLUIR:** só registra fim, fotos e observações. Não cobra nada.
- O status aparece em tempo real para o cliente.

### 4.6 Cancelamento
Permitido até a SAÍDA:
- SOLICITADA ou ORCADA: sem custo (pelo cliente que criou ou pelo motorista).
- AGENDADA, pelo cliente: multa pelas faixas do SNAPSHOT do orçamento aprovado, mostrada antes de confirmar. Libera a reserva e lança a multa na mesma transação.
- AGENDADA, pelo motorista: sem custo para o cliente, motivo obrigatório.

Após a SAÍDA não há cancelamento: o valor já está debitado e é devido. Cancelamento e saída simultâneos: o banco serializa (lock da atividade) e só um vence.

## 5. Agenda
- A agenda controla a DISPONIBILIDADE DO MOTORISTA, qualquer que seja a modalidade.
- Bloqueiam horário: SOLICITADA e ORCADA (pré-reserva com contagem regressiva), AGENDADA e EM_ANDAMENTO.
- Conflito impedido no banco: exclusion constraint em tstzrange por motorista, considerando só blocos ativos.
- Expiração sem depender do cron:
  - a função que ocupa um horário primeiro expira, na mesma transação, as pré-reservas vencidas que colidem
  - o cron (a cada 15 min) só expira o restante e dispara as notificações
- O cliente vê só "ocupado" nos pedidos de outros.
- **Pendências em destaque**, no topo da tela inicial:
  - motorista: "aguardando seu orçamento"
  - cliente: "aguardando sua aprovação", com prazo
  - ambos: revisões pendentes, itens perto de expirar, saldo insuficiente, atraso
- Lembretes em 50% e 90% do prazo.

## 6. Saldo (núcleo crítico)
- Dinheiro sempre em CENTAVOS (integer).
  - Cada linha do memorial é arredondada em centavos (meio para cima) no momento do cálculo.
  - O total é a soma das linhas já arredondadas.
  - Percentuais (retorno, multa) aplicados sobre centavos, com o mesmo arredondamento.
- Livro-razão IMUTÁVEL `lancamentos`: sem UPDATE/DELETE para ninguém (RLS + trigger). Correção só por AJUSTE ou ESTORNO, com motivo.
  - Tipos FINANCEIROS (afetam o saldo contábil): RECARGA, DEBITO, MULTA, ADITIVO, AJUSTE, ESTORNO.
  - Tipos de RESERVA (efeito ZERO no saldo contábil; só alteram o reservado): RESERVA, LIBERACAO_RESERVA.
- Saldo contábil = soma dos lançamentos financeiros.
- Reservado = soma das reservas ativas.
- Disponível = contábil − reservado.
- A recarga é feita por fora (Pix) e lançada pelo ADM (ou MOTORISTA delegado), com comprovante.
- Toda operação de saldo roda em função SQL transacional:
  - lock da conta da empresa (`FOR UPDATE`)
  - chave de idempotência por requisição
  - unicidade por regra de negócio (unique constraint: 1 DEBITO por atividade; 1 reserva ativa por atividade; 1 MULTA por atividade; 1 lançamento por aditivo aprovado)
  - assim, tentativas duplicadas com chaves de idempotência DIFERENTES também falham
- Reconciliação diária; qualquer divergência alerta o ADM:
  - contábil recalculado = contábil exibido
  - reserva ativa só existe em AGENDADA
  - toda cobrança aponta para aprovação válida
  - nenhuma atividade com mais de 1 débito
- Extrato visível aos dois lados (respeitando a privacidade da seção 2), filtrável e exportável em CSV/PDF.

## 7. Notificações (entrega verificável)
- **Outbox:** o evento de notificação é gravado na MESMA transação da operação. Um worker envia, com chave de deduplicação, novas tentativas com backoff e status por canal (pendente, aceito, entregue, falhou).
- **Canais:** push e e-mail; o usuário escolhe. Eventos financeiros (débito, multa, recarga, ajuste) e aprovações sempre ficam registrados na central de notificações do app, mesmo com e-mail desligado.
- Status de e-mail via webhook do Resend: "aceito" é diferente de "entregue".
- Falha persistente alerta o ADM.

| Evento | Motorista | Cliente |
|---|---|---|
| Nova solicitação / revisão pedida | ✓ | |
| Orçamento ou revisão recebidos | | ✓ |
| Aprovação / reprovação | ✓ | |
| Prazo perto de vencer / expiração | ✓ | ✓ |
| Agendamento confirmado | ✓ | ✓ |
| Saída (com débito) | | ✓ |
| Atraso / nova previsão | ✓ | ✓ |
| Conclusão | | ✓ |
| Cancelamento e multa | ✓ | ✓ |
| Recarga / ajuste / estorno | | ✓ |
| Saldo baixo / insuficiente | | ✓ |
| Mudança de parâmetros ou da matriz | ✓ | ✓ |
| Falha de backup, reconciliação ou envio | ADM | |

## 8. Fotos
- Bucket privado, só imagem (tipo real validado), máx. 5 MB, nome em UUID, signed URL curta.
- Na conclusão, as fotos vão por e-mail (via outbox) ao cliente e ao motorista, e ficam disponíveis para download no app.
- Apagar SOMENTE quando as duas condições valerem: entrega confirmada pelo webhook E prazo de retenção vencido.
  - Se a entrega falhar, a foto é mantida e o ADM é alertado.
  - Fica registrado que a foto existiu, quando foi entregue e quando foi apagada.
- O histórico financeiro e a auditoria NUNCA são apagados.

## 9. Segurança (cada item com evidência de teste)
Gere `SECURITY.md` com tabela: item | como foi atendido | teste que comprova | resultado.

1. Segredos (service role, Resend, VAPID privada, R2, chave do age) só nos secrets das Edge Functions e do GitHub Actions. O front recebe apenas a URL e a chave `anon`. Varredura do bundle e do repositório confirma ausência.
2. Validação no front (Zod) apenas para UX.
3. Revalidação nas funções SQL e Edge Functions + CHECK constraints. Valores financeiros calculados só no banco.
4. Só queries parametrizadas; funções `SECURITY DEFINER` com `search_path` fixo e checagem explícita de permissão. Só o schema `api` exposto; `REVOKE` de escrita direta nas tabelas para `anon`/`authenticated` (1.1).
5. Senha forte (mín. 10), checagem de senha vazada via HaveIBeenPwned (k-anonymity) no cadastro e na troca de senha, confirmação de e-mail, 2FA obrigatório para ADM e MOTORISTA.
6. IDOR: RLS em todas as tabelas e buckets.
7. Senhas só no Supabase Auth.
8. CAPTCHA (Turnstile) no login e na recuperação de senha, mais limites do Auth.
9. Idempotência, unicidade por regra de negócio e lock em toda operação de saldo e de estado.
10. CSRF: NÃO SE APLICA na arquitetura B. A autenticação é por token Bearer no header (não há cookie de sessão enviado automaticamente pelo navegador). Registrar no `SECURITY.md` com a justificativa e o teste: requisição sem header Authorization é recusada.
11. Upload validado (tipo real, tamanho, bucket privado).
12. Erros genéricos ao usuário; detalhe só em log, sem dados pessoais.
13. Dependabot e `npm audit` sem alto/crítico como gate do deploy.
14. Sessão curta (JWT ≤ 15 min) com refresh; logout revoga o refresh token; usuário desativado perde acesso imediatamente (`perfis.ativo` checado em toda função e política).
15. Rate limit dentro das funções SQL (`interno.checar_limite`) e nas Edge Functions, conforme 1.3; login coberto pelo Auth + Turnstile.
16. Selects mínimos e views por perfil; nada de `select *` exposto.
17. SSRF: nem o banco (pg_net) nem as Edge Functions buscam URL informada pelo usuário. pg_net só chama URLs fixas de configuração (outbox-worker).
18. Armazenamento do token: DECISÃO DOCUMENTADA (substitui "cookies").
    - O app não usa cookie de sessão. O supabase-js guarda o token no armazenamento do navegador, legível por JavaScript; o risco equivale ao de um cookie não HttpOnly.
    - Mitigação principal contra XSS: CSP rígida no `_headers` do Pages:
      - `script-src 'self'` mais o domínio do Turnstile, sem `unsafe-inline`/`unsafe-eval`
      - `connect-src` só para o domínio do Supabase (https e wss)
      - nenhum script de terceiros além do Turnstile
      - React sem `dangerouslySetInnerHTML`
    - JWT curto e refresh token rotativo.
    - Registrar no `SECURITY.md` como risco aceito, com o teste: a CSP bloqueia um script injetado.
19. CORS: as Edge Functions só aceitam a origem do app. Headers de segurança no `_headers` do Pages: CSP, HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy.

**Testes automatizados obrigatórios** (CI contra banco real de teste; deploy bloqueado se falhar):
- **Acesso:**
  - sem delegação: cliente A não lê detalhe, não aprova e não cancela pedido de B
  - com delegação: consegue apenas o que foi delegado
  - cliente não altera parâmetros, saldo ou execução
  - motorista não lança recarga nem edita a tabela geral sem delegação, e consegue quando delegado
  - motorista sempre ajusta parâmetros da corrida, sem alterar a tabela geral
  - nenhum perfil edita ou apaga lançamento
  - link do extrato não vaza detalhe sem permissão
  - escrita direta em tabela (INSERT/UPDATE/DELETE via API) é recusada para todos os perfis; funções de `interno` não são chamáveis pela API
  - cliente B não assina o canal Realtime de pedido de A
  - ADM/MOTORISTA sem `aal2` (TOTP) é recusado pelo banco
  - rate limit dispara ao exceder o limite de cada ação
- **Concorrência:**
  - 10 aprovações simultâneas → 1 reserva
  - 10 saídas simultâneas → 1 débito
  - dois pedidos diferentes disputando o mesmo saldo → limite respeitado
  - cancelamento × saída simultâneos → só um vence, saldo coerente
  - aprovação × expiração simultâneas → resultado único e coerente
  - tentativas duplicadas com chaves de idempotência diferentes → 1 efeito
  - dois pedidos no mesmo horário → só 1 entra
- **Cobrança:**
  - débito = valor aprovado; conclusão não cobra
  - multa correta em cada faixa, usando o snapshot mesmo após mudar a tabela
  - cancelamento após saída bloqueado
  - revisão pendente não altera o contrato vigente; aprovada troca tudo atomicamente
  - aditivo sem aprovação não debita; aditivo respeita o limite
  - arredondamento em centavos conforme regra
- **Saldo:** reserva não altera o contábil; limite negativo respeitado; reconciliação detecta divergência injetada.
- **Notificações e fotos:** falha de envio gera nova tentativa sem duplicar; foto não entregue não é apagada.
- **Recuperação:** ver seção 10.

## 10. Backup e recuperação
- **Diário via GitHub Actions:**
  - `pg_dump` completo (schema + dados + auth) criptografado com age
  - sincronização do Storage (fotos dentro da retenção) para o R2
  - retenção: 30 diários + 12 mensais
- **Chave de descriptografia:** guardada fora do sistema, em gerenciador de senhas de 2 administradores e em cópia impressa lacrada. O `RUNBOOK.md` diz onde está.
- **Alertas:**
  - falha do job alerta o ADM
  - ausência de backup em 26h alerta via Healthchecks.io (dead man's switch), cobrindo o caso de o job nem ter rodado
- **Configuração como código:** migrations, políticas RLS, funções, cron jobs, buckets e configurações de Auth em scripts versionados, para recriar um projeto do zero.
- **Teste de restauração mensal automatizado** em projeto/banco temporário. Confere:
  - contagens e saldo por empresa
  - login de usuário de teste
  - RLS (cliente A não vê B)
  - funções financeiras (reserva → saída → débito)
  - fotos restauradas abrindo

  O resultado fica registrado e visível ao ADM.
- `RUNBOOK.md`: restaurar em novo projeto Supabase, reaplicar configurações, reapontar o app, validar.

## 11. Continuidade
- Todas as contas (GitHub, Cloudflare, Supabase, Resend, domínio, Healthchecks, UptimeRobot) em um e-mail DEDICADO do negócio (pode ser Gmail), com 2 administradores (ADM e motorista) e 2FA.
  - O desenvolvimento pode começar em contas pessoais.
  - A migração para as contas do negócio é PRÉ-REQUISITO para entrar em produção (item bloqueante da fase 6).
  - O repositório é transferido para uma organização GitHub do negócio.
- Nenhuma configuração feita só no painel sem estar em script ou documentada.
- `README.md`: arquitetura, rodar localmente, deploy, variáveis de ambiente, backup/restauração, como alterar parâmetros, quando migrar para plano pago.
- `RUNBOOK.md`: app fora do ar, Supabase pausado, backup falhou ou não rodou, divergência de saldo, e-mails não entregues.
- Exportação completa dos dados (CSV) disponível ao ADM a qualquer momento.
- Stack padrão de mercado, versões fixadas.

## 12. Interface e experiência
PWA instalável (ícone, tela cheia, splash). Deve parecer app nativo: fluido, rápido e com a "cara" do serviço de transporte.

### 12.1 Identidade visual (direção marítima)
**Cores:**
- Base: azul-marinho profundo (ex.: `#0B2545`) e off-white (ex.: `#F7F5F0`)
- Ação/alerta: laranja de sinalização (ex.: `#FF6B1A`), usado SÓ em ações principais e alertas
- Tokens de cor em CSS variables, com modo escuro automático e modo alto contraste para uso no sol (motorista)

**Cores de status** (sempre com ícone + texto, nunca só cor):

| Status | Cor |
|---|---|
| Solicitada | cinza |
| Aguardando aprovação | âmbar |
| Agendada | azul |
| Em andamento | laranja pulsando |
| Concluída | verde |
| Cancelada/expirada | vermelho |

**Tipografia:** sans-serif legível (ex.: Manrope ou IBM Plex Sans), com números tabulares em todo valor monetário.

**Ícone do app e splash:** pickup com reboque estilizada, no padrão marinho + laranja.

### 12.2 Animações e fluidez
Usar Motion (Framer Motion) + View Transitions.

**Tela de carregamento temática** (estilo Zé Delivery):
- Pickup estilizada andando numa estrada, com rodas girando, faixa tracejada passando e leve balanço.
- Em SVG/Lottie leve (< 50 KB), em loop.
- Usada no splash e em carregamentos acima de 400 ms. Abaixo disso, nada aparece; em listas, skeleton.

**Microinterações:**
- Pull-to-refresh com o carrinho dando ré.
- Transições de tela deslizantes (push/pop, como app nativo).
- Feedback tátil (vibração) nas ações principais, onde suportado.
- Botões respondem ao toque em < 100 ms (estado pressionado imediato).

**Momentos-chave:**
- **SAÍDA (motorista):** botão de deslizar para confirmar. O carrinho percorre o trilho e, ao soltar no fim, a pickup "parte".
- **Aprovação (cliente):** recibo com memorial; ao aprovar, o check animado vira o card "Agendado".
- **Acompanhamento:** linha do tempo estilo rastreio de entrega, com o carrinho avançando entre as etapas (agendado → saiu → em andamento → concluído).
- **Saldo:** valor anima contando até o número novo; barra disponível/reservado.

**Regra para dinheiro:** nenhuma ação financeira usa UI otimista. Durante o processamento aparece a animação; o resultado (débito, reserva, multa) só é exibido após confirmação do servidor. Ações não financeiras podem ser otimistas.

**Acessibilidade e desempenho:**
- Respeitar `prefers-reduced-motion` (animações viram transições simples).
- Prefetch de rotas e cache do app shell para abertura instantânea.
- Meta: telas abrindo em < 1 s em 4G.

### 12.3 Telas por perfil (mobile-first)
**MOTORISTA:**
- Início "Hoje": próximo serviço em card grande, com "Abrir no Waze/Maps" e "Ligar para o contato".
- Pendências no topo.
- Ações grandes na parte inferior, para uso com uma mão.
- Orçamento como calculadora: total atualiza ao vivo; valores alterados em relação à tabela marcados em laranja.

**CLIENTE:**
- Início: cartão de saldo (disponível, reservado, total), pendências e botão grande "+ Novo pedido".
- Novo pedido em 4 passos curtos: quando → onde → o quê → revisar.
- "Repetir pedido" a partir de um pedido anterior.

**ADM:** funciona no celular e é confortável no desktop; extrato, auditoria, usuários e configurações em tabelas.

**Agenda:** lista por dia no celular; visão de mês com marcadores de status no desktop.

## 13. Fora do escopo (v1)
Pagamento online, nota fiscal, GPS, múltiplos motoristas.

## 14. Fases
Ao fim de cada fase, liste o que testar. Nenhum deploy em produção antes de os testes da fase passarem.

0. Fundação:
   - Vite + React PWA no Cloudflare Pages, com `_headers` e CSP
   - Supabase sa-east-1 com schemas `api`/`app`/`interno` e REVOKEs
   - CI com Supabase local (pgTAP + Vitest + Playwright)
   - deploy só com CI verde
   - prova do Realtime Broadcast em canal privado
   - design system (tokens, tipografia, componentes base), PWA instalável e animação de carregamento
1. Banco, RLS, auth/2FA/HIBP, perfis, matriz de permissões, parâmetros versionados, auditoria + testes de acesso
2. **Motor de saldo:** livro-razão, reserva, débito, multa, aditivo, idempotência, unicidade, arredondamento, reconciliação + testes de concorrência e cobrança
3. Solicitação, orçamento, aprovação, revisão, agenda, expiração, pendências (usando o motor de saldo)
4. Execução (saída, atraso, conclusão), cancelamento, fotos, retenção
5. Notificações com outbox, backup diário, dead man's switch, teste de restauração, monitoramento
6. Revisão final:
   - `SECURITY.md` com evidências, `README.md`, `RUNBOOK.md`
   - migração das contas para o e-mail do negócio e do repositório para a organização (bloqueante)
   - deploy em produção liberado só com CI verde

---

## Adendo A — Decisões técnicas posteriores à v5

Prevalecem sobre o texto acima em caso de conflito.

### A1. Multiempresa no banco, uma empresa na tela
Tabela `app.empresas`; saldo, lançamentos, pedidos e RLS sempre por `empresa_id` desde a primeira migration. A interface v1 assume só a Umi San. Adicionar outra empresa no futuro não exige migração do livro-razão.

### A2. Erros de negócio não abortam a transação
Uma exceção no Postgres desfaz tudo o que a função escreveu, inclusive o registro de auditoria. Por isso:
- funções `api.*` retornam erros de negócio como resultado estruturado (`jsonb`: `{"ok": false, "codigo": "LIMITE_EXCEDIDO"}`), e a transação é confirmada com a auditoria da tentativa negada;
- `RAISE` fica reservado para violação de integridade (unique, exclusion constraint, check), que deve desfazer tudo;
- o front traduz `codigo` para mensagem genérica (item 12 da seção 9).

### A3. Checagem de senha vazada garantida no banco
- Cadastro público desligado (`enable_signup = false`); usuários entram só por convite do ADM.
- Senha definida/trocada somente pela Edge Function `definir-senha` (força + HIBP k-anonymity → Admin API).
- Trigger em `auth.users` marca `app.perfis.senha_pendente = true` sempre que `encrypted_password` muda; só `definir-senha` limpa a marca, depois de gravar.
- Toda política e função `api.*` exige `senha_pendente = false`. Troca de senha por fora (`auth.updateUser` direto) deixa o usuário bloqueado até redefinir pelo caminho correto.
- Teste obrigatório: senha trocada direto pelo supabase-js → próxima chamada `api.*` recusada.

### A4. Views com `security_invoker`
Toda view em `api` é criada com `security_invoker = true`, para aplicar o RLS das tabelas de `app` com a identidade de quem consulta. Teste pgTAP varre o catálogo e falha se alguma view de `api` não tiver a opção.

### A5. Teste de restauração em Postgres efêmero
O teste mensal restaura o backup no Supabase local (CLI) dentro do próprio GitHub Actions, sem criar projeto Supabase temporário (limite de projetos do Free; criação por API exige token de gerenciamento). Fotos vêm do R2. Mesmas conferências da seção 10.

### A6. Projetos Supabase
Um único projeto remoto (produção, sa-east-1). CI e desenvolvimento usam o Supabase local. A segunda vaga do plano Free fica livre para restauração de emergência.
