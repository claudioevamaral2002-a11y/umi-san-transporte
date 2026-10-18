import { useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import { horaDe } from '../../lib/tempo.ts'
import { useEnvioDePosicao, useTelaAcesa, type EstadoGps } from '../../lib/viagem.ts'
import { AtalhosDaViagem, pontosDoPedido, useAgora } from './comum.tsx'
import { FolhaConcluir } from './FolhaConcluir.tsx'
import { FolhaPrevisao } from './FolhaPrevisao.tsx'

const CHAVE_CIENTE = 'ivo:aviso-localizacao'

function lerCiente(): boolean {
  try {
    return localStorage.getItem(CHAVE_CIENTE) === '1'
  } catch {
    return false
  }
}

function SeloGps({ estado }: { estado: EstadoGps }) {
  if (estado === 'negado' || estado === 'indisponivel') {
    return (
      <Mensagem tipo="erro">
        {estado === 'negado'
          ? 'A localização está bloqueada para o app. Libere nas configurações do navegador para o cliente acompanhar a viagem.'
          : 'Não foi possível usar o GPS agora. A viagem segue normalmente; o cliente vê "localização indisponível".'}
      </Mensagem>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-selecao-suave px-3 py-1.5 ivo-legenda font-bold" data-testid="selo-localizacao" data-estado={estado}>
      <span
        aria-hidden="true"
        className={`size-2.5 rounded-full ${estado === 'ativo' ? 'bg-[var(--status-concluida)] motion-safe:animate-pulse' : 'bg-texto-suave'}`}
      />
      {estado === 'ativo' ? 'Compartilhando sua localização' : 'Procurando o sinal do GPS…'}
    </span>
  )
}

/**
 * Motorista com a viagem em andamento: envia a posição (com a tela aberta e acesa), mostra a chegada prevista e dá
 * acesso à nova previsão e à conclusão. Antes da primeira viagem, explica o que é compartilhado (LGPD, §5).
 */
export function ViagemMotorista({
  pedido,
  aoMudou,
}: {
  pedido: DetalhePedido
  aoMudou: (aviso: string | null) => void
}) {
  const [ciente, setCiente] = useState(lerCiente)
  const [previsao, setPrevisao] = useState(false)
  const [concluindo, setConcluindo] = useState(false)
  const agora = useAgora(30_000)
  const { origem, destino } = pontosDoPedido(pedido)
  const idaEVolta = pedido.levar && pedido.trazer
  useTelaAcesa(true)
  const { estado, chegada, alvo } = useEnvioDePosicao({ id: pedido.id, ativo: ciente, idaEVolta, origem, destino })
  const atrasado = pedido.fim_previsto ? Date.parse(pedido.fim_previsto) < agora : false

  return (
    <Cartao className="space-y-4" data-testid="viagem-motorista">
      {!ciente ? (
        <div className="space-y-3" data-testid="aviso-localizacao">
          <h2 className="ivo-h3">Compartilhar sua localização</h2>
          <p className="ivo-corpo text-texto-suave">
            Enquanto esta viagem estiver em andamento, quem pediu o serviço vê no mapa onde você está e a hora prevista de
            chegada. Só durante a viagem e só com o app aberto. Ao concluir, o trajeto é apagado e fica só o resumo.
          </p>
          <Botao
            variante="principal"
            className="w-full"
            onClick={() => {
              try {
                localStorage.setItem(CHAVE_CIENTE, '1')
              } catch {
                // sem armazenamento: pergunta de novo na próxima viagem
              }
              setCiente(true)
            }}
          >
            Começar a compartilhar
          </Botao>
        </div>
      ) : (
        <SeloGps estado={estado} />
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ivo-legenda font-semibold text-texto-suave">Chegada {alvo === 'origem' ? 'na volta' : 'ao destino'}</p>
          <p className="ivo-valor tabular-nums" data-testid="chegada-prevista">
            {chegada ? `~${horaDe(chegada)}` : '—'}
          </p>
        </div>
        {pedido.fim_previsto && (
          <p className="text-right ivo-legenda text-texto-suave">
            Término previsto
            <br />
            <span className="font-bold text-texto tabular-nums">{horaDe(pedido.fim_previsto)}</span>
          </p>
        )}
      </div>

      {atrasado && (
        <Mensagem tipo="erro">
          Você passou da previsão ({horaDe(pedido.fim_previsto!)}). Informe uma nova para a agenda e o próximo cliente.
        </Mensagem>
      )}

      <p className="flex gap-2 rounded-cartao bg-[var(--cor-laranja)]/10 p-3 ivo-corpo" role="note">
        <Icone nome="alerta" className="mt-0.5 text-alerta-texto" />
        <span>
          <span className="font-bold">Mantenha o app aberto.</span> O cliente está acompanhando você. Com a tela apagada, o
          envio para.
        </span>
      </p>

      <AtalhosDaViagem alvo={alvo === 'origem' ? origem : destino} telefone={pedido.contato_telefone} />

      <div className="grid gap-2 border-t border-borda pt-4">
        <Botao className="flex w-full items-center justify-center gap-2" onClick={() => setPrevisao(true)}>
          <Icone nome="relogio" tamanho={20} />
          Nova previsão de término
        </Botao>
        <Botao variante="principal" className="flex w-full items-center justify-center gap-2" onClick={() => setConcluindo(true)}>
          <Icone nome="check" tamanho={20} />
          Concluir serviço
        </Botao>
      </div>

      <FolhaPrevisao
        aberta={previsao}
        id={pedido.id}
        aoFechar={() => setPrevisao(false)}
        aoSalvo={(m) => {
          setPrevisao(false)
          aoMudou(m)
        }}
      />
      <FolhaConcluir
        aberta={concluindo}
        pedido={pedido}
        aoFechar={() => setConcluindo(false)}
        aoConcluido={(m) => {
          setConcluindo(false)
          aoMudou(m)
        }}
      />
    </Cartao>
  )
}
