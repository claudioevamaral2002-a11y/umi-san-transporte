import { createHmac } from 'node:crypto'

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decodifica base32 (RFC 4648), ignorando espaços, hífens e `=`. */
export function base32Decodificar(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let acumulado = 0
  const bytes: number[] = []
  for (const letra of limpo) {
    const valor = ALFABETO.indexOf(letra)
    if (valor < 0) throw new Error('base32 inválido')
    acumulado = (acumulado << 5) | valor
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((acumulado >> bits) & 0xff)
      acumulado &= (1 << bits) - 1
    }
  }
  return Buffer.from(bytes)
}

/** TOTP (RFC 6238, HMAC-SHA-1, passo de 30 s). `segredo` é o texto base32 devolvido pelo `mfa.enroll`. */
export function gerarTotp(segredo: string, opcoes: { agora?: number; digitos?: number; passo?: number } = {}): string {
  return gerarTotpBruto(base32Decodificar(segredo), opcoes)
}

/** Mesma conta, com o segredo já em bytes (usado pelo vetor de teste do RFC). */
export function gerarTotpBruto(
  chave: Buffer,
  { agora = Date.now(), digitos = 6, passo = 30 }: { agora?: number; digitos?: number; passo?: number } = {},
): string {
  const contador = Math.floor(agora / 1000 / passo)
  const mensagem = Buffer.alloc(8)
  mensagem.writeBigUInt64BE(BigInt(contador))
  const hmac = createHmac('sha1', chave).update(mensagem).digest()
  const deslocamento = hmac[hmac.length - 1]! & 0x0f
  const numero =
    ((hmac[deslocamento]! & 0x7f) << 24) |
    (hmac[deslocamento + 1]! << 16) |
    (hmac[deslocamento + 2]! << 8) |
    hmac[deslocamento + 3]!
  return String(numero % 10 ** digitos).padStart(digitos, '0')
}
