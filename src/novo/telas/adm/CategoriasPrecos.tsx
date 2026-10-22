import { useState, type FormEvent } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo, CampoSelecao } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Interruptor } from '../../../design/componentes/Interruptor.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { api, type ContratoListado } from '../../../lib/api.ts'
import type { CodigoCategoria } from '../../../lib/categorias.ts'
import { categoriasAdm, CODIGOS, COM_TAXA, precosDaVersao, type CategoriaAdm } from '../../../lib/categoriasAdm.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { formatarDataHora } from '../../../lib/valores.ts'
import { PublicarContrato } from '../../../telas/contratos/PublicarContrato.tsx'

/** Nome, descrição e "ativa" de uma categoria; o código e o preenchimento (carga/reboque) não mudam. */
function EditarCategoria({ c, aoSalvar }: { c: CategoriaAdm; aoSalvar: (texto: string) => void }) {
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
    const novos = {
      ...(n.length < 2 || n.length > 40 ? { nome: 'De 2 a 40 caracteres.' } : {}),
      ...(d.length < 1 || d.length > 60 ? { descricao: 'De 1 a 60 caracteres.' } : {}),
    }
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
    <li>
      <Cartao>
        <form onSubmit={(e) => void salvar(e)} noValidate className="space-y-3" aria-label={c.nome}>
          <div className="flex items-center justify-between gap-3">
            <p className="ivo-h3">{c.nome}</p>
            <div className="flex items-center gap-1">
              <span className="ivo-legenda font-semibold">Ativa</span>
              <Interruptor ligado={ativa} rotulo={`${c.nome} ativa`} onAlternar={() => setAtiva((a) => !a)} />
            </div>
          </div>
          {!ativa && <p className="ivo-legenda text-texto-suave">Inativa, a categoria some da tela do cliente.</p>}
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
      </Cartao>
    </li>
  )
}

interface Alvo {
  empresa: string | null
  nome: string
  linha: ContratoListado
}

