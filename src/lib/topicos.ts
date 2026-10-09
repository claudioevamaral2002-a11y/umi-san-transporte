// Tópico de tempo real que a lista/início/agenda do perfil assina (o banco decide quem pode assinar o quê).
import type { Perfil } from './estadoSessao.ts'

/** Cliente: `empresa:<id>` (pedidos da empresa). Equipe (ADM, gestor de frota, motorista): `equipe` (todos). */
export function topicoDoPerfil(perfil: Pick<Perfil, 'papel' | 'empresa_id'> | null | undefined): string | null {
  if (!perfil) return null
  if (perfil.papel === 'CLIENTE') return perfil.empresa_id ? `empresa:${perfil.empresa_id}` : null
  if (perfil.papel === 'ADM' || perfil.papel === 'GESTOR_FROTA' || perfil.papel === 'MOTORISTA') return 'equipe'
  return null
}
