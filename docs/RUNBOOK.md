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
| `GOOGLE_MAPS_CHAVE_SERVIDOR` | segredo | ambiente `producao` (o Deploy copia para o Supabase) | busca de endereços e rota (fase 3A). Ver item 16 |
| `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR` | variável (ou segredo) | ambiente `producao` | blocos do mapa no "Marcar no mapa" (fase 3A; restrita ao domínio). Ver item 16 |

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
- Endereços (fase 3A): pelos termos do Google, de um ponto do Google o app guarda só o código do local (place_id); os km são calculados na hora. Os locais da empresa são gravados a partir dos pedidos; quem cria o pedido informa nome e ponto, e o primeiro registro de um local vale para a empresa toda. Um usuário mal-intencionado da própria empresa poderia gravar primeiro um nome ou ponto errado para um local; o efeito fica na mesma empresa e não mexe em dinheiro (a prévia é estimativa e o motorista confere os km). O custo do Google tem teto diário por empresa e por pessoa (item 16.4).
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

---

## 12. Saldo e dinheiro (fase 2B)

Cada empresa cliente tem **uma conta** com um **livro-razão**: a lista de todos os lançamentos (recarga, ajuste, estorno, reserva, liberação de reserva, multa e, na fase 3, débito do serviço). **Nada é editado nem apagado**: o banco recusa qualquer alteração de lançamento, inclusive do ADM. O saldo é sempre a soma do livro-razão.

- **Saldo total (contábil)** = soma de recargas, ajustes, estornos, multas e débitos.
- **Reservado** = soma das reservas ativas (pedidos aprovados e ainda não realizados). A reserva **não** muda o total; só deixa de estar disponível.
- **Disponível** = total − reservado. Pode ficar negativo até o **limite de crédito** do contrato vigente da empresa.
- **Alerta de saldo baixo** (do contrato): abaixo dele, o cartão de saldo fica laranja para o ADM e para o cliente ("Fale com a IVO Transportes para recarregar") e o painel conta a empresa em pendências.
- **Quem vê:** o ADM vê todas as empresas; os clientes (N1, N2 e N3) veem o saldo, o limite de crédito e o extrato **da própria empresa**. Motorista e gestor de frota **não veem saldo**. Só o ADM lança dinheiro; nenhum cliente altera saldo.

