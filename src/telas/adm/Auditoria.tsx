import { Fragment, useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo, CampoSelecao } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { ACOES, detalheComoTexto, nomeAcao, opcoesDeAcao } from '../../lib/administracao.ts'
import { api, type FiltroAuditoria, type RegistroAuditoria } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { useRotulos, type Rotulos } from '../../lib/rotulos.tsx'
import { formatarDataHora, inicioDoDia, validarPeriodo, type CampoData } from '../../lib/valores.ts'

const RESULTADOS = {
  OK: { rotulo: 'OK', icone: '✓', cor: 'var(--status-concluida)' },
  NEGADO: { rotulo: 'Negado', icone: '✕', cor: 'var(--status-cancelada)' },
  ERRO: { rotulo: 'Erro', icone: '!', cor: 'var(--status-aguardando)' },
} as const

const LIMITES = [50, 100, 200, 500]

function Resultado({ r }: { r: RegistroAuditoria['resultado'] }) {
  const s = RESULTADOS[r] ?? RESULTADOS.ERRO
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap"
      style={{ color: s.cor, borderColor: s.cor }}
    >
      <span aria-hidden="true">{s.icone}</span>
      {s.rotulo}
    </span>
  )
}

function quem(r: RegistroAuditoria, rotulos: Rotulos) {
  if (r.usuario_nome) return `${r.usuario_nome}${r.papel ? ` (${rotulos.papeis[r.papel]})` : ''}`
  return r.usuario_id ? 'Usuário removido' : 'Sistema'
}

/** Detalhe sempre como texto (React escapa): nada da auditoria vira HTML. */
function Detalhe({ r }: { r: RegistroAuditoria }) {
  const linhas: Array<[string, string]> = [
    ['Alvo', r.alvo ?? '—'],
    ['Código', r.codigo ?? '—'],
    ['IP', r.ip ?? '—'],
    ['Dispositivo', r.dispositivo ?? '—'],
  ]
  return (
    <div className="space-y-2 rounded-xl bg-fundo p-3" data-testid="detalhe-auditoria">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
        {linhas.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="ivo-legenda font-semibold text-texto-suave">{k}</dt>
            <dd className="text-sm break-all">{v}</dd>
          </Fragment>
        ))}
      </dl>
      <pre className="max-h-64 overflow-auto rounded-lg border border-borda bg-superficie p-2.5 font-mono text-xs whitespace-pre-wrap break-all">
        {detalheComoTexto(r.detalhe)}
      </pre>
    </div>
  )
}

interface Rascunho {
  de: string
  ate: string
  usuario: string
  acao: string
  resultado: string
  limite: string
}

const INICIAL: Rascunho = { de: '', ate: '', usuario: '', acao: '', resultado: '', limite: '100' }

function paraFiltro(r: Rascunho): FiltroAuditoria {
  return {
    de: r.de ? (inicioDoDia(r.de)?.toISOString() ?? null) : null,
    ate: r.ate ? (inicioDoDia(r.ate, true)?.toISOString() ?? null) : null,
    usuario: r.usuario || null,
    acao: r.acao || null,
    resultado: r.resultado || null,
    limite: Math.min(500, Math.max(1, Number(r.limite) || 100)),
  }
}

/** Se a lista do banco falhar: as ações conhecidas (`ACOES`), agrupadas do mesmo jeito. */
const OPCOES_CONHECIDAS = opcoesDeAcao(Object.keys(ACOES).map((acao) => ({ acao, total: 0 })))

const VAZIO: CampoData = { valor: '', invalido: false }

/** Lê um `<input type="date">` do formulário: o valor e se o navegador o acusou incompleto (`validity.badInput`). */
function campoData(form: HTMLFormElement | null, nome: string, valor: string): CampoData {
  const input = form?.elements.namedItem(nome)
  return { valor, invalido: input instanceof HTMLInputElement && input.validity.badInput }
}

type ErrosPeriodo = { de?: string; ate?: string }

/**
 * v2.2: o período com erro ligado ao campo. Data incompleta ou inexistente → "Data inválida" no campo ruim; "De"
 * depois de "Até" → "A data inicial é depois da final" no "De". Sem erro, `null` (pode filtrar).
 */
