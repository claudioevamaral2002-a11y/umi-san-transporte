import { useState } from 'react'
import { Link } from 'react-router'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar } from '../../../design/componentes/Tela.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { faturas } from '../../../lib/faturas.ts'
import { dinheiro, type Painel } from '../../../lib/saldo.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { ResumoDoPainel } from '../../../telas/adm/Painel.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { BlocoPendenciasFaturas, CHAVE_RESUMO_FATURAS, temPendenciaFaturas } from './PendenciasFaturas.tsx'

function saudacao(agora: Date): string {
  const h = agora.getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

interface Pendencia {
  rotulo: string
  total: number
  para: string
}

/** As pendências do painel com o atalho para a tela que resolve cada uma (só as que têm algo). */
export function pendenciasDoPainel(p: Painel): Pendencia[] {
  return [
    { rotulo: 'Aguardando orçamento', total: p.pendencias.aguardando_orcamento, para: '/pedidos' },
    { rotulo: 'Aguardando aprovação', total: p.pendencias.aguardando_aprovacao, para: '/pedidos' },
    { rotulo: 'Em andamento', total: p.corridas.em_andamento, para: '/pedidos?filtro=agendados' },
    { rotulo: 'Empresas abaixo do alerta', total: p.pendencias.empresas_abaixo_alerta, para: '/adm/creditos' },
  ].filter((x) => x.total > 0)
}

/**
 * Início do Master (v2.2, especificação §5.6): em cima as pendências com atalho (pedidos, corridas, faturas e empresas
 * com saldo baixo); embaixo o resumo do painel. Sem nada pendente: "Nada pendente agora."
 */
export function InicioMaster() {
  const { perfil } = useSessao()
  const [agora] = useState(() => new Date())
  const ola = saudacao(agora)
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0] ?? ''
  // A mesma leitura (e a mesma chave) do `PainelResumo`, feita uma vez só: serve às pendências e ao resumo.
  const painel = useConsulta('painel-resumo', () => dinheiro.painel(null, null))
  const resumo = useConsulta(CHAVE_RESUMO_FATURAS, faturas.resumo)
  const lista = painel.dados ? pendenciasDoPainel(painel.dados) : []
  // Só diz "Nada pendente" com as duas respostas na mão: se as faturas falharem, não dá para afirmar.
  const nada =
    painel.dados !== undefined &&
    resumo.dados !== undefined &&
    !resumo.erro &&
    lista.length === 0 &&
    !temPendenciaFaturas(resumo.dados)

  return (
    <FolhaMapa rotulo="Início">
      <h1 className="ivo-h2">{primeiroNome ? `${ola}, ${primeiroNome}` : ola}</h1>
      <div className="mt-4 space-y-4">
        <section aria-labelledby="titulo-pendencias-master" className="space-y-2" data-testid="pendencias-master">
          <h2 id="titulo-pendencias-master" className="px-1 ivo-sobretitulo text-texto-suave">
            Pendências
          </h2>
          {painel.dados === undefined ? (
            painel.erro ? (
              <ErroAoCarregar onTentar={painel.recarregar} />
            ) : (
              <Skeleton className="h-24" />
            )
          ) : nada ? (
            <Cartao>
              <p className="flex items-center gap-2 ivo-corpo text-texto-suave">
                <Icone nome="check" tamanho={18} />
                Nada pendente agora.
              </p>
            </Cartao>
          ) : (
            <>
              {lista.length > 0 && (
                <Cartao>
                  <ul className="divide-y divide-borda" aria-label="Pendências do painel">
                    {lista.map((x) => (
                      <li key={x.rotulo}>
                        <Link
                          to={x.para}
                          viewTransition
                          className="flex min-h-12 items-center justify-between gap-3 py-2 font-semibold hover:text-link"
                        >
                          <span className="min-w-0">{x.rotulo}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-bold tabular-nums">{x.total}</span>
                            <Icone nome="setaDireitaPequena" tamanho={18} className="text-texto-suave" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Cartao>
              )}
              <BlocoPendenciasFaturas dados={resumo.dados} />
            </>
          )}
        </section>
        <ResumoDoPainel dados={painel.dados} />
      </div>
    </FolhaMapa>
  )
}

export default InicioMaster
