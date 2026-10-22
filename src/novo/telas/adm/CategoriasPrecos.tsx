import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo, CampoSelecao } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Interruptor } from '../../../design/componentes/Interruptor.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { api, type ContratoListado } from '../../../lib/api.ts'
import { categoriasAdm, CODIGOS, COM_TAXA, type CategoriaAdm } from '../../../lib/categoriasAdm.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { ROTULO_CARGA, type Carga } from '../../../lib/situacao.ts'
import {
  CAMPOS_TARIFA,
  diferencas,
  doFormulario,
  FORM_TARIFA_VAZIO,
  paraFormulario,
  type CampoTarifa,
  type ErrosTarifa,
  type FormTarifa,
  type Tarifa,
} from '../../../lib/tarifas.ts'
import { deEntradaDataHora, formatarDataHora, paraEntradaDataHora } from '../../../lib/valores.ts'

const AJUDA_ZERADO = 'Deixe zerado se não cobra.'
const ANO_MS = 365 * 24 * 3600_000

function validarNomeDescricao(nome: string, descricao: string) {
  return {
    ...(nome.length < 2 || nome.length > 40 ? { nome: 'De 2 a 40 caracteres.' } : {}),
    ...(descricao.length < 1 || descricao.length > 60 ? { descricao: 'De 1 a 60 caracteres.' } : {}),
  }
}

function validarVigencia(valor: string): { data: Date } | { erro: string } {
  const data = deEntradaDataHora(valor)
  if (!data) return { erro: 'Informe a data e a hora.' }
  if (data.getTime() < Date.now() - 60_000) return { erro: 'A vigência precisa ser agora ou no futuro.' }
  if (data.getTime() > Date.now() + ANO_MS) return { erro: 'A vigência pode ser no máximo 1 ano à frente.' }
  return { data }
}

/** As três categorias de antes da 4.1 (as únicas com preço antes da primeira tabela). */
const DE_ANTES = new Set<string>(CODIGOS)

/** O campo Reboque só existe na categoria marcada com reboque (a de veículo do cliente nunca tem). */
const temReboque = (c: CategoriaAdm) => c.reboque === 'SIM' && !c.veiculo_cliente

/**
 * O que a categoria cobra hoje, para a revisão. Tabela já publicada: a dela. Primeira tabela (`inicial`): só as três
 * categorias de antes da 4.1 tinham preço, e só a Carga Pesada cobrava o reboque (a taxa fixa do reboque); a Carga
 * Leve, agora com reboque, passa a cobrar, e o aumento aparece na revisão. Categoria nova: nada antes.
 */
function tarifaDeAntes(c: CategoriaAdm): Tarifa | null {
  const t = c.tarifa
  if (!t) return null
  if (!t.inicial) return t
  if (!DE_ANTES.has(c.codigo)) return null
  // Antes da 4.1, Passageiros e Carga Leve cobravam só o km (a taxa fixa ia 0 e o reboque não existia).
  return c.codigo === COM_TAXA ? t : { ...t, taxa_fixa_cent: 0, reboque_cent: 0 }
}

