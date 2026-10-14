import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api, type ContratoListado } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { formatarDataHora } from '../../lib/valores.ts'
import { CartoesContrato, Historico, SeloSemContrato, SeloVigente } from '../contratos/CartoesContrato.tsx'
import { PublicarContrato } from '../contratos/PublicarContrato.tsx'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODELO = 'modelo'

const caminhoDe = (empresa: string | null) => `/adm/contratos/${empresa ?? MODELO}`
const nomeDe = (c: Pick<ContratoListado, 'empresa_id' | 'empresa_nome'>) =>
  c.empresa_id === null ? 'Tabela modelo' : (c.empresa_nome ?? 'Empresa')

// ------------------------------------------------------------------------------------------------
// Lista: tabela modelo + cada empresa
// ------------------------------------------------------------------------------------------------

function ItemContrato({ c }: { c: ContratoListado }) {
  const modelo = c.empresa_id === null
  return (
    <li>
      <Link
        to={caminhoDe(c.empresa_id)}
        viewTransition
        className="flex min-h-16 items-center gap-3 rounded-cartao border-[1.5px] border-borda bg-superficie p-4 shadow-[var(--sombra)] transition-colors hover:border-marinho-2"
      >
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            modelo ? 'bg-marinho text-papel' : 'bg-fundo text-link'
          }`}
        >
          <Icone nome={modelo ? 'tabela' : 'predio'} />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold">{nomeDe(c)}</span>
            {c.vigente ? <SeloVigente /> : <SeloSemContrato />}
          </span>
          <span className="block ivo-legenda text-texto-suave">
            {modelo && <>Base para os contratos das empresas. </>}
            {c.vigente ? (
              <>
                Versão <span className="tabular-nums">{c.vigente.versao}</span> desde{' '}
                <span className="tabular-nums">{formatarDataHora(c.vigente.vigente_desde)}</span>
              </>
            ) : modelo ? (
              'Ainda sem versão vigente.'
            ) : (
              'Sem contrato vigente: os clientes desta empresa ainda não fazem pedidos.'
            )}
          </span>
          {c.proxima_vigencia && (
            <span className="block ivo-legenda font-semibold text-[var(--status-agendada)]">
              Nova versão agendada para <span className="tabular-nums">{formatarDataHora(c.proxima_vigencia)}</span>
            </span>
          )}
        </span>
        <Icone nome="setaDireita" tamanho={18} className="shrink-0 text-texto-suave" />
      </Link>
    </li>
  )
}

export function Contratos() {
  const { dados, erro, carregando, recarregar } = useConsulta('adm-contratos', api.contratos)
  const modelo = dados?.find((c) => c.empresa_id === null)
  const empresas = dados?.filter((c) => c.empresa_id !== null) ?? []

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Contratos"
        descricao="Preços, regras e crédito de cada empresa. Só você publica; cada versão vale a partir da vigência."
      />

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando os contratos">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {dados && (
        <>
          {modelo && (
            <ul className="space-y-3" data-testid="contrato-modelo">
              <ItemContrato c={modelo} />
            </ul>
          )}
          <section aria-labelledby="titulo-empresas" className="space-y-2">
            <h2 id="titulo-empresas" className="px-1 ivo-sobretitulo text-texto-suave">
              Empresas
            </h2>
            {empresas.length === 0 ? (
              <EstadoVazio icone="predio" titulo="Nenhuma empresa cadastrada">
                Cadastre a empresa em <Link to="/adm/empresas" className="font-semibold underline">Empresas</Link> e depois
                crie o contrato dela a partir da tabela modelo.
              </EstadoVazio>
            ) : (
              <ul className="space-y-3" data-testid="lista-contratos">
                {empresas.map((c) => (
                  <ItemContrato key={c.empresa_id} c={c} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

// ------------------------------------------------------------------------------------------------
// Detalhe: contrato vigente, histórico e "Publicar nova versão"
// ------------------------------------------------------------------------------------------------

export function ContratoDetalhe() {
  const { alvo = MODELO } = useParams()
  const empresa = UUID.test(alvo) ? alvo.toLowerCase() : null
  const valido = empresa !== null || alvo === MODELO
  const [busca, setBusca] = useSearchParams()
  const [aviso, setAviso] = useState<string | null>(null)
  const { dados, erro, carregando, recarregar } = useConsulta(`adm-contrato-${empresa ?? MODELO}`, async () => {
    if (!valido) return null
    const [lista, historico] = await Promise.all([api.contratos(), api.historicoContrato(empresa)])
    const linha = lista.find((c) => c.empresa_id === empresa) ?? null
    return {
      linha,
      modelo: lista.find((c) => c.empresa_id === null)?.vigente ?? null,
      historico,
      agora: Date.now(),
    }
  })

  const formularioAberto = busca.get('publicar') === '1' && !!dados?.linha
  const abrir = (sim: boolean) =>
    setBusca(
      (b) => {
        const n = new URLSearchParams(b)
        if (sim) n.set('publicar', '1')
        else n.delete('publicar')
        return n
      },
      { replace: true },
    )

  const linha = dados?.linha ?? null
  const nome = linha ? nomeDe(linha) : empresa ? 'Contrato' : 'Tabela modelo'
  const vigente = linha?.vigente ?? null
  const proxima = dados?.historico.find((v) => new Date(v.vigente_desde).getTime() > dados.agora) ?? null
  // Ponto de partida do formulário e da comparação: o vigente (ou, sem ele, o agendado mais recente).
  const base = vigente ?? dados?.historico[0] ?? null
  const semNada = !!dados && !base
  const aPartirDoModelo = semNada && empresa !== null && !!dados?.modelo

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <Link
        to="/adm/contratos"
        viewTransition
        className="inline-flex min-h-12 items-center gap-2 rounded-xl pr-3 font-semibold text-texto-suave hover:text-texto"
      >
        <Icone nome="setaEsquerda" tamanho={20} />
        Contratos
      </Link>
      <CabecalhoTela
        sobretitulo={empresa ? 'Contrato da empresa' : 'Contratos'}
        titulo={nome}
        descricao={
          empresa
            ? 'Mudanças valem só para orçamentos criados depois da vigência.'
            : 'Base para os contratos das empresas. Mudar a tabela modelo não altera contratos já publicados.'
        }
        acao={
          linha &&
          !semNada && (
            <Botao variante="principal" className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => abrir(true)}>
              <Icone nome="mais" tamanho={20} />
              Publicar nova versão
            </Botao>
          )
        }
      />

      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Carregando o contrato">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      )}

      {dados && !linha && (
        <EstadoVazio icone="predio" titulo="Contrato não encontrado">
          Volte para a lista de contratos e escolha a empresa de novo.
        </EstadoVazio>
      )}

      {dados && linha && (
        <>
          {vigente ? (
            <>
              <p className="ivo-legenda text-texto-suave" data-testid="versao-vigente">
                Versão <span className="font-bold text-texto tabular-nums">{vigente.versao}</span>, vigente desde{' '}
                <span className="font-bold text-texto tabular-nums">{formatarDataHora(vigente.vigente_desde)}</span>
                {vigente.publicado_por_nome && <>, publicada por {vigente.publicado_por_nome}</>}
              </p>
              {proxima && (
                <Mensagem tipo="info">
                  A versão {proxima.versao} entra em vigor em {formatarDataHora(proxima.vigente_desde)}.
                </Mensagem>
              )}
              <CartoesContrato versao={vigente} />
            </>
          ) : (
            <Cartao className="space-y-3 text-center" data-testid="sem-contrato">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-fundo text-alerta-texto">
                <Icone nome="alerta" />
              </span>
              <h2 className="ivo-h3">{empresa ? 'Sem contrato vigente' : 'Tabela modelo ainda não vigente'}</h2>
              <p className="mx-auto max-w-md ivo-corpo text-texto-suave">
                {proxima
                  ? `A versão ${proxima.versao} entra em vigor em ${formatarDataHora(proxima.vigente_desde)}.`
                  : empresa
                    ? 'Enquanto não houver contrato vigente, os clientes desta empresa não conseguem fazer pedidos.'
                    : 'Publique a primeira versão: ela é a base dos contratos das empresas.'}
              </p>
              {semNada && (
                <Botao variante="principal" className="inline-flex items-center gap-2" onClick={() => abrir(true)}>
                  <Icone nome="mais" tamanho={20} />
                  {aPartirDoModelo
                    ? 'Criar contrato a partir da tabela modelo'
                    : empresa
                      ? 'Criar contrato'
                      : 'Publicar tabela modelo'}
                </Botao>
              )}
            </Cartao>
          )}

          {dados.historico.length > 0 && <Historico historico={dados.historico} vigente={vigente} agora={dados.agora} />}
        </>
      )}

      {dados && linha && (
        <PublicarContrato
          aberta={formularioAberto}
          alvo={{ empresa, nome }}
          base={base}
          modelo={dados.modelo}
          onFechar={() => abrir(false)}
          onPublicado={(texto) => {
            setAviso(texto)
            abrir(false)
            recarregar()
          }}
        />
      )}
    </main>
  )
}
