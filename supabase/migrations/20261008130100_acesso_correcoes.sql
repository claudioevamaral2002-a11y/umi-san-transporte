-- Correções do núcleo de acesso (revisão de segurança da Task 3).

-- I1/I2: políticas. Nunca testar a linha composta inteira com IS [NOT] NULL (só é true se TODOS os campos
-- forem não nulos) e embrulhar chamadas de função em (select ...) para avaliar uma vez por consulta.
drop policy permissoes_ler on app.permissoes_delegadas;
create policy permissoes_ler on app.permissoes_delegadas for select to authenticated using (
  (select (app.pode_acessar()).usuario_id) is not null
);

drop policy perfis_ler on app.perfis;
create policy perfis_ler on app.perfis for select to authenticated using (
  usuario_id = (select auth.uid())
  or (select app.pode_fazer('GERIR_USUARIOS'))
);

drop policy auditoria_ler on app.auditoria;
create policy auditoria_ler on app.auditoria for select to authenticated using (
  (select app.pode_fazer('VER_AUDITORIA'))
);

-- I3 + M1: limite sem usuário ou com janela inválida nega; janelas >= 1 dia alinham à meia-noite de São Paulo.
create or replace function interno.checar_limite(p_acao text, p_max int, p_janela interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  inicio timestamptz;
  atual int;
begin
  if (select auth.uid()) is null or p_janela <= interval '0' then
    return false;
  end if;
  if p_janela >= interval '1 day' then
    inicio := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  else
    inicio := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_janela)) * extract(epoch from p_janela));
  end if;
  insert into interno.limites (usuario_id, acao, janela_inicio, contagem)
  values ((select auth.uid()), p_acao, inicio, 1)
  on conflict (usuario_id, acao, janela_inicio) do update set contagem = interno.limites.contagem + 1
  returning contagem into atual;
  return atual <= p_max;
end $$;

-- I4: nome do convite com a mesma regra do perfil; o trigger grava o nome aparado.
alter table app.convites add constraint convites_nome_check check (length(trim(nome)) between 2 and 120);

create or replace function interno.criar_perfil_do_convite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c app.convites;
begin
  select * into c from app.convites
  where email = lower(new.email) and usado_em is null
  order by criado_em desc limit 1;
  if found then
    insert into app.perfis (usuario_id, nome, papel, empresa_id, senha_pendente)
    values (new.id, trim(c.nome), c.papel, c.empresa_id, true);
    update app.convites set usado_em = now() where id = c.id;
  end if;
  return new;
end $$;

-- I5: o IP é informativo (cabeçalhos podem ser forjados pelo cliente); preferir o do Cloudflare.
create or replace function interno.auditar(p_acao text, p_alvo text, p_resultado text, p_codigo text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cabecalhos jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  insert into app.auditoria (usuario_id, papel, acao, alvo, resultado, codigo, detalhe, ip, dispositivo)
  values (
    (select auth.uid()),
    (select papel from app.perfis where usuario_id = (select auth.uid())),
    p_acao, p_alvo, p_resultado, p_codigo, p_detalhe,
    left(coalesce(cabecalhos ->> 'cf-connecting-ip', trim(split_part(cabecalhos ->> 'x-forwarded-for', ',', 1))), 64),
    left(cabecalhos ->> 'user-agent', 200)
  );
end $$;

-- M2: apagar o usuário que convidou/alterou não deve ser bloqueado nem apagar histórico.
alter table app.convites drop constraint convites_criado_por_fkey;
alter table app.convites add constraint convites_criado_por_fkey
  foreign key (criado_por) references auth.users (id) on delete set null;
alter table app.permissoes_delegadas drop constraint permissoes_delegadas_alterado_por_fkey;
alter table app.permissoes_delegadas add constraint permissoes_delegadas_alterado_por_fkey
  foreign key (alterado_por) references auth.users (id) on delete set null;
