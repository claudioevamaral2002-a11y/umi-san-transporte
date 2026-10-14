import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto, Campo } from '../../design/componentes/Campo.tsx'
import { CarregandoPickup } from '../../design/componentes/CarregandoPickup.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { api } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { prazoPorExtenso } from '../../lib/contratos.ts'
import { mensagemDoCodigo, MENSAGENS } from '../../lib/erros.ts'
import {
  DURACAO_MAX,
  DURACAO_MIN,
  FORM_VAZIO,
  PASSO_DURACAO,
  mascararTelefone,
  montarPedido,
  primeiroPassoComErro,
  temDados,
  validarPasso,
  type ErrosPedido,
  type FormPedido,
  type Passo,
} from '../../lib/novoPedido.ts'
import { pedidos } from '../../lib/pedidos.ts'
import type { Saldo } from '../../lib/saldo.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { ROTULO_CARGA, ROTULO_MODALIDADE, ROTULO_REBOQUE, rotuloTrajeto } from '../../lib/situacao.ts'
import {
  diaDe,
  formatarDuracao,
  hoje as hojeSp,
  horaDe,
  mesDe,
  nomeDoDia,
  nomeDoMes,
  numeroPedido,
  somarDias,
} from '../../lib/tempo.ts'
import { fraseQuando, horariosDoDia } from '../../lib/horariosDoDia.ts'
import { Calendario } from '../agenda/Calendario.tsx'
import { FaixaDias } from './FaixaDias.tsx'
import { useCreditoParaPedido } from './Pedidos.tsx'
import { CampoEndereco } from './CampoEndereco.tsx'
import { FolhaMarcarNoMapa } from './FolhaMarcarNoMapa.tsx'
import { CaixaChip, Contador, Escolhas, Rota } from './componentes.tsx'

const TITULOS = { 1: 'Quando?', 2: 'Onde?', 3: 'O que vamos levar?', 4: 'Confira o pedido' } as const
type Etapa = Passo | 4

const mesmoInstante = (a: string | null, b: string | null) =>
  !!a && !!b && new Date(a).getTime() === new Date(b).getTime()

/** Prefill vindo da Agenda (`?inicio=ISO` de uma janela livre). */
function formDaUrl(inicio: string | null): FormPedido {
  if (!inicio || Number.isNaN(new Date(inicio).getTime())) return FORM_VAZIO
  return { ...FORM_VAZIO, dia: diaDe(inicio), inicio: new Date(inicio).toISOString() }
}

