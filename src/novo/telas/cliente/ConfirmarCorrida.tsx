import { useId, useState } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto, Campo } from '../../../design/componentes/Campo.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { categorias, kmDaRota, MAX_CENTRO_CUSTO, toleranciaKm } from '../../../lib/categorias.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { corrida, resumoDaProposta } from '../../../lib/corrida.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { pedidos, type LinhaOrcamento, type RespostaPedido } from '../../../lib/pedidos.ts'
import { dinheiro, Intencao, resumoDispositivo, saldoAposAprovacao, semResposta } from '../../../lib/saldo.ts'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { topicoSaldo } from '../../../lib/topicos.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { Memorial } from '../../../telas/pedidos/componentes.tsx'
import { SaldoInsuficiente, type Aprovacao } from '../../../telas/pedidos/Aprovar.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { iniciais, quandoCompleto, reaisCurto } from '../../formatos.ts'
import { gravarUltimoCentroCusto, lerUltimoCentroCusto } from '../../preferencias.ts'
import { paradasDoDetalhe } from './paradasDoDetalhe.ts'

const MUDOU = ['ORCAMENTO_ALTERADO', 'ORCAMENTO_VENCIDO', 'STATUS_INVALIDO', 'HORARIO_OCUPADO']

const TEXTO_MUDOU: Record<string, string> = {
  ORCAMENTO_ALTERADO: 'A proposta mudou desde que você abriu. Atualizamos a tela: confira o novo valor antes de confirmar.',
  ORCAMENTO_VENCIDO: 'O prazo para confirmar esta proposta venceu e o pedido foi encerrado. Se ainda precisar, peça de novo.',
  STATUS_INVALIDO: 'Este pedido mudou de situação. Atualizamos a tela para você conferir.',
  HORARIO_OCUPADO: 'O horário deste pedido não está mais livre. Peça de novo com outro horário.',
}

type Estado = { fase: 'pronto' } | { fase: 'confirmando' } | { fase: 'erro'; codigo: string; detalhe: Record<string, unknown> }

const primeiroNome = (nome: string | null) => nome?.trim().split(/\s+/)[0] ?? 'motorista'

/**
 * "Pela tabela" = a estimativa da mesma categoria para a mesma rota, com as paradas e as horas estimadas do pedido
 * (o banco calcula; a tela só compara). v2.1: com as diárias estimadas e a volta à origem do pedido; o pedido antigo de
 * ida e volta (`trazer`) continua com o preço de ida e volta.
 */
function useTabela(r: RespostaPedido, km: number | null, kmVolta: number | null) {
  const p = r.pedido
  const codigo = p.categoria ?? null
  const paradas = paradasDoDetalhe(p).quantidade
  const horas = paradasDoDetalhe(p).horas
  const diarias = p.diarias_estimadas ?? null
  const volta = p.volta_a_origem === true
  const chave =
    codigo && km !== null
      ? `novo-tabela-${p.id}-${kmDaRota(km)}-${kmVolta}-${p.levar}-${p.trazer}-${paradas}-${horas ?? ''}-${diarias ?? ''}-${volta}`
      : 'novo-tabela-nada'
  const { dados } = useConsulta(chave, async () => {
    if (!codigo || km === null) return null
    const lista = await categorias.disponiveis({
      km: kmDaRota(km),
      kmVolta,
      levar: p.levar,
      trazer: p.trazer,
      paradas: paradas > 0 ? paradas : null,
      horas,
      diarias,
      voltaAOrigem: volta,
    })
    const c = lista.categorias.find((x) => x.codigo === codigo)
    return c && c.total_cent !== null ? { total_cent: c.total_cent, linhas: c.linhas ?? [] } : null
  })
  return dados ?? null
}

/** Folha de "Pedir outro valor" (volta ao Ivo, com motivo) e de "Recusar" (encerra, motivo opcional). */
function FolhaResposta({
  tipo,
  id,
  aoFechar,
  aoConcluir,
}: {
  tipo: 'revisao' | 'recusar' | null
  id: string
  aoFechar: () => void
  aoConcluir: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const revisao = tipo === 'revisao'
  async function enviar() {
    const m = motivo.trim()
    if (revisao && (m.length < 3 || m.length > 500)) {
      setErro('Informe o motivo (de 3 a 500 caracteres).')
      return
    }
    setEnviando(true)
    setErro(null)
    const r = revisao ? await pedidos.pedirRevisao(id, m) : await pedidos.reprovar(id, m || null)
    setEnviando(false)
    if (r.ok) {
      setMotivo('')
      aoFechar()
      aoConcluir()
    } else setErro(mensagemDoCodigo(r.codigo))
  }
  return (
    <Folha
      aberta={tipo !== null}
      titulo={revisao ? 'Pedir outro valor' : 'Recusar a proposta'}
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
          void enviar()
        }}
      >
        <p className="ivo-corpo text-texto-suave">
          {revisao
            ? 'O pedido volta para o Ivo com o seu motivo, e ele manda uma nova proposta.'
            : 'O pedido é encerrado e o horário fica livre. Nada é cobrado.'}
        </p>
        <AreaTexto
          rotulo={revisao ? 'Motivo' : 'Motivo (opcional)'}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
          required={revisao}
        />
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        <Botao type="submit" variante={revisao ? 'principal' : 'perigo'} className="w-full" disabled={enviando} aria-busy={enviando}>
          {revisao ? 'Enviar pedido' : 'Recusar a proposta'}
        </Botao>
      </form>
    </Folha>
  )
}

