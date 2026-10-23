import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Segmentado } from '../../design/componentes/Segmentado.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api } from '../../lib/api.ts'
import type { CodigoCategoria } from '../../lib/categorias.ts'
import {
  categoriasAdm,
  CODIGOS,
  COM_TAXA,
  formularioPrecos,
  precosDaVersao,
  validarPrecos,
  type ErrosPrecos,
  type FormPrecos,
  type PrecosCategorias,
} from '../../lib/categoriasAdm.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { usePublicacaoPorCategoria } from '../../lib/publicacaoPorCategoria.tsx'
import {
  diferencas,
  FORMAS_COBRANCA,
  formularioDe,
  GRUPOS,
  ROTULO_FORMA_COBRANCA,
  MAX_FAIXAS,
  validarFormulario,
  type CampoNumerico,
  type DefinicaoCampo,
  type ErrosFormulario,
  type FormaCobranca,
  type FormularioContrato,
  type ValoresContrato,
  type VersaoContrato,
} from '../../lib/contratos.ts'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { dinheiro } from '../../lib/saldo.ts'
import { deEntradaDataHora, formatarDataHora, paraEntradaDataHora } from '../../lib/valores.ts'

const ANO_MS = 365 * 24 * 3600_000

const ENTRADA: Record<DefinicaoCampo['tipo'], { inputMode: 'decimal' | 'numeric'; prefixo?: string; sufixo?: string; placeholder: string }> = {
  dinheiro: { inputMode: 'decimal', prefixo: 'R$', placeholder: '0,00' },
  percentual: { inputMode: 'decimal', sufixo: '%', placeholder: '0' },
  horas: { inputMode: 'numeric', sufixo: 'h', placeholder: '0' },
  dias: { inputMode: 'numeric', sufixo: 'dias', placeholder: '0' },
}

function validarVigencia(valor: string): { data: Date } | { erro: string } {
  const data = deEntradaDataHora(valor)
  if (!data) return { erro: 'Informe a data e a hora.' }
  if (data.getTime() < Date.now() - 60_000) return { erro: 'A vigência precisa ser agora ou no futuro.' }
  if (data.getTime() > Date.now() + ANO_MS) return { erro: 'A vigência pode ser no máximo 1 ano à frente.' }
  return { data }
}

interface Revisao {
  valores: ValoresContrato
  vigencia: Date
  /** Só no app novo ("Categorias e preços"): o preço de cada categoria da versão nova. */
  precos: PrecosCategorias | null
}

/**
 * Fase 4 ("Categorias e preços" do app novo): o mesmo formulário com o preço por km e a taxa de cada categoria, e a
 * publicação por `publicar_contrato_categorias` (o `publicar_contrato` antigo criaria a versão sem esses preços).
 * Sem esta opção, a tela é a de hoje.
 */
export interface OpcaoCategorias {
  nomes: Record<CodigoCategoria, string>
  /** Preço atual de cada categoria (já com o fallback da versão antiga), para pré-preencher e comparar. */
  precos: PrecosCategorias | null
  /**
   * Fase 4.1: a versão de partida já tem a tabela por categoria (`publicar_tarifas`). O km/taxa por categoria daqui não
   * vale mais para os pedidos do app novo: a tela não os mostra (vão os mesmos, sem mudança) e aponta para
   * "Categorias e preços".
   */
  comTarifas?: boolean
}

const OPCOES_FORMA = FORMAS_COBRANCA.map((f) => ({ valor: f, rotulo: ROTULO_FORMA_COBRANCA[f] }))

const NOTA_TAXA = 'Só a Carga Pesada (com reboque) cobra taxa fixa. Passageiros e Carga Leve cobram só o km.'

/** Para quem é a versão: a tabela modelo (`empresa` nula) ou o contrato de uma empresa. */
export interface AlvoContrato {
  empresa: string | null
  nome: string
}