function Cabecalho({
  passo,
  aoFechar,
  aoVoltar,
  tituloRef,
}: {
  passo: Etapa
  aoFechar: () => void
  aoVoltar: (() => void) | null
  tituloRef: RefObject<HTMLHeadingElement | null>
}) {
  return (
    <header className="sobre-marinho border-b border-borda bg-comando px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-5 text-comando-texto">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center justify-between">
          {aoVoltar ? (
            <button
              type="button"
              onClick={aoVoltar}
              aria-label="Voltar ao passo anterior"
              className="-ml-3 flex size-12 items-center justify-center rounded-xl hover:bg-white/10"
            >
              <Icone nome="setaEsquerda" />
            </button>
          ) : (
            <span className="size-12" />
          )}
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar o novo pedido"
            className="-mr-3 flex size-12 items-center justify-center rounded-xl hover:bg-white/10"
          >
            <Icone nome="fechar" />
          </button>
        </div>
        <p className="text-[13px] font-medium text-bloco-suave">Passo {passo} de 4</p>
        <h1 ref={tituloRef} tabIndex={-1} className="mt-1 ivo-h1 outline-none">
          {TITULOS[passo]}
        </h1>
        <div
          className="mt-4 grid grid-cols-4 gap-1.5"
          role="progressbar"
          aria-label="Progresso do pedido"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={passo}
        >
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`h-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                n < passo ? 'bg-[var(--cor-laranja)]' : n === passo ? 'bg-papel' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </header>
  )
}

function Rodape({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-borda bg-superficie/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  )
}

/** Dias da faixa do passo "Quando" (14 a partir de hoje, ou a partir do dia escolhido no mês, se ficar depois). */
const DIAS_NA_FAIXA = 14

function PassoQuando({
  f,
  mudar,
  rodada,
  erro,
  aviso,
}: {
  f: FormPedido
  mudar: (p: Partial<FormPedido>) => void
  rodada: number
  erro?: string
  aviso: string | null
}) {
  const hoje = hojeSp()
  const inicioFaixa = f.dia && f.dia > somarDias(hoje, DIAS_NA_FAIXA - 1) ? f.dia : hoje
  const [mesAberto, setMesAberto] = useState(false)
  const [mes, setMes] = useState(() => mesDe(f.dia ?? hoje))
  const mesesDaFaixa = [...new Set([mesDe(inicioFaixa), mesDe(somarDias(inicioFaixa, DIAS_NA_FAIXA - 1))])]
  const faixa = useConsulta(`novo-faixa-${inicioFaixa}-${f.duracaoMin}-${rodada}`, async () =>
    (await Promise.all(mesesDaFaixa.map((m) => pedidos.diasDoMes(m, f.duracaoMin)))).flat(),
  )
  const calendario = useConsulta(`novo-mes-${mes}-${f.duracaoMin}-${rodada}-${mesAberto}`, () =>
    mesAberto ? pedidos.diasDoMes(mes, f.duracaoMin) : Promise.resolve(undefined),
  )
  const livres = useConsulta(`novo-livres-${f.dia ?? '-'}-${f.duracaoMin}-${rodada}`, async () =>
    f.dia ? pedidos.horariosLivres(f.dia, f.duracaoMin) : null,
  )
  const horarios = livres.dados?.horarios ?? []
  const grade = horariosDoDia(horarios)
  const escolhaValida = horarios.some((h) => mesmoInstante(h, f.inicio))
  const escolherDia = (dia: string) => mudar({ dia, inicio: mesmoDia(f.inicio, dia) ? f.inicio : null })
  const nomeMes = nomeDoMes(mesDe(f.dia ?? inicioFaixa)).split(' de ')[0]

  return (
    <div className="space-y-6" data-testid="passo-quando">
      {aviso && <Mensagem tipo="erro">{aviso}</Mensagem>}
      <section aria-label="Dia">
        <div className="flex items-baseline justify-between gap-3 pb-1">
          <h2 className="ivo-h3">{nomeMes}</h2>
          <button
            type="button"
            onClick={() => {
              setMes(mesDe(f.dia ?? hoje))
              setMesAberto(true)
            }}
            className="min-h-11 text-sm font-semibold underline underline-offset-4"
          >
            Ver mês inteiro
          </button>
        </div>
        <FaixaDias inicio={inicioFaixa} quantos={DIAS_NA_FAIXA} selecionado={f.dia} dias={faixa.dados} aoSelecionar={escolherDia} />
        {faixa.erro && faixa.dados === undefined && (
          <Mensagem tipo="erro">Não foi possível carregar os dias. Verifique a conexão.</Mensagem>
        )}
      </section>

      <section aria-labelledby="titulo-horarios" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="titulo-horarios" className="font-semibold">
            Início
          </h2>
          {grade.some((h) => !h.livre) && <span className="ivo-legenda text-texto-suave">riscado = ocupado</span>}
        </div>
        {!f.dia ? (
          <p className="ivo-corpo text-texto-suave">Escolha um dia para ver os horários livres.</p>
        ) : livres.carregando && livres.dados === undefined ? (
          <div className="grid grid-cols-4 gap-2" aria-busy="true" aria-label="Carregando os horários">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-11 rounded-campo" />
            ))}
          </div>
        ) : livres.erro && livres.dados === undefined ? (
          <Mensagem tipo="erro">Não foi possível carregar os horários. Verifique a conexão.</Mensagem>
        ) : grade.length === 0 ? (
          <p className="ivo-corpo text-texto-suave">Nenhum horário livre neste dia para essa duração. Tente outro dia.</p>
        ) : (
          <div role="radiogroup" aria-labelledby="titulo-horarios" className="grid grid-cols-4 gap-2" data-testid="horarios-livres">
            {grade.map((h) => {
              if (!h.livre) {
                return (
                  <button
                    key={h.inicio}
                    type="button"
                    role="radio"
                    aria-checked={false}
                    aria-disabled="true"
                    aria-label={`${horaDe(h.inicio)}, ocupado`}
                    className="h-11 cursor-not-allowed rounded-campo border-[1.5px] border-dashed border-borda text-[15px] font-semibold text-texto-suave tabular-nums line-through"
                  >
                    {horaDe(h.inicio)}
                  </button>
                )
              }
              const marcado = mesmoInstante(h.inicio, f.inicio)
              return (
                <button
                  key={h.inicio}
                  type="button"
                  role="radio"
                  aria-checked={marcado}
                  onClick={() => mudar({ inicio: new Date(h.inicio).toISOString() })}
                  className={`h-11 rounded-campo border-[1.5px] text-[15px] font-semibold tabular-nums transition-colors duration-150 motion-reduce:transition-none ${
                    marcado ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
                  }`}
                >
                  {horaDe(h.inicio)}
                </button>
              )
            })}
          </div>
        )}
        {f.inicio && livres.dados && !escolhaValida && (
          <p className="ivo-legenda font-semibold text-alerta-texto">
            O horário {horaDe(f.inicio)} não está livre com essa duração. Escolha outro.
          </p>
        )}
        {erro && (
          <p role="alert" className="ivo-legenda font-semibold text-[var(--status-cancelada)]">
            {erro}
          </p>
        )}
      </section>

      <Contador
        rotulo="Duração estimada"
        valor={f.duracaoMin}
        min={DURACAO_MIN}
        max={DURACAO_MAX}
        passo={PASSO_DURACAO}
        aoMudar={(duracaoMin) => mudar({ duracaoMin })}
        formatar={formatarDuracao}
        detalhe="O motorista confirma no orçamento."
      />

      {f.dia && f.inicio && escolhaValida && (
        <p data-testid="frase-quando" aria-live="polite" className="rounded-campo bg-selecao-suave px-3.5 py-3 leading-snug font-semibold">
          {fraseQuando(f.dia, f.inicio, f.duracaoMin)}
        </p>
      )}

      <Folha aberta={mesAberto} titulo="Escolha o dia" onFechar={() => setMesAberto(false)}>
        <Calendario
          mes={mes}
          dias={calendario.dados}
          selecionado={f.dia}
          hoje={hoje}
          modo="escolher"
          aoSelecionar={(dia) => {
            escolherDia(dia)
            setMesAberto(false)
          }}
          aoMudarMes={setMes}
        />
      </Folha>
    </div>
  )
}

const mesmoDia = (inicio: string | null, dia: string) => !!inicio && diaDe(inicio) === dia

function PassoOnde({
  f,
  mudar,
  erros,
  aoMarcarNoMapa,
}: {
  f: FormPedido
  mudar: (p: Partial<FormPedido>) => void
  erros: ErrosPedido
  aoMarcarNoMapa: (lado: 'origem' | 'destino') => void
}) {
  return (
    <div className="space-y-5">
      <Cartao className="flex gap-3">
        <div aria-hidden="true" className="flex flex-col items-center pt-10 pb-6">
          <span className="size-3.5 rounded-full border-[3px] border-marinho-2" />
          <span className="my-1 w-0.5 flex-1 bg-borda" />
          <span className="size-0 border-x-[7px] border-t-[12px] border-x-transparent border-t-[var(--cor-laranja)]" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <CampoEndereco
            rotulo="Origem"
            valor={{ texto: f.origem, local: f.origemLocal }}
            aoMudar={(v) => mudar({ origem: v.texto, origemLocal: v.local, kmEstimado: null, minutosEstimados: null })}
            aoMarcarNoMapa={() => aoMarcarNoMapa('origem')}
            placeholder="Endereço ou local de saída"
            erro={erros.origem}
          />
          <CampoEndereco
            rotulo="Destino"
            valor={{ texto: f.destino, local: f.destinoLocal }}
            aoMudar={(v) => mudar({ destino: v.texto, destinoLocal: v.local, kmEstimado: null, minutosEstimados: null })}
            aoMarcarNoMapa={() => aoMarcarNoMapa('destino')}
            placeholder="Endereço ou local de chegada"
            erro={erros.destino}
          />
        </div>
      </Cartao>

      <fieldset className="space-y-2">
        <legend className="mb-2 ivo-sobretitulo text-texto-suave">Trajeto</legend>
        <div className="flex gap-2">
          <CaixaChip rotulo="Levar" marcado={f.levar} aoMudar={(levar) => mudar({ levar })} />
          <CaixaChip rotulo="Trazer" marcado={f.trazer} aoMudar={(trazer) => mudar({ trazer })} />
        </div>
        <p className="ivo-legenda text-texto-suave">Marque os dois para ida e volta.</p>
        {erros.trajeto && (
          <p role="alert" className="ivo-legenda font-semibold text-[var(--status-cancelada)]">
            {erros.trajeto}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 ivo-sobretitulo text-texto-suave">Contato no local (opcional)</legend>
        <Campo
          rotulo="Nome do contato"
          value={f.contatoNome}
          onChange={(e) => mudar({ contatoNome: e.target.value })}
          autoComplete="name"
          maxLength={120}
          erro={erros.contatoNome}
        />
        <Campo
          rotulo="Telefone do contato"
          type="tel"
          inputMode="tel"
          value={f.contatoTelefone}
          onChange={(e) => mudar({ contatoTelefone: mascararTelefone(e.target.value) })}
          placeholder="(47) 99999-1234"
          autoComplete="tel-national"
          erro={erros.contatoTelefone}
        />
      </fieldset>
    </div>
  )
}

function PassoOque({ f, mudar, erros }: { f: FormPedido; mudar: (p: Partial<FormPedido>) => void; erros: ErrosPedido }) {
  const pessoas = f.carga !== 'EQUIPAMENTO'
  const equipamento = f.carga !== 'PESSOAS'
  return (
    <div className="space-y-5">
      <Escolhas
        rotulo="Tipo"
        tamanho="largo"
        opcoes={(['PESSOAS', 'EQUIPAMENTO', 'AMBOS'] as const).map((v) => ({ valor: v, rotulo: ROTULO_CARGA[v] }))}
        valor={f.carga}
        aoMudar={(carga) => mudar({ carga })}
      />
      {pessoas && (
        <Cartao>
          <Contador
            rotulo="Pessoas"
            valor={f.pessoasQtd}
            min={1}
            max={99}
            aoMudar={(pessoasQtd) => mudar({ pessoasQtd })}
          />
          {erros.pessoasQtd && <p className="ivo-legenda text-[var(--status-cancelada)]">{erros.pessoasQtd}</p>}
        </Cartao>
      )}
      {equipamento && (
        <Cartao className="space-y-4">
          <AreaTexto
            rotulo="Equipamento"
            value={f.equipamentoDesc}
            onChange={(e) => mudar({ equipamentoDesc: e.target.value })}
            placeholder="O que vamos levar? Ex.: 2 bombas d'água e mangueiras"
            maxLength={500}
            erro={erros.equipamentoDesc}
          />
          <div className="grid grid-cols-2 gap-3">
            <Campo
              rotulo="Peso (kg)"
              inputMode="decimal"
              value={f.pesoKg}
              onChange={(e) => mudar({ pesoKg: e.target.value })}
              sufixo="kg"
              erro={erros.pesoKg}
            />
            <Campo
              rotulo="Dimensões"
              value={f.dimensoes}
              onChange={(e) => mudar({ dimensoes: e.target.value })}
              placeholder="2 × 1 × 1 m"
              maxLength={120}
              erro={erros.dimensoes}
            />
          </div>
        </Cartao>
      )}
      <Escolhas
        rotulo="Modalidade"
        tamanho="largo"
        opcoes={(['VEICULO_PROPRIO', 'VEICULO_CLIENTE'] as const).map((v) => ({ valor: v, rotulo: ROTULO_MODALIDADE[v] }))}
        valor={f.modalidade}
        aoMudar={(modalidade) => mudar({ modalidade })}
      />
      <Escolhas
        rotulo="Reboque"
        tamanho="largo"
        opcoes={(['SIM', 'NAO', 'NAO_SEI'] as const).map((v) => ({ valor: v, rotulo: ROTULO_REBOQUE[v] }))}
        valor={f.reboque}
        aoMudar={(reboque) => mudar({ reboque })}
      />
      <AreaTexto
        rotulo="Observações (opcional)"
        value={f.observacoes}
        onChange={(e) => mudar({ observacoes: e.target.value })}
        maxLength={1000}
        erro={erros.observacoes}
      />
    </div>
  )
}

function LinhaResumo({ titulo, aoEditar, children }: { titulo: string; aoEditar: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-borda py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="ivo-legenda font-semibold text-texto-suave">{titulo}</p>
        <div className="mt-1">{children}</div>
      </div>
      <button
        type="button"
        onClick={aoEditar}
        aria-label={`Editar ${titulo.toLowerCase()}`}
        className="-mr-2 min-h-12 shrink-0 rounded-xl px-3 font-semibold text-link hover:bg-borda/60"
      >
        Editar
      </button>
    </div>
  )
}

function PassoRevisar({
  f,
  irPara,
  prazoHoras,
  erroEnvio,
  saldo,
}: {
  f: FormPedido
  irPara: (p: Passo) => void
  prazoHoras: number | null | undefined
  erroEnvio: string | null
  /** Saldo da empresa: abaixo do alerta do contrato, avisa (o pedido pode ser feito; a aprovação confere o valor). */
  saldo: Saldo | null
}) {
  const carga = [
    f.carga !== 'EQUIPAMENTO' ? (f.pessoasQtd === 1 ? '1 pessoa' : `${f.pessoasQtd} pessoas`) : null,
    f.carga !== 'PESSOAS' ? f.equipamentoDesc.trim() : null,
  ]
    .filter(Boolean)
    .join(' + ')
  return (
    <div className="space-y-4">
      {erroEnvio && <Mensagem tipo="erro">{erroEnvio}</Mensagem>}
      {saldo?.abaixo_alerta && (
        <div
          className="flex gap-3 rounded-cartao border-[1.5px] border-[var(--cor-laranja)] bg-[var(--cor-laranja)]/10 p-4"
          data-testid="aviso-saldo-baixo"
          role="note"
        >
          <Icone nome="alerta" className="mt-0.5 shrink-0 text-alerta-texto" />
          <p className="ivo-corpo">
            <span className="font-bold">Saldo baixo.</span> Sua empresa tem{' '}
            <Dinheiro centavos={saldo.disponivel_cent} className="font-bold" /> disponível. Você pode enviar o pedido;
            para aprovar o orçamento, o crédito da empresa precisa cobrir o valor. Fale com a IVO Transportes para recarregar.
          </p>
        </div>
      )}
      <Cartao className="py-1" data-testid="resumo-pedido">
        <LinhaResumo titulo="Quando" aoEditar={() => irPara(1)}>
          <p className="font-bold tabular-nums">
            {f.dia ? nomeDoDia(f.dia) : ''}, {f.inicio ? horaDe(f.inicio) : ''}
          </p>
          <p className="ivo-legenda text-texto-suave">Duração estimada: {formatarDuracao(f.duracaoMin)}</p>
        </LinhaResumo>
        <LinhaResumo titulo="Onde" aoEditar={() => irPara(2)}>
          <Rota origem={f.origem} destino={f.destino} compacta />
          <p className="mt-1 ivo-legenda text-texto-suave">{rotuloTrajeto(f.levar, f.trazer)}</p>
          {(f.contatoNome || f.contatoTelefone) && (
            <p className="ivo-legenda text-texto-suave">
              Contato: {[f.contatoNome.trim(), f.contatoTelefone].filter(Boolean).join(', ')}
            </p>
          )}
        </LinhaResumo>
        <LinhaResumo titulo="Carga" aoEditar={() => irPara(3)}>
          <p className="font-bold">{ROTULO_CARGA[f.carga]}</p>
          <p className="ivo-legenda break-words text-texto-suave">{carga}</p>
        </LinhaResumo>
        <LinhaResumo titulo="Modalidade" aoEditar={() => irPara(3)}>
          <p className="font-bold">{ROTULO_MODALIDADE[f.modalidade]}</p>
          <p className="ivo-legenda text-texto-suave">Reboque: {ROTULO_REBOQUE[f.reboque]}</p>
        </LinhaResumo>
      </Cartao>
      <div className="flex gap-3 rounded-cartao border-[1.5px] border-marinho-2/40 bg-marinho-2/10 p-4" data-testid="aviso-prazo">
        <Icone nome="relogio" className="mt-0.5 text-link" />
        <p className="ivo-corpo">
          {prazoHoras
            ? `O motorista envia o orçamento em até ${prazoPorExtenso(prazoHoras)}; o horário fica pré-reservado até lá.`
            : 'O motorista envia o orçamento dentro do prazo do contrato; o horário fica pré-reservado até lá.'}
        </p>
      </div>
    </div>
  )
}

function Sucesso({ id, numero, prazoHoras }: { id: string; numero: number; prazoHoras: number | null | undefined }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-fundo p-6 text-center" data-testid="pedido-enviado">
      <svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="var(--status-concluida)" className="check-circulo motion-reduce:animate-none" />
        <path
          d="M28 50l13 13 27-29"
          fill="none"
          stroke="#fff"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="check-traco motion-reduce:animate-none"
        />
      </svg>
      <p className="ivo-legenda font-semibold text-texto-suave">Pedido {numeroPedido(numero)}</p>
      <h1 ref={titulo} tabIndex={-1} className="ivo-h1 outline-none">
        Pedido enviado
      </h1>
      <p className="max-w-sm ivo-corpo text-texto-suave">
        {prazoHoras
          ? `O motorista envia o orçamento em até ${prazoPorExtenso(prazoHoras)}. Avisamos aqui quando chegar.`
          : 'O motorista envia o orçamento dentro do prazo. Avisamos aqui quando chegar.'}
      </p>
      <div className="mt-2 flex w-full max-w-sm flex-col gap-3">
        <Link
          to={`/pedidos/${id}`}
          replace
          className="flex min-h-12 items-center justify-center gap-2 rounded-botao bg-acao px-5 ivo-botao text-acao-texto"
        >
          Acompanhar pedido
        </Link>
        <Link to="/" replace className="flex min-h-12 items-center justify-center rounded-botao px-5 ivo-botao text-texto">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}

/** Cliente N1/N2: novo pedido em 4 passos (quando → onde → o quê → revisar). Envio confirmado pelo servidor. */
export function NovoPedido() {
  const { perfil } = useSessao()
  const navegar = useNavigate()
  const local = useLocation()
  const [params] = useSearchParams()
  const [f, setF] = useState<FormPedido>(() => formDaUrl(params.get('inicio')))
  const [passo, setPasso] = useState<Etapa>(1)
  const [erros, setErros] = useState<ErrosPedido>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [criado, setCriado] = useState<{ id: string; numero: number } | null>(null)
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  const [rodada, setRodada] = useState(0)
  const [mapaPara, setMapaPara] = useState<'origem' | 'destino' | null>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const primeiraVez = useRef(true)
  const regras = useConsulta('novo-pedido-regras', api.regrasDoServico)
  const credito = useCreditoParaPedido(perfil)
  const prazoHoras = regras.dados?.prazo_orcar_horas

  // A cada passo, o foco vai para o título (leitor de tela anuncia onde a pessoa está).
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    titulo.current?.focus()
    window.scrollTo({ top: 0 })
  }, [passo])

  const mudar = (p: Partial<FormPedido>) => {
    setF((a) => ({ ...a, ...p }))
    setErros({})
  }

  const sair = () => (local.key !== 'default' ? navegar(-1) : navegar('/', { replace: true }))
  const fechar = () => (temDados(f) ? setConfirmarSaida(true) : sair())

  if (criado) return <Sucesso id={criado.id} numero={criado.numero} prazoHoras={prazoHoras} />

  if (credito.indisponivel) {
    return (
      <div className="min-h-dvh bg-fundo">
        <Cabecalho passo={1} aoFechar={sair} aoVoltar={null} tituloRef={titulo} />
        <main className="mx-auto max-w-lg p-4">
          <Cartao
            className="space-y-2"
            data-testid={perfil?.empresa_tem_contrato === false ? 'novo-pedido-sem-contrato' : 'novo-pedido-sem-credito'}
          >
            <p className="flex items-center gap-2 ivo-legenda font-semibold text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Novo pedido indisponível
            </p>
            <p className="ivo-corpo">{credito.indisponivel}</p>
          </Cartao>
        </main>
      </div>
    )
  }

  async function avancar() {
    if (passo === 4) {
      await enviar()
      return
    }
    const e = validarPasso(passo, f)
    if (passo === 1 && Object.keys(e).length === 0) {
      // O horário escolhido precisa estar entre os livres para a duração atual (o banco confere de novo).
      const livres = await pedidos.horariosLivres(f.dia!, f.duracaoMin).catch(() => null)
      if (livres && !livres.horarios.some((h) => mesmoInstante(h, f.inicio))) {
        setErros({ inicio: 'Esse horário não está livre com essa duração. Escolha outro.' })
        return
      }
    }
    if (Object.keys(e).length > 0) {
      setErros(e)
      return
    }
    setErros({})
    setAviso(null)
    setPasso((passo + 1) as Etapa)
  }

  async function enviar() {
    const pendente = primeiroPassoComErro(f)
    if (pendente) {
      setErros(validarPasso(pendente, f))
      setPasso(pendente)
      return
    }
    setEnviando(true)
    setErroEnvio(null)
    const r = await pedidos.criar(montarPedido(f))
    setEnviando(false)
    if (r.ok && typeof r.id === 'string') {
      setCriado({ id: r.id, numero: Number(r.numero) })
      return
    }
    if (r.codigo === 'HORARIO_OCUPADO') {
      setF((a) => ({ ...a, inicio: null }))
      setAviso(MENSAGENS.HORARIO_OCUPADO)
      setRodada((n) => n + 1)
      setPasso(1)
      return
    }
    setErroEnvio(mensagemDoCodigo(r.codigo))
  }

  const rotuloBotao = passo === 4 ? 'Enviar pedido' : passo === 3 ? 'Revisar' : 'Continuar'

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <Cabecalho
        passo={passo}
        aoFechar={fechar}
        aoVoltar={passo > 1 ? () => setPasso((passo - 1) as Etapa) : null}
        tituloRef={titulo}
      />
      <main className="mx-auto w-full max-w-lg flex-1 p-4 pb-6">
        {passo === 1 && <PassoQuando f={f} mudar={mudar} rodada={rodada} erro={erros.inicio} aviso={aviso} />}
        {passo === 2 && <PassoOnde f={f} mudar={mudar} erros={erros} aoMarcarNoMapa={setMapaPara} />}
        {passo === 3 && <PassoOque f={f} mudar={mudar} erros={erros} />}
        {passo === 4 && (
          <PassoRevisar f={f} irPara={setPasso} prazoHoras={prazoHoras} erroEnvio={erroEnvio} saldo={credito.saldo} />
        )}
        {enviando && <CarregandoPickup ativo rotulo="Enviando o pedido…" />}
      </main>
      <Rodape>
        <Botao variante="principal" className="flex w-full items-center justify-center gap-2" onClick={() => void avancar()} disabled={enviando}>
          {enviando ? 'Enviando…' : rotuloBotao}
        </Botao>
      </Rodape>

      <FolhaMarcarNoMapa
        aberta={mapaPara !== null}
        centro={(mapaPara === 'origem' ? (f.origemLocal ?? f.destinoLocal) : (f.destinoLocal ?? f.origemLocal)) ?? null}
        aoFechar={() => setMapaPara(null)}
        aoUsar={(local) => {
          if (mapaPara === 'origem') mudar({ origem: local.nome, origemLocal: local, kmEstimado: null, minutosEstimados: null })
          else mudar({ destino: local.nome, destinoLocal: local, kmEstimado: null, minutosEstimados: null })
          setMapaPara(null)
        }}
      />

      <Folha aberta={confirmarSaida} titulo="Descartar este pedido?" onFechar={() => setConfirmarSaida(false)}>
        <p className="ivo-corpo text-texto-suave">O que você preencheu até aqui será perdido.</p>
        <div className="flex flex-col gap-3">
          <Botao variante="perigo" onClick={sair}>
            Descartar pedido
          </Botao>
          <Botao onClick={() => setConfirmarSaida(false)}>Continuar preenchendo</Botao>
        </div>
      </Folha>
    </div>
  )
}
