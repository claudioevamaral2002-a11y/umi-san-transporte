import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { criarPessoa, empresaNova, rpc } from './ajuda.ts'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const t = Buffer.from(tipo, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(dados.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])))
  return Buffer.concat([len, t, dados, crc])
}

/** PNG 1x1 válido (vermelho). */
function pngMinimo(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8 // profundidade
  ihdr[9] = 2 // RGB
  const linha = Buffer.from([0, 255, 0, 0])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(linha)),
    bloco('IEND', Buffer.alloc(0)),
  ])
}

describe('logo da empresa (Storage)', () => {
  it('cliente não grava; ADM grava e define; acesso por empresa na leitura', async () => {
    const empresaA = await empresaNova()
    const empresaB = await empresaNova()
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    const clienteA = await criarPessoa({ papel: 'CLIENTE', empresa: empresaA })
    const clienteB = await criarPessoa({ papel: 'CLIENTE', empresa: empresaB })
    const caminho = `${empresaA}/logo.png`
    const png = pngMinimo()
    const opcoes = { contentType: 'image/png', upsert: true }

    const negado = await clienteA.cliente.storage.from('logos').upload(caminho, png, opcoes)
    expect(negado.error).not.toBeNull()

    const ok = await adm.cliente.storage.from('logos').upload(caminho, png, opcoes)
    expect(ok.error).toBeNull()
    expect((await rpc(adm, 'definir_logo_empresa', { p_empresa: empresaA, p_caminho: caminho })).ok).toBe(true)

    // cliente da empresa: URL assinada curta + download
    const assinada = await clienteA.cliente.storage.from('logos').createSignedUrl(caminho, 60)
    expect(assinada.error).toBeNull()
    const resp = await fetch(assinada.data!.signedUrl)
    expect(resp.status).toBe(200)
    expect(Buffer.from(await resp.arrayBuffer()).equals(png)).toBe(true)
    const baixado = await clienteA.cliente.storage.from('logos').download(caminho)
    expect(baixado.error).toBeNull()

    // cliente de outra empresa não consegue
    const outra = await clienteB.cliente.storage.from('logos').createSignedUrl(caminho, 60)
    expect(outra.error).not.toBeNull()
    expect((await clienteB.cliente.storage.from('logos').download(caminho)).error).not.toBeNull()

    // motorista (aal2) lê
    expect((await motorista.cliente.storage.from('logos').download(caminho)).error).toBeNull()

    // cliente não apaga nem sobrescreve
    const sobrescrever = await clienteA.cliente.storage.from('logos').upload(caminho, png, opcoes)
    expect(sobrescrever.error).not.toBeNull()
    await clienteA.cliente.storage.from('logos').remove([caminho])
    expect((await adm.cliente.storage.from('logos').download(caminho)).error).toBeNull()
  })

  it('bucket recusa SVG, arquivo acima de 500 KiB e caminho fora do padrão', async () => {
    const empresa = await empresaNova()
    const adm = await criarPessoa({ papel: 'ADM' })
    const logos = adm.cliente.storage.from('logos')

    const svg = await logos.upload(`${empresa}/logo.png`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
      contentType: 'image/svg+xml',
    })
    expect(svg.error).not.toBeNull()

    const grande = Buffer.concat([pngMinimo(), Buffer.alloc(500 * 1024 + 1)])
    const acima = await logos.upload(`${empresa}/logo.png`, grande, { contentType: 'image/png' })
    expect(acima.error).not.toBeNull()

    const png = pngMinimo()
    for (const caminho of [
      `${empresa}/outro.png`,
      `${empresa}/logo.jpg`,
      `${empresa}/sub/logo.png`,
      'logo.png',
      `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/logo.png`, // empresa inexistente
    ]) {
      const r = await logos.upload(caminho, png, { contentType: 'image/png' })
      expect(r.error, caminho).not.toBeNull()
    }
  })
})
