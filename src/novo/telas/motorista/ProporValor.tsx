import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { kmDaRota } from '../../../lib/categorias.ts'
import { corrida } from '../../../lib/corrida.ts'
import { mensagemAoOrcar } from '../../../lib/erros.ts'
import {
  DIARIAS_MAX,
  ESPERA_MAX_MEIAS,
  KM_MAX_DECIMOS,
  MAX_OUTROS,
  kmParaTexto,
  meiasParaTexto,
  montarEntrada,
  type FormOrcamento,
} from '../../../lib/orcar.ts'
import type { RespostaPedido } from '../../../lib/pedidos.ts'
import type { Veiculo } from '../../../lib/veiculos.ts'
import { Contador, Memorial } from '../../../telas/pedidos/componentes.tsx'
import { usePrevia } from '../../../telas/pedidos/usePrevia.ts'
import { formatarKm, reaisCurto } from '../../formatos.ts'
import { AVISO_PROPOSTA } from './Chamada.tsx'
import { formDaCalculadora, formDaTabela, rotuloVeiculo, trechos, useChamada } from './chamada.ts'

/** Passo do km: 1 km (em décimos). */
const PASSO_KM = 10

/** "+ R$ 40,00", "− R$ 6,00" ou "igual à tabela". */
function textoDiferenca(diferenca: number): string {
  if (diferenca === 0) return 'igual à tabela'
  return `${diferenca > 0 ? '+' : '−'} ${formatarCentavos(Math.abs(diferenca))}`
}

