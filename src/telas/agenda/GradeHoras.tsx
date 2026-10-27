import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { MarcaAgora } from '../../design/componentes/MarcaAgora.tsx'
import { corDoStatus, StatusBadge } from '../../design/componentes/StatusBadge.tsx'
import { faixaDeHoras, posicionar, topoDoAgora, type EntradaGrade, type ItemGrade } from '../../lib/gradeAgenda.ts'
import { diaDaSemanaCurto, faixaHorario, horaDe, numeroPedido } from '../../lib/tempo.ts'
import { fimDaCorrida, SeloConcluida } from './Concluidas.tsx'

const PX_HORA = 56
const RESPIRO = 10 // espaço acima da primeira hora, para o rótulo não ser cortado

function Item({ it, compacto, equipe, pedir }: { it: ItemGrade; compacto: boolean; equipe: boolean; pedir: boolean }) {
  const posicao: CSSProperties = {
    top: it.topo + RESPIRO + 1,
    height: Math.max(it.altura - 3, 22),
    left: `calc(${(it.coluna / it.colunas) * 100}% + 4px)`,
    width: `calc(${100 / it.colunas}% - 8px)`,
  }
  const base = 'absolute overflow-hidden rounded-[10px] px-2.5 py-1.5 text-[13px] leading-snug'

  if (it.tipo === 'ocupado') {
    return (
      <div
        data-testid="bloco-ocupado"
        style={posicao}
        className={`${base} bloco-ocupado flex items-start gap-1.5 font-semibold text-texto-suave`}
      >
        <Icone nome="cadeado" tamanho={16} />
        <span className={compacto ? 'sr-only' : ''}>
          Ocupado
          <span className="block font-medium tabular-nums">
            {it.bloco && faixaHorario(it.bloco.inicio, it.bloco.fim)}
          </span>
        </span>
      </div>
    )
  }

  if (it.tipo === 'livre' && it.janela) {
    const j = it.janela
    const texto = compacto ? 'Livre' : `Livre, ${faixaHorario(j.inicio, j.fim)}`
    const classe = `${base} flex items-start justify-between gap-2 border-[1.5px] border-dashed border-livre bg-livre-fundo font-bold text-livre`
    return pedir ? (
      <Link
        to={`/pedidos/novo?inicio=${encodeURIComponent(j.inicio)}`}
        data-testid="janela-livre"
        aria-label={`Livre das ${faixaHorario(j.inicio, j.fim).replace('–', ' às ')}: fazer pedido neste horário`}
        style={posicao}
        className={classe}
      >
        <span className="tabular-nums">{texto}</span>
        {!compacto && (
          <span className="flex shrink-0 items-center gap-1">
            <Icone nome="mais" tamanho={16} />
            Pedir
          </span>
        )}
      </Link>
    ) : (
      <div data-testid="janela-livre" style={posicao} className={classe}>
        <span className="tabular-nums">{texto}</span>
      </div>
    )
  }

  if (it.tipo === 'concluida' && it.concluida) {
    // v2.2: corrida em andamento ou concluída: cartão cinza com o selo, toque abre a corrida.
    const c = it.concluida
    return (
      <Link
        to={`/pedidos/${c.id}`}
        viewTransition
        data-testid="bloco-concluida"
        aria-label={`Pedido ${numeroPedido(c.numero)}, ${faixaHorario(c.inicio, fimDaCorrida(c))}, ${c.status === 'EM_ANDAMENTO' ? 'em andamento' : 'concluída'}`}
        style={posicao}
        className={`${base} bloco-concluido block text-texto`}
      >
        <span className="block text-sm font-bold">
          {compacto ? '' : 'Pedido '}
          {numeroPedido(c.numero)}
        </span>
        <span className="block tabular-nums">{faixaHorario(c.inicio, fimDaCorrida(c))}</span>
        {compacto ? (
          <span className="mt-0.5 block">
            <SeloConcluida status={c.status} />
          </span>
        ) : (
          <>
            <span className="absolute top-1.5 right-1.5">
              <SeloConcluida status={c.status} />
            </span>
            <span className="block truncate text-texto-suave">
              {c.origem} até {c.destino}
            </span>
          </>
        )}
      </Link>
    )
  }

  const b = it.bloco!
  const cor = b.status ? corDoStatus(b.status) : 'var(--status-agendada)'
  const estilo: CSSProperties = {
    ...posicao,
    borderLeftColor: cor,
    background: `color-mix(in srgb, ${cor} 12%, var(--cor-superficie))`,
  }
  const conteudo = (
    <>
      <span className="block text-sm font-bold">
        {compacto ? '' : 'Pedido '}
        {b.numero !== undefined ? numeroPedido(b.numero) : ''}
      </span>
      <span className="block tabular-nums">{faixaHorario(b.inicio, b.fim)}</span>
      {!compacto && b.status && (
        <span className="absolute top-1.5 right-1.5">
          <StatusBadge status={b.status} />
        </span>
      )}
      {it.tipo === 'aguardando' && <span className="block font-semibold text-alerta-texto">Aguarda você</span>}
      {!compacto && (
        <>
          {equipe && b.empresa_nome && <span className="block font-semibold">{b.empresa_nome}</span>}
          {b.origem && (
            <span className="block truncate text-texto-suave">
              {b.origem} até {b.destino}
            </span>
          )}
          {b.tipo === 'PRE_RESERVA' && (
            <span className="block text-texto-suave">Pré-reserva até o orçamento ser decidido</span>
          )}
        </>
      )}
    </>
  )
  const classe = `${base} block border-l-[3px] text-texto`
  return b.pode_abrir && b.atividade_id ? (
    <Link
      to={`/pedidos/${b.atividade_id}`}
      viewTransition
      data-testid="bloco-proprio"
      style={estilo}
      className={classe}
    >
      {conteudo}
    </Link>
  ) : (
    <div data-testid="bloco-proprio" style={estilo} className={classe}>
      {conteudo}
    </div>
  )
}