/** Nome, descrição e "ativa" de uma categoria; o código, a carga, o reboque e o veículo do cliente não mudam aqui. */
function DadosDaCategoria({ c, aoSalvar }: { c: CategoriaAdm; aoSalvar: (texto: string) => void }) {
  const [nome, setNome] = useState(c.nome)
  const [descricao, setDescricao] = useState(c.descricao_curta)
  const [ativa, setAtiva] = useState(c.ativa)
  const [erros, setErros] = useState<{ nome?: string; descricao?: string }>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const mudou = nome !== c.nome || descricao !== c.descricao_curta || ativa !== c.ativa

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const n = nome.trim()
    const d = descricao.trim()
    const novos = validarNomeDescricao(n, d)
    setErros(novos)
    if (Object.keys(novos).length > 0) return
    setEnviando(true)
    setFalha(null)
    const r = await categoriasAdm.salvar({ codigo: c.codigo, nome: n, descricao_curta: d, ordem: c.ordem, ativa })
    setEnviando(false)
    if (r.ok) aoSalvar(`${n} salva.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form onSubmit={(e) => void salvar(e)} noValidate className="space-y-3" aria-label={`Dados de ${c.nome}`}>
      <div className="flex items-center justify-end gap-1">
        <span className="ivo-legenda font-semibold">Ativa</span>
        <Interruptor ligado={ativa} rotulo={`${c.nome} ativa`} onAlternar={() => setAtiva((a) => !a)} />
      </div>
      {!ativa && <p className="ivo-legenda text-texto-suave">Inativa: some da tela do cliente e fica fora da tabela.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Campo rotulo="Nome" maxLength={40} erro={erros.nome} value={nome} onChange={(e) => setNome(e.target.value)} />
        <Campo
          rotulo="Descrição"
          maxLength={60}
          erro={erros.descricao}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <Botao type="submit" disabled={!mudou || enviando}>
        {enviando ? 'Salvando…' : 'Salvar categoria'}
      </Botao>
    </form>
  )
}

/** Os campos da tabela de uma categoria (reais com vírgula; retorno em %). Zerado = não cobra. */
function CamposTarifa({
  c,
  form,
  erros,
  aoMudar,
}: {
  c: CategoriaAdm
  form: FormTarifa
  erros: ErrosTarifa
  aoMudar: (campo: CampoTarifa, valor: string) => void
}) {
  return (
    <fieldset className="space-y-2" disabled={!c.ativa}>
      <legend className="mb-1 ivo-sobretitulo text-texto-suave">Tabela de preço</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CAMPOS_TARIFA.filter((x) => x.campo !== 'reboque' || temReboque(c)).map((x) => (
          <Campo
            key={x.campo}
            rotulo={x.rotulo}
            inputMode="decimal"
            autoComplete="off"
            {...(x.tipo === 'reais' ? { prefixo: 'R$', placeholder: '0,00' } : { sufixo: '%', placeholder: '0' })}
            ajuda={AJUDA_ZERADO}
            erro={erros[x.campo]}
            value={form[x.campo]}
            onChange={(e) => aoMudar(x.campo, e.target.value)}
          />
        ))}
      </div>
    </fieldset>
  )
}

function CartaoCategoria({
  c,
  form,
  erros,
  aoMudar,
  aoSalvar,
}: {
  c: CategoriaAdm
  form: FormTarifa
  erros: ErrosTarifa
  aoMudar: (campo: CampoTarifa, valor: string) => void
  aoSalvar: (texto: string) => void
}) {
  const id = useId()
  const marcas = [
    ...(c.veiculo_cliente ? ['Veículo do cliente'] : []),
    ...(temReboque(c) ? ['Com reboque'] : []),
    ...(c.carga ? [`Leva: ${ROTULO_CARGA[c.carga].toLowerCase()}`] : []),
  ]
  return (
    <li>
      <Cartao>
        <section aria-labelledby={`${id}-nome`} className={`space-y-4 ${c.ativa ? '' : 'opacity-90'}`}>
          <div className="space-y-1">
            <h2 id={`${id}-nome`} className="ivo-h3">
              {c.nome}
            </h2>
            <p className="ivo-legenda text-texto-suave">{c.descricao_curta}</p>
            {marcas.length > 0 && (
              <ul aria-label="Marcações" className="flex flex-wrap gap-1.5">
                {marcas.map((m) => (
                  <li key={m} className="rounded-full border border-marinho-2 px-2.5 py-0.5 ivo-legenda font-bold">
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DadosDaCategoria key={`${c.nome}-${c.descricao_curta}-${String(c.ativa)}`} c={c} aoSalvar={aoSalvar} />
          <CamposTarifa c={c} form={form} erros={erros} aoMudar={aoMudar} />
        </section>
      </Cartao>
    </li>
  )
}

/** "+ Nova categoria": um cartão em branco. Sem código: o banco gera do nome. */
function NovaCategoria({
  ordem,
  aoCriar,
  aoCancelar,
}: {
  ordem: number
  aoCriar: (texto: string) => void
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [carga, setCarga] = useState<Carga>('PESSOAS')
  const [cliente, setCliente] = useState(false)
  const [reboque, setReboque] = useState(false)
  const [erros, setErros] = useState<{ nome?: string; descricao?: string }>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const caixa = useRef<HTMLFormElement>(null)

  useEffect(() => {
    caixa.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const n = nome.trim()
    const d = descricao.trim()
    const novos = validarNomeDescricao(n, d)
    setErros(novos)
    if (Object.keys(novos).length > 0) {
      requestAnimationFrame(() => caixa.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setEnviando(true)
    setFalha(null)
    const r = await categoriasAdm.salvar({
      nome: n,
      descricao_curta: d,
      ordem,
      ativa: true,
      veiculo_cliente: cliente,
      reboque: reboque && !cliente ? 'SIM' : 'NAO',
      carga,
    })
    setEnviando(false)
    if (r.ok) aoCriar(`${n} criada. Preencha a tabela e publique.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <li>
      <Cartao className="border-[1.5px] border-dashed border-borda">
        <form ref={caixa} onSubmit={(e) => void criar(e)} noValidate className="space-y-3" aria-label="Nova categoria">
          <p className="ivo-h3">Nova categoria</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo rotulo="Nome" maxLength={40} placeholder="IVO Van Executiva" erro={erros.nome} value={nome} onChange={(e) => setNome(e.target.value)} />
            <Campo
              rotulo="Descrição"
              maxLength={60}
              placeholder="até 12 pessoas"
              erro={erros.descricao}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <CampoSelecao rotulo="Leva" value={carga} onChange={(e) => setCarga(e.target.value as Carga)}>
            {(Object.keys(ROTULO_CARGA) as Carga[]).map((k) => (
              <option key={k} value={k}>
                {ROTULO_CARGA[k]}
              </option>
            ))}
          </CampoSelecao>
          <div className="flex flex-wrap gap-x-6">
            <div className="flex items-center gap-1">
              <span className="ivo-legenda font-semibold">Veículo do cliente</span>
              <Interruptor
                ligado={cliente}
                rotulo="Nova categoria: veículo do cliente"
                onAlternar={() => setCliente((x) => !x)}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="ivo-legenda font-semibold">Com reboque</span>
              <Interruptor
                ligado={reboque && !cliente}
                desabilitado={cliente}
                rotulo="Nova categoria: com reboque"
                onAlternar={() => setReboque((x) => !x)}
              />
            </div>
          </div>
          <p className="ivo-legenda text-texto-suave">
            Veículo do cliente: o Ivo dirige o carro da empresa, sem veículo da IVO e sem reboque. Essas marcações não
            mudam depois. A categoria fica indisponível para o cliente até entrar numa tabela publicada.
          </p>
          <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
          <div className="flex flex-col-reverse gap-2 md:flex-row">
            <Botao onClick={aoCancelar} disabled={enviando}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="principal" disabled={enviando}>
              {enviando ? 'Criando…' : 'Criar categoria'}
            </Botao>
          </div>
        </form>
      </Cartao>
    </li>
  )
}

