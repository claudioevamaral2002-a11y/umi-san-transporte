import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Map as MapaLeaflet } from 'leaflet'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import type { Local } from '../../lib/enderecos.ts'
import { criarSessaoTiles } from '../../lib/mapaTiles.ts'

/** Itajaí (porto), quando não há ponto de partida. */
const ITAJAI = { lat: -26.9078, lng: -48.6619 }
const AVISO_SEM_MAPA = 'O mapa não está disponível agora. Escreva o local; o motorista confere os km.'

const reduzido = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Pino fixo no centro do mapa: a ponta é o triângulo laranja da marca. */
function Pino() {
  return (
    <svg
      data-testid="pino"
      viewBox="0 0 36 52"
      width="36"
      height="52"
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 z-[500] -translate-x-1/2 -translate-y-full drop-shadow"
    >
      <circle cx="18" cy="16" r="14" fill="var(--cor-marinho)" stroke="#fff" strokeWidth="3" />
      <circle cx="18" cy="16" r="5" fill="#fff" />
      <path d="M8 34h20L18 52z" fill="var(--cor-laranja)" />
    </svg>
  )
}

function Mapa({ centro, aoUsar }: { centro: { lat: number; lng: number }; aoUsar: (local: Local) => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaLeaflet | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'indisponivel'>('carregando')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | undefined>()
  const animar = !reduzido()

  useEffect(() => {
    let vivo = true
    void (async () => {
      const chave = import.meta.env.VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR ?? ''
      // Leaflet e o CSS dele só carregam quando a folha abre (fora da carga inicial do app).
      const [sessao, L] = await Promise.all([
        criarSessaoTiles(chave),
        import('leaflet').then((m) => m.default).catch(() => null),
        import('leaflet/dist/leaflet.css').catch(() => null),
      ])
      if (!vivo || !caixa.current) return
      if (!sessao || !L) {
        setEstado('indisponivel')
        return
      }
      const m = L.map(caixa.current, {
        zoomControl: true,
        attributionControl: true,
        zoomAnimation: animar,
        fadeAnimation: animar,
        markerZoomAnimation: animar,
        inertia: animar,
      }).setView([centro.lat, centro.lng], 15)
      m.attributionControl.setPrefix(false)
      L.tileLayer(sessao.urlTile, { maxZoom: 20, attribution: 'Google' }).addTo(m)
      const marcarCentro = () => {
        const c = m.getCenter()
        caixa.current?.setAttribute('data-centro', `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`)
      }
      m.on('moveend', marcarCentro)
      marcarCentro()
      mapa.current = m
      // O <dialog> acabou de abrir: o Leaflet confere o tamanho real da caixa.
      requestAnimationFrame(() => m.invalidateSize())
      setEstado('pronto')
    })()
    return () => {
      vivo = false
      mapa.current?.remove()
      mapa.current = null
    }
  }, [centro.lat, centro.lng, animar])

  function usar(e: FormEvent) {
    e.preventDefault()
    const n = nome.trim()
    if (n.length < 3 || n.length > 200) {
      setErro('Dê um nome ao local (de 3 a 200 caracteres).')
      return
    }
    const m = mapa.current
    if (!m) return
    const c = m.getCenter()
    aoUsar({ nome: n, endereco: null, lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)), place_id: null })
  }

  if (estado === 'indisponivel') {
    return (
      <p role="note" className="rounded-campo bg-[var(--cor-laranja)]/10 px-3.5 py-3 ivo-corpo">
        {AVISO_SEM_MAPA}
      </p>
    )
  }

  return (
    <form onSubmit={usar} noValidate className="space-y-3">
      <div className="relative h-[52dvh] overflow-hidden rounded-cartao border border-borda bg-fundo">
        <div
          ref={caixa}
          data-testid="mapa"
          data-pronto={estado === 'pronto' ? 'sim' : 'nao'}
          data-animacao={animar ? 'sim' : 'nao'}
          className="absolute inset-0"
          aria-label="Mapa: arraste para posicionar o ponto"
          role="application"
        />
        {estado === 'pronto' && <Pino />}
      </div>
      <p className="ivo-legenda text-texto-suave">Mova o mapa até a ponta do triângulo ficar no lugar certo.</p>
      <Campo
        rotulo="Nome do local"
        value={nome}
        maxLength={200}
        autoComplete="off"
        placeholder="Ex.: Marina Itajaí, rampa 2"
        erro={erro}
        onChange={(e) => {
          setNome(e.target.value)
          setErro(undefined)
        }}
      />
      <Botao type="submit" variante="principal" className="w-full" disabled={estado !== 'pronto'}>
        Usar este ponto
      </Botao>
    </form>
  )
}

/**
 * Fase 3A: "Marcar no mapa" para portos, marinas e estaleiros sem endereço exato. O mapa se move por baixo do pino fixo;
 * a pessoa dá um nome ao ponto e confirma. Leaflet com os blocos da Google Map Tiles API, carregados sob demanda.
 */
export function FolhaMarcarNoMapa({
  aberta,
  centro,
  aoFechar,
  aoUsar,
}: {
  aberta: boolean
  centro: { lat: number; lng: number } | null
  aoFechar: () => void
  aoUsar: (local: Local) => void
}) {
  return (
    <Folha aberta={aberta} titulo="Marcar no mapa" onFechar={aoFechar} largura="md:max-w-2xl">
      <Mapa centro={centro ?? ITAJAI} aoUsar={aoUsar} />
    </Folha>
  )
}
