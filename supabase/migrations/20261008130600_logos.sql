-- Logo da empresa cliente (Storage). Bucket privado; acesso por política em storage.objects.
-- O bucket também é declarado em supabase/config.toml; aqui garantimos a existência (idempotente)
-- e mantemos os mesmos limites, para que CI e produção tenham o mesmo bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 512000, array['image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 512000,
      allowed_mime_types = array['image/png', 'image/webp'];

-- Escrita: só quem pode GERIR_EMPRESAS, no caminho <uuid de empresa existente>/logo.png|webp.
create policy logos_inserir on storage.objects for insert to authenticated
with check (
  bucket_id = 'logos'
  and (select app.pode_fazer('GERIR_EMPRESAS'))
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.(png|webp)$'
  and exists (select 1 from app.empresas e where e.id::text = (storage.foldername(name))[1])
);

create policy logos_atualizar on storage.objects for update to authenticated
using (
  bucket_id = 'logos'
  and (select app.pode_fazer('GERIR_EMPRESAS'))
)
with check (
  bucket_id = 'logos'
  and (select app.pode_fazer('GERIR_EMPRESAS'))
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.(png|webp)$'
  and exists (select 1 from app.empresas e where e.id::text = (storage.foldername(name))[1])
);

create policy logos_apagar on storage.objects for delete to authenticated
using (
  bucket_id = 'logos'
  and (select app.pode_fazer('GERIR_EMPRESAS'))
);

-- Leitura: equipe (ADM/MOTORISTA) qualquer logo; cliente só o da própria empresa.
create policy logos_ler on storage.objects for select to authenticated
using (
  bucket_id = 'logos'
  and (select (app.pode_acessar()).usuario_id) is not null
  and (
    (select (app.pode_acessar()).papel) in ('ADM', 'MOTORISTA')
    or (storage.foldername(name))[1] = (select (app.pode_acessar()).empresa_id)::text
  )
);
