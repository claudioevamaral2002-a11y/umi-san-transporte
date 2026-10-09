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

(Também serve para quem esqueceu a senha.)

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
- Se o serviço de senhas vazadas (HIBP) estiver fora do ar, definir senha fica bloqueado até voltar.
- A configuração de Auth só muda pelo código (`config.toml`); mudanças feitas no painel seriam sobrescritas no próximo deploy.
