// v2.2 (especificação §2 "Cancelada" e §5.2): corrida encerrada sem serviço (cancelada, expirada, recusada ou
// reprovada). No topo, o que de fato foi lançado (multa ou nada, reserva devolvida); o orçamento só aparece embaixo, como
// "não cobrado", e nunca como valor cobrado.
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { StatusBadge, type Status } from '../../../design/componentes/StatusBadge.tsx'
import { textoCobranca } from '../../../lib/cobrancaPedido.ts'
import type { RespostaPedido } from '../../../lib/pedidos.ts'
import { formatarQuando } from '../../../lib/tempo.ts'
import { Memorial } from '../../../telas/pedidos/componentes.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { TrilhoCorrida } from './Aguardando.tsx'
import { DetalhesPedido } from './DetalhesPedido.tsx'

const positivo = (v: number | null | undefined): v is number => typeof v === 'number' && v > 0

/** Título sem multa, pela situação (com multa, "Multa R$ X" em todas). */
const SEM_COBRANCA: Partial<Record<Status, string>> = {
  CANCELADA: 'Cancelada sem cobrança',
  EXPIRADA: 'Expirada · sem cobrança',
  RECUSADA: 'Recusada pelo Ivo · sem cobrança',
  REPROVADA: 'Reprovada · sem cobrança',
}

/** `aviso`: o resultado do cancelamento que acabou de ser feito nesta tela (como no detalhe de hoje). */
export function Encerrada({ r, aviso = null }: { r: RespostaPedido; aviso?: string | null }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const p = r.pedido
  const cobranca = r.cobranca ?? null
  const multa = cobranca?.multa_cent ?? null
  // "Multa R$ X" (o mesmo texto da lista, de `textoCobranca`) ou "… sem cobrança" conforme a situação.
  const resultado = positivo(multa)
    ? (textoCobranca(p.status, multa) ?? `Multa ${formatarCentavos(multa)}`)
    : (SEM_COBRANCA[p.status] ?? 'Sem cobrança')
  const liberado = cobranca?.liberado_cent
  const motivo = r.historico.at(-1)?.observacao?.trim() || null
  const o = r.orcamento
  const orcamento =
    o && o.linhas && o.total_cent !== undefined && !positivo(cobranca?.debito_cent) ? { linhas: o.linhas, total: o.total_cent } : null

  return (
    <FolhaMapa rotulo="Corrida encerrada">
      {aviso && (
        <div className="mb-3">
          <Mensagem tipo="sucesso">{aviso}</Mensagem>
        </div>
      )}
      <div className="mb-3 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--status-cancelada)] text-white"
        >
          <Icone nome="fechar" />
        </span>
        <div className="min-w-0 space-y-1">
          <h1 ref={titulo} tabIndex={-1} className="ivo-h2 outline-none" data-testid="resultado-encerrada">
            {resultado}
            {positivo(liberado) && (
              <span className="ivo-corpo font-semibold text-texto-suave"> · reserva de {formatarCentavos(liberado)} devolvida</span>
            )}
          </h1>
          <StatusBadge status={p.status} />
          {motivo && (
            <p className="ivo-corpo break-words text-texto-suave">
              <span className="font-semibold text-texto">Motivo:</span> {motivo}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <TrilhoCorrida r={r} />
        <DetalhesPedido r={r} />

        {orcamento && (
          <section aria-labelledby="orcamento-nao-cobrado" className="rounded-cartao border border-borda p-3">
            <h2 id="orcamento-nao-cobrado" className="mb-2 font-bold">
              Orçamento (não cobrado)
            </h2>
            <Memorial linhas={orcamento.linhas} total={orcamento.total} />
          </section>
        )}

        {r.historico.length > 0 && (
          <section aria-labelledby="historico-encerrada">
            <h2 id="historico-encerrada" className="mb-2 font-bold">
              Histórico
            </h2>
            <ol className="space-y-2" data-testid="historico">
              {r.historico.map((h, i) => (
                <li key={`${h.em}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-borda pb-2">
                  <StatusBadge status={h.para} />
                  <span className="ivo-legenda text-texto-suave tabular-nums">{formatarQuando(h.em)}</span>
                  {h.por_nome && <span className="ivo-legenda text-texto-suave">· {h.por_nome}</span>}
                  {h.observacao && <p className="w-full ivo-legenda break-words">{h.observacao}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <Link
          to="/"
          className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto"
        >
          Voltar ao início
        </Link>
      </div>
    </FolhaMapa>
  )
}
