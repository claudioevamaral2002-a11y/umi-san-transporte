import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { Dinheiro } from '../design/componentes/Dinheiro.tsx'
import { Icone } from '../design/componentes/Icone.tsx'
import { Mensagem } from '../design/componentes/Mensagem.tsx'
import { Skeleton } from '../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../design/componentes/Tela.tsx'
import { api } from '../lib/api.ts'
import { useConsulta } from '../lib/consulta.ts'
import { descreverFaixas, formatarValor, GRUPOS, podeEditarParametros, type VersaoParametros } from '../lib/parametros.ts'
import { useSessao } from '../lib/sessao.tsx'
import { formatarDataHora } from '../lib/valores.ts'
import { PublicarParametros } from './parametros/PublicarParametros.tsx'

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-borda py-2.5 last:border-b-0">
      <dt className="ivo-corpo text-texto-suave">{rotulo}</dt>
      <dd className="text-right font-bold whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  )
}

function CartoesVersao({ versao }: { versao: VersaoParametros }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GRUPOS.map((g) => (
        <Cartao key={g.id} className={`space-y-1 ${g.id === 'comuns' ? 'md:col-span-2' : ''}`}>
          <p className="ivo-sobretitulo text-texto-suave">{g.id === 'comuns' ? 'Todas as modalidades' : 'Modalidade'}</p>
          <h2 className="ivo-h3">{g.titulo}</h2>
          <p className="ivo-legenda text-texto-suave">{g.descricao}</p>
          <div className={g.id === 'comuns' ? 'grid gap-x-8 md:grid-cols-2' : ''}>
            {g.id === 'comuns' && (
              <section aria-labelledby="titulo-faixas" className="pt-2">
                <h3 id="titulo-faixas" className="font-bold">
                  Cancelamento
                </h3>
                <p className="ivo-legenda text-texto-suave">Multa sobre o valor aprovado, pela antecedência do aviso.</p>
                <ul className="mt-2 space-y-2" data-testid="faixas-cancelamento">
                  {descreverFaixas(versao.faixas_cancelamento).map((t) => (
                    <li key={t} className="flex items-start gap-2.5 rounded-xl bg-fundo px-3 py-2.5 tabular-nums">
                      <Icone nome="relogio" tamanho={18} className="mt-0.5 text-marinho-2" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <dl className={g.id === 'comuns' ? 'pt-2' : 'pt-1'}>
              {g.campos.map((c) => (
                <Linha key={c.campo} rotulo={c.rotulo}>
                  {c.tipo === 'dinheiro' ? (
                    <Dinheiro centavos={versao[c.campo]} />
                  ) : (
                    formatarValor(c.tipo, versao[c.campo])
                  )}
                </Linha>
              ))}
            </dl>
          </div>
        </Cartao>
      ))}
    </div>
  )
}

function Historico({ historico, vigente, agora }: { historico: VersaoParametros[]; vigente: VersaoParametros | null; agora: number }) {
  return (
    <section aria-labelledby="titulo-historico" className="space-y-2">
      <h2 id="titulo-historico" className="px-1 ivo-sobretitulo text-texto-suave">
        Histórico de versões
      </h2>
      <Cartao className="p-0">
        <ul>
          {historico.map((v) => {
            const futura = new Date(v.vigente_desde).getTime() > agora
            return (
              <li key={v.versao} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-borda px-4 py-3 last:border-b-0">
                <span className="w-24 font-bold tabular-nums">Versão {v.versao}</span>
                <span className="flex-1 ivo-legenda text-texto-suave">
                  Vigente desde <span className="tabular-nums text-texto">{formatarDataHora(v.vigente_desde)}</span>
                  {v.publicado_por_nome && (
                    <>
                      {' · '}publicada por <span className="text-texto">{v.publicado_por_nome}</span>
                    </>
                  )}
                </span>
                {vigente?.versao === v.versao && (
                  <span className="rounded-full border border-[var(--status-concluida)] px-2.5 py-0.5 text-xs font-bold text-[var(--status-concluida)]">
                    ✓ Vigente
                  </span>
                )}
                {futura && (
                  <span className="rounded-full border border-[var(--status-agendada)] px-2.5 py-0.5 text-xs font-bold text-[var(--status-agendada)]">
                    ▣ Agendada
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </Cartao>
    </section>
  )
}

export function Parametros() {
  const { perfil } = useSessao()
  const [busca, setBusca] = useSearchParams()
  const [aviso, setAviso] = useState<string | null>(null)
  const { dados, erro, carregando, recarregar } = useConsulta('parametros', async () => {
    const [parametros, permissoes] = await Promise.all([api.parametros(), api.permissoes()])
    return { ...parametros, permissoes, agora: Date.now() }
  })

  const pode = dados ? podeEditarParametros(perfil?.papel, dados.permissoes) : false
  const formularioAberto = pode && busca.get('publicar') === '1'
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

  const vigente = dados?.vigente ?? null
  const proxima = dados?.historico.find((v) => new Date(v.vigente_desde).getTime() > dados.agora) ?? null
  // Ponto de partida do formulário e da comparação: a vigente (ou, sem ela, a agendada mais recente).
  const base = vigente ?? dados?.historico[0] ?? null

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={perfil?.papel === 'ADM' || pode ? 'Parâmetros' : 'Somente leitura'}
        titulo="Tabela de preços e regras"
        descricao="Valores padrão de cada modalidade. Mudanças valem só para orçamentos criados depois da vigência."
        acao={
          pode && (
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
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Carregando a tabela">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      )}

      {dados && (
        <>
          {vigente ? (
            <>
              <p className="ivo-legenda text-texto-suave" data-testid="versao-vigente">
                Versão <span className="font-bold text-texto tabular-nums">{vigente.versao}</span> · vigente desde{' '}
                <span className="font-bold text-texto tabular-nums">{formatarDataHora(vigente.vigente_desde)}</span>
                {vigente.publicado_por_nome && <> · publicada por {vigente.publicado_por_nome}</>}
              </p>
              {proxima && (
                <Mensagem tipo="info">
                  A versão {proxima.versao} entra em vigor em {formatarDataHora(proxima.vigente_desde)}.
                </Mensagem>
              )}
              <CartoesVersao versao={vigente} />
            </>
          ) : (
            <EstadoVazio icone="tabela" titulo="Tabela ainda não publicada">
              {proxima ? (
                <>A versão {proxima.versao} entra em vigor em {formatarDataHora(proxima.vigente_desde)}.</>
              ) : pode ? (
                <>Publique a primeira versão para que motoristas e clientes vejam os valores e os orçamentos sejam liberados.</>
              ) : (
                <>Assim que a IVO Transportes publicar os valores, eles aparecem aqui.</>
              )}
            </EstadoVazio>
          )}

          {dados.historico.length > 0 && <Historico historico={dados.historico} vigente={vigente} agora={dados.agora} />}
        </>
      )}

      {dados && (
        <PublicarParametros
          aberta={formularioAberto}
          base={base}
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
