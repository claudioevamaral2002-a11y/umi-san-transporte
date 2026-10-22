import { Equipe, Usuarios } from '../../../telas/pessoas/Pessoas.tsx'
import { useContextoPainel } from './componentes.tsx'

/**
 * Aba "Pessoas" (/empresa/pessoas): reaproveita a Equipe do Administrador (convidar, novo link, ativar/desativar). O
 * Master vê a lista de Usuários de todas as empresas (a mesma tela do ADM).
 */
export function AbaPessoas() {
  const { ehAdm, empresa } = useContextoPainel()
  return ehAdm ? <Usuarios empresa={empresa ?? undefined} /> : <Equipe />
}
