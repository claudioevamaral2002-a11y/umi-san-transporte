/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** '1' só nas builds de desenvolvimento/teste (definido no vite.config.ts); nunca em produção. */
  readonly VITE_VITRINE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
