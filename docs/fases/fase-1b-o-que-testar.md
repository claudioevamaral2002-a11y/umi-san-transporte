# Fase 1B — o que testar em produção (roteiro manual)

Faça depois do merge da `fase-1b` na `main` e do deploy verde (https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions/workflows/deploy.yml). Aplicativo: https://umi-san-transporte.pages.dev. Passo a passo de operação no [RUNBOOK](../RUNBOOK.md) (itens 7 a 10 são os novos desta fase).

Marque cada item. Se algo falhar, pare e anote a tela e a mensagem (sem links nem senhas).

> **Várias contas ao mesmo tempo:** o app guarda **uma sessão por navegador**. Para ver ADM, cliente N1, N2, N3 e motorista lado a lado, use **perfis diferentes do navegador** (Chrome: ícone do perfil, *Adicionar*; Edge: *Perfis*) ou **janelas anônimas** de navegadores diferentes (uma janela anônima do Chrome e uma InPrivate do Edge são sessões separadas; duas janelas anônimas do mesmo navegador **compartilham** a sessão). O celular também conta como outro navegador.

## A. Deploy e migração
1. **Deploy verde.** Na aba [Actions](https://github.com/claudioevamaral2002-a11y/umi-san-transporte/actions), o workflow **Deploy** da `main` terminou com sucesso (o passo de migrations aplicou `20261009120000`, `20261009120100` e `20261009120200`).
2. **Endereço antigo.** Como ADM, abra https://umi-san-transporte.pages.dev/parametros: o app leva para **Contratos**. O menu não tem mais **Permissões** nem **Tabela** para o ADM.

## B. Contratos (ADM)
3. **Lista.** Menu **Contratos** (https://umi-san-transporte.pages.dev/adm/contratos): aparecem **Tabela modelo** e **Umi San**, ambas com versão 1 vigente.
4. **Umi San v1 = tabela antiga.** Abra **Umi San** e confira, campo a campo, que os valores são **os mesmos** da tabela que você publicou na fase 1 (km sem/com reboque, taxa do reboque, retorno, hora de espera, hospedagem, diária do motorista, faixas de cancelamento, prazo para orçar, validade, limiar de urgente, limite de saldo negativo e alerta de saldo baixo). O autor é você. Faça o mesmo na **Tabela modelo**.
5. **Publicar um ajuste.** Em **Umi San**, **Publicar nova versão**: altere um valor (ex.: hora de espera), escolha a vigência (agora ou no futuro), confira o resumo "Alterado … passa a …" e **Publicar versão**. A versão 2 aparece no histórico; a 1 continua intacta. Se escolheu vigência futura, a lista mostra a próxima vigência e a v1 segue vigente até lá.
6. **Modelo independente.** A Tabela modelo **não** mudou com o ajuste da Umi San (e vice-versa).
7. **Nova empresa.** (Opcional) Em **Empresas**, crie uma empresa de teste: em **Contratos** ela aparece **Sem contrato vigente**, com **Criar contrato a partir da tabela modelo**. Um cliente dela vê o aviso de que ainda não há contrato.

## C. Configurações (ADM)
8. **Retenção de fotos.** Menu **Configurações** (https://umi-san-transporte.pages.dev/adm/configuracoes): **Fotos guardadas após a entrega** mostra o mesmo número de dias da tabela antiga. Mude, **Salvar**, recarregue: o valor ficou. A mudança aparece em **Auditoria** (`DEFINIR_RETENCAO_FOTOS`).

## D. Cliente N1 e a equipe da empresa
9. **Cliente existente virou N1.** O cliente da Umi San criado na fase 1 entra e vê **Regras do serviço** e **Equipe** (é o gestor da empresa).
10. **Convidar um N1 novo (ADM).** Em **Usuários**, **Convidar**, perfil **Cliente**, empresa **Umi San**, **Nível na empresa: Gestor da empresa (N1)**. Entregue o link e defina a senha num **outro perfil do navegador** (sem 2FA para cliente).
11. **N1 convida N2 e N3.** Logado como esse N1, menu **Equipe** (https://umi-san-transporte.pages.dev/equipe), **Convidar colega**: convide um N2 (solicitante) e um N3 (visualizador). Repare que não há escolha de empresa nem de perfil (sempre cliente da Umi San). Abra cada link num perfil do navegador diferente e defina a senha.
12. **O que cada um vê.**
    - **N1:** Início, **Regras do serviço**, **Equipe** (só pessoas da Umi San; nunca motorista, ADM ou outra empresa).
    - **N2 e N3:** Início e **Regras do serviço**; sem **Equipe**. Forçando https://umi-san-transporte.pages.dev/equipe aparece **Sem permissão**.
    - **Nenhum cliente** vê preços, limite de saldo, versão ou autor: **Regras do serviço** mostra só faixas de cancelamento, prazo para orçar, validade do orçamento e o que conta como urgente. Forçando https://umi-san-transporte.pages.dev/tabela ou `/adm/contratos` aparece **Sem permissão**.
13. **N1 gerencia a equipe.** Na **Equipe**, no N3: **Gerenciar**, **Gerar novo link** (funciona), **Desativar** com motivo (o N3 perde o acesso na hora), depois **Reativar** e gere novo link. O N1 não consegue desativar a si mesmo.
14. **Auditoria.** Como ADM, em **Auditoria**, os convites, links e desativações feitos pelo N1 aparecem com o nome dele.

## E. Motorista
15. **Convidar motorista** (ou usar o da fase 1): entra com senha + 2FA.
16. **Tabela do motorista.** Menu **Tabela** (https://umi-san-transporte.pages.dev/tabela): aparecem **Modalidade veículo próprio** e **Modalidade veículo do cliente** com os preços e prazos do contrato da Umi San (inclusive o ajuste do item 5, se já vigente). **Não** aparecem limite de saldo, alerta de saldo, retenção de fotos, número de versão nem autor.
17. Forçando `/adm/contratos`, `/equipe` ou `/regras`: **Sem permissão**.

## F. Fechamento
18. **Gestor de frota (opcional).** Convidar com perfil **Gestor de frota** exige 2FA no primeiro acesso; ele ainda não tem telas próprias (fase 3) e não vê preços.
19. **Limpeza.** Desative as contas de teste (N2, N3, empresa de teste) e confira que só ficam os usuários reais.
