import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto, Campo } from '../../../design/componentes/Campo.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Segmentado } from '../../../design/componentes/Segmentado.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'
import {
  categorias,
  comPreenchimento,
  DIARIAS_MAX,
  horasValidas,
  kmDaRota,
  MAX_CENTRO_CUSTO,
  MAX_OUTROS_CUSTOS,
  mudarDiarias,
  mudarHoras,
  pedidoDaCategoria,
  primeiroHorarioAgora,
  type CategoriaComPreco,
} from '../../../lib/categorias.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import type { Local } from '../../../lib/enderecos.ts'
import { pontoDaRota, type PontoRota } from '../../../lib/enderecosRemoto.ts'
import { mensagemDoPedido } from '../../../lib/erros.ts'
import { DURACAO_PADRAO, FORM_VAZIO, mascararTelefone, validarPasso, type ErrosPedido, type FormPedido } from '../../../lib/novoPedido.ts'
import { mensagemDeParadas, paradaDoLocal } from '../../../lib/paradas.ts'
import { pedidos } from '../../../lib/pedidos.ts'
import { diaDe, formatarDuracao, hoje, somarDias } from '../../../lib/tempo.ts'
import { Contador } from '../../../telas/pedidos/componentes.tsx'
import { DIAS_NO_SELETOR, EscolherHorario } from './EscolherHorario.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { formatarKm, quandoCompleto, quandoCurto, reaisCurto } from '../../formatos.ts'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { gravarUltimaCategoria, gravarUltimoCentroCusto, lerUltimaCategoria, lerUltimoCentroCusto } from '../../preferencias.ts'
import { useRotaComParadas, voltaAOrigem } from './rotaComParadas.ts'

export type EnderecoEscolhido = { texto: string; local: Local }

/**
 * Dá para pedir esta categoria: disponível, com preenchimento conhecido e com preço — ou, na categoria cobrada por
 * hora, com o preço pendente até as horas estimadas (o banco devolve `total_cent` nulo sem as horas).
 */
const escolhivel = (c: CategoriaComPreco) =>
  c.disponivel && comPreenchimento(c) !== null && (c.total_cent !== null || c.cobra_hora)

/** "1 h", "1,5 h". */
const formatarHoras = (h: number) => `${h.toLocaleString('pt-BR')} h`

const paradasNaLegenda = (n: number) => (n === 0 ? '' : n === 1 ? ' com 1 parada' : ` com ${n} paradas`)

type Modo = 'agendar' | 'agora'

/** Horários livres de um dia para a duração padrão (`null` = a leitura falhou). */
async function livresDoDia(dia: string): Promise<string[] | null> {
  try {
    return (await pedidos.horariosLivres(dia, DURACAO_PADRAO)).horarios
  } catch {
    return null
  }
}

/** "Agora": o primeiro horário livre a partir de agora + 60 min, hoje ou (tarde da noite) amanhã. */
async function inicioDoAgora(agora: Date): Promise<string | null> {
  const dia = diaDe(agora)
  for (const d of [dia, somarDias(dia, 1)]) {
    const livres = await livresDoDia(d)
    const h = livres ? primeiroHorarioAgora(livres, agora) : null
    if (h) return h
  }
  return null
}

/** Padrão do "Agendar": o primeiro horário livre a partir de amanhã (o "Agora" cobre o mesmo dia). */
async function primeiroAgendavel(): Promise<{ dia: string; inicio: string } | null> {
  const amanha = somarDias(hoje(), 1)
  for (let i = 0; i < DIAS_NO_SELETOR; i++) {
    const dia = somarDias(amanha, i)
    const livres = await livresDoDia(dia)
    if (livres === null) return null
    if (livres.length > 0) return { dia, inicio: [...livres].sort()[0]! }
  }
  return null
}

