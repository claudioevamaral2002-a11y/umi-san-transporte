# RUNBOOK — IVO Transportes (operação)

Guia passo a passo para o dono do sistema. Não precisa saber programar. Em todos os casos abaixo você usa o site do GitHub, logado na conta dona do repositório.

- Repositório: https://github.com/claudioevamaral2002-a11y/umi-san-transporte
- Aba de workflows: https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions
- Aplicativo (produção): https://umi-san-transporte.pages.dev
- Painel Supabase: https://supabase.com/dashboard
- Painel Cloudflare: https://dash.cloudflare.com

> Regra de ouro: nunca cole links de acesso, senhas ou chaves em conversas, e-mails ou prints. Os links gerados valem por 24 horas (`otp_expiry` no `config.toml`) e só funcionam uma vez.
>
> **Como é o link:** curto, no formato `https://umi-san-transporte.pages.dev/c/K7M2QX9PRT` (10 letras/números, sem 0, O, 1, I nem L). Ao abrir, aparece a tela **Crie sua senha** com o texto "Toque em Continuar para validar seu link de acesso." e o botão **Continuar**. O link só é gasto quando a pessoa toca em **Continuar**: a pré-visualização do WhatsApp/Telegram, o pré-carregamento do navegador e os antivírus de e-mail **não** queimam mais o link. Se aparecer "Este link expirou ou já foi usado. Peça um novo ao administrador.", gere um novo link.

---

## 1. Primeiro acesso do ADM (a primeira pessoa administradora)

Só funciona enquanto ainda não existe nenhum ADM.

1. Abra https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/criar-primeiro-adm.yml
2. Clique em **Run workflow** (botão à direita). Preencha **e-mail** e **nome** do administrador e clique no botão verde **Run workflow**.
3. Aguarde ~1 minuto. Clique na execução que apareceu (a mais recente) e espere o círculo ficar verde.
4. Na página da execução, role até o **resumo** (seção "Convite do primeiro ADM"). Lá está o botão **Abrir link para criar a senha**. O link não aparece nos logs, só no resumo.
5. Clique no link. Abre o aplicativo na tela **Crie sua senha**; toque em **Continuar** (é aqui que o link é usado). No formulário que aparece, escolha uma senha com pelo menos 10 caracteres, com maiúscula, minúscula e número (letras sem acento: A-Z e a-z) e clique em **Criar senha**.
6. O app volta para a tela **Entrar** com o aviso "Senha criada. Entre com a nova senha." Entre com **e-mail e senha** (o CAPTCHA é automático).
7. Em seguida aparece a tela do **2FA**: abra um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, Authy...), leia o QR code e digite o código de 6 dígitos.
8. Pronto. A partir daí o login é e-mail + senha + código do autenticador.

### O link expirou ou foi usado errado
Rode o mesmo workflow de novo (passos 1 a 4) com o mesmo e-mail. Se a senha ainda não foi criada, ele gera um novo link de recuperação. Se o ADM já criou a senha, o workflow recusa (use a tela de login ou o item 4).

---

## 2. O ADM perdeu o 2FA (celular perdido/trocado)

1. Abra https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/resetar-2fa-adm.yml
2. **Run workflow**, informe o **e-mail do ADM** e confirme.
3. Espere ficar verde. O log diz quantos fatores foram removidos (sem dados sensíveis).
4. O ADM entra normalmente com e-mail e senha e o app pede para cadastrar o 2FA de novo (QR code).
5. A ação fica registrada na auditoria (`RESETAR_2FA`).

Se o ADM também esqueceu a senha, veja o item 3 (outro ADM gera o link) ou, sendo o único ADM, use o item 1 só se a senha nunca foi criada. Caso contrário, peça ajuda técnica.

---

## 3. Gerar link de senha para motorista ou cliente

(Também serve para quem esqueceu a senha. Para colegas de uma empresa cliente, o gestor da empresa (N1) faz o mesmo pela tela **Equipe**; ver item 9.)