/** Linhas da confirmação com o preço de cada categoria (antes e depois), como as dos campos do contrato. */
function LinhasCategorias({
  nomes,
  antes,
  depois,
}: {
  nomes: Record<CodigoCategoria, string>
  antes: PrecosCategorias | null
  depois: PrecosCategorias
}) {
  const linhas = CODIGOS.flatMap((c) => [
    { chave: `${c}.km`, rotulo: `${nomes[c]}: quilômetro`, antes: antes?.[c].km_cent ?? null, depois: depois[c].km_cent },
    ...(c === COM_TAXA
      ? [{ chave: `${c}.taxa`, rotulo: `${nomes[c]}: taxa fixa`, antes: antes?.[c].taxa_fixa_cent ?? null, depois: depois[c].taxa_fixa_cent }]
      : []),
  ])
  return (
    <>
      {linhas.map((l) => {
        const mudou = l.antes !== l.depois
        const marcar = mudou && l.antes !== null
        return (
          <li
            key={l.chave}
            className={`px-3.5 py-2.5 ${marcar ? 'border-l-4 border-l-[var(--cor-laranja)] bg-[rgb(255_106_0/0.06)]' : ''}`}
            data-mudou={mudou ? 'sim' : 'nao'}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="ivo-legenda font-semibold">{l.rotulo}</span>
              {marcar && <span className="ivo-legenda font-semibold text-alerta-texto">Alterado</span>}
            </div>
            <p className="tabular-nums">
              {marcar && l.antes !== null && (
                <>
                  <span className="text-texto-suave line-through">{formatarCentavos(l.antes)}</span>
                  <span aria-hidden="true"> para </span>
                  <span className="sr-only"> passa a </span>
                </>
              )}
              <span className="font-bold">{formatarCentavos(l.depois)}</span>
            </p>
          </li>
        )
      })}
    </>
  )
}