### Operações do ADM (Créditos)
Menu **Créditos** (https://umi-san-transporte.pages.dev/adm/creditos): uma linha por empresa com disponível, reservado, limite e alerta. Abra a empresa:

1. **Recarga** (o cliente pagou): valor em reais (ex.: `2.000,00`), **motivo** obrigatório (3 a 500 caracteres, ex.: "Pix recebido em 09/10") e **comprovante** opcional (ID do Pix ou observação, até 200 caracteres). Confira o resumo (saldo antes → depois) e **Confirmar recarga**.
2. **Ajuste** (correção ou cortesia): escolha **Crédito** (aumenta) ou **Débito** (diminui), valor e **motivo** obrigatório. **Confirmar ajuste**.
3. **Estorno** (desfazer um lançamento): no **Extrato** da empresa, na linha do lançamento, **Estornar**, informe o **motivo** e **Confirmar estorno**. O estorno cria um lançamento novo com o valor **oposto** exato; o original continua no extrato. Só recarga, ajuste, multa, débito e aditivo podem ser estornados, e **uma única vez** ("Este lançamento já tinha sido estornado."). Reserva e liberação não se estornam: são desfeitas cancelando o pedido.

Garantias: o resultado só aparece **depois** que o servidor confirma (nada otimista). Se a internet cair no meio, toque em **Tentar de novo**: a operação leva uma chave única e **nunca é lançada duas vezes**. Valores acima de R$ 1 bilhão são recusados. Tudo fica na **Auditoria** (`LANCAR_RECARGA`, `LANCAR_AJUSTE`, `ESTORNAR_LANCAMENTO`) com o nome de quem fez e o motivo.

### Aprovação do orçamento (cliente)
- Quem aprova: o **N2 dono do pedido** ou o **N1** da empresa (N3 não age). No pedido orçado, **Aprovar** abre o recibo (memorial, total, saldo depois da aprovação) → **Confirmar aprovação**.
- O servidor confere, numa única operação: orçamento ainda **válido** (pelo relógio do servidor); **versão e impressão digital** do orçamento que a pessoa viu (se o motorista reenviou nesse meio tempo, a tela pede para conferir de novo); **horário** ainda livre; e **crédito**: disponível − total ≥ −limite. Sem crédito aparece "Saldo insuficiente para aprovar este orçamento." com quanto falta.
- Aprovado: o valor vai para **Reservado** (extrato: **Reserva**), o pedido vira **Agendado** e o horário fica reservado. A aprovação fica registrada (quem, quando, IP, aparelho, versão e impressão digital do orçamento). Dez cliques ou aparelhos ao mesmo tempo resultam em **uma** aprovação só.

### Cancelamento de um pedido agendado
- **Cliente (N2 dono ou N1):** **Cancelar agendamento** mostra, **antes de confirmar**, a multa pela faixa de cancelamento do contrato **gravado no orçamento** (mudanças posteriores no contrato não afetam). Confirmado, o extrato mostra **Liberação de reserva** (o reservado volta a ficar disponível) e, se houver, **Multa de cancelamento** (sai do total). Se o horário passar para outra faixa enquanto a pessoa decide, nada é feito e a tela mostra o valor novo para confirmar de novo ("A multa mudou…").
- **Motorista atribuído ou ADM:** cancela **sem custo** para o cliente, com **motivo obrigatório**; só a liberação da reserva aparece no extrato.
- Quer devolver uma multa ao cliente? **Estorne** a multa no extrato (item 3 acima), com motivo.
- Cancelamentos simultâneos (cliente e motorista ao mesmo tempo): só um vale; o outro vê "Este pedido mudou de situação. Atualize a página."

### Extrato
Cliente: menu **Extrato** (https://umi-san-transporte.pages.dev/extrato). ADM: **Créditos** → empresa → **Extrato**. Filtros de período (Este mês, Últimos 7 dias, Últimos 30 dias, Mês passado ou Escolher datas) e de tipo; exportar **CSV** ou **PDF** (impressão). Cada linha: data, tipo, valor, número do pedido e quem pediu; o pedido só abre para quem pode vê-lo (um N2 vê a reserva do colega no extrato, mas não abre o pedido dele).

---

## 13. Divergência de saldo (reconciliação diária)

Todo dia às **03:00** (horário de Brasília; job `reconciliar-saldos` no banco, `0 6 * * *` em UTC) o banco **refaz todas as contas a partir do livro-razão** e confere as regras do dinheiro. O resultado aparece no **Painel** do ADM (https://umi-san-transporte.pages.dev/adm/painel, também no **Início** do ADM), bloco **Última reconciliação**: data/hora, quantas empresas foram conferidas e **Tudo confere** ou **N divergências** com a lista (tipo, empresa e, quando houver, **ver pedido**). Uma reconciliação com divergência também entra na **Auditoria** como `RECONCILIAR_SALDOS` com resultado `ERRO` (`DIVERGENCIA_SALDO`). Antes da primeira execução o bloco diz "Ainda não houve reconciliação (roda todo dia às 03:00)".

### O que cada divergência quer dizer
| No painel | Código | Significa |
| --- | --- | --- |
| Saldo da conta diferente do livro-razão | `CONTA_DIVERGENTE` | o total ou o reservado guardado na conta não bate com a soma dos lançamentos/reservas |
| Reserva ativa em pedido que não está agendado | `RESERVA_FORA_DE_AGENDADA` | o pedido saiu de Agendado, mas a reserva não foi liberada |
| Pedido agendado sem reserva | `AGENDADA_SEM_RESERVA` | pedido Agendado sem dinheiro reservado |
| Pedido agendado sem aprovação registrada | `AGENDADA_SEM_APROVACAO` | pedido Agendado sem o registro da aprovação do orçamento aprovado |
| Reserva sem o lançamento de reserva/liberação correspondente | `RESERVA_SEM_PAR` | a reserva não tem exatamente um lançamento **Reserva** (e uma **Liberação**, se já liberada) |
| Lançamento de reserva com valor diferente da reserva | `RESERVA_VALOR_DIVERGENTE` | o valor reservado no extrato difere do valor da reserva |
| Lançamento ou reserva ligado a pedido de outra empresa | `EMPRESA_DIVERGENTE` | um lançamento ou reserva aponta para pedido/reserva de outra empresa |
| Estorno que não é o inverso exato do lançamento original | `ESTORNO_DIVERGENTE` | estorno com valor diferente de −original, de outra empresa ou de tipo não estornável |
| Cobrança sem aprovação registrada | `COBRANCA_SEM_APROVACAO` | multa/débito sem a aprovação do mesmo orçamento |
| Cobrança duplicada no mesmo pedido | `COBRANCA_DUPLICADA` | mais de uma multa (ou mais de um débito) no mesmo pedido |

As travas do banco impedem todas essas situações; uma divergência indica falha técnica ou mexida manual no banco.

### Passo a passo
1. **Não edite saldo nem lançamento** — nem pelo app, nem pelo painel Supabase. O banco recusa, e qualquer tentativa por fora (SQL manual) piora a situação e apaga a pista do que aconteceu.
2. **Anote** a data/hora da reconciliação, o tipo, a empresa e o número do pedido (print do bloco, sem links).
3. **Veja o livro-razão pelo app:** **Créditos** → empresa → **Extrato** (período que cobre o problema, todos os tipos); abra o pedido em **ver pedido** e confira a linha do tempo e o histórico. Na **Auditoria**, veja as ações do período (`APROVAR_ORCAMENTO`, `CANCELAR_AGENDADO`, `LANCAR_RECARGA`, `LANCAR_AJUSTE`, `ESTORNAR_LANCAMENTO`).
4. **Se precisar ver mais (técnico):** no painel Supabase, *SQL Editor*, apenas **consultas de leitura**, por exemplo:
   ```sql
   select criado_em, tipo, valor_cent, atividade_id, reserva_id, estorna_id, motivo
     from app.lancamentos where empresa_id = '<id da empresa>' order by criado_em, id;
   select * from app.contas where empresa_id = '<id da empresa>';
   select em, ok, empresas, divergencias from app.reconciliacoes order by em desc limit 5;
   ```
   Nunca rode `update`, `delete` ou `insert` nessas tabelas.
5. **Corrija só pelo app, com motivo:** se o cliente ficou com valor a mais ou a menos, lance um **Ajuste** (crédito ou débito) com motivo citando a reconciliação (ex.: "Correção da divergência de 10/10, pedido #0012"); se um lançamento estava errado, **estorne-o** com motivo. Se a divergência é de pedido (reserva/agendado), **cancele o pedido** como ADM (sem custo, com motivo) e peça ao cliente para pedir de novo.
6. **Confira no dia seguinte:** a próxima reconciliação (03:00) deve voltar a **Tudo confere**. Se `CONTA_DIVERGENTE` persistir com o extrato correto, é falha técnica: não lance mais ajustes e peça ajuda técnica com as anotações do passo 2.
7. **O job parou?** Se a última reconciliação tiver mais de 1 dia, veja no painel Supabase, *Integrations → Cron*, o job `reconciliar-saldos` (ativo, execuções com *succeeded*).

---

## 14. Tempo real (o que atualiza sozinho)

As telas assinam **tópicos privados**; o banco decide quem pode assinar cada um. A mensagem só diz "mudou" (número, status, horário): a tela sempre relê os dados do servidor com as permissões de quem está vendo.

| Tópico | Quem assina | Quando chega |
| --- | --- | --- |
| `atividade:<id do pedido>` | quem pode ver aquele pedido | o status do pedido mudou (detalhe do pedido) |
| `empresa:<id da empresa>` | clientes da empresa (N1, N2, N3) e a equipe (ADM, gestor de frota, motorista) | um pedido da empresa mudou (listas, início, agenda) |
| `equipe` | ADM, gestor de frota e motorista | qualquer pedido de qualquer empresa mudou (só número interno, empresa e status) |
| `saldo:<id da empresa>` | ADM e clientes da empresa (nunca motorista nem gestor de frota) | entrou um lançamento (cartão de saldo e extrato) |
| `rastreio:<id do pedido>` (fase 3B) | quem pediu, o N1 da empresa, o ADM, o gestor de frota e o motorista da viagem (nunca o N3 nem outro N2) | posição do motorista a cada ~5 s durante a viagem (esta mensagem leva a posição: lat, lng, chegada prevista) |

Se uma tela parecer parada, puxe para atualizar ou recarregue: nada depende só do tempo real.

## 15. Quando o app pede o código do 2FA (e quando pede a senha)

- **Código do autenticador:** só num **login novo** (senha digitada) de ADM, gestor de frota ou motorista. Recarregar, fechar e reabrir o app, abrir outra aba ou ficar horas sem usar **não** pede o código: depois do 2FA a sessão fica verificada (aal2) no servidor e cada renovação do token (a cada 15 min de uso) continua aal2.
- Se o aparelho ficou com um token de antes do 2FA (por exemplo, o app foi fechado enquanto a pessoa copiava o código no autenticador), o app renova uma vez ao abrir e, se o servidor já tinha confirmado o código, vai direto ao Início.
- **Senha de novo** (e depois o código): só quando a sessão acaba no Supabase, o que é do próprio Supabase e não do app: **Sair**, conta desativada, 2FA resetado, ou o mesmo token de renovação usado duas vezes com mais de 10 s de diferença (`refresh_token_reuse_interval`; acontece se duas cópias do app, como o app instalado e uma aba do navegador, renovarem ao mesmo tempo depois de muito tempo fechadas). Não há limite de duração nem de inatividade configurado (`[auth.sessions]` vazio no `supabase/config.toml`).

---

## 16. Google Maps (fase 3A: endereços, distância e mapa)

O app usa o Google para três coisas: **sugerir endereços** (Places API New), **calcular os km da rota** (Routes API) e **mostrar o mapa** do "Marcar no mapa" (Map Tiles API). São **duas chaves**:

| Chave | Onde fica | Pode o quê |
| --- | --- | --- |
| **Chave de servidor** | segredo `GOOGLE_MAPS_CHAVE_SERVIDOR` do ambiente `producao` (o Deploy copia para o Supabase) | só Places API (New) e Routes API. Nunca vai para o navegador |
| **Chave de navegador** | variável `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR` do ambiente `producao` | só Map Tiles API, e só a partir de `https://umi-san-transporte.pages.dev/*`. Vai no app (é pública por natureza; a restrição é o que a protege) |

**Nunca cole uma chave no chat, em e-mail ou no código.** Sem as chaves o app continua funcionando: os campos de origem e destino aceitam texto livre, com o aviso "Não foi possível buscar endereços agora…", e o motorista informa os km como sempre.

### 16.1 Criar o projeto e o faturamento (uma vez)

1. Entre em https://console.cloud.google.com com a conta do negócio.
2. No topo, clique no seletor de projeto, depois **Novo projeto**. Nome: `ivo-transportes-mapas`. Clique em **Criar** e, quando terminar, selecione esse projeto no seletor.
3. Menu (☰), **Faturamento**. Vincule uma conta de faturamento (cartão da empresa). O Google pede o faturamento mesmo dentro da cota gratuita.
4. Ainda em **Faturamento**, **Orçamentos e alertas**, **Criar orçamento**:
   - Escopo: o projeto `ivo-transportes-mapas`;
   - Valor: **R$ 50** por mês;
   - Alertas em 50%, 90% e 100%, por e-mail para os administradores.

   O alerta avisa; quem freia de verdade é o teto diário por empresa do app (16.4).

### 16.2 Ativar as três APIs

Menu (☰), **APIs e serviços**, **Biblioteca**. Procure e clique em **Ativar** em cada uma:
1. **Places API (New)** (atenção: a "New", não a antiga "Places API");
2. **Routes API**;
3. **Map Tiles API**.

### 16.3 Criar as chaves e cadastrar no GitHub

**Chave de servidor**
1. **APIs e serviços**, **Credenciais**, **Criar credenciais**, **Chave de API**. Copie a chave **só para a área de transferência** (não salve em arquivo).
2. Clique em **Editar chave** (ou no nome dela). Nome: `servidor-enderecos`.
3. **Restrições de aplicativo:** *Nenhuma* (quem chama é o servidor do Supabase, sem endereço fixo).
4. **Restrições de API:** *Restringir chave*, marque **Places API (New)** e **Routes API**. **Salvar**.
5. No GitHub: https://github.com/claudioevamaral2002-a11y/umi-san-transporte/settings/environments, **producao**, seção *Environment secrets*, **Add environment secret**. Nome: `GOOGLE_MAPS_CHAVE_SERVIDOR`. Cole a chave. **Add secret**.

**Chave de navegador**
1. **Credenciais**, **Criar credenciais**, **Chave de API**. Copie.
2. **Editar chave**. Nome: `navegador-mapa`.
3. **Restrições de aplicativo:** *Sites (referenciadores HTTP)*, adicione `https://umi-san-transporte.pages.dev/*`.
4. **Restrições de API:** *Restringir chave*, marque só **Map Tiles API**. **Salvar**.
5. No GitHub, ambiente **producao**, seção *Environment variables*, **Add environment variable**. Nome: `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR`. Cole a chave. **Add variable**.

**Publicar:** GitHub, **Actions**, workflow **Deploy**, última execução da `main`, **Re-run all jobs**. No log do passo *Configuração do Auth, migrations e Edge Functions*, confira que o comando `supabase secrets set --env-file` rodou sem erro (a chave de servidor foi para o Supabase). Se aparecer "GOOGLE_MAPS_CHAVE_SERVIDOR ausente", o segredo não foi achado: confira o nome e se está no ambiente `producao`.

**Conferir:** no app, um N2 abre **Novo pedido**, passo **Onde?**, e digita "porto itaj": aparecem sugestões do Google. Escolha origem e destino: aparece "NN km pela rota". Em **Não achou? Marcar no mapa** o mapa aparece com o pino.

### 16.4 Teto diário por empresa

Configurações (ADM), cartão **Busca de endereços**: quantas chamadas ao Google cada empresa pode fazer por dia (padrão **2.000**). Cada pessoa também tem um limite próprio de 500 por dia e de 60 sugestões por minuto. Acima disso, o campo cai no texto livre até o dia seguinte (fuso de São Paulo). Custo esperado e cotas gratuitas: [fase-3a-desenho-enderecos-previa.md](fases/fase-3a-desenho-enderecos-previa.md), §6.1.

### 16.5 Trocar uma chave (vazou ou foi exposta)

1. Crie uma chave nova com as **mesmas restrições** (16.3).
2. Atualize o segredo ou a variável no GitHub (mesmo nome) e rode o **Deploy** (Re-run).
3. Confira no app (16.3, "Conferir").
4. Só então, no Google Cloud, **Credenciais**, apague a chave antiga.

### 16.6 Problemas comuns

- **Sugestões nunca aparecem, sempre o aviso:** chave de servidor ausente ou com a API errada (precisa ser a *Places API (New)*), faturamento desativado, ou teto diário atingido (veja o cartão em Configurações e a Auditoria, ação `USO_MAPAS`).
- **Sugestões aparecem, mas não os km:** a Routes API não está ativada ou não está na restrição da chave de servidor.
- **"O mapa não está disponível agora":** a variável `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR` falta (precisa de novo Deploy depois de criar), a Map Tiles API não está ativada, ou o referenciador não é exatamente `https://umi-san-transporte.pages.dev/*`.

## 17. Execução da viagem e rastreio (fase 3B)

**Fluxo:** pedido agendado → o motorista **desliza para sair** (a partir de 1 h antes do início) → viagem em andamento, com a posição para o cliente → **Concluir serviço** (fotos e observação) → resumo.

### Dinheiro
- **A saída cobra.** Numa só operação, a reserva é liberada e entra o **débito** do valor aprovado. O disponível da empresa não muda, porque o valor já estava reservado.
- Depois da saída **não há cancelamento**. Uma correção só sai por **estorno** do débito em Créditos, com motivo.
- **A conclusão não cobra nada.**
- A reconciliação das 03:00 confere que reserva ativa só existe em pedido agendado e que todo débito aponta para a aprovação do mesmo orçamento.

### Localização do motorista
- Só durante a viagem e só com o app aberto e a tela acesa. Com a tela apagada ou outro app na frente, o envio para (limite do PWA, principalmente no iPhone). O cliente vê "Sinal do motorista perdido" e o carro cinza.
- O navegador precisa da permissão de localização. Se a pessoa negou: ajustes do navegador › site umi-san-transporte.pages.dev › Localização › Permitir. A viagem funciona sem GPS; o cliente vê só o status.
- **Retenção:** as posições são apagadas na conclusão. Fica só o resumo: saída, chegada e km rodados (aproximado, pelo GPS). Uma viagem esquecida em andamento tem as posições apagadas depois de 48 h (cron `limpar-posicoes`, de hora em hora).
- **Chegada prevista:** calculada pelo celular do motorista com a rota do Google, no máximo **12 vezes por viagem** (na saída, a cada 10 min e ao trocar de destino na ida e volta).

### Atraso
- **Nova previsão:** o motorista informa a nova hora de término. A agenda se estende até ela, sem passar do início do próximo serviço.
- **Quando colide com o próximo pedido:** o cliente desse pedido vê "O motorista está terminando outro serviço" no detalhe e nas pendências. E-mail e push só na fase 5.
- **Viagem que passou da previsão** e continua em andamento: aparece como **atrasada** para o motorista e para o ADM (Painel › Corridas).

### Fotos
- Até **10 por serviço**, durante a viagem ou até 24 h depois de concluir. São reduzidas no celular e conferidas pelo servidor: tipo real JPEG, PNG ou WebP, até 5 MB.
- Ficam no bucket privado `fotos` e só abrem por link temporário, para quem pode ver o pedido.
- **Nenhuma foto é apagada nesta fase.** A retenção de Configurações passa a valer na fase 5, junto com o envio por e-mail. Acompanhe o uso do Storage no painel do Supabase (plano gratuito: 1 GB).

### Problemas comuns
| Sintoma | O que fazer |
| --- | --- |
| "Ainda é cedo para sair" | A saída libera 1 h antes do início. Espere ou peça ao cliente para mudar o horário. |
| "Você tem outro serviço em andamento" | Conclua o serviço anterior antes de sair para o próximo. |
| O cliente não vê o mapa | Confira se é quem fez o pedido ou o N1 (o N3 não vê). Sem as chaves do Google, aparece "o mapa não está disponível", mas o sinal e a chegada continuam. |
| Saiu por engano | Não há como desfazer a saída pelo app. O ADM estorna o débito em Créditos (com motivo), e o motorista conclui o pedido com uma observação explicando. |
## 18. App novo (fase 4)

O **IVO novo** é a interface no estilo Uber (mapa na frente, categorias, calculadora de contraproposta, painel da empresa). Ele usa o **mesmo banco** do app atual. Roteiro de teste: [fase-4-o-que-testar.md](fases/fase-4-o-que-testar.md). Desenho: [fase-4-ivo-estilo-uber-desenho.md](fases/fase-4-ivo-estilo-uber-desenho.md).

### 18.1 Os dois sites e como são publicados
| Site | Endereço | Projeto no Cloudflare Pages |
| --- | --- | --- |
| App atual | https://umi-san-transporte.pages.dev | `umi-san-transporte` |
| App novo (teste) | https://ivo-novo.pages.dev | `ivo-novo` |

- Os dois saem **do mesmo commit da `main`**, no mesmo workflow **Deploy**: primeiro o app atual, depois o novo. O banco e as funções sobem uma vez só, antes dos dois.
- Cada um é um PWA à parte: instala em separado e guarda a própria versão no celular. O app atual **não muda**.
- **Deploy vermelho:** abra a execução e veja **qual passo falhou**. Se foram só os passos do "IVO novo" (build, publicar ou verificar a CSP), o app atual **já foi publicado** e está no ar; só o site novo ficou para trás. Rode **Re-run failed jobs**.

### 18.2 Categorias e preços
- As categorias são **IVO Passageiros**, **IVO Carga Leve** e **IVO Carga Pesada**. Cada uma tem o seu preço por km (a Carga Pesada também tem a taxa fixa do reboque).
- **Preço por categoria muda pelo app novo:** entre em https://ivo-novo.pages.dev como Master (ADM), menu ☰ › **Categorias e preços**, ajuste e toque em **Publicar nova versão**. Cria uma versão nova do contrato, imutável como sempre.
- Publicar pela tela **Contratos do app atual** também pode: a versão nova **herda** os preços por categoria da versão anterior da mesma empresa (ou do modelo). Para **mudar** o preço de uma categoria, use o app novo.
- Contratos antigos, sem preço por categoria, não mudam de valor: Passageiros e Carga Leve usam o km sem reboque; Carga Pesada usa o km com reboque mais a taxa do reboque.
- A taxa fixa só vale para a Carga Pesada; nas outras categorias ela é ignorada.

### 18.3 Veículos
- O motorista cadastra os dele em ☰ › **Meus veículos**; o Master vê e edita todos em ☰ › **Veículos**.
- Cada veículo diz que **categorias** atende e tem uma situação: **Ativo**, **Em manutenção** ou **Inativo**. Só o veículo **Ativo** é oferecido na chamada.
- Sem veículo ativo para uma categoria, ela aparece ao cliente como **"Indisponível no momento"**, e o banco recusa o orçamento.
- O cliente vê modelo, cor e placa do veículo a partir da confirmação.

### 18.4 Contraproposta do motorista
- Na chamada, o Ivo toca em **Aceitar por R$ X** (valor pela tabela) ou em **Propor outro valor**.
- **Propor outro valor** abre a **calculadora**: km, espera, pedágio, hospedagem e "Outros", **sempre com os preços do contrato**. O banco recalcula o total; não existe valor digitado livremente na tela.
- O cliente vê o valor da tabela, o valor proposto e o cálculo linha a linha. Pode **confirmar** (reserva no saldo, como a aprovação de hoje), **pedir outro valor** (volta ao Ivo) ou **recusar**.
- O centro de custo é digitado pelo cliente ao confirmar (opcional, até 80 caracteres) e aparece no resumo da corrida, no extrato e no CSV do painel.

### 18.5 "Agora"
- Vale como "o mais cedo possível, a partir de 1 hora": o início é o **primeiro horário livre do Ivo a partir de agora + 60 min**.
- O Ivo tem **15 minutos** para responder, e o cliente tem **15 minutos** para confirmar a proposta. Passou do prazo, o pedido expira sozinho (como os agendados).
- Os prazos dos pedidos **agendados** continuam os do contrato.
- Se o primeiro horário livre cair no dia seguinte (por exemplo, pedido às 23h30), o pedido nasce para o dia seguinte e não expira na criação.

### 18.6 Disponível, chamada e telefone
- **Disponível para chamadas** (no ☰ do motorista) só liga e desliga o som e a vibração da chamada **neste aparelho**. **Não envia localização**: a posição só sai durante a corrida.
- **A chamada só toca com o app aberto.** Com o app fechado, ela fica em **Pendências** quando o Ivo abre o app. Aviso com o app fechado é da fase 5.
- Desligado, aparece "Indisponível no momento" no início do motorista; as chamadas não tocam, mas continuam na lista.
- O botão **Ligar** do cliente só aparece se o Ivo salvou o telefone em ☰ › **Perfil e segurança**.
- Durante a corrida valem as regras da §17 (localização só com o app aberto e a tela acesa). O **Abrir no Waze** avisa que, enquanto o Waze estiver na frente, o cliente vê "sinal perdido".

### 18.7 Painel da empresa (computador)
Para o **Administrador** da empresa (N1) e para o Master (que escolhe a empresa no topo): ☰ › **Painel da empresa**. É só leitura.
- **Gasto no mês:** soma das cobranças (débitos) do mês menos os estornos. Aparece com a barra de quanto isso representa do total do mês (saldo do início do mês + recargas do mês + limite de crédito).
- **Disponível agora:** o que a empresa ainda pode usar hoje.
- **Reservado:** corridas já confirmadas que ainda não saíram. O valor fica separado do saldo e só vira cobrança na saída.
- **Próximas corridas** (aguardando, orçadas e agendadas), **Corridas recentes** (últimos 30 dias) e **Pessoas** (quem não pediu corrida em 90 dias e convites não aceitos; **Reenviar convite** usa o fluxo da Equipe).
- **Exportar CSV do mês:** todas as corridas do mês com o centro de custo, para conferir a fatura. Pode divergir um pouco de "Gasto no mês" quando houver estorno ou aditivo, porque o CSV traz o valor aprovado de cada corrida.
- **Recarga é só do ADM.** O painel mostra "Para recarregar, fale com a IVO" com o contato de **Configurações › Contato para recarga**. Preencha esse campo.

### 18.8 Problemas comuns
| Sintoma | O que fazer |
| --- | --- |
| **"O mapa não aparece no endereço novo"** | A chave `navegador-mapa` não conhece o endereço novo (o Google confere o endereço do site, o "referenciador"). Faça o passo **18.9 (a)**, espere uns minutos e recarregue. |
| O login no endereço novo não completa / o CAPTCHA trava | Falta o domínio no widget do Turnstile: passo **18.9 (b)**. |
| O link de convite ou de senha abre o app atual | É o esperado: os links gerados continuam apontando para o app atual (https://umi-san-transporte.pages.dev). A pessoa cria a senha lá e depois entra pelo app novo. |
| Deploy vermelho | Veja o passo que falhou (18.1). Se foi só o site novo, o atual já está no ar. |
| App instalado mostra versão antiga | Feche e abra o app. O app novo mostra "Nova versão · Atualizar" quando há versão nova; toque nele. Se não aparecer, apague o ícone e instale de novo. |
| Categoria "Indisponível no momento" | Nenhum veículo **Ativo** do Ivo atende essa categoria (18.3). |

### 18.9 Passos do dono (uma vez, para o endereço novo)
**(a) Chave do mapa (Google Cloud).** Sem isto o mapa não aparece no endereço novo.
1. Abra https://console.cloud.google.com e escolha o projeto `ivo-transportes-mapas`.
2. Menu (☰) › **APIs e serviços** › **Credenciais**.
3. Clique no nome da chave **`navegador-mapa`**.
4. Em **Restrições de aplicativo** (*Sites*), clique em **Adicionar** e digite `https://ivo-novo.pages.dev/*`. **Mantenha** a linha `https://umi-san-transporte.pages.dev/*` que já existe.
5. Em **Restrições de API**, deixe **Restringir chave** marcada **somente com Map Tiles API**. Se aparecerem **Places API (New)** ou **Routes API**, **desmarque**: elas são da chave de servidor. (Esta limpeza está pendente desde 19/10.)
6. Clique em **Salvar**. Pode levar alguns minutos para valer.

**(b) Turnstile (Cloudflare).**
1. Abra https://dash.cloudflare.com › **Turnstile**.
2. Clique no seu widget (o mesmo usado pelo app atual).
3. Em **Hostname Management** (Domínios), clique em **Add hostname** (Adicionar) e digite `ivo-novo.pages.dev`. Salve. Mantenha o domínio que já está lá.

**(c) Projeto `ivo-novo` no Cloudflare Pages.** O **Deploy cria o projeto sozinho** na primeira vez. Confira em dash.cloudflare.com › **Workers & Pages**: deve existir `ivo-novo`. **Só se o Deploy falhar** nesse passo por causa do projeto:
1. dash.cloudflare.com › **Workers & Pages** › **Create** › **Pages** › **Upload assets** (envio direto).
2. Nome do projeto: `ivo-novo`. Crie (pode enviar uma pasta qualquer, o Deploy sobrescreve) e rode o Deploy de novo (**Re-run failed jobs**).

**(d) URL de retorno do Supabase.** **Não há nada para fazer**: o Deploy aplica `https://ivo-novo.pages.dev/definir-senha` (só o caminho dos links de convite e recuperação) em Auth › URL Configuration › Redirect URLs a partir do `supabase/config.toml` (passo `config push`). Para conferir: https://supabase.com/dashboard › seu projeto › **Authentication** › **URL Configuration**: a lista **Redirect URLs** deve ter `https://ivo-novo.pages.dev/definir-senha`. Se não tiver depois de um Deploy verde, avise.
