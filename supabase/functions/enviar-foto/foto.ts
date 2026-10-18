// Fase 3B (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.6; especificação §8): foto da conclusão do serviço.
// O tipo vale pelos primeiros bytes (não pelo nome nem pelo Content-Type declarado), até 5 MB. A permissão, o status do
// pedido, o limite de 10 fotos e o caminho em UUID vêm de api.autorizar_foto (JWT de quem envia); o arquivo é gravado
// com a service role e só então confirmado (api.confirmar_foto confere que o arquivo está no bucket).

export const FOTO_MAX_BYTES = 5 * 1024 * 1024
/** Base64 de 5 MB (4/3) com folga para o JSON em volta. */
export const CORPO_MAX_BYTES = Math.ceil((FOTO_MAX_BYTES * 4) / 3) + 1024

export type TipoFoto = 'image/jpeg' | 'image/png' | 'image/webp'
type Resultado = { ok: boolean; codigo?: string; [campo: string]: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Tipo real pela assinatura do arquivo (JPEG, PNG, WebP); `null` para qualquer outra coisa. */
export function tipoPelosBytes(b: Uint8Array): TipoFoto | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length >= 8 && png.every((x, i) => b[i] === x)) return 'image/png'
  const ascii = (de: number, ate: number) => String.fromCharCode(...b.subarray(de, ate))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

function decodificar(dados: string): Uint8Array | null {
  if (dados.length === 0 || dados.length % 4 !== 0 || !BASE64.test(dados)) return null
  try {
    const bin = atob(dados)
    const b = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
    return b
  } catch {
    return null
  }
}

export interface DependenciasFoto {
  autorizar: (atividade: string, tipo: TipoFoto, bytes: number) => Promise<Resultado>
  gravar: (caminho: string, bytes: Uint8Array, tipo: TipoFoto) => Promise<boolean>
  confirmar: (foto: string) => Promise<Resultado>
  log?: (etapa: string, detalhe?: unknown) => void
}

/** corpo: {atividade, dados (base64)} → {ok, foto_id, caminho} ou {ok:false, codigo}. */
export function criarManipuladorFoto(d: DependenciasFoto) {
  return async (corpo: Record<string, unknown>): Promise<Resultado> => {
    const { atividade, dados } = corpo
    if (typeof atividade !== 'string' || !UUID.test(atividade) || typeof dados !== 'string') {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    const bytes = decodificar(dados)
    if (!bytes || bytes.length === 0 || bytes.length > FOTO_MAX_BYTES) return { ok: false, codigo: 'FOTO_INVALIDA' }
    const tipo = tipoPelosBytes(bytes)
    if (!tipo) return { ok: false, codigo: 'FOTO_INVALIDA' }

    const autorizado = await d.autorizar(atividade, tipo, bytes.length)
    if (!autorizado.ok) return autorizado
    const caminho = autorizado.caminho
    const fotoId = autorizado.foto_id
    if (typeof caminho !== 'string' || typeof fotoId !== 'string') return { ok: false, codigo: 'ERRO_INESPERADO' }

    if (!(await d.gravar(caminho, bytes, tipo))) {
      d.log?.('gravar')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    const confirmado = await d.confirmar(fotoId)
    if (!confirmado.ok) return confirmado
    return { ok: true, foto_id: fotoId, caminho }
  }
}
