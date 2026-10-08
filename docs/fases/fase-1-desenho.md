# Fase 1 — Acesso, perfis, permissões e parâmetros (desenho)

Referência: `docs/especificacao.md` seções 1–3 e 9, Adendos A1–A7. Execução sem Docker local (testes de banco só no CI).

## Objetivo
Pessoas entram com segurança (convite, senha forte não vazada, 2FA para ADM e motorista), cada uma só faz o que o perfil e a matriz permitem — garantido no banco —, a tabela de preços e regras fica versionada e visível a todos, e tudo que importa fica auditado. O app passa a ter a identidade IVO Transportes.

## 0. Pré-requisitos desta fase
1. **Identidade IVO no app** (Adendo A7): nome "IVO Transportes", ícone/splash do kit (`docs/marca/`), paleta e escala tipográfica oficiais, logo SVG no topo. A vitrine `/vitrine` sai do ar ao fim da fase (fica só em desenvolvimento).
2. **Configuração do Auth em produção como código**: `supabase/config.toml` ganha `[remotes.producao]` com as diferenças de produção (site_url do Pages, redirect, segredo do CAPTCHA via env). O deploy passa a rodar `supabase config push` antes das migrations. **Atenção:** o `config push` envia o `config.toml` INTEIRO (não só os overrides de `[remotes.producao]`). Em produção ele altera: captcha Turnstile ligado e obrigatório, JWT 15 min, cadastro público fechado, MFA TOTP, `email_sent` 30/h (sem efeito enquanto não houver SMTP próprio: os links são gerados pelo ADM e não passam pelo envio de e-mail), site_url e redirects do Pages, S3 protocol e vector buckets desligados, schema `api` exposto; `[db.pooler]` e `[db.network_restrictions]` ficam fora (comentados). O captcha passa a ser exigido assim que o `config push` roda, então o PR para `main` deve incluir o front com Turnstile no mesmo merge. O deploy confere project_id x `SUPABASE_PROJECT_REF`, a presença do segredo e mostra `config diff` no log. Com isso o projeto remoto fica igual ao testado: só o schema `api` exposto, JWT 15 min, cadastro fechado, MFA TOTP.
3. **Turnstile**: widget criado pelo usuário no painel Cloudflare (hostnames `umi-san-transporte.pages.dev` e `127.0.0.1`). Chave do site = variável pública; chave secreta = segredo do ambiente `producao`. Local/CI usam as chaves de teste oficiais da Cloudflare (sempre passam).
4. **Edge Functions no deploy**: `supabase functions deploy` no `deploy.yml`.

## 1. Modelo de dados (schema `app`, salvo indicação)

| Tabela | Conteúdo | Regras |
|---|---|---|
| `empresas` | id, nome, logo_caminho (nullable), criada_em | Umi San é a primeira. ADM cria/edita. |
| `perfis` | usuario_id (= auth.users.id), nome, telefone, papel (`ADM`/`MOTORISTA`/`CLIENTE`), empresa_id (obrigatória para CLIENTE, nula para os outros), ativo, senha_pendente, criado_em | 1 por usuário. CHECK papel × empresa. |
| `convites` | id, email, papel, empresa_id, nome, criado_por, criado_em, usado_em | Pré-cadastro que dá origem ao perfil. |
| `permissoes_delegadas` | chave (`MOTORISTA_LANCA_RECARGA`, `MOTORISTA_EDITA_PARAMETROS`, `CLIENTE_ATUA_EM_PEDIDO_DE_OUTRO`), ativo, alterado_por, alterado_em | Tudo desligado por padrão. |
| `parametros_versoes` | versao (serial), vigente_desde, publicado_por, publicado_em, colunas tipadas (abaixo), faixas_cancelamento jsonb | Imutável (só INSERT). |
| `auditoria` | id, em, usuario_id, papel, acao, alvo, resultado (`OK`/`NEGADO`/`ERRO`), codigo, detalhe jsonb, ip, dispositivo | Imutável para todos, inclusive ADM (sem grant + trigger que recusa UPDATE/DELETE/TRUNCATE). |
| `interno.limites` | usuario_id, acao, janela_inicio, contagem | Rate limit (especificação 1.3). |

**Parâmetros (colunas tipadas, dinheiro em centavos, percentuais em pontos-base inteiros):**
- Veículo próprio: `km_sem_reboque_cent`, `km_com_reboque_cent`, `taxa_fixa_reboque_cent`, `retorno_trecho_unico_bp`, `hora_espera_cent`, `hospedagem_diaria_cent`
- Veículo da Umi San: `diaria_motorista_cent`, `hospedagem_diaria_cent` (compartilhada)
- Comuns: `faixas_cancelamento` (lista de {antecedencia_min_horas, multa_bp}, padrão >24h 0%, 24–6h 50%, <6h 100%; validada por função: ordenada, sem buracos, 0–10000 bp), `prazo_orcar_horas` (12), `validade_orcamento_horas` (24), `limiar_urgente_horas` (6), `limite_saldo_negativo_cent`, `alerta_saldo_baixo_cent`, `retencao_fotos_dias` (30)
- CHECKs: todos ≥ 0; prazos > 0.
- Vigente = maior `vigente_desde` ≤ agora. Publicar exige `vigente_desde` ≥ agora (não reescreve o passado).
- Enquanto não houver nenhuma versão publicada, o app mostra "Tabela ainda não publicada" (orçar fica bloqueado na fase 3).

