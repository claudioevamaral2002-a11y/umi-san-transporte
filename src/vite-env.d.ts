/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Fase 3A: chave de navegador do Google, restrita ao domínio do app e só à Map Tiles API. */
  readonly VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR?: string
  /** '1' só nas builds de desenvolvimento/teste (definido no vite.config.ts); nunca em produção. */
  readonly VITE_VITRINE?: string
  /** Versão do package.json (definida no vite.config.ts), mostrada em Perfil e segurança na v2. */
  readonly VITE_VERSAO: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