/** Atualiza "agora" a cada minuto. */
function useAgoraMinuto(): Date {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return agora
}

/**
 * Grade de horas (visões Dia e 3 dias, estilo Lark): blocos posicionados pelo horário, ocupados hachurados, janelas
 * livres tracejadas e a linha laranja do "agora" com o triângulo da marca, só na coluna de hoje.
 */
export function GradeHoras({
  dias,
  itensPorDia,
  hoje,
  pedir,
  equipe,
}: {
  dias: string[]
  itensPorDia: Record<string, EntradaGrade[]>
  hoje: string
  pedir: boolean
  equipe: boolean
}) {
  const agora = useAgoraMinuto()
  const agoraIso = agora.toISOString()
  // A faixa de horas cabe os itens de cada dia e, na coluna de hoje, também o "agora".
  const { horaIni, horaFim } = dias.reduce(
    (f, d) => {
      const doDia = [...(itensPorDia[d] ?? []), ...(d === hoje ? [{ inicio: agoraIso, fim: agoraIso }] : [])]
      const r = faixaDeHoras(doDia, d)
      return {
        horaIni: Math.min(f.horaIni, r.horaIni),
        horaFim: Math.max(f.horaFim, r.horaFim),
      }
    },
    { horaIni: 24, horaFim: 0 },
  )
  const horas = Array.from({ length: horaFim - horaIni }, (_, i) => horaIni + i)
  const altura = horas.length * PX_HORA + RESPIRO
  const compacto = dias.length > 1
  const topoAgora = dias.includes(hoje) ? topoDoAgora(agora, hoje, horaIni, horaFim, PX_HORA) : null

  // Rola até o agora (ou ao primeiro item) quando o dia mostrado muda.
  const alvo = useRef<HTMLDivElement>(null)
  const chave = dias.join(',')
  useEffect(() => {
    alvo.current?.scrollIntoView({ block: 'center' })
  }, [chave])

  const primeiro = Math.min(
    ...dias.flatMap((d) => posicionar(itensPorDia[d] ?? [], d, horaIni, horaFim, PX_HORA).map((i) => i.topo)),
    Infinity,
  )
  const topoAlvo = topoAgora ?? (Number.isFinite(primeiro) ? primeiro : null)

  return (
    <>
      {compacto && (
        <div aria-hidden="true" className="-mx-4 flex pt-1 pb-2">
          <span className="w-[52px] shrink-0" />
          {dias.map((d) => (
            <span
              key={d}
              data-testid="cabecalho-dia"
              className={`flex-1 text-center text-sm font-semibold ${d === hoje ? 'text-alerta-texto' : 'text-texto-suave'}`}
            >
              {diaDaSemanaCurto(d)} <span className="font-bold tabular-nums">{Number(d.slice(8))}</span>
            </span>
          ))}
        </div>
      )}
      <div data-testid="grade-horas" className="relative -mx-4 border-t border-borda" style={{ height: altura }}>
        {horas.map((h, i) => (
          <div key={h} className="absolute inset-x-0 flex" style={{ top: RESPIRO + i * PX_HORA }}>
            <span className="w-[52px] shrink-0 -translate-y-2 pr-2 text-right text-xs font-medium text-texto-suave tabular-nums">
              {String(h).padStart(2, '0')}:00
            </span>
            <span className="flex-1 border-t border-borda" />
          </div>
        ))}
        <div className="absolute top-0 right-0 bottom-0 left-[52px] flex">
          {dias.map((d, i) => (
            <div key={d} data-coluna-dia={d} className={`relative flex-1 ${i > 0 ? 'border-l border-borda' : ''}`}>
              {posicionar(itensPorDia[d] ?? [], d, horaIni, horaFim, PX_HORA).map((it) => (
                <Item key={it.chave} it={it} compacto={compacto} equipe={equipe} pedir={pedir} />
              ))}
              {d === hoje && topoAgora !== null && (
                <div
                  data-testid="linha-agora"
                  aria-label={`Agora, ${horaDe(agora)}`}
                  role="img"
                  className="absolute right-0 left-0 z-10 h-[2px] bg-laranja"
                  style={{ top: RESPIRO + topoAgora }}
                >
                  <MarcaAgora className="absolute -top-[11px] -left-[7px]" />
                </div>
              )}
            </div>
          ))}
        </div>
        {topoAgora !== null && (
          <span
            aria-hidden="true"
            className="absolute left-0 z-10 w-[46px] bg-fundo pr-1 text-right text-[11px] font-bold text-alerta-texto tabular-nums"
            style={{ top: RESPIRO + topoAgora - 8 }}
          >
            {horaDe(agora)}
          </span>
        )}
        {topoAlvo !== null && (
          <div ref={alvo} aria-hidden="true" className="absolute left-0" style={{ top: RESPIRO + topoAlvo }} />
        )}
      </div>
    </>
  )
}
