// "Encoded polyline" do Google (precisão 1e5), para a rota simulada.
export function codificarPolyline(pontos: Array<[number, number]>): string {
  const um = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    return s + String.fromCharCode(x + 63)
  }
  let lat = 0
  let lng = 0
  return pontos
    .map(([a, b]) => {
      const la = Math.round(a * 1e5)
      const ln = Math.round(b * 1e5)
      const s = um(la - lat) + um(ln - lng)
      lat = la
      lng = ln
      return s
    })
    .join('')
}
