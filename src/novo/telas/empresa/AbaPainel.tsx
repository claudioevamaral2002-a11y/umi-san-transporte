import { Link } from 'react-router'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar } from '../../../design/componentes/Tela.tsx'
import { useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import type { Painel } from '../../../lib/painelEmpresa.ts'
import { reaisCurto } from '../../formatos.ts'
import {
  BOTAO_CONTORNO,
  CARTAO,
  TabelaCorridas,
  Secao,
  baixarCsv,
  enderecoDaAba,
  nomeDoMesPainel,
  plural,
  useContextoPainel,
  usePainelDaEmpresa,
  type Aba,
} from './componentes.tsx'

/** Só os dígitos, para o link de ligação ("(47) 9 9999-0000" → "tel:+5547999990000"). */
function linkDoContato(contato: string): string | null {
  const d = contato.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return d.length === 10 || d.length === 11 ? `tel:+55${d}` : null
}

/** Um valor do resumo do Faturado ("A faturar", "Em aberto", "Vencidas"). */
function Total({ rotulo, detalhe, centavos, testId }: { rotulo: string; detalhe?: string; centavos: number; testId: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-sm font-medium text-texto-suave">
        {rotulo}
        {detalhe && <span className="text-xs"> · {detalhe}</span>}
      </dt>
      <dd className="text-2xl leading-tight font-extrabold tracking-[-0.02em] tabular-nums md:text-[1.75rem]">
        {reaisCurto(centavos)}
      </dd>
    </div>
  )
}

/**
 * v2.1 (§5.3): no Faturado não há saldo a recarregar. O gasto do mês continua; o disponível, o reservado, a barra do
 * total e o contato de recarga dão lugar ao que vai para a fatura, às faturas em aberto e, delas, às vencidas.
 */
function ResumoFaturado({ resumo, faturas }: { resumo: Painel['resumo']; faturas: string }) {
  return (
    <Secao titulo={`Resumo de ${nomeDoMesPainel(resumo.mes)}`} link={{ para: faturas, texto: 'Faturas' }}>
      <div className={`${CARTAO} space-y-5 p-6 md:p-8`} data-testid="resumo-mes">
        <div>
          <p className="text-sm font-medium text-texto-suave">Gasto no mês</p>
          <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
            {reaisCurto(resumo.gasto_cent)}
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-borda pt-4 sm:grid-cols-3">
          <Total rotulo="A faturar" detalhe="ainda sem fatura" centavos={resumo.a_faturar_cent ?? 0} testId="a-faturar" />
          <Total rotulo="Em aberto" detalhe="faturas emitidas não pagas" centavos={resumo.em_aberto_cent ?? 0} testId="em-aberto" />
          <Total rotulo="Vencidas" centavos={resumo.vencidas_cent ?? 0} testId="vencidas" />
        </dl>
      </div>
    </Secao>
  )
}

function Resumo({ resumo, carteira }: { resumo: Painel['resumo']; carteira: string }) {
  const { gasto_cent: gasto, total_mes_cent: total } = resumo
  const porcento = total > 0 ? Math.min(100, Math.max(0, Math.round((gasto / total) * 100))) : 0
  const contato = resumo.contato_recarga
  const tel = contato ? linkDoContato(contato) : null
  return (
    <Secao titulo={`Resumo de ${nomeDoMesPainel(resumo.mes)}`} link={{ para: carteira, texto: 'Extrato' }}>
      <div className={`${CARTAO} space-y-5 p-6 md:p-8`} data-testid="resumo-mes">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-sm font-medium text-texto-suave">Gasto no mês</p>
            <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
              {reaisCurto(gasto)}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-sm font-medium text-texto-suave">Total do mês</p>
            <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
              {reaisCurto(total)}
            </p>
          </div>
        </div>
        <div
          role="meter"
          aria-label="Gasto do total do mês"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcento}
          aria-valuetext={`${porcento}% do total do mês`}
        >
          <svg className="block h-3.5 w-full" aria-hidden="true">
            <rect width="100%" height="100%" rx="7" className="fill-painel-trilho" />
            {porcento > 0 && <rect width={`${porcento}%`} height="100%" rx="7" className="fill-painel-barra" />}
          </svg>
          <p className="mt-2 text-xs text-texto-suave">
            {porcento}% do total do mês (saldo no início do mês + recargas + limite de crédito)
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-borda pt-4">
          <p>
            <span className="text-lg font-bold tabular-nums">{reaisCurto(resumo.disponivel_cent)}</span>{' '}
            <span className="font-semibold">disponível</span>
            {resumo.reservado_cent > 0 && (
              <span className="text-sm text-texto-suave">
                {' '}
                · {reaisCurto(resumo.reservado_cent)} reservado em corridas confirmadas
              </span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-texto-suave">
            Para recarregar, fale com a IVO
            {contato &&
              (tel ? (
                <a href={tel} className={BOTAO_CONTORNO}>
                  Falar com a IVO · <span className="tabular-nums">{contato}</span>
                </a>
              ) : (
                <span className="font-semibold text-texto">{contato}</span>
              ))}
          </p>
        </div>
      </div>
    </Secao>
  )
}

function Pessoas({ pessoas, equipe, onExportar }: { pessoas: Painel['pessoas']; equipe: string; onExportar: () => void }) {
  const etiqueta = 'rounded-md bg-tag-neutro-fundo px-2 py-0.5 text-sm font-bold text-tag-neutro-texto tabular-nums'
  return (
    <Secao titulo="Pessoas" link={{ para: equipe, texto: 'Equipe' }}>
      <div className={`${CARTAO} flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4`} data-testid="bloco-pessoas">
        <p className="flex items-center gap-2">
          <span className={etiqueta}>{plural(pessoas.sem_corridas, 'pessoa', 'pessoas')}</span>
          <span>{pessoas.sem_corridas === 1 ? 'ainda não fez corridas' : 'ainda não fizeram corridas'}</span>
        </p>
        <p className="flex items-center gap-2">
          <span className={etiqueta}>{plural(pessoas.convites_pendentes, 'convite', 'convites')}</span>
          <span>{pessoas.convites_pendentes === 1 ? 'não aceito' : 'não aceitos'}</span>
        </p>
        <span className="flex flex-wrap gap-2 md:ml-auto">
          {/* O fluxo de convite de hoje (Equipe: "Gerar novo link" ou "Convidar"). */}
          <Link to={equipe} className={BOTAO_CONTORNO}>
            Reenviar convite
          </Link>
          <button type="button" onClick={onExportar} className={BOTAO_CONTORNO}>
            Exportar CSV do mês
          </button>
        </span>
      </div>
    </Secao>
  )
}

/** Aba "Painel" (/empresa): resumo do mês, próximas corridas, recentes e pessoas. */
export function AbaPainel() {
  const { ehAdm, empresa, semEmpresa, erroEmpresas, recarregarEmpresas, forma } = useContextoPainel()
  const { dados, erro, recarregar } = usePainelDaEmpresa()
  // O nome da página já está no cabeçalho "← Início": o h1 daqui é só para leitores de tela.
  useTituloNaTela('oculto')
  const aba = (a: Aba) => enderecoDaAba(a, ehAdm, empresa)

  return (
    <main className="mx-auto max-w-5xl space-y-9 p-4 md:p-6">
      <h1 className="sr-only">Painel da empresa</h1>
      {semEmpresa ? (
        <p className={`${CARTAO} p-6`}>Nenhuma empresa cadastrada.</p>
      ) : !dados ? (
        erro || erroEmpresas ? (
          <ErroAoCarregar
            onTentar={() => {
              recarregarEmpresas()
              recarregar()
            }}
          />
        ) : (
          <div className="space-y-6" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando o painel…
            </p>
            <Skeleton className="h-56 rounded-[20px]" />
            <Skeleton className="h-48 rounded-[20px]" />
            <Skeleton className="h-48 rounded-[20px]" />
          </div>
        )
      ) : (
        <>
          {forma === 'FATURADO' ? (
            <ResumoFaturado resumo={dados.resumo} faturas={aba('/faturas')} />
          ) : (
            <Resumo resumo={dados.resumo} carteira={aba('/carteira')} />
          )}
          <Secao titulo="Próximas corridas" link={{ para: aba('/corridas'), texto: 'Ver todas' }}>
            <TabelaCorridas titulo="Próximas corridas" itens={dados.proximas} vazio="Nenhuma corrida marcada." ehCliente={!ehAdm} />
          </Secao>
          <Secao titulo="Corridas recentes" link={{ para: aba('/corridas'), texto: 'Ver todas' }}>
            <TabelaCorridas
              titulo="Corridas recentes"
              itens={dados.recentes}
              vazio="Nenhuma corrida nos últimos 30 dias."
              ehCliente={!ehAdm}
            />
          </Secao>
          <Pessoas
            pessoas={dados.pessoas}
            equipe={aba('/pessoas')}
            onExportar={() => baixarCsv(dados.do_mes, dados.resumo.mes.slice(0, 7))}
          />
        </>
      )}
    </main>
  )
}
