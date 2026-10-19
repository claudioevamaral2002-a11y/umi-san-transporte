import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Map as MapaLeaflet, Marker } from 'leaflet'
import { criarSessaoTiles } from '../../lib/mapaTiles.ts'
import { sessaoTilesComRetentativa, type SessaoTiles } from '../../lib/mapaComRetentativa.ts'
import type { Ponto } from '../../lib/rastreio.ts'

export type { Ponto }
export interface CarroNoMapa extends Ponto {
  /** Sem sinal há mais de 60 s: o carro fica cinza na última posição. */
  perdido: boolean
}

/** Sem centro (a empresa chega na Tarefa 8): Itajaí. */
export const CENTRO_PADRAO: Ponto = { lat: -26.9078, lng: -48.6619 }
const INTERVALO_RETENTATIVA_MS = 15_000
const reduzido = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Ícones do mapa como HTML de classes (sem atributo style: a CSP não libera estilo em linha). Os mesmos do
// MapaAoVivo do app atual (classes marcador-carro / marcador-destino em src/design/estilos.css).
const SVG_CARRO =
  '<svg viewBox="0 0 64 36" width="26" height="16" aria-hidden="true"><path fill="currentColor" d="M6 22h4l5-11h17v11h4V9h12l8 9 4 2v6h-4a6 6 0 0 0-12 0H26a6 6 0 0 0-12 0H6z"/><circle cx="20" cy="27" r="4.5" fill="currentColor"/><circle cx="42" cy="27" r="4.5" fill="currentColor"/></svg>'
const SVG_DESTINO = '<svg viewBox="0 0 16 14" width="20" height="18" aria-hidden="true"><path d="M8 14 0 0h16z"/></svg>'

type Estado = 'carregando' | 'tentando' | 'pronto' | 'indisponivel'

function descricao(estado: Estado, c: { rota: boolean; destino: boolean; carro: CarroNoMapa | null }): string {
  if (estado === 'indisponivel') return 'Mapa indisponível.'
  if (estado === 'tentando') return 'O mapa não carregou. Tentando de novo a cada 15 segundos.'
  if (estado === 'carregando') return 'Carregando o mapa.'
  const partes = ['Mapa da região']
  if (c.rota) partes.push('com o trajeto desenhado em laranja')
  if (c.destino) partes.push(c.rota ? 'e o destino marcado' : 'com o destino marcado')
  let texto = `${partes.join(' ')}.`
  if (c.carro) {
    texto += c.carro.perdido
      ? ' Sinal do motorista perdido: o carro aparece cinza na última posição.'
      : ' O carro do motorista aparece no mapa.'
  }
  return texto
}

/** "lat,lng;lat,lng" → pontos (as dependências dos efeitos ficam estáveis entre renderizações). */
const chaveDosPontos = (pontos: Ponto[] | undefined) => (pontos ?? []).map((p) => `${p.lat},${p.lng}`).join(';')
const pontosDaChave = (chave: string): Ponto[] =>
  chave === ''
    ? []
    : chave.split(';').map((par) => {
        const [lat, lng] = par.split(',').map(Number) as [number, number]
        return { lat, lng }
      })

/**
 * Mapa de tela cheia do app novo: Leaflet com os blocos da Map Tiles API (sem script do Google, mesma CSP).
 * Se a sessão de blocos falhar, tenta de novo a cada 15 s. Camadas: a rota (linha laranja, só na memória da tela,
 * termos do Google), o destino e o carro (cinza com o sinal perdido).
 */
