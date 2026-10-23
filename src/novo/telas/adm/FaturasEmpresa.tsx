import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto, Campo, CampoSelecao } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ErroAoCarregar, EstadoVazio } from '../../../design/componentes/Tela.tsx'
import { api } from '../../../lib/api.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { ROTULO_TIPO, diaBr } from '../../../lib/extrato.ts'
import {
  enviarPdfNota,
  faturas,
  linkNota,
  MAX_NUMERO_NF,
  MOTIVO_MAX,
  MOTIVO_MIN,
  ROTULO_SITUACAO,
  rotuloQuinzena,
  ultimaQuinzenaFechada,
  vencimentoPadrao,
  type Fatura,
  type ItemFatura,
  type Quinzena,
  type SituacaoFatura,
} from '../../../lib/faturas.ts'
import { hoje, numeroPedido } from '../../../lib/tempo.ts'

/** Quantas quinzenas fechadas a folha oferece (a primeira, a última que fechou, já vem escolhida). */
const QUINZENAS_NA_LISTA = 6
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

const chaveQuinzena = (q: Quinzena) => `${q.inicio}|${q.fim}`

/** As últimas quinzenas fechadas, da mais recente para a mais antiga (horário de Brasília). */
function quinzenasFechadas(agora: Date): Quinzena[] {
  const lista = [ultimaQuinzenaFechada(agora)]
  while (lista.length < QUINZENAS_NA_LISTA) {
    // Meio-dia de Brasília do início da quinzena: a anterior a ela é a "última fechada" daquele instante.
    lista.push(ultimaQuinzenaFechada(new Date(`${lista.at(-1)!.inicio}T12:00:00-03:00`)))
  }
  return lista
}

const CLASSE_ETIQUETA: Record<SituacaoFatura, string> = {
  ABERTA: 'border-[var(--status-agendada)] text-texto',
  VENCIDA: 'border-[var(--cor-laranja)] bg-[var(--cor-laranja)] text-marinho',
  PAGA: 'border-[var(--status-concluida)] text-texto',
  CANCELADA: 'border-borda text-texto-suave',
}

