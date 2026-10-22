import { kmDaRota, kmDoPedido } from '../../../lib/categorias.ts'

/**
 * Km para `categorias.disponiveis` (Ruling F4): `km` é a ida (pelas paradas) e `kmVolta` a volta direta, cada um com
 * uma casa. O banco soma `km + km_volta`; para a soma bater com o total do motorista (`kmDoPedido`, arredondado uma
 * vez só), a volta é o total menos a ida já arredondada, e não a volta arredondada sozinha (30,04 + 21,04 = 51,1, e
 * não 30,0 + 21,0 = 51,0). Sem volta (trecho único ou rota da volta indisponível), `kmVolta` é `null`.
 */
export function kmsDaPrevia(ida: number, volta: number | null): { km: number; kmVolta: number | null } {
  const km = kmDaRota(ida)
  if (volta === null) return { km, kmVolta: null }
  const total = kmDoPedido({ ida: { km: ida }, volta: { km: volta }, levar: true, trazer: true })!
  return { km, kmVolta: kmDaRota(total - km) }
}
