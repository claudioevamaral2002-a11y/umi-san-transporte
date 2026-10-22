import { useId } from 'react'
import { NavLink, Outlet, useSearchParams } from 'react-router'
import { SimboloIvo } from '../../../design/componentes/SimboloIvo.tsx'
import { api, type Empresa } from '../../../lib/api.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { enderecoDaAba, type ContextoPainel } from './componentes.tsx'

/**
 * "Painel da empresa" (especificação §6.9, mockup "painel com abas" da fase 4.1, tom executivo da Rhino, Ruling R17):
 * um painel só, com as abas Painel · Corridas · Pessoas · Carteira como rotas de verdade (/empresa, /empresa/corridas,
 * /empresa/pessoas, /empresa/carteira). O cabeçalho (com o "← Início" da moldura de página) e o seletor de empresa do
 * Master ficam em todas; só o conteúdo troca. Para o Administrador (N1) da própria empresa e para o Master (ADM).
 * Quase monocromático: hierarquia pelo tamanho e pelo peso, o laranja só no símbolo.
 */

const ITEM_ABA = 'flex min-h-11 items-center border-b-2 font-semibold'

const ABAS = [
  { rotulo: 'Painel', aba: '' },
  { rotulo: 'Corridas', aba: '/corridas' },
  { rotulo: 'Pessoas', aba: '/pessoas' },
  { rotulo: 'Carteira', aba: '/carteira' },
] as const

/** Topo do painel: marca, abas (navegação com a aba atual marcada) e a empresa. */
function BarraDoPainel({
  ehAdm,
  empresas,
  empresa,
  onEmpresa,
  nomeEmpresa,
}: {
  ehAdm: boolean
  empresas: Empresa[] | null
  empresa: string | null
  onEmpresa: (id: string) => void
  nomeEmpresa: string | null
}) {
  const idSeletor = useId()
  return (
    // Região própria (o <header> da moldura já é o banner, com o ☰).
    <section aria-label="Topo do painel" className="border-b border-borda bg-superficie">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-1 px-4 py-3 md:px-8">
        <span className="flex min-h-12 items-center gap-2 text-lg font-extrabold tracking-[-0.02em]">
          <SimboloIvo altura={24} />
          IVO para empresas
        </span>
        <nav aria-label="Painel da empresa" className="order-last w-full md:order-none md:w-auto">
          <ul className="flex gap-5 md:gap-6">
            {ABAS.map(({ rotulo, aba }) => (
              <li key={rotulo}>
                <NavLink
                  to={enderecoDaAba(aba, ehAdm, empresa)}
                  // O Painel é a raiz: só ele é "atual" exato; as outras abas, na própria rota.
                  end
                  className={({ isActive }) =>
                    `${ITEM_ABA} ${isActive ? 'border-texto text-texto' : 'border-transparent text-texto-suave hover:text-texto'}`
                  }
                >
                  {rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <span className="ml-auto flex items-center gap-2">
          {empresas ? (
            <>
              <label htmlFor={idSeletor} className="sr-only">
                Empresa
              </label>
              <select
                id={idSeletor}
                value={empresa ?? ''}
                onChange={(e) => onEmpresa(e.target.value)}
                className="min-h-11 rounded-xl border border-borda bg-superficie px-3 font-bold text-texto"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </>
          ) : (
            nomeEmpresa && <span className="font-bold">{nomeEmpresa}</span>
          )}
        </span>
      </div>
    </section>
  )
}

export function PainelEmpresa() {
  const { perfil } = useSessao()
  const ehAdm = perfil?.papel === 'ADM'
  const [busca, setBusca] = useSearchParams()
  const listaEmpresas = useConsulta('painel-empresa-empresas', () => (ehAdm ? api.empresas() : Promise.resolve([])))
  const empresa = ehAdm ? (busca.get('empresa') ?? listaEmpresas.dados?.[0]?.id ?? null) : null
  const semEmpresa = ehAdm && listaEmpresas.dados !== undefined && listaEmpresas.dados.length === 0
  const contexto: ContextoPainel = {
    ehAdm,
    empresa,
    semEmpresa,
    erroEmpresas: !!listaEmpresas.erro,
    recarregarEmpresas: listaEmpresas.recarregar,
  }

  return (
    <div className="min-h-dvh bg-painel-fundo pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <BarraDoPainel
        ehAdm={ehAdm}
        empresas={ehAdm ? (listaEmpresas.dados ?? []) : null}
        empresa={empresa}
        // Troca a empresa e fica na mesma aba (só muda o `?empresa=`).
        onEmpresa={(id) => setBusca({ empresa: id }, { replace: true })}
        nomeEmpresa={perfil?.empresa_nome ?? null}
      />
      <Outlet context={contexto} />
    </div>
  )
}
