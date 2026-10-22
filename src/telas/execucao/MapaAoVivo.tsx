import { useEffect, useRef, useState } from 'react'
import type { Map as MapaLeaflet, Marker } from 'leaflet'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { detalhar } from '../../lib/enderecosRemoto.ts'
import { criarSessaoTiles } from '../../lib/mapaTiles.ts'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import { aplicarPosicao, comoPosicao, estadoDoSinal, interpolar, type Ponto, type Posicao } from '../../lib/rastreio.ts'
import { horaDe } from '../../lib/tempo.ts'
import { useTransmissao } from '../../lib/tempoReal.ts'
import { pontosDoPedido, useAgora } from './comum.tsx'

const ITAJAI = { lat: -26.9078, lng: -48.6619 }
const reduzido = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Ícones do mapa como HTML de classes (sem atributo style: a CSP não libera estilo em linha).
const SVG_CARRO =
  '<svg viewBox="0 0 64 36" width="26" height="16" aria-hidden="true"><path fill="currentColor" d="M6 22h4l5-11h17v11h4V9h12l8 9 4 2v6h-4a6 6 0 0 0-12 0H26a6 6 0 0 0-12 0H6z"/><circle cx="20" cy="27" r="4.5" fill="currentColor"/><circle cx="42" cy="27" r="4.5" fill="currentColor"/></svg>'
const SVG_DESTINO = '<svg viewBox="0 0 16 14" width="20" height="18" aria-hidden="true"><path d="M8 14 0 0h16z"/></svg>'

export function textoDoSinal(estado: ReturnType<typeof estadoDoSinal>, idadeS: number): string {
  if (estado === 'aguardando') return 'Aguardando a posição do motorista…'
  if (estado === 'perdido') {
    const min = Math.max(1, Math.round(idadeS / 60))
    return `Sinal do motorista perdido. Última posição há ${min} min. O mapa volta a se mover quando o sinal voltar.`
  }
  if (estado === 'atrasado') return `Atualizado há ${idadeS} s`
  return 'Atualizado agora'
}

/**
 * Cliente (solicitante e N1), ADM e gestor de frota: o carro no mapa ao vivo, pelo canal privado rastreio:<id>.
 * O carro anda interpolando entre os pontos; sem dado há mais de 60 s fica cinza e a tela diz isso (nunca inventa posição).
 */