## 2. Regras de acesso (no banco)

- `app.pode_acessar()` (e `app.pode_fazer(acao)` para a matriz) — `SECURITY DEFINER`, devolve o perfil do `auth.uid()` e **recusa** (retorna nulo) quem: não tem perfil, está inativo, tem `senha_pendente`, ou é ADM/MOTORISTA sem `aal2` no JWT. Toda política RLS e toda RPC passa por ela.
- `app.pode_fazer(acao text) → boolean` — única fonte de "quem pode o quê": lê papel + matriz. Exemplos: `EDITAR_PARAMETROS` = ADM ou (MOTORISTA e `MOTORISTA_EDITA_PARAMETROS`); `GERIR_USUARIOS` = ADM.
- RPCs `api.*` devolvem `jsonb {ok, codigo, ...}`; negação e excesso de limite são auditados e a transação é confirmada (Adendo A2). Integridade (unique/check) continua com `RAISE`.
- Views `api.*` são `security_invoker` sobre tabelas com RLS:
  - `api.meu_perfil()` (função) — o próprio perfil + nome/logo da empresa.
  - `api.listar_usuarios()` (função) — ADM vê todos; demais não veem nada.
  - `api.empresas` — ADM vê todas; cliente vê a própria; motorista vê todas (nome/logo).
  - `api.permissoes` — todos leem (transparência, especificação 2); só ADM altera.
  - `api.parametros_vigentes` e `api.parametros_historico` — todos leem.
  - `api.listar_auditoria()` (função) — só ADM.
- Logo do cliente: bucket privado `logos` (PNG/WebP, ≤ 500 KB, limite do bucket); escrita só ADM; leitura por usuários da própria empresa e pela equipe (ADM/motorista), por URL assinada curta.

## 3. Entrada no app

**Convite (ADM):**
1. Tela Usuários → "Convidar": nome, e-mail, perfil (e empresa, se cliente).
2. Edge Function `convidar` (exige ADM com aal2): chama `api.preparar_convite` com o JWT do ADM (checa permissão, limite 10/dia, audita, cria `convites`), depois gera pela Admin API um link do tipo convite.
3. Trigger em `auth.users` (insert) cria o perfil a partir do convite pendente com `senha_pendente = true`. Usuário criado sem convite não ganha perfil → não acessa nada.
4. O app mostra o link (24 h, uso único) com botão "Copiar" e "Enviar no WhatsApp". **Sem domínio próprio, não há e-mail automático** (desvio temporário registrado; vira e-mail quando houver domínio).

**Definir senha** (`/definir-senha`, aberta pelo link): a pessoa digita a senha → Edge Function `definir-senha` valida força (≥ 10, maiúscula, minúscula, número) e HIBP por k-anonimato (só os 5 primeiros caracteres do SHA-1 saem; cabeçalho de padding) → grava pela Admin API → limpa `senha_pendente`. Trigger em `auth.users` (update de senha) remarca `senha_pendente` em qualquer troca feita por fora (Adendo A3).

**2FA (ADM e motorista):** depois da senha, tela de cadastro com QR code (TOTP) e confirmação de 6 dígitos. Em todo login, pede o código. Sem `aal2`, o banco recusa tudo — a tela só guia.

**Login** (`/entrar`): e-mail + senha + Turnstile (CAPTCHA nativo do Supabase Auth). Erros genéricos ("E-mail ou senha incorretos").

**Sessão:** JWT 15 min com renovação automática; "Sair" revoga o refresh token.

**Situações especiais:**
- Desativar usuário: `perfis.ativo = false` (efeito imediato no banco) + bloqueio na Admin API (impede renovar sessão).
- Esqueceu a senha: ADM gera novo link (tipo recuperação) na tela Usuários.
- Perdeu o 2FA: ADM remove o fator (Edge Function `gerir-usuario`, ação `RESETAR_2FA`, auditado). Se o ADM perder o próprio: workflow manual no GitHub `resetar-2fa-adm` (só o dono do repositório dispara), documentado no RUNBOOK.
- **Primeiro ADM:** workflow manual `criar-primeiro-adm` (entrada: e-mail e nome) — só funciona se ainda não existir ADM; o link sai no resumo da execução (visível só a quem tem acesso ao repositório).

## 4. Telas (identidade IVO)

