import { describe, expect, it } from 'vitest'
import { FOTO_MAX_BYTES, criarManipuladorFoto, tipoPelosBytes } from './foto.ts'

const ATIVIDADE = '3f1c2a9e-1d2b-4c3d-8e4f-5a6b7c8d9e0f'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const WEBP = new TextEncoder().encode('RIFF\x10\x00\x00\x00WEBPVP8 ')
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

function dependencias() {
  const chamadas: string[] = []
  return {
    chamadas,
    d: {
      autorizar: async (atividade: string, tipo: string, bytes: number) => {
        chamadas.push(`autorizar:${atividade}:${tipo}:${bytes}`)
        return { ok: true, foto_id: 'f1', caminho: `${atividade}/f1.jpg` }
      },
      gravar: async (caminho: string, _b: Uint8Array, tipo: string) => {
        chamadas.push(`gravar:${caminho}:${tipo}`)
        return true
      },
      confirmar: async (foto: string) => {
        chamadas.push(`confirmar:${foto}`)
        return { ok: true }
      },
    },
  }
}

describe('enviar-foto', () => {
  it('tipo pelos bytes: JPEG, PNG e WebP; o resto é recusado', () => {
    expect(tipoPelosBytes(JPEG)).toBe('image/jpeg')
    expect(tipoPelosBytes(PNG)).toBe('image/png')
    expect(tipoPelosBytes(WEBP)).toBe('image/webp')
    expect(tipoPelosBytes(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(tipoPelosBytes(new TextEncoder().encode('<svg xmlns='))).toBeNull()
    expect(tipoPelosBytes(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })

  it('autoriza com o tipo real e o tamanho, grava e confirma, nessa ordem', async () => {
    const { chamadas, d } = dependencias()
    const r = await criarManipuladorFoto(d)({ atividade: ATIVIDADE, dados: b64(JPEG) })
    expect(r).toEqual({ ok: true, foto_id: 'f1', caminho: `${ATIVIDADE}/f1.jpg` })
    expect(chamadas).toEqual([`autorizar:${ATIVIDADE}:image/jpeg:8`, `gravar:${ATIVIDADE}/f1.jpg:image/jpeg`, 'confirmar:f1'])
  })

  it('arquivo que não é imagem (mesmo com nome .jpg) não chega a ser autorizado', async () => {
    const { chamadas, d } = dependencias()
    const r = await criarManipuladorFoto(d)({ atividade: ATIVIDADE, dados: b64(new TextEncoder().encode('MZ executável!!')) })
    expect(r).toEqual({ ok: false, codigo: 'FOTO_INVALIDA' })
    expect(chamadas).toEqual([])
  })

  it('base64 inválido, vazio ou acima de 5 MB: FOTO_INVALIDA; atividade fora do formato: CAMPOS_INVALIDOS', async () => {
    const { d } = dependencias()
    const m = criarManipuladorFoto(d)
    expect(await m({ atividade: ATIVIDADE, dados: '***' })).toEqual({ ok: false, codigo: 'FOTO_INVALIDA' })
    expect(await m({ atividade: ATIVIDADE, dados: '' })).toEqual({ ok: false, codigo: 'FOTO_INVALIDA' })
    const grande = new Uint8Array(FOTO_MAX_BYTES + 1)
    grande.set(JPEG)
    expect(await m({ atividade: ATIVIDADE, dados: Buffer.from(grande).toString('base64') })).toEqual({
      ok: false,
      codigo: 'FOTO_INVALIDA',
    })
    expect(await m({ atividade: '../x', dados: b64(JPEG) })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ atividade: ATIVIDADE })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
  })

  it('recusa do banco volta como veio; falha no upload não confirma', async () => {
    const { chamadas, d } = dependencias()
    const negado = criarManipuladorFoto({ ...d, autorizar: async () => ({ ok: false, codigo: 'LIMITE_FOTOS' }) })
    expect(await negado({ atividade: ATIVIDADE, dados: b64(PNG) })).toEqual({ ok: false, codigo: 'LIMITE_FOTOS' })
    const semUpload = criarManipuladorFoto({ ...d, gravar: async () => false })
    expect(await semUpload({ atividade: ATIVIDADE, dados: b64(WEBP) })).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
    expect(chamadas.filter((c) => c.startsWith('confirmar'))).toEqual([])
  })
})