export function MapaAoVivo({ pedido }: { pedido: DetalhePedido }) {
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaLeaflet | null>(null)
  const carro = useRef<Marker | null>(null)
  const destinoMarcador = useRef<Marker | null>(null)
  const leaflet = useRef<typeof import('leaflet') | null>(null)
  const animacao = useRef<number | null>(null)
  const [posicao, setPosicao] = useState<Posicao | null>(null)
  const [estadoMapa, setEstadoMapa] = useState<'carregando' | 'pronto' | 'indisponivel'>('carregando')
  const [destinoDetalhado, setDestinoDetalhado] = useState<Ponto | null>(null)
  const agora = useAgora(1_000)
  const { destino } = pontosDoPedido(pedido)
  const sinal = estadoDoSinal(posicao?.recebidaEm ?? null, agora)
  const idadeS = posicao ? Math.round((agora - posicao.recebidaEm) / 1000) : 0

  useTransmissao(`rastreio:${pedido.id}`, 'posicao', (payload) => {
    const nova = comoPosicao(payload, Date.now())
    if (nova) setPosicao((atual) => aplicarPosicao(atual, nova))
  })

  // Coordenadas do destino: as guardadas, ou um "detalhar" na hora (ficam só na memória da tela; termos do Google).
  const guardadoLat = destino.lat
  const guardadoLng = destino.lng
  const destinoXY: Ponto | null =
    guardadoLat !== null && guardadoLng !== null ? { lat: guardadoLat, lng: guardadoLng } : destinoDetalhado
  const placeDestino = guardadoLat === null || guardadoLng === null ? destino.place_id : null
  const nomeDestino = destino.nome
  useEffect(() => {
    if (!placeDestino) return
    let vivo = true
    void detalhar(placeDestino, nomeDestino, crypto.randomUUID()).then((l) => {
      if (vivo && l && l.lat !== null && l.lng !== null) setDestinoDetalhado({ lat: l.lat, lng: l.lng })
    })
    return () => {
      vivo = false
    }
  }, [placeDestino, nomeDestino])
  const destinoLat = destinoXY?.lat ?? null
  const destinoLng = destinoXY?.lng ?? null

  // Mapa (Leaflet + blocos do Google), carregado sob demanda.
  useEffect(() => {
    let vivo = true
    const animar = !reduzido()
    void (async () => {
      const [sessao, L] = await Promise.all([
        criarSessaoTiles(import.meta.env.VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR ?? ''),
        import('leaflet').then((m) => m.default).catch(() => null),
        import('leaflet/dist/leaflet.css').catch(() => null),
      ])
      if (!vivo || !caixa.current) return
      if (!sessao || !L) {
        setEstadoMapa('indisponivel')
        return
      }
      leaflet.current = L
      const m = L.map(caixa.current, {
        zoomControl: true,
        attributionControl: true,
        zoomAnimation: animar,
        fadeAnimation: animar,
        markerZoomAnimation: animar,
      }).setView([ITAJAI.lat, ITAJAI.lng], 13)
      m.attributionControl.setPrefix(false)
      L.tileLayer(sessao.urlTile, { maxZoom: 20, attribution: 'Google' }).addTo(m)
      mapa.current = m
      requestAnimationFrame(() => m.invalidateSize())
      setEstadoMapa('pronto')
    })()
    return () => {
      vivo = false
      if (animacao.current !== null) cancelAnimationFrame(animacao.current)
      mapa.current?.remove()
      mapa.current = null
      carro.current = null
      destinoMarcador.current = null
    }
  }, [])

  // Destino no mapa.
  useEffect(() => {
    const L = leaflet.current
    const m = mapa.current
    if (estadoMapa !== 'pronto' || !L || !m || destinoLat === null || destinoLng === null) return
    destinoMarcador.current?.remove()
    destinoMarcador.current = L.marker([destinoLat, destinoLng], {
      icon: L.divIcon({ className: 'marcador-destino', html: SVG_DESTINO, iconSize: [20, 18], iconAnchor: [10, 18] }),
      keyboard: false,
      interactive: false,
    }).addTo(m)
    if (!carro.current) m.setView([destinoLat, destinoLng], 13)
  }, [estadoMapa, destinoLat, destinoLng])

  // Carro: anda do ponto atual até o novo em ~1 s (com movimento reduzido, salta).
  useEffect(() => {
    const L = leaflet.current
    const m = mapa.current
    if (estadoMapa !== 'pronto' || !L || !m || !posicao) return
    const alvo = { lat: posicao.lat, lng: posicao.lng }
    caixa.current?.setAttribute('data-posicao', `${alvo.lat.toFixed(6)},${alvo.lng.toFixed(6)}`)
    if (!carro.current) {
      carro.current = L.marker([alvo.lat, alvo.lng], {
        icon: L.divIcon({ className: 'marcador-carro', html: SVG_CARRO, iconSize: [44, 44], iconAnchor: [22, 22] }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(m)
      const limites =
        destinoLat !== null && destinoLng !== null
          ? L.latLngBounds([alvo, { lat: destinoLat, lng: destinoLng }]).pad(0.3)
          : null
      if (limites) m.fitBounds(limites, { maxZoom: 15 })
      else m.setView([alvo.lat, alvo.lng], 15)
      return
    }
    const marcador = carro.current
    const de = marcador.getLatLng()
    if (animacao.current !== null) cancelAnimationFrame(animacao.current)
    if (reduzido()) {
      marcador.setLatLng([alvo.lat, alvo.lng])
      return
    }
    const inicio = performance.now()
    const passo = (t: number) => {
      const p = interpolar({ lat: de.lat, lng: de.lng }, alvo, (t - inicio) / 1000)
      marcador.setLatLng([p.lat, p.lng])
      animacao.current = (t - inicio) / 1000 < 1 ? requestAnimationFrame(passo) : null
    }
    animacao.current = requestAnimationFrame(passo)
  }, [estadoMapa, posicao, destinoLat, destinoLng])

  // Sinal perdido: carro cinza.
  useEffect(() => {
    const el = carro.current?.getElement()
    if (el) el.classList.toggle('perdido', sinal === 'perdido')
  }, [sinal, posicao])

  return (
    <Cartao className="space-y-3 overflow-hidden p-0" data-testid="mapa-ao-vivo-cartao">
      {estadoMapa !== 'indisponivel' ? (
        <div className="relative h-72 bg-fundo">
          <div
            ref={caixa}
            data-testid="mapa-ao-vivo"
            data-pronto={estadoMapa === 'pronto' ? 'sim' : 'nao'}
            data-sinal={sinal}
            className="absolute inset-0"
            role="img"
            aria-label={`Mapa com a posição do motorista. ${textoDoSinal(sinal, idadeS)}`}
          />
        </div>
      ) : (
        <p className="m-4 rounded-campo bg-[var(--cor-laranja)]/10 px-3.5 py-3 ivo-corpo" role="note">
          O mapa não está disponível agora. A chegada prevista continua abaixo.
        </p>
      )}
      <div className="space-y-3 px-4 pb-4">
        <p
          className={`flex items-start gap-2 ivo-legenda font-semibold ${sinal === 'perdido' ? 'text-alerta-texto' : 'text-texto-suave'}`}
          aria-live="polite"
          data-testid="sinal-motorista"
        >
          <Icone nome={sinal === 'perdido' ? 'alerta' : 'sinal'} tamanho={16} className="mt-0.5" />
          {textoDoSinal(sinal, idadeS)}
        </p>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="ivo-legenda font-semibold text-texto-suave">Chegada prevista</p>
            <p className={`ivo-valor tabular-nums ${sinal === 'perdido' ? 'text-texto-suave' : ''}`} data-testid="chegada-cliente">
              {posicao?.eta ? `~${horaDe(posicao.eta)}` : '—'}
            </p>
          </div>
          <p className="text-right ivo-legenda text-texto-suave">
            {pedido.motorista_nome ?? 'Motorista'}
            {pedido.saiu_em && (
              <>
                <br />
                saiu {horaDe(pedido.saiu_em)}
              </>
            )}
          </p>
        </div>
      </div>
    </Cartao>
  )
}