| Rota | Quem | Conteúdo |
|---|---|---|
| `/entrar` | todos | login (mockup aprovado) |
| `/definir-senha` | via link | nova senha com medidor de força e checagem de vazamento |
| `/seguranca/2fa` | ADM, motorista | cadastro do autenticador (mockup aprovado) |
| `/` | todos | início provisório por perfil: saudação, pendências (vazio por enquanto), atalhos; cliente com logo da empresa no canto superior direito |
| `/parametros` | todos | "Tabela de preços e regras": vigente + histórico; editar só para quem `pode_fazer('EDITAR_PARAMETROS')` (formulário publica nova versão com data de vigência) |
| `/adm/usuarios` | ADM | lista, convidar, gerar link, desativar/reativar, trocar perfil, resetar 2FA |
| `/adm/empresas` | ADM | nome e logo das empresas clientes |
| `/adm/permissoes` | ADM | as 3 chaves da matriz, com confirmação e motivo |
| `/adm/auditoria` | ADM | lista filtrável (data, usuário, ação, resultado) |

Guardas de rota no front só para experiência; a proteção real é o banco.

## 5. Testes (CI — bloqueiam o deploy)

**pgTAP**
- guarda de privilégios da fase 0 continua verde com as novas tabelas
- auditoria: UPDATE/DELETE/TRUNCATE recusados até para `postgres` via trigger (exceto migração explícita futura documentada)
- parâmetros: publicar cria versão nova; anterior intacta; faixas inválidas recusadas; `vigente_desde` no passado recusado
- `pode_acessar()` nulo para: sem perfil, inativo, `senha_pendente`, ADM/motorista em aal1
- trigger de convite: usuário sem convite não ganha perfil

**Integração (supabase-js contra o Supabase do CI)**
- cliente não altera parâmetros, matriz, usuários, empresas, auditoria
- motorista não publica parâmetros sem delegação; publica quando ADM liga `MOTORISTA_EDITA_PARAMETROS`; desligar volta a bloquear
- motorista nunca altera a matriz nem usuários
- ninguém edita/apaga auditoria (inclusive ADM)
- cliente A não vê perfil de cliente B; vê a própria empresa; não chama `api.listar_usuarios()` nem `api.listar_auditoria()`
- ADM/motorista sem aal2 recusados; com TOTP verificado, liberados
- usuário desativado recusado na chamada seguinte
- senha trocada por fora (`auth.updateUser`) → próxima chamada `api.*` recusada (Adendo A3)
- `definir-senha` recusa senha curta, sem maiúscula/número e senha conhecida vazada (ex.: `Password123`)
- rate limit: 11º convite no dia recusado e auditado
- tentativa negada aparece na auditoria com resultado `NEGADO`
- logo: cliente não grava no bucket; cliente de outra empresa não lê o logo

**E2E (Playwright, contra o Supabase do CI com chaves de teste do Turnstile)**
- ADM semeado → convida motorista → abre o link → define senha → cadastra 2FA (código TOTP calculado no teste) → entra → vê início de motorista
- cliente convidado entra sem 2FA e vê o logo da empresa
- motorista não vê o menu ADM e, se forçar a URL, a tela mostra "sem permissão" (e o banco recusa)
- zero violações de CSP com o Turnstile carregado

## 6. Fora desta fase
Saldo (fase 2); pedidos, agenda/calendário e Realtime real de pedidos (fase 3 — a prova de Realtime da fase 0 permanece até lá); notificações e e-mail (fase 5; a mudança de parâmetros/matriz já fica auditada e passa a notificar na fase 5); upload validado por conteúdo real (fase 4 — logos aceitam só PNG/WebP por tipo declarado, escrita restrita ao ADM, exibição via `<img>`).

## 7. Riscos e decisões registradas
- **Sem domínio**: links copiados pelo ADM substituem e-mail; "confirmação de e-mail" vira confirmação de posse do link. Bloqueante antes de clientes reais em produção.
- **Link de recuperação = acesso à conta**: se um CLIENTE recarregar a página depois de abrir um link de recuperação, ele fica logado sem ter definido a senha. Aceito: o link é a credencial (24 h, uso único, entregue pelo ADM).
- **`config push`** pode sobrescrever ajustes feitos no painel — por isso nenhuma configuração de Auth é feita no painel daqui em diante (especificação 11).
- **Primeiro ADM** via workflow: o link aparece no resumo do GitHub Actions (repositório privado, só o dono vê); uso único, 24 h.
- **Risco residual — chave de serviço**: quem detém a `service_role` (Edge Functions, segredos do GitHub) pode assumir qualquer conta pela Admin API. Mitigação: segredos só no environment `producao` e auditoria das operações de sistema (`detalhe.origem = sistema`).
- **Riscos aceitos das Edge Functions (Task 7)**: (a) ADM pode desativar outro ADM (exceto o último ativo); (b) ADM pode resetar o 2FA e gerar link de recuperação de não-ADMs, o que equivale a assumir a conta — sempre auditado (ADMs não são alvo); (c) pedidos sem cabeçalho Origin são aceitos (o Bearer continua obrigatório; CORS só protege navegadores); (d) o limite em memória das funções é apenas auxiliar — o controle são os limites no banco; (e) se o HIBP estiver fora, definir senha fica bloqueado (falha fechada); (f) a troca de senha encerra a sessão corrente e a reativação não ressuscita a sessão antiga: o front exige novo login.
- **Merge da fase 1 inteiro de uma vez (backend + front com Turnstile)**: o captcha é exigido no Auth assim que o `config push` roda; front sem o widget ficaria sem login.