1. Entre no aplicativo como ADM: https://umi-san-transporte.pages.dev
2. Menu **Usuários**.
3. Para quem ainda não tem conta: botão **Convidar** (no topo da tela), preencha o formulário e clique em **Gerar link de convite**. Para quem já tem conta: na linha da pessoa, clique em **Gerenciar**, depois em **Gerar novo link** e em **Gerar link**.
4. Use **Copiar** ou **Enviar no WhatsApp**. O link vale 24 horas e só funciona uma vez; a pessoa abre e toca em **Continuar** (a prévia do WhatsApp não gasta o link). Gerar um novo link para a mesma pessoa anula o anterior. Sem domínio próprio, o app não envia e-mail: você entrega o link.
5. Para motorista que perdeu o 2FA: na linha da pessoa, **Gerenciar**, depois **Resetar 2FA** (aparece só para quem tem 2FA cadastrado).

---

## 4. Desativar um usuário

1. Aplicativo, menu **Usuários**, linha da pessoa, **Gerenciar**, depois **Desativar**.
2. O bloqueio é imediato. Para voltar atrás, **Gerenciar**, **Reativar** e gere um novo link de senha (a sessão antiga não volta, a pessoa precisa entrar de novo).
3. Não é possível desativar o último ADM ativo.

---

## 5. Onde ficam os segredos (somente nomes; os valores nunca vão para o código)

Local: GitHub, Settings, Environments, **producao** (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/settings/environments) e Settings, Secrets and variables, Actions (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/settings/secrets/actions).

| Nome | Tipo | Onde | Para que serve |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | segredo | ambiente `producao` (hoje pode estar no repositório; ver abaixo) | CLI do Supabase: deploy, e obter a chave de serviço nos workflows manuais |
| `SUPABASE_DB_PASSWORD` | segredo | ambiente `producao` | senha do banco, usada em `db push` |
| `CLOUDFLARE_API_TOKEN` | segredo | ambiente `producao` | publicar no Cloudflare Pages |
| `TURNSTILE_SECRET_KEY` | segredo | ambiente `producao` | segredo do CAPTCHA (vai para o Auth via `config push`) |
| `SUPABASE_PROJECT_REF` | variável | ambiente `producao` | identificador do projeto Supabase |
| `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY` | variáveis | ambiente `producao` | públicas (vão no front) |

**Mover para o ambiente `producao`:** `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` devem ficar só no ambiente `producao` (assim só os workflows que usam esse ambiente os enxergam). O dono faz assim: em Settings, Environments, **producao**, seção *Environment secrets*, **Add environment secret**, cole o valor com o mesmo nome; depois, em Settings, Secrets and variables, Actions, apague o segredo de mesmo nome do nível do repositório. Rode o workflow Deploy de novo para confirmar.

A chave de serviço do Supabase (`service_role`) **não** fica salva no GitHub: os workflows manuais a buscam na hora com o `SUPABASE_ACCESS_TOKEN`, escondem o valor nos logs e a descartam ao fim da execução.

### Como trocar cada segredo
Regra: crie o novo, atualize no GitHub, rode um deploy/teste, e só então revogue o antigo.

- **Supabase access token:** https://supabase.com/dashboard/account/tokens, **Generate new token**, copie. No GitHub, edite o segredo `SUPABASE_ACCESS_TOKEN` e cole. Depois apague o token antigo no Supabase.
- **Senha do banco:** painel Supabase, projeto, Project Settings, Database, **Reset database password**. Copie a nova senha, atualize `SUPABASE_DB_PASSWORD` no ambiente `producao` e rode o workflow Deploy de novo (re-executando a última execução) para confirmar.
- **Token da Cloudflare:** https://dash.cloudflare.com/profile/api-tokens, crie um token novo com a mesma permissão (Cloudflare Pages: Edit), atualize `CLOUDFLARE_API_TOKEN`, confirme com um deploy, depois apague o token antigo (**Roll** também serve).
- **Turnstile (CAPTCHA):** Cloudflare, Turnstile, seu widget, **Rotate secret key**. Atualize `TURNSTILE_SECRET_KEY` e rode o Deploy em seguida (é ele que envia o novo segredo ao Auth). Entre o rotacionar e o deploy, o login pode falhar por alguns minutos: faça fora do horário de uso. A chave de site (`VITE_TURNSTILE_SITE_KEY`) não muda.