function Calculadora({ r, km, veiculo }: { r: RespostaPedido; km: number | null; veiculo: Veiculo }) {
  const p = r.pedido
  const navegar = useNavigate()
  const idCalculo = useId()
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const [f, setF] = useState<FormOrcamento>(() => formDaCalculadora(p, r.orcamento_anterior?.entrada ?? null, km))
  const [verCalculo, setVerCalculo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // "Pela tabela": a mesma entrada do "Aceitar" da chamada (só os km da rota), recalculada pelo banco.
  const montadoTabela = km !== null ? montarEntrada(formDaTabela(p, km)) : null
  const tabela = usePrevia(p.id, montadoTabela?.ok ? montadoTabela.entrada : null, 0)
  const montado = montarEntrada(f)
  const entrada = montado.ok ? montado.entrada : null
  const previa = usePrevia(p.id, entrada)
  const total = previa?.estado === 'ok' ? previa.total : null
  const totalTabela = tabela?.estado === 'ok' ? tabela.total : null

  const mudar = (x: Partial<FormOrcamento>) => {
    setF((a) => ({ ...a, ...x }))
    setErro(null)
  }

  async function enviar() {
    if (!entrada || total === null) return
    setEnviando(true)
    setErro(null)
    // Só as quantidades e o veículo: nenhum ajuste livre (Ruling R11). O banco recalcula e grava o mesmo total.
    const resposta = await corrida.enviarProposta(p.id, entrada, { veiculo_id: veiculo.id })
    setEnviando(false)
    if (resposta.ok) navegar('/', { replace: true, state: { aviso: AVISO_PROPOSTA } })
    else setErro(mensagemAoOrcar(resposta.codigo))
  }

  const nTrechos = trechos(p)
  return (
    <>
      <div className="mx-auto w-full max-w-lg space-y-3 px-4 pt-[calc(env(safe-area-inset-top)+5rem)] pb-4">
        <div>
          <h1 ref={titulo} tabIndex={-1} className="ivo-h2 outline-none">
            Propor outro valor
          </h1>
          <p className="ivo-legenda text-texto-suave">Ajuste os itens; o preço de cada um vem do contrato.</p>
          <p className="mt-1 ivo-legenda text-texto-suave">
            {p.categoria_nome ? `${p.categoria_nome} · ` : ''}
            {rotuloVeiculo(veiculo)}
          </p>
        </div>

        <Cartao className="divide-y divide-borda py-1" data-testid="itens-proposta">
          <Contador
            rotulo="Km rodados"
            valor={f.kmDecimos}
            min={0}
            max={KM_MAX_DECIMOS}
            passo={PASSO_KM}
            aoMudar={(kmDecimos) => mudar({ kmDecimos })}
            formatar={kmParaTexto}
            detalhe={
              km !== null
                ? `rota: ${formatarKm(kmDaRota(km))}${nTrechos === 2 ? ' por trecho (ida e volta)' : ''}`
                : 'rota indisponível agora'
            }
          />
          <Contador
            rotulo="Espera (horas)"
            valor={f.esperaMeias}
            min={0}
            max={ESPERA_MAX_MEIAS}
            aoMudar={(esperaMeias) => mudar({ esperaMeias })}
            formatar={meiasParaTexto}
          />
          <div className="py-3">
            <Campo
              rotulo="Pedágio / balsa"
              prefixo="R$"
              inputMode="decimal"
              placeholder="0,00"
              value={f.pedagio}
              onChange={(e) => mudar({ pedagio: e.target.value })}
              erro={!montado.ok ? montado.erros.pedagio : undefined}
              ajuda="Valor estimado, cobrado como informado."
            />
          </div>
          <Contador
            rotulo="Hospedagem (diárias)"
            valor={f.hospedagemDiarias}
            min={0}
            max={DIARIAS_MAX}
            aoMudar={(hospedagemDiarias) => mudar({ hospedagemDiarias })}
          />
          <p className="flex items-center gap-2 py-3 ivo-legenda text-texto-suave">
            <Icone nome="cadeado" tamanho={16} />
            Reboque: {f.usaReboque ? 'com reboque' : 'sem reboque'} (fixo pela categoria)
          </p>
        </Cartao>

        <Cartao className="space-y-3" data-testid="outros">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Outros</p>
            <span className="ivo-legenda text-texto-suave">
              {f.outros.length} de {MAX_OUTROS}
            </span>
          </div>
          {f.outros.map((o, i) => (
            <div key={i} className="flex items-end gap-2">
              <Campo
                className="flex-1"
                rotulo={`Descrição ${i + 1}`}
                value={o.descricao}
                maxLength={120}
                onChange={(e) => mudar({ outros: f.outros.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })}
              />
              <Campo
                className="w-32"
                rotulo={`Valor ${i + 1}`}
                prefixo="R$"
                inputMode="decimal"
                value={o.valor}
                onChange={(e) => mudar({ outros: f.outros.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })}
              />
              <button
                type="button"
                aria-label={`Remover item ${i + 1}`}
                onClick={() => mudar({ outros: f.outros.filter((_, j) => j !== i) })}
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
              >
                <Icone nome="lixeira" />
              </button>
            </div>
          ))}
          {!montado.ok && montado.erros.outros && (
            <p className="ivo-legenda font-semibold text-[var(--status-cancelada)]">{montado.erros.outros}</p>
          )}
          {f.outros.length < MAX_OUTROS && (
            <Botao
              className="flex w-full items-center justify-center gap-2"
              onClick={() => mudar({ outros: [...f.outros, { descricao: '', valor: '' }] })}
            >
              <Icone nome="mais" />
              Adicionar item
            </Botao>
          )}
        </Cartao>

        <Cartao className="space-y-1" data-testid="resumo-proposta">
          <p className="ivo-legenda text-texto-suave" data-testid="pela-tabela">
            {totalTabela !== null ? `Pela tabela ${formatarCentavos(totalTabela)}` : km === null ? 'Pela tabela: sem a rota agora' : 'Pela tabela…'}
          </p>
          <div className="flex items-end justify-between gap-3" aria-live="polite" aria-atomic="true">
            <span className="sr-only">Nova proposta: </span>
            {total !== null ? (
              <span className="ivo-valor tabular-nums" data-testid="total-proposta">
                {formatarCentavos(total)}
              </span>
            ) : previa?.estado === 'erro' ? (
              <span className="ivo-valor text-texto-suave">—</span>
            ) : (
              <Skeleton className="h-9 w-36" />
            )}
            {total !== null && totalTabela !== null && (
              <span className="ivo-legenda font-semibold text-texto-suave tabular-nums" data-testid="diferenca">
                {textoDiferenca(total - totalTabela)}
              </span>
            )}
          </div>
          {previa?.estado === 'erro' && <Mensagem tipo="erro">{previa.mensagem}</Mensagem>}
          {previa?.estado === 'ok' && (
            <>
              <button
                type="button"
                aria-expanded={verCalculo}
                aria-controls={idCalculo}
                onClick={() => setVerCalculo((v) => !v)}
                className="flex min-h-12 items-center gap-1 ivo-legenda font-semibold text-link"
              >
                Ver o cálculo
                <Icone nome={verCalculo ? 'setaCima' : 'setaBaixo'} tamanho={16} />
              </button>
              <div id={idCalculo} hidden={!verCalculo}>
                {verCalculo && <Memorial linhas={previa.linhas} total={previa.total} />}
              </div>
            </>
          )}
        </Cartao>
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        <Link
          to={`/chamada/${p.id}`}
          replace
          className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto"
        >
          Voltar à chamada
        </Link>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-borda bg-superficie/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Botao
            variante="principal"
            className="w-full"
            onClick={() => void enviar()}
            disabled={total === null || previa?.estado !== 'ok' || enviando}
            aria-busy={enviando}
          >
            {total !== null ? `Enviar proposta · ${reaisCurto(total)}` : 'Enviar proposta'}
          </Botao>
        </div>
      </div>
    </>
  )
}

/**
 * Mockup 6 (ajustado em 19/10): a contraproposta é a calculadora do contrato, não um valor livre. Cada mudança chama
 * `calcular_orcamento` (sem gravar) e mostra "Pela tabela R$ X", o novo total e a diferença.
 */
export function ProporValor() {
  const { id = '' } = useParams()
  const [busca] = useSearchParams()
  const { r, erro, recarregar, rota, veiculos } = useChamada(id)
  const veiculo = veiculos?.find((v) => v.id === busca.get('veiculo')) ?? veiculos?.[0] ?? null
  const esperandoRota = rota.fase === 'carregando'

  let conteudo
  if (r === undefined || veiculos === undefined || esperandoRota) {
    conteudo = erro ? (
      <div className="mx-auto max-w-lg space-y-3 p-4 pt-[calc(env(safe-area-inset-top)+5rem)]">
        <Mensagem tipo="erro">Não foi possível abrir a calculadora agora.</Mensagem>
        <Botao className="w-full" onClick={recarregar}>
          Tentar de novo
        </Botao>
      </div>
    ) : (
      <div className="mx-auto max-w-lg space-y-3 p-4 pt-[calc(env(safe-area-inset-top)+5rem)]" aria-busy="true">
        <p role="status" className="sr-only">
          Carregando a calculadora…
        </p>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    )
  } else if (!r.acoes.orcar || r.pedido.modalidade !== 'VEICULO_PROPRIO' || !veiculo) {
    conteudo = (
      <div className="mx-auto max-w-lg space-y-3 p-4 pt-[calc(env(safe-area-inset-top)+5rem)]">
        <h1 className="ivo-h2">Propor outro valor</h1>
        <Mensagem tipo="info">
          {!veiculo && r.acoes.orcar
            ? 'Nenhum veículo ativo atende esta corrida. Ative ou cadastre um em Meus veículos.'
            : 'Esta chamada não espera mais resposta.'}
        </Mensagem>
        <Link to="/" className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto">
          Voltar ao início
        </Link>
      </div>
    )
  } else {
    conteudo = <Calculadora r={r} km={rota.fase === 'pronta' ? rota.rota.km : null} veiculo={veiculo} />
  }
  return <main className="min-h-dvh bg-fundo">{conteudo}</main>
}