function errosDoPeriodo(de: CampoData, ate: CampoData): ErrosPeriodo | null {
  const geral = validarPeriodo(de, ate)
  if (!geral) return null
  if (geral === 'Data inválida') {
    return {
      ...(validarPeriodo(de, VAZIO) ? { de: geral } : {}),
      ...(validarPeriodo(VAZIO, ate) ? { ate: geral } : {}),
    }
  }
  return { de: geral }
}

export function Auditoria() {
  const [rascunho, setRascunho] = useState<Rascunho>(INICIAL)
  const [filtro, setFiltro] = useState<FiltroAuditoria>(() => paraFiltro(INICIAL))
  const [abertos, setAbertos] = useState<Set<number>>(new Set())
  const [errosPeriodo, setErrosPeriodo] = useState<ErrosPeriodo>({})
  const formulario = useRef<HTMLFormElement>(null)
  const usuarios = useConsulta('auditoria-usuarios', api.usuarios)
  // v2.2: as ações que já aparecem na auditoria, vindas do banco; se a leitura falhar, as conhecidas.
  const acoes = useConsulta('auditoria-acoes', api.acoesAuditoria)
  const rotulos = useRotulos()
  const { dados, erro, carregando, recarregar } = useConsulta(`auditoria:${JSON.stringify(filtro)}`, () => api.auditoria(filtro))

  const mudar = (campo: keyof Rascunho, valor: string) => setRascunho((r) => ({ ...r, [campo]: valor }))
  const alternar = (id: number) =>
    setAbertos((a) => {
      const n = new Set(a)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  function aplicar(e: FormEvent) {
    e.preventDefault()
    // Data incompleta no campo nativo chega como "" (igual a vazio): o `badInput` diz que não é vazio de verdade.
    const erros = errosDoPeriodo(
      campoData(formulario.current, 'de', rascunho.de),
      campoData(formulario.current, 'ate', rascunho.ate),
    )
    if (erros) {
      setErrosPeriodo(erros)
      const campo = formulario.current?.elements.namedItem(erros.de ? 'de' : 'ate')
      if (campo instanceof HTMLInputElement) campo.focus()
      return
    }
    setErrosPeriodo({})
    setAbertos(new Set())
    const novo = paraFiltro(rascunho)
    if (JSON.stringify(novo) === JSON.stringify(filtro)) recarregar()
    else setFiltro(novo)
  }

  const gruposAcao = acoes.dados ? opcoesDeAcao(acoes.dados) : acoes.erro ? OPCOES_CONHECIDAS : []

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Auditoria"
        descricao="Registro imutável de tudo que foi feito ou negado no app. Ninguém edita nem apaga."
      />

      <Cartao>
        <form
          ref={formulario}
          onSubmit={aplicar}
          noValidate
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          aria-label="Filtros da auditoria"
        >
          <Campo
            rotulo="De"
            type="date"
            name="de"
            value={rascunho.de}
            erro={errosPeriodo.de}
            onChange={(e) => mudar('de', e.target.value)}
          />
          <Campo
            rotulo="Até"
            type="date"
            name="ate"
            value={rascunho.ate}
            erro={errosPeriodo.ate}
            onChange={(e) => mudar('ate', e.target.value)}
          />
          <CampoSelecao className="col-span-2 sm:col-span-1" rotulo="Usuário" value={rascunho.usuario} onChange={(e) => mudar('usuario', e.target.value)}>
            <option value="">Todos</option>
            {(usuarios.dados ?? []).map((u) => (
              <option key={u.usuario_id} value={u.usuario_id}>
                {u.nome}
              </option>
            ))}
          </CampoSelecao>
          <CampoSelecao className="col-span-2 sm:col-span-1" rotulo="Ação" value={rascunho.acao} onChange={(e) => mudar('acao', e.target.value)}>
            <option value="">Todas</option>
            {gruposAcao.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.opcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </optgroup>
            ))}
          </CampoSelecao>
          <CampoSelecao rotulo="Resultado" value={rascunho.resultado} onChange={(e) => mudar('resultado', e.target.value)}>
            <option value="">Todos</option>
            <option value="OK">OK</option>
            <option value="NEGADO">Negado</option>
            <option value="ERRO">Erro</option>
          </CampoSelecao>
          <CampoSelecao rotulo="Quantidade" value={rascunho.limite} onChange={(e) => mudar('limite', e.target.value)}>
            {LIMITES.map((l) => (
              <option key={l} value={l}>
                Últimos {l}
              </option>
            ))}
          </CampoSelecao>
          <div className="col-span-2 flex gap-2 lg:col-span-3 lg:justify-end">
            <Botao
              className="flex-1 lg:flex-none"
              onClick={() => {
                // O reset limpa também a data incompleta, que o React vê como "" e não apagaria.
                formulario.current?.reset()
                setRascunho(INICIAL)
                setErrosPeriodo({})
                setFiltro(paraFiltro(INICIAL))
              }}
            >
              Limpar
            </Botao>
            <Botao type="submit" variante="principal" className="flex flex-1 items-center justify-center gap-2 lg:flex-none">
              <Icone nome="busca" tamanho={20} />
              Filtrar
            </Botao>
          </div>
        </form>
      </Cartao>

      <p aria-live="polite" className="px-1 ivo-legenda text-texto-suave">
        {carregando ? 'Carregando…' : dados ? `${dados.length} ${dados.length === 1 ? 'registro' : 'registros'}` : ''}
      </p>

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && <Skeleton className="h-64" />}
      {dados && dados.length === 0 && (
        <EstadoVazio icone="lista" titulo="Nenhum registro">
          Nada encontrado com esses filtros.
        </EstadoVazio>
      )}

      {dados && dados.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden" data-testid="auditoria-lista">
            {dados.map((r) => (
              <li key={r.id}>
                <Cartao className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">{nomeAcao(r.acao)}</p>
                      <p className="ivo-legenda text-texto-suave">{quem(r, rotulos)}</p>
                    </div>
                    <Resultado r={r.resultado} />
                  </div>
                  <p className="ivo-legenda tabular-nums text-texto-suave">{formatarDataHora(r.em)}</p>
                  <Botao
                    className="flex w-full items-center justify-center gap-2"
                    aria-expanded={abertos.has(r.id)}
                    onClick={() => alternar(r.id)}
                  >
                    {abertos.has(r.id) ? 'Ocultar detalhe' : 'Ver detalhe'}
                    <Icone nome="setaBaixo" tamanho={18} className={abertos.has(r.id) ? 'rotate-180' : ''} />
                  </Botao>
                  {abertos.has(r.id) && <Detalhe r={r} />}
                </Cartao>
              </li>
            ))}
          </ul>
          <Cartao className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-left" data-testid="auditoria-tabela">
              <caption className="sr-only">Registros da auditoria</caption>
              <thead className="border-b border-borda">
                <tr className="ivo-sobretitulo text-texto-suave">
                  <th scope="col" className="px-4 py-3">Quando</th>
                  <th scope="col" className="px-4 py-3">Quem</th>
                  <th scope="col" className="px-4 py-3">Ação</th>
                  <th scope="col" className="px-4 py-3">Resultado</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Detalhe</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-borda">
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap tabular-nums">{formatarDataHora(r.em)}</td>
                      <td className="px-4 py-2.5 text-sm">{quem(r, rotulos)}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold">
                        {nomeAcao(r.acao)}
                        {r.codigo && <span className="block text-xs font-medium text-texto-suave">{r.codigo}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Resultado r={r.resultado} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          aria-expanded={abertos.has(r.id)}
                          aria-label={`${abertos.has(r.id) ? 'Ocultar' : 'Ver'} detalhe de ${nomeAcao(r.acao)} em ${formatarDataHora(r.em)}`}
                          onClick={() => alternar(r.id)}
                          className="inline-flex size-12 items-center justify-center rounded-xl text-texto-suave hover:bg-fundo"
                        >
                          <Icone nome="setaBaixo" className={abertos.has(r.id) ? 'rotate-180' : ''} />
                        </button>
                      </td>
                    </tr>
                    {abertos.has(r.id) && (
                      <tr className="border-b border-borda">
                        <td colSpan={5} className="px-4 pb-3">
                          <Detalhe r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Cartao>
        </>
      )}
    </main>
  )
}
