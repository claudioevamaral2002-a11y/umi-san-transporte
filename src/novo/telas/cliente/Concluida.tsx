import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../../design/componentes/Campo.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { corrida } from '../../../lib/corrida.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { execucao } from '../../../lib/execucao.ts'
import type { RespostaPedido } from '../../../lib/pedidos.ts'
import { horaDe } from '../../../lib/tempo.ts'
import { Foto } from '../../../telas/execucao/ResumoConcluido.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { diaCurto } from '../../formatos.ts'
import { NumeroPedido } from './Aguardando.tsx'
import { pedirDeNovoDe } from '../../pedirDeNovo.ts'

const NOTAS = [1, 2, 3, 4, 5] as const
const rotuloDaNota = (n: number) => `${n} ${n === 1 ? 'estrela' : 'estrelas'}`

function Estrela({ cheia }: { cheia: boolean }) {
  return (
    <span aria-hidden="true" className={`text-[1.75rem] leading-none ${cheia ? 'text-laranja' : 'text-borda'}`}>
      {cheia ? '★' : '☆'}
    </span>
  )
}

/** Nota já dada: estrelas só para ler. */
function EstrelasLidas({ nota }: { nota: number }) {
  return (
    <p role="img" aria-label={`Sua avaliação: ${nota} de 5 estrelas`} className="flex gap-1">
      {NOTAS.map((n) => (
        <Estrela key={n} cheia={n <= nota} />
      ))}
    </p>
  )
}

/**
 * As 5 estrelas como um grupo de rádio de verdade: uma parada no Tab (a marcada, ou a primeira), setas movem e marcam,
 * e a área de toque de cada estrela tem 48 px.
 */
function EstrelasParaEscolher({ nota, aoEscolher }: { nota: number | null; aoEscolher: (n: number) => void }) {
  const botoes = useRef<Array<HTMLButtonElement | null>>([])
  function teclar(e: KeyboardEvent, atual: number) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (passo === 0) return
    e.preventDefault()
    const novo = Math.min(5, Math.max(1, atual + passo))
    aoEscolher(novo)
    botoes.current[novo - 1]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Como foi com o Ivo?" className="flex">
      {NOTAS.map((n) => (
        <button
          key={n}
          ref={(el) => {
            botoes.current[n - 1] = el
          }}
          type="button"
          role="radio"
          aria-checked={nota === n}
          aria-label={rotuloDaNota(n)}
          tabIndex={nota === n || (nota === null && n === 1) ? 0 : -1}
          onClick={() => aoEscolher(n)}
          onKeyDown={(e) => teclar(e, n)}
          className="flex size-12 items-center justify-center rounded-xl"
        >
          <Estrela cheia={nota !== null && n <= nota} />
        </button>
      ))}
    </div>
  )
}

function Avaliacao({ r, aoAvaliar }: { r: RespostaPedido; aoAvaliar: () => void }) {
  const [nota, setNota] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviada, setEnviada] = useState<number | null>(null)
  const dada = r.pedido.avaliacao ?? enviada

  async function enviar() {
    if (nota === null || enviando) return
    setEnviando(true)
    setErro(null)
    const resp = await corrida.avaliar(r.pedido.id, nota, comentario.trim() || null)
    setEnviando(false)
    if (resp.ok) {
      setEnviada(nota)
      aoAvaliar()
      return
    }
    // Já avaliada em outro aparelho: relê o pedido, que traz a nota.
    if (resp.codigo === 'JA_AVALIADO') aoAvaliar()
    setErro(mensagemDoCodigo(resp.codigo))
  }

  if (dada !== null && dada !== undefined) {
    return (
      <section aria-label="Sua avaliação" className="mt-4 space-y-1">
        <EstrelasLidas nota={dada} />
        {enviada !== null && (
          <p role="status" className="ivo-legenda text-texto-suave">
            Obrigado pela avaliação.
          </p>
        )}
      </section>
    )
  }
  if (!r.acoes.avaliar) return null
  return (
    <section aria-label="Avaliação" className="mt-4 space-y-2">
      <p className="font-semibold">Como foi com o Ivo?</p>
      <EstrelasParaEscolher nota={nota} aoEscolher={setNota} />
      {nota !== null && (
        <div className="space-y-2">
          <AreaTexto
            rotulo="Comentário (opcional)"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            maxLength={500}
          />
          <Botao variante="principal" className="w-full" disabled={enviando} aria-busy={enviando} onClick={() => void enviar()}>
            Enviar avaliação
          </Botao>
        </div>
      )}
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
    </section>
  )
}

