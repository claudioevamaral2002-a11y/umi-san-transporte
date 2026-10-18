// Fase 3B (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.3, §2.4): hooks da viagem do motorista. Só rodam com a
// tela "Em andamento" aberta: ao sair dela ou concluir, o GPS e a tela acesa param (nada de rastreio em segundo plano).
import { useEffect, useState } from 'react'
import type { Local } from './enderecos.ts'
import { detalhar, rota } from './enderecosRemoto.ts'
import { execucao } from './execucao.ts'
import {
  alvoDaViagem,
  chegou,
  criarAmostrador,
  precisaRecalcularEta,
  type Leitura,
  type Ponto,
} from './rastreio.ts'

export type PontoDoPedido = Pick<Local, 'nome' | 'lat' | 'lng' | 'place_id'>
export type EstadoGps = 'parado' | 'pedindo' | 'ativo' | 'negado' | 'indisponivel' | 'encerrado'

/** Coordenadas do ponto para saber quando o motorista chegou: as guardadas, ou um "detalhar" na hora (só em memória). */
async function coordenadas(p: PontoDoPedido | null): Promise<Ponto | null> {
  if (!p) return null
  if (p.lat !== null && p.lng !== null) return { lat: p.lat, lng: p.lng }
  if (!p.place_id) return null
  const l = await detalhar(p.place_id, p.nome, crypto.randomUUID())
  return l && l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null
}

/**
 * Envia a posição do motorista enquanto `ativo`: amostragem de 5 s / 50 m (sinal de vida a cada 30 s parado), chegada
 * prevista recalculada na saída, ao trocar o alvo (ida e volta) e a cada 10 min, no máximo 12 por viagem (banco).
 */
export function useEnvioDePosicao({
  id,
  ativo,
  idaEVolta,
  origem,
  destino,
}: {
  id: string
  ativo: boolean
  idaEVolta: boolean
  origem: PontoDoPedido | null
  destino: PontoDoPedido | null
}): { estado: EstadoGps; chegada: string | null; alvo: 'destino' | 'origem' } {
  const [estado, setEstado] = useState<EstadoGps>('pedindo')
  const [chegada, setChegada] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<'destino' | 'origem'>('destino')
  const chaveOrigem = JSON.stringify(origem)
  const chaveDestino = JSON.stringify(destino)
  const semGps = typeof navigator === 'undefined' || !('geolocation' in navigator)

  useEffect(() => {
    if (!ativo || semGps) return
    const o: PontoDoPedido | null = JSON.parse(chaveOrigem)
    const d: PontoDoPedido | null = JSON.parse(chaveDestino)
    let vivo = true
    let encerrado = false
    const amostrador = criarAmostrador()
    let seq = 0
    let ultima: Leitura | null = null
    let ultimoEta: { em: number; destino: 'destino' | 'origem' } | null = null
    let calculando = false
    let etaAtual: string | null = null
    let chegouNoDestino = false
    let coordDestino: Ponto | null = null
    void coordenadas(d).then((c) => {
      coordDestino = c
    })

    async function calcularEta(l: Leitura, qual: 'destino' | 'origem') {
      const ponto = qual === 'destino' ? d : o
      if (!ponto) return
      const permitido = await execucao.registrarEta(id)
      if (!permitido.ok || !vivo) return
      const r = await rota({ lat: l.lat, lng: l.lng, place_id: null }, ponto)
      if (!vivo || r.minutos === null) return
      etaAtual = new Date(Date.now() + r.minutos * 60_000).toISOString()
      setChegada(etaAtual)
    }

    async function enviar(l: Leitura) {
      if (encerrado) return
      const agora = Date.now()
      if (!chegouNoDestino && chegou(l, coordDestino)) chegouNoDestino = true
      const qual = alvoDaViagem(idaEVolta, chegouNoDestino)
      setAlvo(qual)
      if (!calculando && precisaRecalcularEta(ultimoEta, qual, agora)) {
        calculando = true
        ultimoEta = { em: agora, destino: qual }
        void calcularEta(l, qual).finally(() => {
          calculando = false
        })
      }
      seq += 1
      const r = await execucao.enviarPosicao(id, {
        lat: Number(l.lat.toFixed(6)),
        lng: Number(l.lng.toFixed(6)),
        precisao: Math.round(l.precisao * 10) / 10,
        rumo: l.rumo ?? null,
        velocidade: l.velocidade ?? null,
        seq,
        eta: etaAtual,
      })
      if (!r.ok && r.codigo === 'STATUS_INVALIDO') {
        encerrado = true
        if (vivo) setEstado('encerrado')
      }
    }

    const vigia = navigator.geolocation.watchPosition(
      (p) => {
        if (!vivo) return
        setEstado('ativo')
        const c = p.coords
        const l: Leitura = {
          lat: c.latitude,
          lng: c.longitude,
          precisao: c.accuracy,
          rumo: c.heading !== null && Number.isFinite(c.heading) ? Math.round(c.heading) : null,
          velocidade: c.speed !== null && Number.isFinite(c.speed) ? Math.min(100, Math.max(0, c.speed)) : null,
        }
        ultima = l
        if (amostrador.deveEnviar(l, Date.now())) void enviar(l)
      },
      (erro) => {
        if (vivo) setEstado(erro.code === erro.PERMISSION_DENIED ? 'negado' : 'indisponivel')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    )
    // Parado, o GPS pode não mandar leitura nova: o sinal de vida sai pela última leitura.
    const batimento = setInterval(() => {
      if (ultima && amostrador.deveEnviar(ultima, Date.now())) void enviar(ultima)
    }, 5_000)

    return () => {
      vivo = false
      navigator.geolocation.clearWatch(vigia)
      clearInterval(batimento)
    }
  }, [id, ativo, semGps, idaEVolta, chaveOrigem, chaveDestino])

  return { estado: !ativo ? 'parado' : semGps ? 'indisponivel' : estado, chegada, alvo }
}

/** Tela acesa (Wake Lock) enquanto `ativo`; o navegador solta ao esconder a aba, então pede de novo ao voltar. */
export function useTelaAcesa(ativo: boolean) {
  useEffect(() => {
    if (!ativo || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let vivo = true
    let trava: WakeLockSentinel | null = null
    const pedir = async () => {
      try {
        trava = await navigator.wakeLock.request('screen')
      } catch {
        // Bateria fraca ou navegador recusou: segue sem tela acesa (o aviso pede para manter o app aberto).
      }
    }
    void pedir()
    const aoVoltar = () => {
      if (vivo && document.visibilityState === 'visible') void pedir()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      document.removeEventListener('visibilitychange', aoVoltar)
      void trava?.release().catch(() => undefined)
    }
  }, [ativo])
}
