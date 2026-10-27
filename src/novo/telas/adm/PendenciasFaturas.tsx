import { Link } from 'react-router'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { faturas, rotuloQuinzena, type ResumoEmpresaFaturas } from '../../../lib/faturas.ts'

/** Chave da leitura de `faturas_resumo` (só o Master): a mesma na lista de Faturas e nas pendências. */
export const CHAVE_RESUMO_FATURAS = 'adm-faturas-resumo'

/**
 * Pendências das faturas no Início e no Painel do Master (especificação §5.4): "Quinzena fechada: <empresa> pronta para
 * faturar" e "Faturas vencidas". Sem pendência (ou sem resposta), não mostra nada.
 */
export function PendenciasFaturas() {
  const { dados } = useConsulta(CHAVE_RESUMO_FATURAS, faturas.resumo)
  return <BlocoPendenciasFaturas dados={dados} />
}

/** Há fatura a gerar (quinzena fechada) ou vencida no resumo. */
export function temPendenciaFaturas(dados: readonly ResumoEmpresaFaturas[] | null | undefined): boolean {
  return (dados ?? []).some((e) => e.quinzena_pronta || e.vencidas_cent > 0)
}

/** O bloco das pendências a partir do resumo já lido (o Início do Master lê uma vez e decide o "Nada pendente"). */
export function BlocoPendenciasFaturas({ dados }: { dados: readonly ResumoEmpresaFaturas[] | null | undefined }) {
  const prontas = (dados ?? []).filter((e) => e.quinzena_pronta)
  const vencidas = (dados ?? []).filter((e) => e.vencidas_cent > 0)
  if (prontas.length === 0 && vencidas.length === 0) return null
  return (
    <Cartao className="space-y-2" data-testid="pendencias-faturas">
      <h2 className="ivo-sobretitulo text-texto-suave">Faturas</h2>
      <ul className="divide-y divide-borda">
        {prontas.map((e) => (
          <li key={`pronta-${e.empresa_id}`}>
            <Link
              to={`/adm/faturas/${e.empresa_id}`}
              className="flex min-h-12 items-center justify-between gap-3 py-2 font-semibold hover:text-link"
              aria-describedby={`quinzena-${e.empresa_id}`}
            >
              <span className="min-w-0">Quinzena fechada: {e.empresa_nome} pronta para faturar</span>
              <Icone nome="setaDireitaPequena" tamanho={18} className="shrink-0 text-texto-suave" />
            </Link>
            <p id={`quinzena-${e.empresa_id}`} className="-mt-1 pb-2 ivo-legenda text-texto-suave tabular-nums">
              {rotuloQuinzena(e.quinzena_pronta!)}
            </p>
          </li>
        ))}
        {vencidas.length > 0 && (
          <li>
            <p className="flex items-center gap-2 pt-2 font-semibold text-alerta-texto">
              <Icone nome="alerta" tamanho={18} />
              Faturas vencidas
            </p>
            <ul className="pb-1">
              {vencidas.map((e) => (
                <li key={`vencida-${e.empresa_id}`}>
                  <Link
                    to={`/adm/faturas/${e.empresa_id}`}
                    className="flex min-h-12 items-center justify-between gap-3 hover:text-link"
                  >
                    <span className="min-w-0 truncate">{e.empresa_nome}</span>
                    <span className="shrink-0 font-bold tabular-nums">{formatarCentavos(e.vencidas_cent)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </Cartao>
  )
}

export default PendenciasFaturas