function CartaoCategoria({
  c,
  marcada,
  minutos,
  comOutrosCustos,
  aoEscolher,
}: {
  c: CategoriaComPreco
  marcada: boolean
  minutos: number | null
  /** v2.1: o cliente avisou outros custos; embaixo do preço da marcada, "+ outros custos no orçamento". */
  comOutrosCustos: boolean
  aoEscolher: () => void
}) {
  const disponivel = escolhivel(c)
  // No cartão marcado (fundo marinho) o texto suave perde contraste: a legenda usa a cor do cartão, um pouco apagada.
  const suave = marcada ? 'opacity-85' : 'text-texto-suave'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      disabled={!disponivel}
      onClick={aoEscolher}
      className={`flex w-full items-center gap-3 rounded-cartao border-[1.5px] px-3 py-2.5 text-left transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed ${
        marcada ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
      } ${disponivel ? '' : 'opacity-70'}`}
    >
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-fundo text-texto">
        <Icone nome="caminhao" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{c.nome}</span>
        <span className={`block ivo-legenda ${suave}`}>
          {disponivel
            ? [c.descricao_curta, minutos !== null ? formatarDuracao(minutos) : null].filter(Boolean).join(' · ')
            : 'Indisponível no momento'}
        </span>
      </span>
      {disponivel &&
        (c.total_cent !== null ? (
          <span className="shrink-0 text-right">
            <span className="block font-extrabold tabular-nums">~{reaisCurto(c.total_cent)}</span>
            <span className={`block ivo-legenda ${suave}`}>estimado</span>
            {marcada && comOutrosCustos && (
              <span className={`block ivo-legenda ${suave}`}>+ outros custos no orçamento</span>
            )}
          </span>
        ) : (
          <span className={`shrink-0 text-right ivo-legenda ${suave}`}>por hora</span>
        ))}
    </button>
  )
}

/**
 * Mockup 2: o trajeto desenhado no mapa, as categorias com o preço estimado pela tabela do contrato, "Agendar" (padrão)
 * ou "Agora", os detalhes recolhidos e "Pedir {categoria} · {dia hh:mm}". O pedido só existe depois da resposta.
 */
