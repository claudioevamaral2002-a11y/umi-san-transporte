# Fase 0 — o que testar

## Automático (CI, bloqueia o deploy)
- pgTAP: schemas, privilégios, funções SECURITY DEFINER com search_path, views security_invoker, RLS em app, política do Realtime
- Integração: API só serve `api`; escrita direta recusada; RPC sem Authorization recusada; Realtime A recebe / B recusado
- E2E: headers de segurança; CSP bloqueia script injetado; zero violações navegando; manifest; offline; pickup só após 400 ms; movimento reduzido; números tabulares
- Auditoria npm (alto/crítico), varredura de segredos (bundle + repositório), orçamento de 150 KB gzip

## Manual (no celular)
1. Abrir https://umi-san-transporte.pages.dev no Chrome (Android) ou Safari (iPhone).
2. Instalar: Android → menu ⋮ → "Instalar app"; iPhone → Compartilhar → "Adicionar à Tela de Início".
3. Abrir pelo ícone: abre em tela cheia, ícone da pickup com reboque, barra no azul-marinho.
4. Ir em "Ver design system": a tela desliza; status com ícone + texto; valores alinhados.
5. "Simular 1500 ms": pickup andando na estrada, rodas girando. "Simular 200 ms": nada aparece.
6. "Alternar alto contraste": tudo legível sob o sol.
7. Modo avião e abrir o app de novo: a tela inicial abre.
8. Celular em modo escuro: cores mudam automaticamente.