export function MapaBase({
  rota,
  carro,
  destino,
  centro,
}: {
  rota?: Ponto[]
  carro?: CarroNoMapa
  destino?: Ponto
  centro?: Ponto
}) {
  const idDescricao = useId()
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaLeaflet | null>(null)
  const [leaflet, setLeaflet] = useState<{ L: typeof import('leaflet') } | null>(null)
  const [semLeaflet, setSemLeaflet] = useState(false)
  const [sessao, setSessao] = useState<SessaoTiles | null>(null)
  const [falhou, setFalhou] = useState(false)
  const chave = import.meta.env.VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR ?? ''

  // Sessão dos blocos, com nova tentativa a cada 15 s. Sem chave não há o que tentar.
  useEffect(() => {
    if (!chave) return
    return sessaoTilesComRetentativa(chave, setSessao, INTERVALO_RETENTATIVA_MS, async (k) => {
      const s = await criarSessaoTiles(k)
      if (!s) setFalhou(true)
      return s
    })
  }, [chave])

  // Leaflet, carregado sob demanda.
  useEffect(() => {
    let vivo = true
    const animar = !reduzido()
    void Promise.all([import('leaflet').then((m) => m.default), import('leaflet/dist/leaflet.css')])
      .then(([L]) => {
        if (!vivo || !caixa.current) return
        const m = L.map(caixa.current, {
          zoomControl: false,
          attributionControl: true,
          zoomAnimation: animar,
          fadeAnimation: animar,
          markerZoomAnimation: animar,
        }).setView([CENTRO_PADRAO.lat, CENTRO_PADRAO.lng], 13)
        // Embaixo fica a folha: atribuição e zoom vão para o canto de cima, à direita (o ☰ fica à esquerda).
        m.attributionControl.setPrefix(false)
        m.attributionControl.setPosition('topright')
        L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(m)
        mapa.current = m
        requestAnimationFrame(() => m.invalidateSize())
        setLeaflet({ L })
      })
      .catch(() => {
        if (vivo) setSemLeaflet(true)
      })
    return () => {
      vivo = false
      mapa.current?.remove()
      mapa.current = null
    }
  }, [])

  // Blocos do Google, quando a sessão chega.
  const L = leaflet?.L ?? null
  const urlTile = sessao?.urlTile ?? null
  useEffect(() => {
    const m = mapa.current
    if (!L || !m || !urlTile) return
    const camada = L.tileLayer(urlTile, { maxZoom: 20, attribution: 'Google' }).addTo(m)
    return () => {
      camada.remove()
    }
  }, [L, urlTile])

  const chaveRota = chaveDosPontos(rota)
  const pontosRota = useMemo(() => pontosDaChave(chaveRota), [chaveRota])
  const destinoLat = destino?.lat ?? null
  const destinoLng = destino?.lng ?? null
  const centroLat = centro?.lat ?? CENTRO_PADRAO.lat
  const centroLng = centro?.lng ?? CENTRO_PADRAO.lng
  const carroLat = carro?.lat ?? null
  const carroLng = carro?.lng ?? null
  const carroPerdido = carro?.perdido ?? false

  // Rota e destino (e o enquadramento: o trajeto inteiro, ou o centro pedido).
  useEffect(() => {
    const m = mapa.current
    if (!L || !m) return
    const grupo = L.layerGroup().addTo(m)
    const enquadrar: Ponto[] = [...pontosRota]
    if (pontosRota.length > 1) {
      L.polyline(
        pontosRota.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#ff6a00', weight: 5, opacity: 0.95, interactive: false, className: 'rota-mapa' },
      ).addTo(grupo)
    }
    if (destinoLat !== null && destinoLng !== null) {
      L.marker([destinoLat, destinoLng], {
        icon: L.divIcon({ className: 'marcador-destino', html: SVG_DESTINO, iconSize: [20, 18], iconAnchor: [10, 18] }),
        keyboard: false,
        interactive: false,
      }).addTo(grupo)
      enquadrar.push({ lat: destinoLat, lng: destinoLng })
    }
    if (enquadrar.length > 1) m.fitBounds(L.latLngBounds(enquadrar.map((p) => [p.lat, p.lng])).pad(0.2), { maxZoom: 15 })
    else if (enquadrar.length === 1) m.setView([enquadrar[0]!.lat, enquadrar[0]!.lng], 14)
    else m.setView([centroLat, centroLng], 13)
    return () => {
      grupo.remove()
    }
  }, [L, pontosRota, destinoLat, destinoLng, centroLat, centroLng])

  // Carro: segue a posição recebida; cinza com o sinal perdido.
  const marcadorCarro = useRef<Marker | null>(null)
  useEffect(() => {
    const m = mapa.current
    if (!L || !m || carroLat === null || carroLng === null) {
      marcadorCarro.current?.remove()
      marcadorCarro.current = null
      return
    }
    if (!marcadorCarro.current) {
      marcadorCarro.current = L.marker([carroLat, carroLng], {
        icon: L.divIcon({ className: 'marcador-carro', html: SVG_CARRO, iconSize: [44, 44], iconAnchor: [22, 22] }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(m)
    } else {
      marcadorCarro.current.setLatLng([carroLat, carroLng])
    }
    marcadorCarro.current.getElement()?.classList.toggle('perdido', carroPerdido)
  }, [L, carroLat, carroLng, carroPerdido])
  useEffect(
    () => () => {
      marcadorCarro.current?.remove()
      marcadorCarro.current = null
    },
    [],
  )

  const estado: Estado =
    !chave || semLeaflet ? 'indisponivel' : L && sessao ? 'pronto' : falhou ? 'tentando' : 'carregando'
  const texto = descricao(estado, {
    rota: pontosRota.length > 1,
    destino: destinoLat !== null,
    carro: carroLat !== null && carroLng !== null ? { lat: carroLat, lng: carroLng, perdido: carroPerdido } : null,
  })

  return (
    <section aria-label="Mapa" aria-describedby={idDescricao} className="fixed inset-0 z-0 bg-fundo">
      <div
        ref={caixa}
        data-testid="mapa-base"
        data-pronto={estado === 'pronto' ? 'sim' : 'nao'}
        data-estado={estado}
        className="mapa-base absolute inset-0"
      />
      <p id={idDescricao} className="sr-only" aria-live="polite">
        {texto}
      </p>
      {(estado === 'tentando' || estado === 'indisponivel') && (
        <p
          data-testid="mapa-aviso"
          aria-hidden="true"
          className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5rem)] z-[500] mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-superficie px-4 py-2 text-center ivo-legenda font-semibold text-texto shadow-[var(--sombra)]"
        >
          {estado === 'tentando' ? 'Mapa indisponível agora. Tentando de novo…' : 'Mapa indisponível.'}
        </p>
      )}
    </section>
  )
}
