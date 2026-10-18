import { useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import type { Papel } from '../../lib/estadoSessao.ts'
import type { RespostaPedido } from '../../lib/pedidos.ts'
import { horaDe } from '../../lib/tempo.ts'
import { AtalhosDaViagem, pontosDoPedido } from './comum.tsx'
import { FolhaConcluir } from './FolhaConcluir.tsx'
import { FolhaPrevisao } from './FolhaPrevisao.tsx'
import { MapaAoVivo } from './MapaAoVivo.tsx'
import { ResumoConcluido } from './ResumoConcluido.tsx'
import { SaidaMotorista } from './SaidaMotorista.tsx'
import { ViagemMotorista } from './ViagemMotorista.tsx'

/** O serviço anterior do motorista atrasou e passa do início deste (D4: aviso dentro do app). */
export function AvisoAtrasoAnterior({ ate }: { ate: string }) {
  return (
    <p
      className="flex gap-3 rounded-cartao bg-[var(--cor-laranja)]/10 p-4 ivo-corpo"
      role="note"
      data-testid="aviso-atraso-anterior"
    >
      <Icone nome="relogio" className="mt-0.5 shrink-0 text-alerta-texto" />
      <span>
        <span className="font-bold">O motorista está terminando outro serviço.</span> Previsão de chegada ~{horaDe(ate)}.
        Avisamos aqui quando ele sair.
      </span>
    </p>
  )
}

/** ADM com a viagem em andamento: acompanha no mapa e pode informar previsão ou concluir pelo motorista (sem GPS). */
function ViagemAdm({ r, aoMudou }: { r: RespostaPedido; aoMudou: (aviso: string | null) => void }) {
  const [previsao, setPrevisao] = useState(false)
  const [concluindo, setConcluindo] = useState(false)
  return (
    <>
      <MapaAoVivo pedido={r.pedido} />
      <div className="grid grid-cols-2 gap-2">
        <Botao onClick={() => setPrevisao(true)}>Nova previsão</Botao>
        <Botao onClick={() => setConcluindo(true)}>Concluir</Botao>
      </div>
      <FolhaPrevisao
        aberta={previsao}
        id={r.pedido.id}
        aoFechar={() => setPrevisao(false)}
        aoSalvo={(m) => {
          setPrevisao(false)
          aoMudou(m)
        }}
      />
      <FolhaConcluir
        aberta={concluindo}
        pedido={r.pedido}
        aoFechar={() => setConcluindo(false)}
        aoConcluido={(m) => {
          setConcluindo(false)
          aoMudou(m)
        }}
      />
    </>
  )
}

/**
 * Fase 3B no detalhe do pedido: o que cada perfil vê em cada etapa da execução. O banco decide as ações (`acoes`) e
 * quem vê o rastreio (`pode_ver_rastreio`); aqui só se escolhe a tela.
 */
export function PainelExecucao({
  r,
  papel,
  aoMudou,
}: {
  r: RespostaPedido
  papel: Papel | undefined
  /** Relê o pedido e mostra o aviso (sucesso) quando houver. */
  aoMudou: (aviso: string | null) => void
}) {
  const p = r.pedido
  const a = r.acoes

  if (p.status === 'AGENDADA') {
    return (
      <>
        {p.atraso_anterior_ate && <AvisoAtrasoAnterior ate={p.atraso_anterior_ate} />}
        {a.sair && (
          <Cartao className="space-y-4" data-testid="cartao-saida">
            <div>
              <p className="ivo-legenda font-semibold text-texto-suave">Próximo serviço</p>
              <p className="ivo-h3">Pronto para sair?</p>
            </div>
            <AtalhosDaViagem alvo={pontosDoPedido(p).origem} telefone={p.contato_telefone} />
            <SaidaMotorista
              id={p.id}
              liberadaEm={p.saida_liberada_em ?? null}
              aoSair={() => aoMudou('Saída registrada. Boa viagem!')}
            />
          </Cartao>
        )}
      </>
    )
  }

  if (p.status === 'EM_ANDAMENTO') {
    if (papel === 'MOTORISTA' && a.concluir) return <ViagemMotorista pedido={p} aoMudou={aoMudou} />
    if (papel === 'ADM' && a.concluir) return <ViagemAdm r={r} aoMudou={aoMudou} />
    if (p.pode_ver_rastreio) return <MapaAoVivo pedido={p} />
    return null
  }

  if (p.status === 'CONCLUIDA' && (p.saiu_em || p.concluiu_em)) {
    return <ResumoConcluido pedido={p} podeEnviarFotos={a.enviar_fotos === true} />
  }
  return null
}