function Etiqueta({ situacao }: { situacao: SituacaoFatura }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${CLASSE_ETIQUETA[situacao]}`}>
      {ROTULO_SITUACAO[situacao]}
    </span>
  )
}

function Total({ rotulo, centavos, testid }: { rotulo: string; centavos: number; testid: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-fundo p-3">
      <p className="ivo-legenda text-texto-suave">{rotulo}</p>
      <p className="ivo-h3 tabular-nums" data-testid={testid}>
        <Dinheiro centavos={centavos} />
      </p>
    </div>
  )
}

/** Uma corrida (ou multa, ajuste, estorno) da fatura: o cobrado é `-valor_cent`. */
function LinhaItem({ i }: { i: ItemFatura }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="font-semibold">
          {i.numero !== null ? `Pedido ${numeroPedido(i.numero)}` : ROTULO_TIPO[i.tipo]}
          {i.numero !== null && i.tipo !== 'DEBITO' && <span className="font-normal text-texto-suave">, {ROTULO_TIPO[i.tipo]}</span>}
        </p>
        <p className="ivo-legenda text-texto-suave">
          {diaBr(i.criado_em.slice(0, 10))}
          {i.solicitante_nome ? `, ${i.solicitante_nome}` : ''}
        </p>
        {i.origem && i.destino && <RotaDePara origem={i.origem} destino={i.destino} paradas={i.paradas ?? []} className="mt-1" />}
      </div>
      <Dinheiro centavos={-i.valor_cent} className="shrink-0 font-bold" />
    </li>
  )
}

// ------------------------------------------------------------------------------------------------
// Folhas: gerar, pagar, cancelar e trocar o PDF. Nada muda na tela antes da resposta do servidor.
// ------------------------------------------------------------------------------------------------

function Rodape({ falha, children }: { falha: string | null; children: ReactNode }) {
  return (
    <>
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">{children}</div>
    </>
  )
}

function CampoPdf({ erro, aoEscolher }: { erro?: string; aoEscolher: (f: File | null) => void }) {
  return (
    <Campo
      type="file"
      rotulo="PDF da NF"
      ajuda="Só PDF, de até 5 MB."
      accept="application/pdf,.pdf"
      erro={erro}
      onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)}
      className="[&_input]:py-2.5"
    />
  )
}

function GerarFatura({ empresa, aoConcluir, aoFechar }: { empresa: string; aoConcluir: (m: string) => void; aoFechar: () => void }) {
  const [opcoes] = useState(() => quinzenasFechadas(new Date()))
  const [quinzena, setQuinzena] = useState<Quinzena>(opcoes[0]!)
  const [numero, setNumero] = useState('')
  const [emissao, setEmissao] = useState(() => hoje())
  const [vencimento, setVencimento] = useState(() => vencimentoPadrao(hoje()))
  const [vencimentoEditado, setVencimentoEditado] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erros, setErros] = useState<{ numero?: string; emissao?: string; pdf?: string; vencimento?: string }>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // O PDF já enviado deste arquivo: numa nova tentativa (depois de uma recusa), não sobe de novo.
  const enviado = useRef<{ arquivo: File; caminho: string } | null>(null)

  const previa = useConsulta(`adm-previa-fatura-${empresa}-${chaveQuinzena(quinzena)}`, () =>
    faturas.previa(empresa, quinzena.inicio, quinzena.fim),
  )
  const nada = previa.dados !== undefined && (previa.dados.itens.length === 0 || previa.dados.total_cent <= 0)

  function mudarEmissao(v: string) {
    setEmissao(v)
    if (!vencimentoEditado && DATA_RE.test(v)) setVencimento(vencimentoPadrao(v))
  }

  async function confirmar() {
    if (enviando) return
    setFalha(null)
    const e: typeof erros = {}
    const n = numero.trim()
    if (n.length < 1 || n.length > MAX_NUMERO_NF) e.numero = `Informe o número da NF (até ${MAX_NUMERO_NF} caracteres).`
    if (!DATA_RE.test(emissao)) e.emissao = 'Informe a data de emissão.'
    if (!arquivo) e.pdf = 'Anexe o PDF da NF.'
    if (!DATA_RE.test(vencimento) || (DATA_RE.test(emissao) && vencimento < emissao)) {
      e.vencimento = 'Informe o vencimento, na emissão ou depois dela.'
    }
    setErros(e)
    if (Object.keys(e).length > 0 || !arquivo) return
    setEnviando(true)
    let caminho = enviado.current?.arquivo === arquivo ? enviado.current.caminho : null
    if (!caminho) {
      const up = await enviarPdfNota(empresa, arquivo)
      if (!up.ok) {
        setEnviando(false)
        setFalha(mensagemDoCodigo(up.codigo))
        return
      }
      caminho = up.caminho
      enviado.current = { arquivo, caminho }
    }
    const r = await faturas.gerar(empresa, quinzena.inicio, quinzena.fim, {
      numero: n,
      emitida_em: emissao,
      pdf_caminho: caminho,
      vencimento,
    })
    setEnviando(false)
    if (r.ok) aoConcluir(`Fatura nº ${String(r.numero)} gerada.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        void confirmar()
      }}
    >
      <CampoSelecao
        rotulo="Quinzena"
        value={chaveQuinzena(quinzena)}
        onChange={(e) => setQuinzena(opcoes.find((q) => chaveQuinzena(q) === e.target.value) ?? opcoes[0]!)}
      >
        {opcoes.map((q) => (
          <option key={chaveQuinzena(q)} value={chaveQuinzena(q)}>
            {rotuloQuinzena(q)}
          </option>
        ))}
      </CampoSelecao>

      <section aria-label="Prévia da fatura" className="space-y-2 rounded-xl border border-borda px-3 py-2">
        {previa.dados === undefined ? (
          previa.erro ? (
            <div className="space-y-2 py-1">
              <Mensagem tipo="erro">Não foi possível carregar a prévia desta quinzena.</Mensagem>
              <Botao onClick={previa.recarregar}>Tentar de novo</Botao>
            </div>
          ) : (
            <Skeleton className="h-24" />
          )
        ) : nada ? (
          <p className="py-2 ivo-corpo text-texto-suave">Não há nada a faturar nesta quinzena.</p>
        ) : (
          <>
            <ul className="divide-y divide-borda" data-testid="previa-fatura">
              {previa.dados.itens.map((i) => (
                <LinhaItem key={i.lancamento_id} i={i} />
              ))}
            </ul>
            <p className="flex items-baseline justify-between gap-3 border-t border-borda pt-2 font-bold">
              <span>Total da fatura</span>
              <span data-testid="total-previa">
                <Dinheiro centavos={previa.dados.total_cent} />
              </span>
            </p>
          </>
        )}
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Campo
          rotulo="Número da NF"
          autoComplete="off"
          maxLength={MAX_NUMERO_NF}
          value={numero}
          erro={erros.numero}
          onChange={(e) => setNumero(e.target.value)}
        />
        <Campo type="date" rotulo="Emissão da NF" value={emissao} erro={erros.emissao} onChange={(e) => mudarEmissao(e.target.value)} />
      </div>
      <CampoPdf erro={erros.pdf} aoEscolher={setArquivo} />
      <Campo
        type="date"
        rotulo="Vencimento"
        ajuda="Emissão + 30 dias. Pode trocar."
        value={vencimento}
        erro={erros.vencimento}
        onChange={(e) => {
          setVencimentoEditado(true)
          setVencimento(e.target.value)
        }}
      />

      <Rodape falha={falha}>
        <Botao onClick={aoFechar} disabled={enviando}>
          Voltar
        </Botao>
        <Botao type="submit" variante="principal" disabled={enviando || previa.dados === undefined || nada}>
          {enviando ? 'Gerando…' : 'Confirmar'}
        </Botao>
      </Rodape>
    </form>
  )
}

