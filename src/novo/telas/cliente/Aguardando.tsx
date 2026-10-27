import { useState } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../../design/componentes/Campo.tsx'
import { DesenhoPickup } from '../../../design/componentes/CarregandoPickup.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { pedidos, type RespostaPedido } from '../../../lib/pedidos.ts'
import { numeroPedido } from '../../../lib/tempo.ts'
import { useAgora } from '../../../lib/useAgora.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { prazoAte, quandoCompleto } from '../../formatos.ts'
import { DetalhesPedido } from './DetalhesPedido.tsx'

/** Número do pedido, origem, dia e categoria, destino: o trilho do mockup 3 (v2.2: com o número, como nas listas). */
export function TrilhoCorrida({ r }: { r: RespostaPedido }) {
  const p = r.pedido
  return (
    <div className="rounded-cartao border-[1.5px] border-borda p-3">
      <p className="mb-1.5 ivo-legenda font-bold text-texto-suave tabular-nums" data-testid="numero-pedido">
        Pedido {numeroPedido(p.numero)}
      </p>
      <div className="flex gap-3">
        <div aria-hidden="true" className="flex flex-col items-center pt-1.5">
          <span className="size-2.5 rounded-full bg-marinho-2" />
          <span className="my-1 w-0.5 flex-1 bg-borda" />
          <span className="size-2.5 bg-laranja" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold break-words">
            <span className="sr-only">Origem: </span>
            {p.origem}
          </p>
          <p className="ivo-legenda text-texto-suave tabular-nums">
            {[quandoCompleto(p.inicio), p.categoria_nome].filter(Boolean).join(' · ')}
          </p>
          <p className="font-semibold break-words">
            <span className="sr-only">Destino: </span>
            {p.destino}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Mockup 3: o pedido foi enviado e o Ivo tem até o prazo para responder. Cancelar aqui não tem custo. */
export function Aguardando({ r, aoMudar }: { r: RespostaPedido; aoMudar: () => void }) {
  const agora = useAgora()
  const [cancelando, setCancelando] = useState(false)
  const p = r.pedido
  return (
    <FolhaMapa rotulo="Aguardando o Ivo">
      <div className="flex flex-col items-center gap-1 pt-1 pb-2 text-center">
        <DesenhoPickup className="h-10 w-auto text-texto" />
        <h1 className="ivo-h2">Enviado ao Ivo</h1>
        <p className="ivo-corpo text-texto-suave" aria-live="polite">
          {p.prazo_vencido ? (
            'O prazo para o Ivo responder venceu.'
          ) : (
            <>
              Ele responde até <b className="text-texto">{prazoAte(p.prazo_orcar_ate, agora)}</b>. Você recebe o valor aqui.
            </>
          )}
        </p>
      </div>
      <div className="my-3 space-y-3">
        <TrilhoCorrida r={r} />
        <DetalhesPedido r={r} />
      </div>
      {r.acoes.cancelar && (
        <Botao className="w-full" onClick={() => setCancelando(true)}>
          Cancelar pedido
        </Botao>
      )}
      <FolhaCancelar aberta={cancelando} id={p.id} aoFechar={() => setCancelando(false)} aoConcluir={aoMudar} />
    </FolhaMapa>
  )
}

function FolhaCancelar({ aberta, id, aoFechar, aoConcluir }: { aberta: boolean; id: string; aoFechar: () => void; aoConcluir: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function confirmar() {
    setEnviando(true)
    setErro(null)
    const r = await pedidos.cancelar(id, motivo.trim() || null)
    setEnviando(false)
    if (r.ok) {
      aoFechar()
      aoConcluir()
    } else setErro(mensagemDoCodigo(r.codigo))
  }
  return (
    <Folha
      aberta={aberta}
      titulo="Cancelar pedido"
      onFechar={() => {
        setMotivo('')
        setErro(null)
        aoFechar()
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void confirmar()
        }}
      >
        <p className="ivo-corpo text-texto-suave">Sem custo nesta etapa. O horário fica livre.</p>
        <AreaTexto rotulo="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        <Botao type="submit" variante="perigo" className="w-full" disabled={enviando} aria-busy={enviando}>
          Cancelar pedido
        </Botao>
      </form>
    </Folha>
  )
}
