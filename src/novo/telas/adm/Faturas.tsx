import { Link } from 'react-router'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ErroAoCarregar, EstadoVazio } from '../../../design/componentes/Tela.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { faturas, type ResumoEmpresaFaturas } from '../../../lib/faturas.ts'
import { CHAVE_RESUMO_FATURAS } from './PendenciasFaturas.tsx'

/** Uma linha de `faturas_resumo` (só o Master): a mesma consulta para a lista e para as pendências. */
const useResumo = () => useConsulta(CHAVE_RESUMO_FATURAS, faturas.resumo)

function Valor({ rotulo, centavos, destaque = false }: { rotulo: string; centavos: number; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="ivo-legenda text-texto-suave">{rotulo}</p>
      <p className={`font-bold tabular-nums ${destaque ? 'text-alerta-texto' : ''}`}>
        <Dinheiro centavos={centavos} />
      </p>
    </div>
  )
}

function LinhaEmpresa({ e }: { e: ResumoEmpresaFaturas }) {
  return (
    <Link
      to={`/adm/faturas/${e.empresa_id}`}
      viewTransition
      className="block space-y-3 rounded-cartao border-[1.5px] border-borda bg-superficie p-4 shadow-[var(--sombra)] transition-colors hover:border-marinho-2"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate ivo-h3">{e.empresa_nome}</p>
        {e.quinzena_pronta && (
          <span className="shrink-0 rounded-full bg-[var(--cor-laranja)] px-2.5 py-0.5 text-xs font-extrabold text-marinho">
            Pronta para faturar
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Valor rotulo="A faturar" centavos={e.a_faturar_cent} />
        <Valor rotulo="Em aberto" centavos={e.em_aberto_cent} />
        <Valor rotulo="Vencidas" centavos={e.vencidas_cent} destaque={e.vencidas_cent > 0} />
      </div>
    </Link>
  )
}

/** ☰ › Faturas (só o Master): uma linha por empresa no Faturado (NF), com A faturar, Em aberto e Vencidas. */
export function Faturas() {
  const { dados, erro, recarregar } = useResumo()
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Faturas"
        descricao="Empresas no Faturado (NF). A cada dia 1 e 16, gere a fatura da quinzena que fechou com a NF emitida na prefeitura."
      />
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Carregando as faturas">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        )
      ) : dados.length === 0 ? (
        <EstadoVazio icone="predio" titulo="Nenhuma empresa no Faturado (NF)">
          Em Contratos, publique uma versão com a forma de cobrança Faturado (NF).
        </EstadoVazio>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="lista-faturas-empresas">
          {dados.map((e) => (
            <li key={e.empresa_id}>
              <LinhaEmpresa e={e} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
