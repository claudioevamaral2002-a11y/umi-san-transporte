// v2.1 (especificação §5.1): o cartão de uma categoria em "Categorias e preços". Abre só para ver (nome, descrição,
// as marcações que mudam o comportamento e os valores maiores que zero); o lápis ("Editar <nome>") mostra os campos,
// com Cancelar (descarta o rascunho) e Desativar ou Excluir, com confirmação. Nas inativas, Reativar.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { categoriasAdm, lerPessoasMax, type CategoriaAdm } from '../../../lib/categoriasAdm.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import {
  CAMPOS_TARIFA,
  type CampoTarifa,
  type ErrosTarifa,
  type FormTarifa,
  type Tarifa,
} from '../../../lib/tarifas.ts'
import { formatarPercentual } from '../../../lib/valores.ts'

const AJUDA_ZERADO = 'Deixe zerado se não cobra.'

/** O campo Reboque só existe na categoria marcada com reboque (a de veículo do cliente nunca tem). */
export const temReboque = (c: CategoriaAdm) => c.reboque === 'SIM' && !c.veiculo_cliente

export function validarNomeDescricao(nome: string, descricao: string) {
  return {
    ...(nome.length < 2 || nome.length > 40 ? { nome: 'De 2 a 40 caracteres.' } : {}),
    ...(descricao.length < 1 || descricao.length > 60 ? { descricao: 'De 1 a 60 caracteres.' } : {}),
  }
}

/** Rótulos curtos do modo de ver ("Km R$ 4,80 · Reboque R$ 100,00 · Diária R$ 400,00"). */
const CURTO: Record<CampoTarifa, string> = {
  taxa: 'Taxa fixa',
  km: 'Km',
  hora: 'Hora',
  espera: 'Espera',
  parada: 'Parada',
  retorno: 'Retorno',
  reboque: 'Reboque',
  hospedagem: 'Diária',
}

// Intl usa espaço sem quebra entre "R$" e o número; no resumo basta o espaço comum.
const reais = (cent: number) => formatarCentavos(cent).replace(/\s/g, ' ')

/** Só os valores maiores que zero, na ordem da tela; o Reboque só na categoria com reboque. */
export function resumoTarifa(c: CategoriaAdm, t: Tarifa): string {
  return CAMPOS_TARIFA.filter((x) => t[x.chave] > 0 && (x.campo !== 'reboque' || temReboque(c)))
    .map((x) => `${CURTO[x.campo]} ${x.tipo === 'reais' ? reais(t[x.chave]) : formatarPercentual(t[x.chave])}`)
    .join(' · ')
}

/** v2.2: "até 4 pessoas" no modo de ver; sem limite, nada. */
export const textoPessoasMax = (n: number | null | undefined) => (n ? `até ${n} pessoa${n === 1 ? '' : 's'}` : null)

const ERRO_PESSOAS = 'De 1 a 99. Deixe vazio para não limitar.'

/**
 * Nome, descrição e (v2.2) "Até quantas pessoas"; o código, a carga, o reboque e o veículo do cliente não mudam aqui.
 */
