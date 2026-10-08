# Fase 1 — o que testar em produção (roteiro manual)

Faça depois do merge da `fase-1` na `main` e do deploy verde (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions). Aplicativo: https://umi-san-transporte.pages.dev. Passo a passo dos workflows no [RUNBOOK](../RUNBOOK.md).

Marque cada item. Se algo falhar, pare e anote a tela e a mensagem (sem links nem senhas).

1. **Deploy verde.** Na aba Actions, o workflow Deploy da `main` terminou com sucesso.
2. **Site no ar.** Abra https://umi-san-transporte.pages.dev: aparece a tela de login com o CAPTCHA.
3. **Criar o primeiro ADM.** Rode o workflow [criar-primeiro-adm](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/criar-primeiro-adm.yml) com seu e-mail e nome ([RUNBOOK, item 1](../RUNBOOK.md#1-primeiro-acesso-do-adm-a-primeira-pessoa-administradora)). Confirme que o link está **só** no resumo, não nos logs.
4. **Rodar de novo.** Com o ADM já criado e senha ainda pendente, rodar outra vez gera novo link (recuperação). Depois de definir a senha, rodar de novo é recusado.
5. **Definir a senha.** Abra o link do resumo, crie uma senha forte. Teste também uma senha fraca (ex.: `12345678`) e uma senha vazada conhecida: o app deve recusar.
6. **Reusar o link.** Abrir o mesmo link outra vez não deve funcionar.
7. **Cadastrar o 2FA.** Leia o QR code no autenticador e confirme com o código de 6 dígitos.
8. **Sair e entrar.** Faça logout; entre com e-mail, senha, CAPTCHA e código 2FA. Teste uma senha errada: a mensagem é genérica ("E-mail ou senha incorretos").
9. **Resetar o 2FA do ADM.** Rode [resetar-2fa-adm](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/resetar-2fa-adm.yml) com seu e-mail ([RUNBOOK, item 2](../RUNBOOK.md#2-o-adm-perdeu-o-2fa-celular-perdidotrocado)); entre de novo e recadastre o 2FA.
10. **Convidar um motorista.** Usuários, Convidar, perfil Motorista. Copie o link, abra em janela anônima, defina a senha e cadastre o 2FA.
11. **Convidar um cliente da Umi San.** Confira que a empresa Umi San já aparece em Empresas (ela já vem cadastrada); depois convide um cliente vinculado a ela. O cliente define a senha (sem 2FA obrigatório) e vê apenas o que é da empresa dele.
12. **Logo da empresa.** Envie o logo da Umi San (a empresa já existe); confirme que aparece para o cliente. Teste um arquivo inválido (não imagem ou grande demais): recusado.
13. **Publicar a tabela de parâmetros.** Em Parâmetros, edite, publique e confira que a nova versão vale para os perfis permitidos.
14. **Testar delegação.** Dê a um motorista a permissão delegada correspondente; confirme que ele passa a poder a ação e que, ao retirar, perde. Cliente nunca ganha acesso de motorista/ADM.
15. **Desativar e reativar.** Desative o motorista de teste: ele perde acesso na hora. Reative e gere novo link de senha ([RUNBOOK, itens 3 e 4](../RUNBOOK.md#3-gerar-link-de-senha-para-motorista-ou-cliente)).
16. **Ver a auditoria.** Em Auditoria, confira os registros: convites, definição de senha, resets de 2FA, desativações, delegações, com usuário e horário. Não deve haver senhas, links nem chaves.
17. **Sem segredos expostos.** No navegador (aba Rede), nenhuma resposta contém `service_role` ou chaves secretas; o log de qualquer execução dos workflows manuais mostra a chave como `***`.
18. **Limpeza.** Remova contas de teste (desative-as) e confira que só ficam os usuários reais.