export function EscolherCategoria({
  origem,
  destino,
  paradas = [],
  aoAdicionarParada,
  categoriaInicial,
  diariasIniciais = 0,
  semData = false,
  aoVoltar,
}: {
  origem: EnderecoEscolhido
  destino: EnderecoEscolhido
  /** Fase 4.1: paradas entre a origem e o destino (até 3), na ordem, todas com local. */
  paradas?: readonly EnderecoEscolhido[]
  /** "+ Adicionar parada": volta aos endereços com um campo de parada novo (ausente com 3 paradas). */
  aoAdicionarParada?: () => void
  /** "Pedir de novo": a categoria da corrida anterior (vem marcada; sem ela, a última pedida neste aparelho). */
  categoriaInicial?: string
  /** "Pedir de novo" (v2.1): as diárias da corrida anterior. */
  diariasIniciais?: number
  /** "Pedir de novo": sem data escolhida; o seletor abre e o botão de pedir espera o horário. */
  semData?: boolean
  aoVoltar: () => void
}) {
  const navegar = useNavigate()
  const idQuando = useId()
  const [escolhida, setEscolhida] = useState<string | null>(() => categoriaInicial ?? lerUltimaCategoria())
  const [modo, setModo] = useState<Modo>('agendar')
  const [quandoAberto, setQuandoAberto] = useState(semData)
  const [agendado, setAgendado] = useState<{ dia: string; inicio: string | null } | null>(
    semData ? { dia: somarDias(hoje(), 1), inicio: null } : null,
  )
  const [semAgenda, setSemAgenda] = useState(false)
  const [agora, setAgora] = useState<{ inicio: string | null } | null>(null)
  const [detalhesAbertos, setDetalhesAbertos] = useState(false)
  const [form, setForm] = useState<Pick<FormPedido, 'pessoasQtd' | 'equipamentoDesc' | 'contatoNome' | 'contatoTelefone' | 'observacoes'>>({
    pessoasQtd: 1,
    equipamentoDesc: '',
    contatoNome: '',
    contatoTelefone: '',
    observacoes: '',
  })
  const [erros, setErros] = useState<ErrosPedido>({})
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [horas, setHoras] = useState<number | null>(null)
  const [centro, setCentro] = useState(() => lerUltimoCentroCusto())
  // v2.1: diárias (hospedagem) e outros custos (texto, sem valor). Sem "Ida e volta": ir e voltar é uma parada e o Para
  // igual ao De, que conta como volta à origem (sem o retorno de trecho único).
  const [diarias, setDiarias] = useState(diariasIniciais)
  const [outrosCustos, setOutrosCustos] = useState('')
  const volta = voltaAOrigem(origem.local, destino.local)
  const detalhes = useRef<HTMLDetailsElement>(null)

  const pontosParadas = paradas.map((p) => pontoDaRota(p.local)).filter((p): p is PontoRota => p !== null)
  const {
    estado: rota,
    falhou: rotaFalhou,
    km,
    kmVolta,
    tentarDeNovo,
  } = useRotaComParadas(pontoDaRota(origem.local), pontoDaRota(destino.local), pontosParadas, false)
  const pontos = rota.fase === 'pronta' ? rota.rota.pontos : []
  const fimDaRota = pontos.at(-1)
  const destinoNoMapa =
    fimDaRota ?? (destino.local.lat !== null && destino.local.lng !== null ? { lat: destino.local.lat, lng: destino.local.lng } : undefined)
  useCamadasDoMapa({ rota: pontos, destino: destinoNoMapa })

  const kmTrajeto = rota.fase === 'pronta' ? kmDaRota(rota.rota.km) : null
  const minutos = rota.fase === 'pronta' ? rota.rota.minutos : null
  const nParadas = paradas.length
  // Preço com as paradas (quantidade), as horas estimadas e as diárias; ao mudar as horas ou as diárias, a lista
  // anterior fica na tela. Outra rota, outras paradas ou a volta à origem esperam o preço novo.
  const trajeto = `${km}-${kmVolta}-${volta}-${nParadas}`
  const lista = useConsulta(
    km === null ? 'novo-categorias-nada' : `novo-categorias-${trajeto}-${horas ?? ''}-${diarias}`,
    async () =>
      km === null
        ? null
        : {
            trajeto,
            categorias: (
              await categorias.disponiveis({
                km,
                kmVolta,
                levar: true,
                paradas: nParadas > 0 ? nParadas : null,
                horas,
                diarias,
                voltaAOrigem: volta,
              })
            ).categorias,
          },
    { manterAnterior: true },
  )
  const cats = km !== null && lista.dados?.trajeto === trajeto ? lista.dados.categorias : null
  const disponiveis = (cats ?? []).filter(escolhivel)
  const atual = disponiveis.find((c) => c.codigo === escolhida) ?? disponiveis[0] ?? null
  const preenchida = atual ? comPreenchimento(atual) : null
  const faltamHoras = !!atual?.cobra_hora && (horas === null || !horasValidas(horas))
  const cobraDiaria = atual?.cobra_diaria === true

  // Padrão do "Agendar": o primeiro horário livre a partir de amanhã.
  useEffect(() => {
    if (semData) return
    let vivo = true
    void primeiroAgendavel().then((p) => {
      if (!vivo) return
      if (p) setAgendado((a) => a ?? p)
      else setSemAgenda(true)
    })
    return () => {
      vivo = false
    }
  }, [semData])

  // "Agora": calculado ao escolher (e de novo no envio).
  useEffect(() => {
    if (modo !== 'agora') return
    let vivo = true
    void inicioDoAgora(new Date()).then((inicio) => {
      if (vivo) setAgora({ inicio })
    })
    return () => {
      vivo = false
    }
  }, [modo])

  const inicio = modo === 'agora' ? (agora?.inicio ?? null) : (agendado?.inicio ?? null)
  const rotuloQuando =
    modo === 'agora'
      ? agora === null
        ? 'Agora · procurando o primeiro horário…'
        : agora.inicio
          ? `Agora · ${quandoCurto(agora.inicio)}`
          : 'Agora · sem horário livre'
      : agendado?.inicio
        ? `Agendar · ${quandoCompleto(agendado.inicio)}`
        : semData || semAgenda
          ? 'Agendar · escolha o dia'
          : 'Agendar · procurando horário…'

  function corpoDoForm(ini: string): FormPedido {
    return {
      ...FORM_VAZIO,
      ...form,
      dia: diaDe(ini),
      inicio: ini,
      duracaoMin: DURACAO_PADRAO,
      origem: origem.texto,
      destino: destino.texto,
      origemLocal: origem.local,
      destinoLocal: destino.local,
      levar: true,
      trazer: false,
      carga: preenchida?.carga ?? 'PESSOAS',
      reboque: preenchida?.reboque ?? 'NAO',
    }
  }

  /** Paradas no formato do pedido: do Google só o `place_id`; marcada no mapa, as coordenadas. */
  const paradasDoPedido = paradas.map((p) => paradaDoLocal(p.texto, p.local))

  async function pedir() {
    if (!preenchida || !inicio || enviando) return
    // O banco não devolve qual campo falhou (CAMPOS_INVALIDOS): a tela confere antes de enviar.
    const problema =
      mensagemDeParadas(paradasDoPedido) ??
      (faltamHoras ? mensagemDoPedido('CAMPOS_INVALIDOS', ['horas_estimadas']) : null) ??
      (centro.trim().length > MAX_CENTRO_CUSTO ? mensagemDoPedido('CAMPOS_INVALIDOS', ['centro_custo']) : null) ??
      (outrosCustos.trim().length > MAX_OUTROS_CUSTOS ? mensagemDoPedido('CAMPOS_INVALIDOS', ['outros_custos']) : null)
    if (problema) {
      setErroEnvio(problema)
      return
    }
    const f = corpoDoForm(inicio)
    const e = { ...validarPasso(2, f), ...validarPasso(3, f) }
    if (Object.keys(e).length > 0) {
      setErros(e)
      setDetalhesAbertos(true)
      requestAnimationFrame(() => detalhes.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setErros({})
    setErroEnvio(null)
    setEnviando(true)
    let ini = inicio
    if (modo === 'agora') {
      // O relógio andou desde a escolha: confere o primeiro horário de novo antes de enviar.
      const novo = await inicioDoAgora(new Date())
      if (novo !== inicio) {
        setAgora({ inicio: novo })
        setEnviando(false)
        setErroEnvio(
          novo
            ? `O primeiro horário livre agora é ${quandoCurto(novo)}. Confira e toque em pedir de novo.`
            : 'Não há horário livre a partir de 1 hora. Escolha "Agendar".',
        )
        return
      }
      ini = novo
    }
    const r = await pedidos.criar(
      pedidoDaCategoria(preenchida, corpoDoForm(ini), {
        agora: modo === 'agora',
        paradas: paradasDoPedido,
        horas,
        centroCusto: centro,
        // As diárias só na categoria que cobra diária (o contador some nas outras).
        diarias: preenchida.cobra_diaria === true ? diarias : null,
        outrosCustos,
        voltaAOrigem: volta,
      }),
    )
    if (r.ok && typeof r.id === 'string') {
      gravarUltimaCategoria(preenchida.codigo)
      gravarUltimoCentroCusto(centro)
      navegar(`/corrida/${r.id}`)
      return
    }
    setEnviando(false)
    setErroEnvio(mensagemDoPedido(r.codigo))
    if (r.codigo === 'CATEGORIA_INDISPONIVEL') lista.recarregar()
    if (r.codigo === 'HORARIO_OCUPADO') {
      if (modo === 'agora') setAgora(null)
      else setAgendado((a) => (a ? { ...a, inicio: null } : a))
      setQuandoAberto(true)
      if (modo === 'agora') void inicioDoAgora(new Date()).then((i) => setAgora({ inicio: i }))
    }
  }

  const mudar = (p: Partial<typeof form>) => {
    setForm((a) => ({ ...a, ...p }))
    setErros({})
  }

  return (
    <FolhaMapa rotulo="Escolher a categoria">
      <div className="mb-3 flex items-start gap-2">
        <button
          type="button"
          onClick={aoVoltar}
          aria-label="Voltar e mudar os endereços"
          className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto"
        >
          <Icone nome="setaEsquerda" />
        </button>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="sr-only">Escolher a categoria</h1>
          <RotaDePara origem={origem.texto} destino={destino.texto} paradas={paradas.map((p) => p.texto)} />
          {aoAdicionarParada && (
            <button
              type="button"
              onClick={aoAdicionarParada}
              className="flex min-h-12 items-center ivo-legenda font-semibold text-link underline underline-offset-4"
            >
              + Adicionar parada
            </button>
          )}
        </div>
      </div>

      {!rotaFalhou && (rota.fase === 'carregando' || (rota.fase === 'pronta' && km === null) || (km !== null && cats === null && !lista.erro)) ? (
        <div className="space-y-2" aria-busy="true">
          <p role="status" className="sr-only">
            Calculando o trajeto e os preços…
          </p>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : rotaFalhou ? (
        <div className="space-y-3">
          <Mensagem tipo="erro">
            Não foi possível calcular o trajeto agora. Confira os endereços ou tente de novo em instantes.
          </Mensagem>
          <Botao className="w-full" onClick={tentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      ) : lista.erro || cats === null ? (
        <div className="space-y-3">
          <Mensagem tipo="erro">Não foi possível carregar as categorias agora.</Mensagem>
          <Botao className="w-full" onClick={lista.recarregar}>
            Tentar de novo
          </Botao>
        </div>
      ) : (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Categorias" className="space-y-2">
            {cats.map((c) => (
              <CartaoCategoria
                key={c.codigo}
                c={c}
                marcada={atual?.codigo === c.codigo}
                minutos={minutos}
                comOutrosCustos={outrosCustos.trim() !== ''}
                aoEscolher={() => {
                  setEscolhida(c.codigo)
                  setErros({})
                  setErroEnvio(null)
                }}
              />
            ))}
          </div>

          {atual?.cobra_hora && (
            <Contador
              rotulo="Horas estimadas"
              valor={horas ?? 0}
              min={0.5}
              max={24}
              passo={0.5}
              formatar={() => (horas === null ? '—' : formatarHoras(horas))}
              aoMudar={(v) => {
                setHoras(horas === null ? 1 : mudarHoras(horas, v > horas ? 1 : -1))
                setErroEnvio(null)
              }}
              detalhe="O Ivo confirma as horas."
            />
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-expanded={quandoAberto}
              aria-controls={idQuando}
              onClick={() => setQuandoAberto((a) => !a)}
              className="flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-borda bg-superficie px-4 font-semibold text-texto tabular-nums"
            >
              <Icone nome="calendario" tamanho={18} />
              <span>{rotuloQuando}</span>
              <Icone nome="setaBaixo" tamanho={16} />
            </button>
            {kmTrajeto !== null && (
              <span className="shrink-0 ivo-legenda text-texto-suave tabular-nums">
                {formatarKm(kmTrajeto)}
                {paradasNaLegenda(nParadas)}
              </span>
            )}
          </div>
          {quandoAberto && (
            <div id={idQuando} className="space-y-3 rounded-cartao border border-borda p-3">
              <Segmentado
                rotulo="Quando"
                opcoes={[
                  { valor: 'agendar', rotulo: 'Agendar' },
                  { valor: 'agora', rotulo: 'Agora' },
                ]}
                valor={modo}
                aoMudar={(m) => {
                  if (m === 'agora' && modo !== 'agora') setAgora(null)
                  setModo(m)
                  setErroEnvio(null)
                }}
              />
              {modo === 'agendar' ? (
                <EscolherHorario
                  dia={agendado?.dia ?? somarDias(hoje(), 1)}
                  inicio={agendado?.inicio ?? null}
                  aoMudarDia={(dia) => setAgendado({ dia, inicio: null })}
                  aoMudarInicio={(i) => setAgendado({ dia: diaDe(i), inicio: i })}
                />
              ) : (
                <p className="ivo-legenda text-texto-suave">
                  O mais cedo possível, a partir de 1 hora: o primeiro horário livre do Ivo. Ele tem 15 minutos para
                  responder, e você tem 15 minutos para confirmar.
                </p>
              )}
            </div>
          )}

          <details
            ref={detalhes}
            open={detalhesAbertos}
            onToggle={(e) => setDetalhesAbertos(e.currentTarget.open)}
            className="rounded-cartao border border-borda"
          >
            <summary className="flex min-h-12 cursor-pointer items-center px-3 ivo-legenda font-semibold text-texto">
              Detalhes da corrida (pessoas, carga, contato)
            </summary>
            <div className="space-y-3 px-3 pb-3">
              {preenchida?.carga !== 'EQUIPAMENTO' && (
                <Contador
                  rotulo="Pessoas"
                  valor={form.pessoasQtd}
                  min={1}
                  max={99}
                  aoMudar={(v) => mudar({ pessoasQtd: v })}
                  detalhe={erros.pessoasQtd}
                />
              )}
              {preenchida && preenchida.carga !== 'PESSOAS' && (
                <AreaTexto
                  rotulo="Descrição da carga"
                  value={form.equipamentoDesc}
                  onChange={(e) => mudar({ equipamentoDesc: e.target.value })}
                  maxLength={500}
                  erro={erros.equipamentoDesc}
                  required
                />
              )}
              {cobraDiaria && (
                <Contador
                  rotulo="Diárias (hospedagem)"
                  valor={diarias}
                  min={0}
                  max={DIARIAS_MAX}
                  aoMudar={(v) => {
                    setDiarias(mudarDiarias(diarias, v > diarias ? 1 : -1))
                    setErroEnvio(null)
                  }}
                  detalhe="Viagem com pernoite"
                />
              )}
              <Campo
                rotulo="Outros custos (opcional)"
                value={outrosCustos}
                onChange={(e) => {
                  setOutrosCustos(e.target.value)
                  setErroEnvio(null)
                }}
                maxLength={MAX_OUTROS_CUSTOS}
                autoComplete="off"
                ajuda="Pedágio, balsa… O valor vem no orçamento"
              />
              <Campo
                rotulo="Contato no local (opcional)"
                value={form.contatoNome}
                onChange={(e) => mudar({ contatoNome: e.target.value })}
                maxLength={120}
                autoComplete="off"
                erro={erros.contatoNome}
              />
              <Campo
                rotulo="Telefone do contato (opcional)"
                value={form.contatoTelefone}
                onChange={(e) => mudar({ contatoTelefone: mascararTelefone(e.target.value) })}
                inputMode="tel"
                autoComplete="off"
                erro={erros.contatoTelefone}
              />
              <AreaTexto
                rotulo="Observação (opcional)"
                value={form.observacoes}
                onChange={(e) => mudar({ observacoes: e.target.value })}
                maxLength={1000}
                erro={erros.observacoes}
              />
            </div>
          </details>

          <Campo
            rotulo="Centro de custo (opcional)"
            value={centro}
            onChange={(e) => setCentro(e.target.value)}
            maxLength={MAX_CENTRO_CUSTO}
            autoComplete="off"
          />

          {erroEnvio && <Mensagem tipo="erro">{erroEnvio}</Mensagem>}
          {Object.keys(erros).length > 0 && !detalhesAbertos && (
            <Mensagem tipo="erro">Confira os detalhes da corrida.</Mensagem>
          )}
          {preenchida && faltamHoras ? (
            <p className="ivo-legenda text-texto-suave">Informe as horas estimadas para pedir.</p>
          ) : preenchida && inicio ? (
            <Botao
              variante="principal"
              className="w-full"
              disabled={enviando}
              aria-busy={enviando}
              onClick={() => void pedir()}
            >
              {`Pedir ${preenchida.nome} · ${quandoCurto(inicio)}`}
            </Botao>
          ) : preenchida ? (
            semData && (
              <p className="ivo-legenda text-texto-suave">Escolha o dia e o horário para pedir.</p>
            )
          ) : (
            <p className="ivo-legenda text-texto-suave">Nenhuma categoria disponível no momento. Tente mais tarde.</p>
          )}
          <p role="status" className="sr-only">
            {enviando ? 'Enviando o pedido ao Ivo…' : ''}
          </p>
        </div>
      )}
    </FolhaMapa>
  )
}
