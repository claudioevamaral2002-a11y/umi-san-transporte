// O front só formata; nunca calcula valores financeiros (especificação 6 e SECURITY item 3).
const FORMATO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new TypeError(`Valor monetário deve ser inteiro em centavos: ${centavos}`)
  }
  return FORMATO.format(centavos / 100)
}