function DadosDaCategoria({
  c,
  aoSalvar,
  aoRascunho,
}: {
  c: CategoriaAdm
  aoSalvar: (texto: string) => void
  aoRascunho: (codigo: string, mudou: boolean) => void
}) {
  const [nome, setNome] = useState(c.nome)
  const [descricao, setDescricao] = useState(c.descricao_curta)
  const [pessoas, setPessoas] = useState(c.pessoas_max ? String(c.pessoas_max) : '')
  const [erros, setErros] = useState<{ nome?: string; descricao?: string; pessoas?: string }>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const caixa = useRef<HTMLFormElement>(null)
  // Só espaço a mais nas pontas não é mudança (o salvar apara).
  const mudou =
    nome.trim() !== c.nome || descricao.trim() !== c.descricao_curta || pessoas.trim() !== (c.pessoas_max ? String(c.pessoas_max) : '')

  // O nome ou a descrição não salvos também contam como rascunho (sair da página pergunta).
  useEffect(() => {
    aoRascunho(c.codigo, mudou)
  }, [aoRascunho, c.codigo, mudou])
  useEffect(() => () => aoRascunho(c.codigo, false), [aoRascunho, c.codigo])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const n = nome.trim()
    const d = descricao.trim()
    const max = lerPessoasMax(pessoas)
    const novos = { ...validarNomeDescricao(n, d), ...(max === undefined ? { pessoas: ERRO_PESSOAS } : {}) }
    setErros(novos)
    if (Object.keys(novos).length > 0) {
      requestAnimationFrame(() => caixa.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setEnviando(true)
    setFalha(null)
    const r = await categoriasAdm.salvar({
      codigo: c.codigo,
      nome: n,
      descricao_curta: d,
      ordem: c.ordem,
      ativa: c.ativa,
      // Só manda o limite quando mudou: sem a chave, o banco mantém o de hoje.
      ...(max !== (c.pessoas_max ?? null) ? { pessoas_max: max ?? null } : {}),
    })
    setEnviando(false)
    if (r.ok) aoSalvar(`${n} salva.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form ref={caixa} onSubmit={(e) => void salvar(e)} noValidate className="space-y-3" aria-label={`Dados de ${c.nome}`}>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo rotulo="Nome" maxLength={40} erro={erros.nome} value={nome} onChange={(e) => setNome(e.target.value)} />
        <Campo
          rotulo="Descrição"
          maxLength={60}
          erro={erros.descricao}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <Campo
          rotulo="Até quantas pessoas"
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          ajuda="Vazio = sem limite."
          erro={erros.pessoas}
          value={pessoas}
          onChange={(e) => setPessoas(e.target.value)}
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
      <legend className="mb-1 ivo-sobretitulo text-texto-suave">
        Tabela de preço<span className="sr-only"> de {c.nome}</span>
      </legend>
      {!c.ativa && <p className="ivo-legenda text-texto-suave">Inativa: fica fora da tabela até ser reativada.</p>}
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

type Confirmacao = 'excluir' | 'desativar'

const CONFIRMAR: Record<Confirmacao, { botao: string; texto: string; feito: string }> = {
  excluir: {
    botao: 'Excluir',
    texto: 'A categoria some de vez. Isso não pode ser desfeito.',
    feito: 'excluída',
  },
  desativar: {
    botao: 'Desativar',
    texto:
      'A categoria sai da tela do cliente e da tabela. Os pedidos e as tabelas antigas continuam como estão. Dá para reativar depois.',
    feito: 'desativada',
  },
}

export function CartaoCategoria({
  c,
  editando,
  form,
  erros,
  aoEditar,
  aoCancelar,
  aoMudar,
  aoSalvar,
  aoMudarSituacao,
  aoRecarregar,
  aoRascunho,
}: {
  c: CategoriaAdm
  editando: boolean
  form: FormTarifa
  erros: ErrosTarifa
  aoEditar: () => void
  aoCancelar: () => void
  aoMudar: (campo: CampoTarifa, valor: string) => void
  /** Nome ou descrição salvos: relê a lista e continua editando. */
  aoSalvar: (texto: string) => void
  /** Excluída, desativada ou reativada: relê a lista e sai do modo de editar. */
  aoMudarSituacao: (texto: string) => void
  /** Relê a lista (CATEGORIA_EM_USO: o `pode_excluir` mudou desde a leitura e o Desativar aparece). */
  aoRecarregar: () => void
  aoRascunho: (codigo: string, mudou: boolean) => void
}) {
  const id = useId()
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Saem "Com reboque" e "Leva: …" (§2): ficam só as marcações que mudam o comportamento.
  const marcas = [...(c.veiculo_cliente ? ['Veículo do cliente'] : []), ...(c.ativa ? [] : ['Inativa'])]
  const resumo = c.tarifa ? resumoTarifa(c, c.tarifa) : ''
  const pessoasMax = textoPessoasMax(c.pessoas_max)
  const secao = useRef<HTMLElement>(null)
  const lapis = useRef<HTMLButtonElement>(null)
  const editandoAntes = useRef(editando)

  // Entrar no lápis leva o foco ao primeiro campo; sair (Cancelar, publicar) devolve ao lápis, mas só se o foco estava
  // neste cartão ou se perdeu (o botão que o tinha sumiu): não rouba o foco de outro lugar.
  useEffect(() => {
    if (editandoAntes.current === editando) return
    editandoAntes.current = editando
    if (editando) {
      secao.current?.querySelector<HTMLElement>('input')?.focus()
      return
    }
    const ativo = document.activeElement
    if (!ativo || ativo === document.body || secao.current?.contains(ativo)) lapis.current?.focus()
  }, [editando])

  /** Desativar e Reativar salvam só o "ativa", com o nome e a descrição publicados. */
  async function mudarAtiva(ativa: boolean) {
    return categoriasAdm.salvar({
      codigo: c.codigo,
      nome: c.nome,
      descricao_curta: c.descricao_curta,
      ordem: c.ordem,
      ativa,
    })
  }

  async function confirmarAcao() {
    if (!confirmar || enviando) return
    setEnviando(true)
    setFalha(null)
    // Sem atualização otimista: a lista só muda com a resposta do servidor.
    const r = confirmar === 'excluir' ? await categoriasAdm.excluir(c.codigo) : await mudarAtiva(false)
    setEnviando(false)
    if (!r.ok) {
      setFalha(mensagemDoCodigo(r.codigo))
      // Alguém usou a categoria depois da leitura: relê, e o cartão passa a oferecer Desativar.
      if (r.codigo === 'CATEGORIA_EM_USO') aoRecarregar()
      return
    }
    const feito = CONFIRMAR[confirmar].feito
    setConfirmar(null)
    aoMudarSituacao(`${c.nome} ${feito}.`)
  }

  async function reativar() {
    if (enviando) return
    setEnviando(true)
    setFalha(null)
    const r = await mudarAtiva(true)
    setEnviando(false)
    if (r.ok) aoMudarSituacao(`${c.nome} reativada.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <li data-codigo={c.codigo}>
      <Cartao>
        <section ref={secao} aria-labelledby={`${id}-nome`} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 id={`${id}-nome`} className="ivo-h3 break-words">
                {c.nome}
              </h2>
              <p className="ivo-legenda text-texto-suave">{c.descricao_curta}</p>
              {pessoasMax && (
                <p data-testid="pessoas-max" className="ivo-legenda font-semibold">
                  {pessoasMax}
                </p>
              )}
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
            {!editando && (
              <button
                ref={lapis}
                type="button"
                onClick={aoEditar}
                aria-label={`Editar ${c.nome}`}
                className="-mt-1 -mr-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
              >
                <Icone nome="lapis" tamanho={20} />
              </button>
            )}
          </div>
          {!editando ? (
            <p data-testid="valores" className="ivo-corpo tabular-nums">
              {c.tarifa ? resumo || 'Nenhum valor na tabela.' : 'Sem tabela.'}
            </p>
          ) : (
            <>
              <DadosDaCategoria
                key={`${c.nome}-${c.descricao_curta}-${c.pessoas_max ?? ''}`}
                c={c}
                aoSalvar={aoSalvar}
                aoRascunho={aoRascunho}
              />
              <CamposTarifa c={c} form={form} erros={erros} aoMudar={aoMudar} />
              <div aria-live="assertive">{falha && !confirmar && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
              <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
                <Botao onClick={aoCancelar} disabled={enviando}>
                  Cancelar
                </Botao>
                {c.pode_excluir && (
                  <Botao variante="perigo" onClick={() => setConfirmar('excluir')} disabled={enviando}>
                    Excluir
                  </Botao>
                )}
                {c.ativa && !c.pode_excluir && (
                  <Botao onClick={() => setConfirmar('desativar')} disabled={enviando}>
                    Desativar
                  </Botao>
                )}
                {!c.ativa && (
                  <Botao variante="principal" onClick={() => void reativar()} disabled={enviando}>
                    {enviando ? 'Reativando…' : 'Reativar'}
                  </Botao>
                )}
              </div>
            </>
          )}
        </section>
      </Cartao>
      <Folha
        aberta={confirmar !== null}
        titulo={confirmar ? `${CONFIRMAR[confirmar].botao} ${c.nome}?` : ''}
        onFechar={() => {
          setConfirmar(null)
          setFalha(null)
        }}
      >
        {confirmar && (
          <div className="space-y-4">
            <p className="ivo-corpo text-texto-suave">{CONFIRMAR[confirmar].texto}</p>
            <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
            <div className="flex flex-col gap-3">
              <Botao
                variante={confirmar === 'excluir' ? 'perigo' : 'principal'}
                onClick={() => void confirmarAcao()}
                disabled={enviando}
              >
                {CONFIRMAR[confirmar].botao}
              </Botao>
              <Botao onClick={() => setConfirmar(null)} disabled={enviando}>
                Voltar
              </Botao>
            </div>
          </div>
        )}
      </Folha>
    </li>
  )
}