interface ItemRevisao {
  codigo: string
  nome: string
  linhas: string[]
  primeira: boolean
  /** Todos os campos zerados: o total sai zero e a categoria fica indisponível para pedir. */
  zerada: boolean
}

interface Revisao {
  tarifas: Record<string, Tarifa>
  itens: ItemRevisao[]
  avisos: string[]
}

async function categoriasMudaram(empresa: string | null, enviadas: string[]): Promise<boolean> {
  try {
    const ativas = (await categoriasAdm.listar(empresa)).filter((c) => c.ativa).map((c) => c.codigo)
    return ativas.length !== enviadas.length || ativas.some((c) => !enviadas.includes(c))
  } catch {
    return false
  }
}

/** A revisão antes de publicar: o que muda em cada categoria ativa, os avisos e a vigência. */
function RevisarTabela({
  alvo,
  revisao,
  aoFechar,
  aoPublicar,
}: {
  alvo: { empresa: string | null; nome: string }
  revisao: Revisao | null
  aoFechar: () => void
  aoPublicar: (texto: string) => void
}) {
  // Montado de novo a cada abertura (key): a vigência parte de "agora + 5 min" na hora de abrir, nunca do passado.
  const [vigencia, setVigencia] = useState(() => paraEntradaDataHora(new Date(Date.now() + 5 * 60_000)))
  const [erroVigencia, setErroVigencia] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  async function publicar() {
    if (!revisao || enviando) return
    const v = validarVigencia(vigencia)
    if ('erro' in v) {
      setErroVigencia(v.erro)
      requestAnimationFrame(() => caixa.current?.querySelector<HTMLElement>('input[name="vigente_desde"]')?.focus())
      return
    }
    setErroVigencia(undefined)
    setEnviando(true)
    setFalha(null)
    // Sem atualização otimista: a tela só muda com a confirmação do servidor.
    const r = await categoriasAdm.publicarTarifas(alvo.empresa, revisao.tarifas, v.data)
    setEnviando(false)
    if (r.ok) {
      aoPublicar(`Tabela publicada: versão ${String(r.versao)}. Vale a partir de ${formatarDataHora(v.data)}.`)
      return
    }
    // O banco só devolve o código. CAMPOS_INVALIDOS também sai quando as categorias ativas mudaram desde a leitura
    // (outra pessoa criou ou desativou uma): relê e compara os códigos.
    if (r.codigo === 'CAMPOS_INVALIDOS' && (await categoriasMudaram(alvo.empresa, Object.keys(revisao.tarifas)))) {
      setFalha('As categorias mudaram. Atualize a página.')
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <Folha aberta={revisao !== null} onFechar={aoFechar} sobretitulo={alvo.nome} titulo="Publicar tabela" largura="md:max-w-2xl">
      {revisao && (
        <div ref={caixa} className="space-y-4">
          <p className="ivo-corpo">
            A versão nova do contrato leva a tabela de todas as categorias ativas. Orçamentos já feitos continuam com os
            valores antigos.
          </p>
          <ul data-testid="revisao-tabela" className="divide-y divide-borda rounded-cartao border-[1.5px] border-borda">
            {revisao.itens.map((i) => (
              <li key={i.codigo} className="space-y-1 px-3.5 py-2.5">
                <p className="font-bold">
                  {i.nome}
                  {i.primeira && <span className="ivo-legenda font-semibold text-texto-suave"> · primeira tabela</span>}
                </p>
                {i.zerada && (
                  <p className="ivo-legenda font-semibold">Todos os valores zerados: fica indisponível para pedir.</p>
                )}
                {i.linhas.length === 0 ? (
                  <p className="ivo-legenda text-texto-suave">Nada muda.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {i.linhas.map((l) => (
                      <li key={l} className="tabular-nums">
                        {l}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {revisao.avisos.map((a) => (
            <Mensagem key={a} tipo="info">
              {a}
            </Mensagem>
          ))}
          <Campo
            type="datetime-local"
            name="vigente_desde"
            rotulo="Vale a partir de"
            ajuda="Horário de Brasília."
            erro={erroVigencia}
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value)}
          />
          <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Botao onClick={aoFechar} disabled={enviando}>
              Voltar e editar
            </Botao>
            <Botao variante="principal" onClick={() => void publicar()} disabled={enviando}>
              {enviando ? 'Publicando…' : 'Publicar tabela'}
            </Botao>
          </div>
        </div>
      )}
    </Folha>
  )
}

/** As categorias e a tabela de um contrato (a tabela modelo ou o de uma empresa). */
function TabelaDoContrato({
  alvo,
  linha,
  aoPublicar,
}: {
  alvo: { empresa: string | null; nome: string }
  linha: ContratoListado | null
  aoPublicar: (texto: string) => void
}) {
  const lista = useConsulta(`novo-categorias-adm-${alvo.empresa ?? 'modelo'}`, () => categoriasAdm.listar(alvo.empresa))
  // Só o que a pessoa editou; o resto vem da tarifa lida (ou da inicial).
  const [editados, setEditados] = useState<Record<string, FormTarifa>>({})
  const [erros, setErros] = useState<Record<string, ErrosTarifa>>({})
  const [nova, setNova] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [revisao, setRevisao] = useState<Revisao | null>(null)
  const [abertura, setAbertura] = useState(0)
  const listaRef = useRef<HTMLUListElement>(null)

  const cats = lista.dados
  const formDe = (c: CategoriaAdm) => editados[c.codigo] ?? (c.tarifa ? paraFormulario(c.tarifa) : FORM_TARIFA_VAZIO)
  const ativas = (cats ?? []).filter((c) => c.ativa)
  const semContrato = cats !== undefined && cats.every((c) => !c.tarifa)
  // "Ainda não publicada" só pelas três de antes: uma categoria criada depois de uma publicação também vem `inicial`.
  const primeira = ativas.some((c) => DE_ANTES.has(c.codigo) && c.tarifa?.inicial)

  function revisar() {
    if (!cats) return
    setAviso(null)
    const novosErros: Record<string, ErrosTarifa> = {}
    const tarifas: Record<string, Tarifa> = {}
    for (const c of ativas) {
      const r = doFormulario(formDe(c))
      if ('erro' in r) novosErros[c.codigo] = r.campos
      // O reboque só conta na categoria com reboque; nas outras vai 0.
      else tarifas[c.codigo] = temReboque(c) ? r : { ...r, reboque_cent: 0 }
    }
    setErros(novosErros)
    if (Object.keys(novosErros).length > 0) {
      requestAnimationFrame(() => listaRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setAbertura((n) => n + 1)
    setRevisao({
      tarifas,
      itens: ativas.map((c) => ({
        codigo: c.codigo,
        nome: c.nome,
        linhas: diferencas(tarifaDeAntes(c), tarifas[c.codigo]!),
        primeira: c.tarifa?.inicial ?? true,
        zerada: Object.values(tarifas[c.codigo]!).every((v) => v === 0),
      })),
      // O app do cliente da fase 4 (ainda em cache) não envia as horas: o pedido seria recusado até ele atualizar.
      avisos: ativas
        .filter(
          (c) =>
            DE_ANTES.has(c.codigo) &&
            tarifas[c.codigo]!.hora_cent > 0 &&
            (!c.tarifa || c.tarifa.inicial || c.tarifa.hora_cent === 0),
        )
        .map(
          (c) =>
            `${c.nome} passa a cobrar por hora. O app do cliente que ainda não atualizou não envia as horas: os pedidos de ${c.nome} feitos por ele serão recusados até a atualização.`,
        ),
    })
  }

  const ordemNova = Math.min(99, Math.max(0, ...(cats ?? []).map((c) => c.ordem)) + 1)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:justify-end">
        <Botao onClick={() => setNova(true)} disabled={nova || cats === undefined}>
          + Nova categoria
        </Botao>
        <Botao variante="principal" onClick={revisar} disabled={cats === undefined || semContrato || ativas.length === 0}>
          Publicar tabela
        </Botao>
      </div>
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {cats === undefined ? (
        lista.erro ? (
          <ErroAoCarregar onTentar={lista.recarregar} />
        ) : (
          <Skeleton className="h-60" />
        )
      ) : (
        <>
          <p className="ivo-legenda text-texto-suave">
            {semContrato
              ? `${alvo.nome} ainda não tem contrato. Publique o contrato na tela Contratos antes da tabela.`
              : primeira
                ? 'Tabela ainda não publicada: veio preenchida com os preços de hoje. Confira e publique.'
                : linha?.vigente
                  ? `Versão ${linha.vigente.versao}, vigente desde ${formatarDataHora(linha.vigente.vigente_desde)}.`
                  : 'Tabela publicada.'}{' '}
            Deixe zerado o que a categoria não cobra. Ao publicar, a revisão mostra o que mudou em cada categoria.
          </p>
          <ul ref={listaRef} aria-label="Categorias" className="space-y-3">
            {nova && (
              <NovaCategoria
                ordem={ordemNova}
                aoCancelar={() => setNova(false)}
                aoCriar={(t) => {
                  setNova(false)
                  setAviso(t)
                  lista.recarregar()
                }}
              />
            )}
            {cats.map((c) => (
              <CartaoCategoria
                key={c.codigo}
                c={c}
                form={formDe(c)}
                erros={erros[c.codigo] ?? {}}
                aoMudar={(campo, valor) => setEditados((x) => ({ ...x, [c.codigo]: { ...formDe(c), [campo]: valor } }))}
                aoSalvar={(t) => {
                  setAviso(t)
                  lista.recarregar()
                }}
              />
            ))}
          </ul>
        </>
      )}
      <RevisarTabela
        key={abertura}
        alvo={alvo}
        revisao={revisao}
        aoFechar={() => setRevisao(null)}
        aoPublicar={(t) => {
          setRevisao(null)
          setEditados({})
          setErros({})
          aoPublicar(t)
          lista.recarregar()
        }}
      />
    </div>
  )
}

/**
 * "Categorias e preços" do Master (fase 4.1, mockup 5): cada categoria em cartão com nome, descrição, ativa, as
 * marcações e a tabela de preço (8 campos; zerado = não cobra). "+ Nova categoria" cria pelo `salvar_categoria` sem
 * código; "Publicar tabela" revisa o que muda e publica a versão nova do contrato com a tabela de todas as ativas
 * (`publicar_tarifas`). Contrato vazio = tabela modelo.
 */
export function CategoriasPrecos() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const contratos = useConsulta('novo-contratos-adm', api.contratos)
  const [alvoId, setAlvoId] = useState<string>('modelo')
  const [aviso, setAviso] = useState<string | null>(null)
  const linha = contratos.dados?.find((c) => (c.empresa_id ?? 'modelo') === alvoId) ?? null
  const alvo = { empresa: alvoId === 'modelo' ? null : alvoId, nome: linha?.empresa_nome ?? 'Tabela modelo' }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4">
      <header className="space-y-1">
        <h1 className="ivo-h2">Categorias e preços</h1>
        <p className="ivo-legenda text-texto-suave">
          O que o cliente vê ao pedir e a tabela de preço de cada categoria. Só o Master edita.
        </p>
      </header>
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {contratos.dados !== undefined && (
        <CampoSelecao
          rotulo="Contrato"
          value={alvoId}
          onChange={(e) => {
            setAviso(null)
            setAlvoId(e.target.value)
          }}
        >
          {contratos.dados.map((c) => (
            <option key={c.empresa_id ?? 'modelo'} value={c.empresa_id ?? 'modelo'}>
              {c.empresa_nome ?? 'Tabela modelo'}
            </option>
          ))}
        </CampoSelecao>
      )}
      <TabelaDoContrato
        key={alvoId}
        alvo={alvo}
        linha={linha}
        aoPublicar={(t) => {
          setAviso(t)
          contratos.recarregar()
        }}
      />
    </main>
  )
}
