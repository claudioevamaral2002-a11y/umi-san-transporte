-- Prova do Realtime Broadcast em canal privado (fase 0, especificação 1.2).
-- Na fase 1 a política passa a usar a permissão real de pedido e esta tabela é removida.
create table app.prova_canal (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null references auth.users (id) on delete cascade,
  status text not null default 'SOLICITADA'
);
alter table app.prova_canal enable row level security;

create function app.pode_ver_prova(topico text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.prova_canal p
    where 'prova:' || p.id::text = topico
      and p.dono = (select auth.uid())
  )
$$;
revoke execute on function app.pode_ver_prova(text) from public, anon;
grant execute on function app.pode_ver_prova(text) to authenticated;

create policy prova_assinar on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and app.pode_ver_prova((select realtime.topic()))
  );

-- Payload mínimo: id, status e horário. Nenhum dado sensível no canal.
create function app.prova_canal_publicar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'status', new.status, 'em', now()),
    'status',
    'prova:' || new.id::text,
    true
  );
  return new;
end
$$;
revoke execute on function app.prova_canal_publicar() from public, anon, authenticated;

create trigger prova_canal_publicar
  after update of status on app.prova_canal
  for each row execute function app.prova_canal_publicar();