/**
 * Mockup 11: "Corrida concluída" com o resumo (valor, centro de custo, km e fotos), a avaliação de 1 a 5 e "Pedir de
 * novo". Nada é otimista: a nota só muda a tela depois da resposta do banco.
 */
export function Concluida({ r, podePedir, aoMudar }: { r: RespostaPedido; podePedir: boolean; aoMudar: () => void }) {
  const p = r.pedido
  const navegar = useNavigate()
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const [fotosAbertas, setFotosAbertas] = useState(false)
  const qtdFotos = p.fotos_qtd ?? 0
  const fotos = useConsulta(qtdFotos > 0 ? `novo-fotos-${p.id}-${qtdFotos}` : 'novo-fotos-nada', async () =>
    qtdFotos > 0 ? await execucao.fotos(p.id) : [],
  )
  const lista = fotos.dados ?? []
  const novo = podePedir ? pedirDeNovoDe(p) : null
  const total = r.orcamento?.total_cent

  return (
    <FolhaMapa rotulo="Corrida concluída">
      <NumeroPedido numero={p.numero} className="mb-2" />
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--status-agendada)] text-white">
          <Icone nome="check" />
        </span>
        <div>
          <h1 ref={titulo} tabIndex={-1} className="ivo-h2 outline-none">
            Corrida concluída
          </h1>
          {p.saiu_em && p.concluiu_em && (
            <p className="ivo-legenda text-texto-suave tabular-nums">
              {diaCurto(p.saiu_em)} · {horaDe(p.saiu_em)} → {horaDe(p.concluiu_em)}
            </p>
          )}
        </div>
      </div>

      <dl data-testid="resumo-corrida" className="grid grid-cols-2 gap-2">
        <div className="rounded-cartao border border-borda p-3">
          <dt className="ivo-legenda text-texto-suave">Valor</dt>
          <dd className="font-bold">{total === undefined ? '—' : <Dinheiro centavos={total} />}</dd>
        </div>
        <div className="rounded-cartao border border-borda p-3">
          <dt className="ivo-legenda text-texto-suave">Centro de custo</dt>
          <dd className="font-bold break-words">{p.centro_custo || '—'}</dd>
        </div>
        <div className="rounded-cartao border border-borda p-3">
          <dt className="ivo-legenda text-texto-suave">Km rodados</dt>
          <dd className="font-bold tabular-nums">
            {p.km_rodados === null || p.km_rodados === undefined ? '—' : `~${Math.round(p.km_rodados)} km`}
          </dd>
        </div>
        <div className="rounded-cartao border border-borda p-3">
          <dt className="ivo-legenda text-texto-suave">Fotos</dt>
          <dd className="font-bold tabular-nums">
            {qtdFotos > 0 ? (
              <button
                type="button"
                aria-expanded={fotosAbertas}
                aria-label={`Fotos: ${qtdFotos}`}
                onClick={() => setFotosAbertas((a) => !a)}
                className="-m-2 min-h-12 rounded-lg p-2 font-bold"
              >
                {qtdFotos} {fotosAbertas ? '▾' : '▸'}
              </button>
            ) : (
              '0'
            )}
          </dd>
        </div>
      </dl>
      {fotosAbertas && (
        <ul className="mt-2 grid grid-cols-4 gap-2" aria-label="Fotos do serviço">
          {lista.map((f) => (
            <Foto key={f.id} foto={f} />
          ))}
        </ul>
      )}

      <Avaliacao r={r} aoAvaliar={aoMudar} />

      <div className="mt-4">
        {novo ? (
          <Botao variante="principal" className="w-full" onClick={() => navegar('/', { state: { pedirDeNovo: novo } })}>
            Pedir de novo
          </Botao>
        ) : (
          <Botao className="w-full" onClick={() => navegar('/')}>
            Voltar ao início
          </Botao>
        )}
      </div>
    </FolhaMapa>
  )
}
