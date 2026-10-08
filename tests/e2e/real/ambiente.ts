// Carrega o .env.test (gerado por `node scripts/env-local.ts`) antes de os helpers de integração lerem o ambiente.
try {
  process.loadEnvFile('.env.test')
} catch {
  // Em CI as variáveis já podem estar no ambiente; se faltar alguma, o helper de integração avisa.
}