/** Preço por categoria da versão atual de um contrato e o botão "Publicar nova versão". */
function PrecosDoContrato({
  alvo,
  modelo,
  nomes,
  aoPublicar,
}: {
  alvo: Alvo
  modelo: ContratoListado | null
  nomes: Record<CodigoCategoria, string>
  aoPublicar: (texto: string) => void
}) {
  // Empresa sem contrato parte da tabela modelo (como na tela Contratos).
  const partida = alvo.linha.vigente ?? (alvo.empresa ? (modelo?.vigente ?? null) : null)
  const empresaDaPartida = alvo.linha.vigente ? alvo.empresa : null
  const chave = `novo-categorias-precos-${empresaDaPartida ?? 'modelo'}-${partida?.versao ?? 'nenhuma'}`
  const { dados, erro, recarregar } = useConsulta(chave, () => categoriasAdm.ler(empresaDaPartida, partida?.versao ?? null))
  const [aberta, setAberta] = useState(false)
  const precos = dados ? precosDaVersao(partida, dados.precos) : null

  if (dados === undefined) {
    return erro ? <ErroAoCarregar onTentar={recarregar} /> : <Skeleton className="h-40" />
  }
  return (
    <div className="space-y-3">
      <p className="ivo-legenda text-texto-suave">
        {alvo.linha.vigente
          ? `Versão ${alvo.linha.vigente.versao}, vigente desde ${formatarDataHora(alvo.linha.vigente.vigente_desde)}.`
          : partida
            ? 'Ainda sem contrato: a versão nova parte da tabela modelo.'
            : 'Ainda sem versão publicada.'}
        {partida && !dados.precos && ' Sem preço por categoria: valem os preços da modalidade veículo próprio.'}
      </p>
      <table className="w-full text-left">
        <caption className="sr-only">Preço por categoria</caption>
        <thead>
          <tr className="ivo-legenda text-texto-suave">
            <th scope="col" className="py-1.5 font-semibold">
              Categoria
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Km
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Taxa fixa
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {CODIGOS.map((c) => (
            <tr key={c}>
              <th scope="row" className="py-2 font-semibold">
                {nomes[c]}
              </th>
              <td className="py-2 text-right tabular-nums">{precos ? formatarCentavos(precos[c].km_cent) : '—'}</td>
              <td className="py-2 text-right tabular-nums">
                {c === COM_TAXA ? (precos ? formatarCentavos(precos[c].taxa_fixa_cent) : '—') : 'Não se aplica'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ivo-legenda text-texto-suave">
        A taxa fixa só vale para a Carga Pesada (com reboque). Passageiros e Carga Leve cobram só o km.
      </p>
      <Botao variante="principal" className="w-full md:w-auto" onClick={() => setAberta(true)}>
        Publicar nova versão
      </Botao>
      {aberta && (
        <PublicarContrato
          aberta
          alvo={{ empresa: alvo.empresa, nome: alvo.nome }}
          base={alvo.linha.vigente}
          modelo={modelo?.vigente ?? null}
          categorias={{ nomes, precos }}
          onFechar={() => setAberta(false)}
          onPublicado={(t) => {
            setAberta(false)
            aoPublicar(t)
          }}
        />
      )}
    </div>
  )
}

/**
 * "Categorias e preços" do ADM (especificação §6.7): nome, descrição e "ativa" de cada categoria e o preço por km e a
 * taxa de cada uma numa versão nova do contrato (imutável, como hoje), publicada por `publicar_contrato_categorias`.
 */
export function CategoriasPrecos() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const lista = useConsulta('novo-categorias-adm', () => categoriasAdm.ler(null, null))
  const contratos = useConsulta('novo-contratos-adm', api.contratos)
  const [alvoId, setAlvoId] = useState<string>('modelo')
  const [aviso, setAviso] = useState<string | null>(null)

  const cats = lista.dados?.categorias
  const nomes = Object.fromEntries(CODIGOS.map((c) => [c, cats?.find((x) => x.codigo === c)?.nome ?? c])) as Record<
    CodigoCategoria,
    string
  >
  const modelo = contratos.dados?.find((c) => c.empresa_id === null) ?? null
  const linha = contratos.dados?.find((c) => (c.empresa_id ?? 'modelo') === alvoId) ?? null

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4">
      <header className="space-y-1">
        <h1 className="ivo-h2">Categorias e preços</h1>
        <p className="ivo-legenda text-texto-suave">
          O que o cliente vê ao pedir e o preço de cada categoria no contrato. Só o Master edita.
        </p>
      </header>
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>

      <section aria-labelledby="titulo-categorias" className="space-y-3">
        <h2 id="titulo-categorias" className="ivo-h3">
          Categorias
        </h2>
        {cats === undefined ? (
          lista.erro ? (
            <ErroAoCarregar onTentar={lista.recarregar} />
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <ul className="space-y-3">
            {cats.map((c) => (
              <EditarCategoria
                key={`${c.codigo}-${c.nome}-${c.descricao_curta}-${String(c.ativa)}`}
                c={c}
                aoSalvar={(t) => {
                  setAviso(t)
                  lista.recarregar()
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-precos" className="space-y-3">
        <h2 id="titulo-precos" className="ivo-h3">
          Preço por categoria
        </h2>
        {contratos.dados === undefined ? (
          contratos.erro ? (
            <ErroAoCarregar onTentar={contratos.recarregar} />
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <Cartao className="space-y-3">
            <CampoSelecao rotulo="Contrato" value={alvoId} onChange={(e) => setAlvoId(e.target.value)}>
              {contratos.dados.map((c) => (
                <option key={c.empresa_id ?? 'modelo'} value={c.empresa_id ?? 'modelo'}>
                  {c.empresa_nome ?? 'Tabela modelo'}
                </option>
              ))}
            </CampoSelecao>
            {linha && (
              <PrecosDoContrato
                key={`${alvoId}-${linha.vigente?.versao ?? 0}`}
                alvo={{ empresa: linha.empresa_id, nome: linha.empresa_nome ?? 'Tabela modelo', linha }}
                modelo={modelo}
                nomes={nomes}
                aoPublicar={(t) => {
                  setAviso(t)
                  contratos.recarregar()
                }}
              />
            )}
          </Cartao>
        )}
      </section>
    </main>
  )
}
