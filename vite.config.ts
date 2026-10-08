import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [react(), tailwindcss()],
})