function Conteudo({
  alvo,
  base,
  modelo,
  onPublicado,
  onCancelar,
  categorias,
}: {
  alvo: AlvoContrato
  base: VersaoContrato | null
  modelo: VersaoContrato | null
  onPublicado: (texto: string) => void
  onCancelar: () => void
  categorias?: OpcaoCategorias
}) {
  // Pré-preenchido com o vigente; empresa sem contrato parte da tabela modelo.
  const partida = base ?? (alvo.empresa ? modelo : null)
  const [form, setForm] = useState<FormularioContrato>(() => formularioDe(partida))
  const [vigencia, setVigencia] = useState(() => paraEntradaDataHora(new Date(Date.now() + 5 * 60_000)))
  const [erros, setErros] = useState<ErrosFormulario & { vigencia?: string } & ErrosPrecos>({})
  const [precos, setPrecos] = useState<FormPrecos>(() => formularioPrecos(categorias?.precos ?? null))
  const [revisao, setRevisao] = useState<Revisao | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const formulario = useRef<HTMLFormElement>(null)
  const topo = useRef<HTMLDivElement>(null)
  const idForma = useId()
  // v2.1: o saldo contábil da empresa, lido ao trocar para o Faturado (aviso sem bloquear: acertar antes com um Ajuste).
  const [saldoContabil, setSaldoContabil] = useState<number | null>(null)
  // Sem a forma na versão de partida (banco anterior), a tela mostra Crédito e não manda a chave até o Master escolher.
  const forma: FormaCobranca = form.forma_cobranca ?? 'CREDITO'
  const faturado = forma === 'FATURADO'

  function mudarForma(nova: FormaCobranca) {
    setForm((f) => ({ ...f, forma_cobranca: nova }))
    if (nova === 'FATURADO' && alvo.empresa && partida?.forma_cobranca !== 'FATURADO' && saldoContabil === null) {
      dinheiro
        .saldo(alvo.empresa)
        .then((s) => setSaldoContabil(s.saldo_contabil_cent))
        .catch(() => undefined)
    }
  }

  const mudarCampo = (campo: CampoNumerico, valor: string) =>
    setForm((f) => ({ ...f, campos: { ...f.campos, [campo]: valor } }))
  const mudarFaixa = (i: number, parte: 'horas' | 'multa', valor: string) =>
    setForm((f) => ({ ...f, faixas: f.faixas.map((x, j) => (j === i ? { ...x, [parte]: valor } : x)) }))

  function revisar(e: FormEvent) {
    e.preventDefault()
    setFalha(null)
    const r = validarFormulario(form)
    const v = validarVigencia(vigencia)
    const rp = categorias ? validarPrecos(precos) : null
    const novos = {
      ...(r.ok ? {} : r.erros),
      ...(rp && !rp.ok ? rp.erros : {}),
      ...('erro' in v ? { vigencia: v.erro } : {}),
    }
    setErros(novos)
    if (!r.ok || 'erro' in v || (rp && !rp.ok)) {
      // Leva o foco ao primeiro campo com problema.
      requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setRevisao({ valores: r.valores, vigencia: v.data, precos: rp?.ok ? rp.precos : null })
    requestAnimationFrame(() => topo.current?.focus())
  }

  async function publicar() {
    if (!revisao || enviando) return
    setEnviando(true)
    setFalha(null)
    // Sem atualização otimista: a tela só muda com a confirmação do servidor.
    const r = revisao.precos
      ? await categoriasAdm.publicar(alvo.empresa, revisao.valores, revisao.precos, revisao.vigencia)
      : await api.publicarContrato(alvo.empresa, revisao.valores, revisao.vigencia)
    setEnviando(false)
    if (r.ok) {
      onPublicado(`Versão ${String(r.versao)} publicada. Vale a partir de ${formatarDataHora(revisao.vigencia)}.`)
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  if (revisao) {
    const lista = diferencas(base, revisao.valores)
    const mudaram = lista.filter((d) => d.mudou).length
    return (
      <div className="space-y-4" data-testid="confirmacao-contrato">
        <div ref={topo} tabIndex={-1} className="space-y-1 outline-none">
          <p className="ivo-corpo">
            Passa a valer em <strong className="tabular-nums">{formatarDataHora(revisao.vigencia)}</strong> (horário de
            Brasília).
          </p>
          <p className="ivo-legenda text-texto-suave">
            {base
              ? mudaram === 0
                ? 'Nenhum valor muda em relação à versão atual.'
                : `${mudaram} ${mudaram === 1 ? 'item muda' : 'itens mudam'} em relação à versão ${base.versao}.`
              : alvo.empresa
                ? partida
                  ? `Primeiro contrato de ${alvo.nome}, a partir da tabela modelo.`
                  : `Primeiro contrato de ${alvo.nome}.`
                : 'Primeira versão da tabela modelo.'}
          </p>
        </div>
        <ul className="divide-y divide-borda rounded-cartao border-[1.5px] border-borda">
          {lista.map((d) => (
            <li
              key={d.campo}
              className={`px-3.5 py-2.5 ${d.mudou && base ? 'border-l-4 border-l-[var(--cor-laranja)] bg-[rgb(255_106_0/0.06)]' : ''}`}
              data-mudou={d.mudou ? 'sim' : 'nao'}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="ivo-legenda font-semibold">{d.rotulo}</span>
                {d.mudou && base && <span className="ivo-legenda font-semibold text-alerta-texto">Alterado</span>}
              </div>
              <p className="tabular-nums">
                {d.mudou && d.antes !== null && (
                  <>
                    <span className="text-texto-suave line-through">{d.antes}</span>
                    <span aria-hidden="true"> para </span>
                    <span className="sr-only"> passa a </span>
                  </>
                )}
                <span className="font-bold">{d.depois}</span>
              </p>
            </li>
          ))}
          {categorias && !categorias.comTarifas && revisao.precos && <LinhasCategorias nomes={categorias.nomes} antes={categorias.precos} depois={revisao.precos} />}
        </ul>
        {categorias && !categorias.comTarifas && <p className="ivo-legenda text-texto-suave">{NOTA_TAXA}</p>}
        <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Botao onClick={() => setRevisao(null)} disabled={enviando}>
            Voltar e editar
          </Botao>
          <Botao variante="principal" onClick={() => void publicar()} disabled={enviando}>
            {enviando ? 'Publicando…' : 'Publicar versão'}
          </Botao>
        </div>
      </div>
    )
  }

  const mostrados = new Set<CampoNumerico>()
  const totalErros = Object.keys(erros).length
  return (
    <form ref={formulario} onSubmit={revisar} noValidate className="space-y-5">
      <div aria-live="polite">
        {totalErros > 0 && (
          <Mensagem tipo="erro">
            {totalErros === 1 ? 'Há 1 campo para corrigir.' : `Há ${totalErros} campos para corrigir.`}
          </Mensagem>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend id={idForma} className="mb-1 ivo-sobretitulo text-texto-suave">
          Forma de cobrança
        </legend>
        <Segmentado rotulo="Forma de cobrança" rotuladoPor={idForma} opcoes={OPCOES_FORMA} valor={forma} aoMudar={mudarForma} />
        <p className="ivo-legenda text-texto-suave">
          {faturado
            ? 'A empresa pede sem saldo e paga por fatura quinzenal com NF. O limite e o alerta de saldo não se aplicam.'
            : 'Saldo pré-pago: a empresa recarrega e cada corrida é debitada do saldo.'}
        </p>
        {faturado && saldoContabil !== null && saldoContabil !== 0 && (
          <div data-testid="aviso-saldo-faturado">
            <Mensagem tipo="info">
              O saldo de {alvo.nome} não está zerado ({formatarCentavos(saldoContabil)}). Acerte antes com um Ajuste em
              Créditos, para a primeira fatura começar do zero.
            </Mensagem>
          </div>
        )}
      </fieldset>

      {GRUPOS.filter((g) => !(faturado && g.id === 'credito')).map((g) => {
        const campos = g.campos.filter((c) => !mostrados.has(c.campo))
        const repetidos = g.campos.filter((c) => mostrados.has(c.campo))
        campos.forEach((c) => mostrados.add(c.campo))
        return (
          <fieldset key={g.id} className="space-y-3">
            <legend className="mb-1 ivo-sobretitulo text-texto-suave">{g.titulo}</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {campos.map((c) => {
                const e = ENTRADA[c.tipo]
                return (
                  <Campo
                    key={c.campo}
                    name={c.campo}
                    rotulo={c.rotulo}
                    ajuda={c.ajuda}
                    erro={erros[c.campo]}
                    inputMode={e.inputMode}
                    prefixo={e.prefixo}
                    sufixo={e.sufixo}
                    placeholder={e.placeholder}
                    autoComplete="off"
                    value={form.campos[c.campo]}
                    onChange={(ev) => mudarCampo(c.campo, ev.target.value)}
                  />
                )
              })}
            </div>
            {repetidos.length > 0 && (
              <p className="ivo-legenda text-texto-suave">
                {repetidos.map((c) => c.rotulo).join(', ')}: o mesmo valor da modalidade veículo próprio.
              </p>
            )}
            {g.id === 'regras' && (
              <div className="space-y-2 pt-1">
                <p className="ivo-legenda font-semibold">Faixas de cancelamento</p>
                <p id="ajuda-faixas" className="ivo-legenda text-texto-suave">
                  Da maior para a menor antecedência. A última começa em 0 h e vale até o horário do serviço.
                </p>
                <ol className="space-y-2" aria-describedby="ajuda-faixas">
                  {form.faixas.map((f, i) => (
                    <li key={i} className="flex items-end gap-2 rounded-xl bg-fundo p-2.5">
                      <Campo
                        className="flex-1"
                        rotulo={`Faixa ${i + 1}: a partir de`}
                        inputMode="numeric"
                        sufixo="h"
                        autoComplete="off"
                        value={f.horas}
                        aria-invalid={erros.faixas ? true : undefined}
                        onChange={(ev) => mudarFaixa(i, 'horas', ev.target.value)}
                      />
                      <Campo
                        className="flex-1"
                        rotulo="multa de"
                        inputMode="decimal"
                        sufixo="%"
                        autoComplete="off"
                        value={f.multa}
                        aria-invalid={erros.faixas ? true : undefined}
                        onChange={(ev) => mudarFaixa(i, 'multa', ev.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`Remover faixa ${i + 1}`}
                        disabled={form.faixas.length <= 1}
                        onClick={() => setForm((x) => ({ ...x, faixas: x.faixas.filter((_, j) => j !== i) }))}
                        className="flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60 disabled:opacity-40"
                      >
                        <Icone nome="lixeira" />
                      </button>
                    </li>
                  ))}
                </ol>
                {erros.faixas && (
                  <p role="alert" className="ivo-legenda font-semibold text-[var(--status-cancelada)]">
                    {erros.faixas}
                  </p>
                )}
                <Botao
                  className="flex items-center gap-2"
                  disabled={form.faixas.length >= MAX_FAIXAS}
                  onClick={() => setForm((x) => ({ ...x, faixas: [...x.faixas, { horas: '0', multa: '' }] }))}
                >
                  <Icone nome="mais" tamanho={20} />
                  Adicionar faixa
                </Botao>
              </div>
            )}
          </fieldset>
        )
      })}

      {categorias?.comTarifas && (
        <fieldset className="space-y-2">
          <legend className="mb-1 ivo-sobretitulo text-texto-suave">Preço por categoria</legend>
          <p className="ivo-legenda text-texto-suave">
            Os preços por categoria agora ficam em{' '}
            <Link to="/adm/categorias" className="font-semibold text-texto underline">
              Categorias e preços
            </Link>
            . Esta versão leva adiante a tabela de cada categoria, sem mudança.
          </p>
        </fieldset>
      )}

      {categorias && !categorias.comTarifas && (
        <fieldset className="space-y-3">
          <legend className="mb-1 ivo-sobretitulo text-texto-suave">Preço por categoria</legend>
          <p className="ivo-legenda text-texto-suave">
            Os pedidos do app novo usam o preço da categoria. Os pedidos sem categoria (app atual) continuam com os
            valores da modalidade veículo próprio, acima.
          </p>
          <p className="ivo-legenda font-semibold">{NOTA_TAXA}</p>
          {CODIGOS.map((c) => (
            <div key={c} className="space-y-2 rounded-xl bg-fundo p-2.5">
              <p className="font-semibold">{categorias.nomes[c]}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Campo
                  name={`${c}.km`}
                  rotulo={`${categorias.nomes[c]}: quilômetro`}
                  erro={erros[`${c}.km`]}
                  inputMode="decimal"
                  prefixo="R$"
                  placeholder="0,00"
                  autoComplete="off"
                  value={precos[c].km}
                  onChange={(ev) => setPrecos((x) => ({ ...x, [c]: { ...x[c], km: ev.target.value } }))}
                />
                {c === COM_TAXA ? (
                  <Campo
                    name={`${c}.taxa`}
                    rotulo={`${categorias.nomes[c]}: taxa fixa`}
                    ajuda="Cobrada uma vez por pedido, pelo reboque."
                    erro={erros[`${c}.taxa`]}
                    inputMode="decimal"
                    prefixo="R$"
                    placeholder="0,00"
                    autoComplete="off"
                    value={precos[c].taxa}
                    onChange={(ev) => setPrecos((x) => ({ ...x, [c]: { ...x[c], taxa: ev.target.value } }))}
                  />
                ) : (
                  <p className="self-center ivo-legenda text-texto-suave">Sem taxa fixa.</p>
                )}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-1 ivo-sobretitulo text-texto-suave">Vigência</legend>
        <Campo
          type="datetime-local"
          name="vigente_desde"
          rotulo="Vale a partir de"
          ajuda="Horário de Brasília. Orçamentos criados antes continuam com os valores antigos."
          erro={erros.vigencia}
          value={vigencia}
          onChange={(ev) => setVigencia(ev.target.value)}
        />
      </fieldset>

      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-borda bg-superficie px-4 py-3 md:-mx-6 md:flex-row md:justify-end md:px-6">
        <Botao onClick={onCancelar}>Cancelar</Botao>
        <Botao type="submit" variante="principal">
          Revisar e publicar
        </Botao>
      </div>
    </form>
  )
}

export function PublicarContrato({
  aberta,
  alvo,
  base,
  modelo,
  onFechar,
  onPublicado,
  categorias,
}: {
  aberta: boolean
  alvo: AlvoContrato
  /** Versão atual (vigente ou, sem ela, a agendada mais recente): base do pré-preenchimento e da comparação. */
  base: VersaoContrato | null
  /** Tabela modelo vigente: ponto de partida de uma empresa ainda sem contrato. */
  modelo: VersaoContrato | null
  onFechar: () => void
  onPublicado: (texto: string) => void
  /** Fase 4 (só o app novo): preço por categoria e publicação por `publicar_contrato_categorias`. */
  categorias?: OpcaoCategorias
}) {
  // No app novo, a tela Contratos de hoje também publica com o preço por categoria (lido da versão de partida).
  const porCategoria = usePublicacaoPorCategoria() && !categorias
  return (
    <Folha aberta={aberta} onFechar={onFechar} sobretitulo={alvo.nome} titulo="Publicar nova versão" largura="md:max-w-2xl">
      {porCategoria ? (
        aberta && <ComCategorias alvo={alvo} base={base} modelo={modelo} onPublicado={onPublicado} onCancelar={onFechar} />
      ) : (
        <Conteudo
          alvo={alvo}
          base={base}
          modelo={modelo}
          onPublicado={onPublicado}
          onCancelar={onFechar}
          categorias={categorias}
        />
      )}
    </Folha>
  )
}

/** Carrega os nomes e o preço por categoria da versão de partida e abre o formulário com eles. */
function ComCategorias(props: {
  alvo: AlvoContrato
  base: VersaoContrato | null
  modelo: VersaoContrato | null
  onPublicado: (texto: string) => void
  onCancelar: () => void
}) {
  const { alvo, base, modelo } = props
  const partida = base ?? (alvo.empresa ? modelo : null)
  const empresaDaPartida = base ? alvo.empresa : null
  const { dados, erro, recarregar } = useConsulta(
    `contrato-categorias-${empresaDaPartida ?? 'modelo'}-${partida?.versao ?? 'nenhuma'}`,
    () => categoriasAdm.ler(empresaDaPartida, partida?.versao ?? null),
  )
  if (dados === undefined) {
    return erro ? (
      <ErroAoCarregar onTentar={recarregar} />
    ) : (
      <div className="space-y-3" aria-busy="true">
        <p role="status" className="sr-only">
          Carregando os preços por categoria…
        </p>
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  const nomes = Object.fromEntries(CODIGOS.map((c) => [c, dados.categorias.find((x) => x.codigo === c)?.nome ?? c])) as Record<
    CodigoCategoria,
    string
  >
  // Fase 4.1: com a tabela por categoria já publicada nesta versão, o km/taxa daqui não vale mais.
  const comTarifas = dados.categorias.some((c) => c.tarifa && !c.tarifa.inicial)
  return <Conteudo {...props} categorias={{ nomes, precos: precosDaVersao(partida, dados.precos), comTarifas }} />
}
