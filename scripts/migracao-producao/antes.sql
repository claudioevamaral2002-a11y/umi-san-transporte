-- Estado igual ao de produção antes da fase 1B (banco em 20261008130900): empresa 'Umi San' (semeada pela
-- migração), um ADM, um CLIENTE da Umi San, um MOTORISTA, uma versão publicada da tabela única (retenção 5 dias)
-- e, a mais, um convite pendente de cliente e uma segunda empresa sem contrato. Usado só pelo CI.
insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-00000000e0b2', 'Outra Empresa');
insert into app.convites (email, nome, papel, empresa_id) values
  ('adm@prod.local', 'Admin Prod', 'ADM', null),
  ('cli@prod.local', 'Cliente Prod', 'CLIENTE', (select id from app.empresas where nome = 'Umi San')),
  ('mot@prod.local', 'Motorista Prod', 'MOTORISTA', null);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@prod.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli@prod.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@prod.local');
update app.perfis set senha_pendente = false;
insert into app.convites (email, nome, papel, empresa_id) values
  ('pendente@prod.local', 'Cliente Pendente', 'CLIENTE', (select id from app.empresas where nome = 'Umi San'));
insert into app.parametros_versoes (
  vigente_desde, publicado_por, publicado_por_nome,
  km_sem_reboque_cent, km_com_reboque_cent, taxa_fixa_reboque_cent, retorno_trecho_unico_bp,
  hora_espera_cent, hospedagem_diaria_cent, diaria_motorista_cent, faixas_cancelamento,
  prazo_orcar_horas, validade_orcamento_horas, limiar_urgente_horas,
  limite_saldo_negativo_cent, alerta_saldo_baixo_cent, retencao_fotos_dias)
values (
  now() - interval '1 hour', '00000000-0000-0000-0000-0000000000f1', 'Admin Prod',
  350, 480, 15000, 5000, 4500, 22000, 30000,
  '[{"antecedencia_min_horas":24,"multa_bp":0},{"antecedencia_min_horas":0,"multa_bp":5000}]',
  2, 48, 12, 100000, 20000, 5);
