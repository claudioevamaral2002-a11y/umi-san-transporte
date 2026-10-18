import { useEffect, useState, type ReactNode } from 'react'
import { Icone, type NomeIcone } from '../../design/componentes/Icone.tsx'
import { linkGoogleMaps, linkWaze } from '../../lib/execucaoExibicao.ts'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import type { PontoDoPedido } from '../../lib/viagem.ts'

/** Relógio da tela (re-renderiza a cada `ms`); para contagens e o estado do sinal. */
export function useAgora(ms: number): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return agora
}

export function pontosDoPedido(p: DetalhePedido): { origem: PontoDoPedido; destino: PontoDoPedido } {
  return {
    origem: { nome: p.origem, lat: p.origem_lat ?? null, lng: p.origem_lng ?? null, place_id: p.origem_place_id ?? null },
    destino: { nome: p.destino, lat: p.destino_lat ?? null, lng: p.destino_lng ?? null, place_id: p.destino_place_id ?? null },
  }
}

const BOTAO_LINK =
  'flex min-h-12 items-center justify-center gap-2 rounded-botao border border-borda bg-superficie px-4 ivo-botao text-texto'

function LinkAcao({ href, icone, children, externo = true }: { href: string; icone: NomeIcone; children: ReactNode; externo?: boolean }) {
  return (
    <a href={href} className={BOTAO_LINK} {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      <Icone nome={icone} tamanho={20} />
      {children}
    </a>
  )
}

/** Maps, Waze e Ligar para o contato (quando houver telefone). */
export function AtalhosDaViagem({ alvo, telefone }: { alvo: PontoDoPedido; telefone: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="atalhos-viagem">
      <LinkAcao href={linkGoogleMaps(alvo)} icone="mapa">
        Maps
      </LinkAcao>
      <LinkAcao href={linkWaze(alvo)} icone="local">
        Waze
      </LinkAcao>
      {telefone && (
        <LinkAcao href={`tel:${telefone.replace(/[^\d+]/g, '')}`} icone="telefone" externo={false}>
          Ligar
        </LinkAcao>
      )}
    </div>
  )
}

export function ResumoViagem({ itens }: { itens: Array<{ rotulo: string; valor: string | null }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="resumo-viagem">
      {itens
        .filter((i) => i.valor !== null)
        .map((i) => (
          <div key={i.rotulo}>
            <dt className="ivo-legenda font-semibold text-texto-suave">{i.rotulo}</dt>
            <dd className="text-[17px] font-bold tabular-nums">{i.valor}</dd>
          </div>
        ))}
    </dl>
  )
}