---

## 6. Riscos aceitos (resumo)

Detalhes em [docs/fases/fase-1-desenho.md](fases/fase-1-desenho.md), seção 7. Em resumo:

- Sem domínio próprio não há e-mail automático: quem gera o link o entrega manualmente. Isso precisa ser resolvido antes de clientes reais.
- Quem tiver a chave de serviço consegue assumir qualquer conta; por isso ela só existe no ambiente `producao` e as operações de sistema são auditadas.
- O link do primeiro ADM aparece no resumo do GitHub Actions (repositório privado, 24 h, uso único).
- Um ADM pode desativar outro ADM (nunca o último ativo) e pode resetar o 2FA e gerar link de não-ADMs, o que equivale a assumir a conta; tudo auditado.
- O gestor da empresa (cliente N1) gera link de senha para colegas da própria empresa, o que equivale a assumir a conta deles; e pode reativar um colega da própria empresa que o ADM tenha desativado. Tudo auditado; o ADM pode desativar o próprio N1 (ver [fase-1b-desenho-e-plano.md](fases/fase-1b-desenho-e-plano.md), "Revisão de segurança").
- Se o serviço de senhas vazadas (HIBP) estiver fora do ar, definir senha fica bloqueado até voltar.
- A configuração de Auth só muda pelo código (`config.toml`); mudanças feitas no painel seriam sobrescritas no próximo deploy.
- Pedidos (fase 2A): um cliente pode pré-reservar horários do motorista (até 20 pedidos por hora) mesmo sem intenção real; o motorista recusa e o horário volta. Quem trabalha na IVO (ADM, gestor de frota, motorista) recebe em tempo real o número interno e o status de todos os pedidos, sem detalhes. Ver [fase-2a-desenho-e-plano.md](fases/fase-2a-desenho-e-plano.md), "Revisão de segurança e concorrência".

---

## 7. Papéis e níveis (quem é quem)

| Papel | Quem é | 2FA | O que faz |
| --- | --- | --- | --- |
| **ADM** | você (prestador) | obrigatório | tudo: contratos, empresas, usuários, configurações, auditoria; único que altera contratos (e, na fase 2, saldo) |
| **Gestor de frota** | prestador | obrigatório | estrutura pronta para a fase 3 (agenda e distribuição de pedidos); **não vê preços nem saldo** |
| **Motorista** | prestador | obrigatório | menu **Tabela**: preços unitários e prazos do contrato da empresa, para orçar; não vê limites de saldo, versão nem autor |
| **Cliente N1 — Gestor da empresa** | cliente | não | tudo da própria empresa; menu **Equipe** (convida e gerencia colegas da própria empresa) |
| **Cliente N2 — Solicitante** | cliente | não | cria e acompanha os próprios pedidos (fase 2A) |
| **Cliente N3 — Visualizador** | cliente | não | só vê; não age |

Nenhum cliente vê a tabela de preços: todos veem **Regras do serviço** (faixas de cancelamento, prazos, validade, o que é urgente). A antiga "matriz de delegação" (tela Permissões) não existe mais; quem pode o quê depende só do papel e do nível. Para trocar o papel ou o nível de alguém: **Usuários**, **Gerenciar**, **Trocar perfil** (só ADM; ninguém troca o próprio papel).

---

## 8. Contrato por empresa (só o ADM publica)

