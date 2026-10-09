import { criarClientesSistema, origensConfiguradas } from '../_compartilhado/clientes.ts'
import { criarManipuladorResgate } from '../_compartilhado/resgate.ts'

// Sem JWT de propósito (verify_jwt = false no config.toml): quem chega aqui ainda não tem sessão.
// Proteções: só POST, CORS por allowlist, limite por IP (memória + 30/dia no banco), código de ~49 bits.
Deno.serve(criarManipuladorResgate({ origens: origensConfiguradas, clientes: criarClientesSistema }))
