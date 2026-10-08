# RUNBOOK — IVO Transportes (operação)

Guia passo a passo para o dono do sistema. Não precisa saber programar. Em todos os casos abaixo você usa o site do GitHub, logado na conta dona do repositório.

- Repositório: https://github.com/claudioevamaral2002-a11y/umi-san-transporte
- Aba de workflows: https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions
- Aplicativo (produção): https://umi-san-transporte.pages.dev
- Painel Supabase: https://supabase.com/dashboard
- Painel Cloudflare: https://dash.cloudflare.com

> Regra de ouro: nunca cole links de acesso, senhas ou chaves em conversas, e-mails ou prints. Os links gerados valem por 24 horas e só funcionam uma vez.

---

## 1. Primeiro acesso do ADM (a primeira pessoa administradora)

Só funciona enquanto ainda não existe nenhum ADM.

1. Abra https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/criar-primeiro-adm.yml
2. Clique em **Run workflow** (botão à direita). Preencha **e-mail** e **nome** do administrador e clique no botão verde **Run workflow**.
3. Aguarde ~1 minuto. Clique na execução que apareceu (a mais recente) e espere o círculo ficar verde.
4. Na página da execução, role até o **resumo** (seção "Convite do primeiro ADM"). Lá está o botão **Abrir link para criar a senha**. O link não aparece nos logs, só no resumo.
5. Clique no link. Abre o aplicativo na tela **Definir senha**. Crie uma senha com pelo menos 10 caracteres, com maiúscula, minúscula e número.
6. Em seguida o app pede o **2FA**: abra um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, Authy...), leia o QR code e digite o código de 6 dígitos.
7. Pronto. A partir daí o login é e-mail + senha + código do autenticador.

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
3. Na linha da pessoa, clique em **Gerar link de senha** (ou **Convidar**, para quem ainda não tem conta).
4. Use **Copiar** ou **Enviar no WhatsApp**. O link vale 24 horas e só funciona uma vez. Sem domínio próprio, o app não envia e-mail: você entrega o link.
5. Para motorista que perdeu o 2FA: na mesma linha, **Resetar 2FA**.

---

## 4. Desativar um usuário

1. Aplicativo, menu **Usuários**, linha da pessoa, **Desativar**.
2. O bloqueio é imediato. Para voltar atrás, **Reativar** e gere um novo link de senha (a sessão antiga não volta, a pessoa precisa entrar de novo).
3. Não é possível desativar o último ADM ativo.

---

## 5. Onde ficam os segredos (somente nomes; os valores nunca vão para o código)

Local: GitHub, Settings, Environments, **producao** (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/settings/environments) e Settings, Secrets and variables, Actions (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/settings/secrets/actions).

| Nome | Tipo | Onde | Para que serve |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | segredo | repositório | CLI do Supabase: deploy, e obter a chave de serviço nos workflows manuais |
| `SUPABASE_DB_PASSWORD` | segredo | ambiente `producao` | senha do banco, usada em `db push` |
| `CLOUDFLARE_API_TOKEN` | segredo | ambiente `producao` | publicar no Cloudflare Pages |
| `TURNSTILE_SECRET_KEY` | segredo | ambiente `producao` | segredo do CAPTCHA (vai para o Auth via `config push`) |
| `SUPABASE_PROJECT_REF` | variável | ambiente `producao` | identificador do projeto Supabase |
| `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY` | variáveis | ambiente `producao` | públicas (vão no front) |

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
