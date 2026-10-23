import { useEffect, useId, useRef } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import { SimboloIvo } from '../../../design/componentes/SimboloIvo.tsx'
import { api, type Empresa } from '../../../lib/api.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import type { FormaCobranca } from '../../../lib/contratos.ts'
import { enderecoDaAba, formaDoPainel, useLeituraDoPainel, type Aba, type ContextoPainel } from './componentes.tsx'

/**
 * "Painel da empresa" (especificação §6.9, mockup "painel com abas" da fase 4.1, tom executivo da Rhino, Ruling R17):
 * um painel só, com as abas Painel · Corridas · Pessoas · Carteira como rotas de verdade (/empresa, /empresa/corridas,
 * /empresa/pessoas, /empresa/carteira). O cabeçalho (com o "← Início" da moldura de página) e o seletor de empresa do
 * Master ficam em todas; só o conteúdo troca. Para o Administrador (N1) da própria empresa e para o Master (ADM).
 * Quase monocromático: hierarquia pelo tamanho e pelo peso, o laranja só no símbolo.
 *
 * v2.1 (§5.3): na empresa Faturado (NF), a aba Carteira vira Faturas (/empresa/faturas). A forma vem do painel do mês,
 * lido aqui uma vez; enquanto ele carrega, a quarta aba espera (nada de "Carteira" que vira "Faturas").
 */

const ITEM_ABA = 'flex min-h-11 items-center border-b-2 font-semibold'

const ABAS_COMUNS: ReadonlyArray<{ rotulo: string; aba: Aba }> = [
  { rotulo: 'Painel', aba: '' },
  { rotulo: 'Corridas', aba: '/corridas' },
  { rotulo: 'Pessoas', aba: '/pessoas' },
]

function abasDa(forma: FormaCobranca | undefined): ReadonlyArray<{ rotulo: string; aba: Aba }> {
  if (!forma) return ABAS_COMUNS
  return [...ABAS_COMUNS, forma === 'FATURADO' ? { rotulo: 'Faturas', aba: '/faturas' } : { rotulo: 'Carteira', aba: '/carteira' }]
}

/** Topo do painel: marca, abas (navegação com a aba atual marcada) e a empresa. */
function BarraDoPainel({
  ehAdm,
  empresas,
  empresa,
  onEmpresa,
  nomeEmpresa,
  forma,
}: {
  ehAdm: boolean
  empresas: Empresa[] | null
  empresa: string | null
  onEmpresa: (id: string) => void
  nomeEmpresa: string | null
  forma: FormaCobranca | undefined
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
            {abasDa(forma).map(({ rotulo, aba }) => (
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
  const painel = useLeituraDoPainel(ehAdm, empresa)
  const forma = formaDoPainel(painel)
  // Dinheiro: voltar à aba Painel (vindo de outra aba) relê os valores. A primeira abertura usa a leitura de cima.
  const { pathname } = useLocation()
  const caminhoAnterior = useRef(pathname)
  const recarregarPainel = painel.recarregar
  useEffect(() => {
    const voltouAoPainel = /^\/empresa\/?$/.test(pathname) && caminhoAnterior.current !== pathname
    caminhoAnterior.current = pathname
    if (voltouAoPainel) recarregarPainel()
  }, [pathname, recarregarPainel])
  const contexto: ContextoPainel = {
    ehAdm,
    empresa,
    semEmpresa,
    nomeEmpresa: (ehAdm ? listaEmpresas.dados?.find((e) => e.id === empresa)?.nome : perfil?.empresa_nome) ?? 'Empresa',
    erroEmpresas: !!listaEmpresas.erro,
    recarregarEmpresas: listaEmpresas.recarregar,
    painel,
    forma,
  }

  return (
    <div className="bg-painel-fundo pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <BarraDoPainel
        ehAdm={ehAdm}
        empresas={ehAdm ? (listaEmpresas.dados ?? []) : null}
        empresa={empresa}
        // Troca a empresa e fica na mesma aba (só muda o `?empresa=`).
        onEmpresa={(id) => setBusca({ empresa: id }, { replace: true })}
        nomeEmpresa={perfil?.empresa_nome ?? null}
        forma={forma}
      />
      <Outlet context={contexto} />
    </div>
  )
}