Cada empresa cliente tem o próprio contrato (preços, faixas de cancelamento, prazos, validade, limiar de urgente, limite de saldo negativo e alerta de saldo baixo), versionado e imutável. A **Tabela modelo** é a base para contratos novos.

1. Menu **Contratos** (https://umi-san-transporte.pages.dev/adm/contratos). A lista mostra a Tabela modelo e cada empresa com a versão vigente (ou **Sem contrato vigente**) e a próxima vigência agendada.
2. Abra a empresa. Botão **Publicar nova versão** (o formulário vem preenchido com o contrato vigente; sem contrato, com a Tabela modelo — **Criar contrato a partir da tabela modelo**).
3. Altere os valores, escolha **Vale a partir de** (agora ou até 1 ano à frente; nunca no passado), confira o resumo das mudanças e **Publicar versão**.
4. A versão anterior continua no histórico e vale até a nova vigência começar. Nada é apagado nem editado depois de publicado: para corrigir, publique outra versão.
5. **Empresa nova:** em **Empresas**, crie a empresa e depois publique o contrato dela (item 2). Sem contrato vigente, o cliente vê "Sua empresa ainda não tem contrato vigente" (na fase 3, "Novo pedido" fica bloqueado).
6. Tudo fica na **Auditoria** (`PUBLICAR_CONTRATO`).

Na passagem para a fase 1B, a tabela única da fase 1 virou **Tabela modelo v1** e **contrato Umi San v1**, com os mesmos valores e o mesmo autor, vigentes desde o deploy.

---

## 9. Equipe da empresa (cliente N1)

O gestor da empresa (N1) cuida dos colegas sem depender do ADM:

1. Menu **Equipe** (https://umi-san-transporte.pages.dev/equipe): só pessoas da própria empresa.
2. **Convidar colega**: nome, e-mail e nível (N1, N2 ou N3). A empresa é sempre a dele (o servidor força) e o perfil é sempre cliente. Entregue o link (copiar ou WhatsApp).
3. Na linha do colega, **Gerenciar**: **Gerar novo link** (senha esquecida ou convite vencido) e **Desativar/Reativar** com motivo. O N1 não age sobre si mesmo, nem sobre motorista/ADM/outra empresa, e não reseta 2FA (cliente não tem 2FA).
4. Limite: 10 convites por dia por pessoa. Tudo fica na auditoria do ADM com o nome do N1.
5. O ADM continua podendo fazer tudo isso pela tela **Usuários** (e é quem cria o primeiro N1 de cada empresa).

---

## 10. Configurações (retenção de fotos)

Menu **Configurações** (https://umi-san-transporte.pages.dev/adm/configuracoes), só ADM: **Fotos guardadas após a entrega** (1 a 3650 dias). Vale para todas as empresas (não faz parte do contrato). A mudança fica na auditoria (`DEFINIR_RETENCAO_FOTOS`). Na passagem para a fase 1B o valor veio da tabela antiga.

---

## 11. Pedidos, orçamentos e agenda (fase 2A)

**Caminho de um pedido:** o cliente pede → o horário fica **pré-reservado** (ninguém mais pega) → o motorista **orça** dentro do prazo → o cliente **pede revisão**, **reprova** ou (fase 2B) **aprova**. Encerrados: **Recusada** (motorista recusou), **Reprovada** (cliente reprovou), **Cancelada**, **Expirada** (prazo vencido). Encerrar libera o horário na hora.

| Quem | O que faz |
| --- | --- |
| **Cliente N1** | cria pedidos; vê, pede revisão, reprova e cancela **todos** os pedidos da empresa |
| **Cliente N2** | cria pedidos; vê e age **só nos próprios**; na agenda os pedidos dos colegas aparecem só como **Ocupado** |
| **Cliente N3** | só vê os pedidos da empresa (sem botões) |
| **Motorista** | **Início**: "Aguardando seu orçamento" com contagem regressiva (**URGENTE** perto do fim); **Orçar**: calculadora com os preços travados do contrato (só informa quantidades: km, reboque, espera, diárias, pedágio, hospedagem, até 5 "Outros" com descrição); pode **Recusar** (com motivo) e **Cancelar** (com motivo); vê só os pedidos atribuídos a ele |
| **ADM** | vê tudo (pedidos e agenda de todas as empresas); pode orçar, recusar e cancelar qualquer pedido aberto |
| **Gestor de frota** | vê a agenda e os pedidos de todos, **sem valores** |

- **Quem atende:** nesta versão, todo pedido novo vai para o **motorista ativo mais antigo**. Sem motorista ativo, o cliente vê "Nenhum motorista disponível no momento".
- **Preço:** sempre do contrato vigente da empresa, calculado no servidor (o aparelho só manda quantidades). O orçamento guarda uma cópia do contrato (o preço não muda se o contrato mudar depois) e uma "impressão digital" (hash) do conteúdo.
- **Revisão:** quando o cliente pede revisão, o pedido volta para o motorista com novo prazo; o **Orçar** já vem preenchido com o orçamento anterior e mostra "Revisão pedida: <motivo>".
- **Tempo real:** as telas atualizam sozinhas quando um pedido muda (cliente: pedidos da empresa; equipe: todos). Se algo parecer parado, puxe para atualizar ou recarregue a página: a tela sempre relê do servidor.

### Prazos e expiração
- **Prazo para orçar** = horas do contrato (ou até o início do serviço, se for antes). **Validade do orçamento** = horas do contrato (ou até o início). Pedir revisão abre um novo prazo para orçar.
- Venceu o prazo: **ninguém consegue mais agir** no pedido (as telas mostram prazo vencido) e o horário **já conta como livre** para outros clientes, mesmo antes do status mudar. Quem pede um horário que colide com uma pré-reserva vencida a encerra na hora.
- O restante é encerrado pelo agendamento **`expirar-vencidos`** (a cada 15 minutos, no banco): vira **Expirada** e aparece na auditoria como `EXPIRAR_VENCIDOS`.

### Um horário parece preso (aparece ocupado e não deveria)
1. Abra a **Agenda** como ADM, toque no dia e no bloco: veja o pedido (número, empresa, status e "pré-reserva até…").
2. Se o pedido ainda está **Solicitado/Orçado dentro do prazo**, o horário está corretamente reservado: o motorista pode **Recusar**, o cliente ou o ADM pode **Cancelar** (o ADM informa o motivo). Isso libera na hora.
3. Se o prazo **já venceu**, o horário já é tratado como livre (novos pedidos entram) e o status vira **Expirada** em até 15 minutos.
4. Se depois de **30 minutos** um pedido com prazo vencido continua **Solicitado/Orçado**, o agendamento pode estar parado: no painel Supabase, *Integrations → Cron*, confira o job `expirar-vencidos` (ativo, execuções recentes com sucesso). Se estiver com erro, anote a mensagem e peça ajuda técnica; enquanto isso, cancele pelo app os pedidos que precisar liberar.
5. **Motorista desativado** com pedidos abertos: os pedidos continuam com ele. Cancele-os como ADM (com motivo) e peça ao cliente para pedir de novo; os novos vão para o motorista ativo mais antigo.

### Mensagens que o cliente/motorista pode ver
- "Esse horário acabou de ser ocupado. Escolha outro." — outra pessoa pegou o mesmo horário segundos antes.
- "O prazo deste pedido venceu." — prazo para orçar ou validade do orçamento venceu.
- "Este pedido mudou de situação. Atualize a página." — alguém agiu antes (ex.: o cliente cancelou enquanto o motorista orçava).
- "O valor calculado passou do limite permitido." — quantidades ou preços absurdos (confira o contrato da empresa).
- "Muitas tentativas seguidas." — limites: 20 pedidos/hora por pessoa, 10 pedidos de revisão/hora, 600 prévias de orçamento/hora.