function MarcarPaga({ fatura, aoConcluir, aoFechar }: { fatura: Fatura; aoConcluir: (m: string) => void; aoFechar: () => void }) {
  const [data, setData] = useState(() => hoje())
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function confirmar() {
    if (enviando) return
    setFalha(null)
    if (!DATA_RE.test(data)) {
      setErro('Informe a data do pagamento.')
      return
    }
    setErro(undefined)
    setEnviando(true)
    const r = await faturas.marcarPaga(fatura.id, data)
    setEnviando(false)
    // JA_PROCESSADO: já estava paga (outra aba, ou a resposta anterior se perdeu).
    if (r.ok || r.codigo === 'JA_PROCESSADO') aoConcluir(`Fatura nº ${fatura.numero} marcada como paga.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-4">
      <p className="ivo-corpo">
        Total de <Dinheiro centavos={fatura.total_cent} className="font-bold" />. O pagamento entra no extrato da empresa.
      </p>
      <Campo type="date" rotulo="Data do pagamento" value={data} erro={erro} onChange={(e) => setData(e.target.value)} />
      <Rodape falha={falha}>
        <Botao onClick={aoFechar} disabled={enviando}>
          Voltar
        </Botao>
        <Botao variante="principal" disabled={enviando} onClick={() => void confirmar()}>
          {enviando ? 'Registrando…' : 'Confirmar pagamento'}
        </Botao>
      </Rodape>
    </div>
  )
}

function CancelarFatura({ fatura, aoConcluir, aoFechar }: { fatura: Fatura; aoConcluir: (m: string) => void; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function confirmar() {
    if (enviando) return
    setFalha(null)
    const m = motivo.trim()
    if (m.length < MOTIVO_MIN || m.length > MOTIVO_MAX) {
      setErro(`Informe o motivo (de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres).`)
      return
    }
    setErro(undefined)
    setEnviando(true)
    const r = await faturas.cancelar(fatura.id, m)
    setEnviando(false)
    if (r.ok) aoConcluir(`Fatura nº ${fatura.numero} cancelada. Os itens voltaram para o A faturar.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-4">
      <p className="ivo-corpo text-texto-suave">
        A fatura continua no histórico, como Cancelada. Use quando a NF for cancelada na prefeitura.
      </p>
      <AreaTexto rotulo="Motivo" value={motivo} maxLength={MOTIVO_MAX} erro={erro} onChange={(e) => setMotivo(e.target.value)} />
      <Rodape falha={falha}>
        <Botao onClick={aoFechar} disabled={enviando}>
          Voltar
        </Botao>
        <Botao variante="perigo" disabled={enviando} onClick={() => void confirmar()}>
          {enviando ? 'Cancelando…' : 'Confirmar cancelamento'}
        </Botao>
      </Rodape>
    </div>
  )
}

function TrocarPdf({
  empresa,
  fatura,
  aoConcluir,
  aoFechar,
}: {
  empresa: string
  fatura: Fatura
  aoConcluir: (m: string) => void
  aoFechar: () => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enviado = useRef<{ arquivo: File; caminho: string } | null>(null)

  async function confirmar() {
    if (enviando) return
    setFalha(null)
    if (!arquivo) {
      setErro('Anexe o PDF da NF.')
      return
    }
    setErro(undefined)
    setEnviando(true)
    let caminho = enviado.current?.arquivo === arquivo ? enviado.current.caminho : null
    if (!caminho) {
      const up = await enviarPdfNota(empresa, arquivo)
      if (!up.ok) {
        setEnviando(false)
        setFalha(mensagemDoCodigo(up.codigo))
        return
      }
      caminho = up.caminho
      enviado.current = { arquivo, caminho }
    }
    const r = await faturas.trocarPdf(fatura.id, caminho)
    setEnviando(false)
    if (r.ok) aoConcluir(`PDF da fatura nº ${fatura.numero} trocado.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-4">
      <CampoPdf erro={erro} aoEscolher={setArquivo} />
      <Rodape falha={falha}>
        <Botao onClick={aoFechar} disabled={enviando}>
          Voltar
        </Botao>
        <Botao variante="principal" disabled={enviando} onClick={() => void confirmar()}>
          {enviando ? 'Enviando…' : 'Enviar PDF'}
        </Botao>
      </Rodape>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------
// Tela
// ------------------------------------------------------------------------------------------------

type Acao = { tipo: 'gerar' } | { tipo: 'paga' | 'cancelar' | 'pdf'; fatura: Fatura }

const TITULO_ACAO: Record<Acao['tipo'], string> = {
  gerar: 'Gerar fatura',
  paga: 'Marcar como paga',
  cancelar: 'Cancelar fatura',
  pdf: 'Trocar PDF',
}

function CartaoFatura({
  f,
  aoAgir,
  aoBaixar,
}: {
  f: Fatura
  aoAgir: (a: Acao) => void
  aoBaixar: (f: Fatura) => void
}) {
  const aberta = f.status === 'ABERTA'
  return (
    <Cartao className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="ivo-h3">Fatura nº {f.numero}</h3>
          <p className="ivo-legenda text-texto-suave tabular-nums">{rotuloQuinzena(f)}</p>
        </div>
        <Etiqueta situacao={f.situacao} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <dt className="ivo-legenda text-texto-suave">Total</dt>
          <dd className="font-bold tabular-nums">
            <Dinheiro centavos={f.total_cent} />
          </dd>
        </div>
        <div>
          <dt className="ivo-legenda text-texto-suave">NF</dt>
          <dd className="font-semibold break-words">
            {f.nf_numero ?? '—'}
            {f.nf_emitida_em && <span className="block font-normal text-texto-suave tabular-nums">emitida em {diaBr(f.nf_emitida_em)}</span>}
          </dd>
        </div>
        <div>
          <dt className="ivo-legenda text-texto-suave">Vencimento</dt>
          <dd className="font-semibold tabular-nums">{f.vencimento ? diaBr(f.vencimento) : '—'}</dd>
        </div>
        {f.paga_em && (
          <div>
            <dt className="ivo-legenda text-texto-suave">Paga em</dt>
            <dd className="font-semibold tabular-nums">{diaBr(f.paga_em)}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        {f.nf_pdf_caminho && (
          <Botao className="flex items-center gap-2" onClick={() => aoBaixar(f)}>
            <Icone nome="externo" tamanho={18} />
            Baixar NF (PDF)
          </Botao>
        )}
        {aberta && (
          <>
            <Botao variante="principal" onClick={() => aoAgir({ tipo: 'paga', fatura: f })}>
              Marcar como paga
            </Botao>
            <Botao onClick={() => aoAgir({ tipo: 'pdf', fatura: f })}>Trocar PDF</Botao>
            <Botao onClick={() => aoAgir({ tipo: 'cancelar', fatura: f })}>Cancelar fatura</Botao>
          </>
        )}
      </div>
    </Cartao>
  )
}

/** /adm/faturas/:empresa — os totais, o "A faturar", as faturas e as ações do Master. */
export function FaturasEmpresa() {
  const { empresa = '' } = useParams()
  const empresas = useConsulta('adm-empresas', api.empresas)
  const nome = empresas.dados?.find((e) => e.id === empresa)?.nome ?? 'Empresa'
  const { dados, erro, recarregar } = useConsulta(`adm-faturas-${empresa}`, () => faturas.listar(empresa))
  const [acao, setAcao] = useState<Acao | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)
  const faturado = dados?.forma_cobranca === 'FATURADO'
  const ordenadas = useMemo(() => [...(dados?.faturas ?? [])].sort((a, b) => b.numero - a.numero), [dados])

  async function baixar(f: Fatura) {
    if (!f.nf_pdf_caminho) return
    setAviso(null)
    try {
      const link = await linkNota(f.nf_pdf_caminho)
      window.open(link, '_blank', 'noopener')
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível abrir a NF. Tente de novo.' })
    }
  }

  const concluir = (texto: string) => {
    setAcao(null)
    setAviso({ tipo: 'sucesso', texto })
    recarregar()
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="space-y-1">
        <Link to="/adm/faturas" viewTransition className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-xl px-2 font-semibold text-link">
          <Icone nome="setaEsquerda" tamanho={20} />
          Faturas
        </Link>
        <CabecalhoTela
          sobretitulo="Faturas"
          titulo={nome}
          acao={
            faturado && (
              <Botao variante="principal" className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => setAcao({ tipo: 'gerar' })}>
                <Icone nome="mais" tamanho={20} />
                Gerar fatura
              </Botao>
            )
          }
        />
      </div>

      <div aria-live="polite">{aviso && <Mensagem tipo={aviso.tipo}>{aviso.texto}</Mensagem>}</div>

      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Carregando as faturas">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : (
        <>
          {!faturado && <Mensagem tipo="info">{mensagemDoCodigo('NAO_FATURADO')}</Mensagem>}
          <Cartao className="grid grid-cols-3 gap-2">
            <Total rotulo="A faturar" centavos={dados.a_faturar.total_cent} testid="total-a-faturar" />
            <Total rotulo="Em aberto" centavos={dados.em_aberto_cent} testid="total-em-aberto" />
            <Total rotulo="Vencidas" centavos={dados.vencidas_cent} testid="total-vencidas" />
          </Cartao>

          {dados.a_faturar.itens.length > 0 && (
            <section aria-labelledby="titulo-a-faturar" className="space-y-2">
              <h2 id="titulo-a-faturar" className="px-1 ivo-sobretitulo text-texto-suave">
                A faturar
              </h2>
              <Cartao className="py-1">
                <ul className="divide-y divide-borda">
                  {dados.a_faturar.itens.map((i) => (
                    <LinhaItem key={i.lancamento_id} i={i} />
                  ))}
                </ul>
              </Cartao>
            </section>
          )}

          <section aria-labelledby="titulo-lista-faturas" className="space-y-2">
            <h2 id="titulo-lista-faturas" className="px-1 ivo-sobretitulo text-texto-suave">
              Faturas
            </h2>
            {ordenadas.length === 0 ? (
              <EstadoVazio icone="lista" titulo="Nenhuma fatura ainda">
                Use “Gerar fatura” quando a quinzena fechar.
              </EstadoVazio>
            ) : (
              <ul aria-label="Faturas da empresa" className="grid gap-3 md:grid-cols-2">
                {ordenadas.map((f) => (
                  <li key={f.id}>
                    <CartaoFatura f={f} aoAgir={setAcao} aoBaixar={(x) => void baixar(x)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Folha
        aberta={acao !== null}
        titulo={acao ? TITULO_ACAO[acao.tipo] : ''}
        sobretitulo={acao && acao.tipo !== 'gerar' ? `${nome}, fatura nº ${acao.fatura.numero}` : nome}
        onFechar={() => setAcao(null)}
        largura="md:max-w-2xl"
      >
        {acao?.tipo === 'gerar' && <GerarFatura empresa={empresa} aoConcluir={concluir} aoFechar={() => setAcao(null)} />}
        {acao?.tipo === 'paga' && <MarcarPaga fatura={acao.fatura} aoConcluir={concluir} aoFechar={() => setAcao(null)} />}
        {acao?.tipo === 'cancelar' && <CancelarFatura fatura={acao.fatura} aoConcluir={concluir} aoFechar={() => setAcao(null)} />}
        {acao?.tipo === 'pdf' && (
          <TrocarPdf empresa={empresa} fatura={acao.fatura} aoConcluir={concluir} aoFechar={() => setAcao(null)} />
        )}
      </Folha>
    </main>
  )
}
