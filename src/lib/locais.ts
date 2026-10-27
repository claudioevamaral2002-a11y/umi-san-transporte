// v2.2 (especificação §4.3 e §5.5): "Locais salvos". Os locais já são guardados sozinhos a cada pedido; aqui só a
// lista da empresa (mais usados primeiro, até 200) e, para o Administrador (N1), renomear e excluir. O banco decide
// quem pode: N2/N3 e outra empresa recebem a recusa. Nenhuma ação é otimista.
import type { RespostaRpc } from './api.ts'
import type { Local } from './enderecos.ts'
import { chamar, ler } from './pedidos.ts'

/** Uma linha de `api.locais_empresa_todos()`. Do Google: `place_id`; marcado no mapa: `lat`/`lng`. */
export interface LocalSalvo {
  id: number
  nome: string
  usos: number
  ultimo_uso: string
  place_id: string | null
  lat: number | null
  lng: number | null
  /** Opcional: a lista pode não trazer o endereço formatado. */
  endereco?: string | null
}

/** Nome do local: de 2 a 80 caracteres (o mesmo check do banco). */
export const NOME_LOCAL_MIN = 2
export const NOME_LOCAL_MAX = 80

export function nomeLocalValido(nome: string): boolean {
  const n = nome.trim().length
  return n >= NOME_LOCAL_MIN && n <= NOME_LOCAL_MAX
}

/** O local salvo como ponto do pedido ("Pedir daqui" abre o pedido com o De preenchido). */
export function localDoPedido(l: LocalSalvo): Local {
  return { nome: l.nome, endereco: l.endereco ?? null, lat: l.lat, lng: l.lng, place_id: l.place_id }
}

/** Todos os locais da empresa de quem chama (qualquer nível do cliente). Recusa: `ErroLeitura`. */
export async function listarLocais(): Promise<LocalSalvo[]> {
  return (await ler<{ locais?: LocalSalvo[] }>('locais_empresa_todos', {})).locais ?? []
}

/** Só o N1 da própria empresa. `{ok}` ou `{ok:false, codigo}` (`NAO_ENCONTRADO` para id de outra empresa). */
export function renomearLocal(id: number, nome: string): Promise<RespostaRpc> {
  return chamar('renomear_local', { p_id: id, p_nome: nome.trim() })
}

/** Só o N1 da própria empresa. Apaga o local; os pedidos não mudam. */
export function excluirLocal(id: number): Promise<RespostaRpc> {
  return chamar('excluir_local', { p_id: id })
}