/**
 * Mockup 4: motorista, veículo, valor e, numa contraproposta, "Pela tabela R$ X · Proposta do Ivo R$ Y" com o resumo do
 * que mudou e "Ver o cálculo". Centro de custo com o último usado. Confirmar reserva no saldo: nada muda na tela antes
 * da resposta do servidor (sem UI otimista), e a nova tentativa usa a mesma chave.
 */
export function ConfirmarCorrida({
  r,
  km,
  kmVolta = null,
  aoConfirmado,
  aoMudou,
}: {
  r: RespostaPedido
  km: number | null
  /** Fase 4.1: km da volta direta, em ida e volta (`null` em trecho único ou sem rota da volta). */
  kmVolta?: number | null
  aoConfirmado: (a: Aprovacao) => void
  aoMudou: () => void
}) {
  const { perfil } = useSessao()
  const p = r.pedido
  const o = r.orcamento
  const idCalculo = useId()
  const [verCalculo, setVerCalculo] = useState(false)
  // O centro de custo informado ao pedir; sem ele, o último usado neste aparelho.
  // Pedido por categoria (app novo): o centro de custo informado ao pedir, mesmo vazio — quem confirma não aplica sem
  // ver o último deste aparelho. Pedido sem categoria (app atual): o último usado neste aparelho, como antes.
  const [centro, setCentro] = useState(() => (p.categoria ? (p.centro_custo ?? '') : (p.centro_custo ?? lerUltimoCentroCusto())))
  const [estado, setEstado] = useState<Estado>({ fase: 'pronto' })
  const [resposta, setResposta] = useState<'revisao' | 'recusar' | null>(null)
  const [intencao] = useState(() => new Intencao())
  const tabela = useTabela(r, km, kmVolta)
  const pode = r.acoes.aprovar
  const saldo = useConsulta(pode ? 'novo-saldo-confirmar' : 'novo-saldo-nada', async () => (pode ? dinheiro.saldo(null) : null))
  useTempoReal(pode ? topicoSaldo(perfil?.empresa_id) : null, saldo.recarregar, 'saldo')

  const completo = o && o.linhas && o.total_cent !== undefined && o.hash ? { ...o, linhas: o.linhas, total_cent: o.total_cent, hash: o.hash } : null
  if (!completo) {
    return (
      <FolhaMapa rotulo="Confirmar a corrida">
        <Mensagem tipo="erro">{mensagemDoCodigo('ORCAMENTO_ALTERADO')}</Mensagem>
      </FolhaMapa>
    )
  }
  const total = completo.total_cent
  // Só é contraproposta quando dá para dizer o que mudou: total diferente sem explicação (ou só a rota que andou um
  // pouco, dentro da tolerância de km) não vira "Pela tabela × Proposta".
  const resumo =
    tabela !== null && km !== null && tabela.total_cent !== total
      ? resumoDaProposta(tabela.linhas as LinhaOrcamento[], completo.linhas, { toleranciaKm: toleranciaKm(kmDaRota(km)) })
      : []
  const contraproposta = tabela !== null && resumo.length > 0
  const confirmando = estado.fase === 'confirmando'
  const nomeMotorista = primeiroNome(p.motorista_nome)

  async function confirmar() {
    if (!completo || confirmando) return
    setEstado({ fase: 'confirmando' })
    const chave = intencao.chave(`${p.id}|${completo.versao}|${completo.hash}`)
    // Vazio limpa o centro de custo gravado ao pedir; `null` (nada a trocar) o mantém.
    const cc = centro.trim() === '' ? (p.centro_custo ? '' : null) : centro.trim()
    const res = await corrida.confirmar(p.id, completo.versao, completo.hash, chave, cc, resumoDispositivo(navigator.userAgent))
    if (res.ok) {
      intencao.encerrar()
      gravarUltimoCentroCusto(cc ?? '')
      aoConfirmado({ reservado_cent: Number(res.reservado_cent), disponivel_cent: Number(res.disponivel_cent) })
      return
    }
    const codigo = res.codigo ?? 'ERRO_INESPERADO'
    setEstado({ fase: 'erro', codigo, detalhe: res })
    if (codigo === 'JA_PROCESSADO' || MUDOU.includes(codigo)) aoMudou()
  }

  const saldoDados = saldo.dados ?? null
  const depois = saldoDados ? saldoAposAprovacao(saldoDados, total) : null

  return (
    <FolhaMapa rotulo="Confirmar a corrida">
      <h1 className="sr-only">Confirmar a corrida</h1>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-marinho-2 font-extrabold text-white"
        >
          {iniciais(p.motorista_nome ?? '?')}
        </span>
        <div className="min-w-0">
          <p className="ivo-h3">{p.motorista_nome ?? 'Motorista'}</p>
          {p.veiculo && (
            <p className="ivo-legenda text-texto-suave">
              {p.veiculo.modelo} {p.veiculo.cor} ·{' '}
              <span className="rounded border border-borda px-1.5 font-bold tracking-wide text-texto">{p.veiculo.placa}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 mb-1 flex items-end justify-between gap-3">
        <Dinheiro centavos={total} className="text-3xl font-extrabold" />
        <span className="ivo-legenda text-texto-suave tabular-nums">{quandoCompleto(p.inicio)}</span>
      </div>
      <p className="ivo-legenda text-texto-suave" data-testid="comparacao" data-tabela={tabela ? 'sim' : 'nao'}>
        {contraproposta && (
          <>
            Pela tabela <b className="text-texto">{formatarCentavos(tabela.total_cent)}</b> · Proposta do {nomeMotorista}{' '}
            <b className="text-texto">{formatarCentavos(total)}</b>
            {` (${resumo.join(', ')})`}
            {' · '}
          </>
        )}
        <button
          type="button"
          aria-expanded={verCalculo}
          aria-controls={idCalculo}
          onClick={() => setVerCalculo((v) => !v)}
          className="inline-flex min-h-12 items-center font-bold text-link underline underline-offset-4"
        >
          Ver o cálculo
        </button>
      </p>
      {verCalculo && (
        <div id={idCalculo} className="mt-1 mb-2">
          <Memorial linhas={completo.linhas} total={total} />
        </div>
      )}

      {pode ? (
        <div className="mt-2 space-y-3">
          <Campo
            rotulo="Centro de custo (opcional)"
            ajuda="Fica neste aparelho para a próxima corrida."
            value={centro}
            onChange={(e) => setCentro(e.target.value)}
            maxLength={MAX_CENTRO_CUSTO}
            autoComplete="off"
            disabled={confirmando}
          />
          {saldo.dados === undefined && !saldo.erro ? (
            <Skeleton className="h-5 w-48" />
          ) : saldoDados ? (
            <div className="space-y-1">
              <p className="ivo-legenda text-texto-suave tabular-nums">
                Disponível no saldo: <Dinheiro centavos={saldoDados.disponivel_cent} />
              </p>
              {depois && !depois.cabe && (
                <p className="ivo-legenda font-semibold text-alerta-texto">
                  Pelo saldo de agora, faltariam {formatarCentavos(depois.falta_cent)}. Ao confirmar, o servidor confere o
                  saldo atualizado.
                </p>
              )}
            </div>
          ) : (
            <p className="ivo-legenda text-texto-suave">Não foi possível ler o saldo agora. O servidor confere ao confirmar.</p>
          )}

          {estado.fase === 'erro' &&
            (estado.codigo === 'SALDO_INSUFICIENTE' ? (
              <SaldoInsuficiente detalhe={estado.detalhe} />
            ) : semResposta({ ok: false, codigo: estado.codigo }) ? (
              <Mensagem tipo="erro">
                Não conseguimos confirmar com o servidor. Verifique a internet e toque de novo: a corrida não será confirmada
                duas vezes.
              </Mensagem>
            ) : (
              <Mensagem tipo="erro">{TEXTO_MUDOU[estado.codigo] ?? mensagemDoCodigo(estado.codigo)}</Mensagem>
            ))}

          <Botao
            variante="principal"
            className="w-full"
            disabled={confirmando}
            aria-busy={confirmando}
            onClick={() => void confirmar()}
          >
            {`Confirmar corrida · ${reaisCurto(total)}`}
          </Botao>
          <p role="status" className="sr-only">
            {confirmando ? 'Confirmando com o servidor…' : ''}
          </p>
          {(r.acoes.pedir_revisao || r.acoes.reprovar) && (
            <div className="grid grid-cols-2 gap-2">
              {r.acoes.pedir_revisao && (
                <Botao disabled={confirmando} onClick={() => setResposta('revisao')}>
                  Pedir outro valor
                </Botao>
              )}
              {r.acoes.reprovar && (
                <Botao disabled={confirmando} onClick={() => setResposta('recusar')}>
                  Recusar
                </Botao>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 ivo-corpo text-texto-suave">Quem fez o pedido (ou o N1 da empresa) confirma esta corrida.</p>
      )}
      <FolhaResposta tipo={resposta} id={p.id} aoFechar={() => setResposta(null)} aoConcluir={aoMudou} />
    </FolhaMapa>
  )
}
