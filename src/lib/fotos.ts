// Fase 3B: a foto é reduzida no aparelho antes de subir (~1600 px, WebP), o que deixa cada uma em ~300 KB e cabe
// folgada no limite de 5 MB do servidor (que confere o tipo real pelos bytes).

export const LADO_MAXIMO = 1600
export const QUALIDADE = 0.8
export const FOTOS_MAX = 10

/** Dimensões dentro de `maximo` no lado maior, mantendo a proporção (nunca amplia). */
export function dimensoesReduzidas(largura: number, altura: number, maximo = LADO_MAXIMO): { largura: number; altura: number } {
  const maior = Math.max(largura, altura)
  if (maior <= maximo) return { largura, altura }
  const f = maximo / maior
  return { largura: Math.round(largura * f), altura: Math.round(altura * f) }
}

/** Base64 (sem o prefixo data:) de um Blob. */
export async function paraBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Reduz e converte para WebP (JPEG se o navegador não gerar WebP). `null` se não for imagem legível. */
export async function reduzirFoto(arquivo: Blob): Promise<Blob | null> {
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    const { largura, altura } = dimensoesReduzidas(imagem.width, imagem.height)
    const tela = document.createElement('canvas')
    tela.width = largura
    tela.height = altura
    const ctx = tela.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(imagem, 0, 0, largura, altura)
    imagem.close()
    const gerar = (tipo: string) => new Promise<Blob | null>((ok) => tela.toBlob(ok, tipo, QUALIDADE))
    const webp = await gerar('image/webp')
    return webp && webp.type === 'image/webp' ? webp : await gerar('image/jpeg')
  } catch {
    return null
  }
}
