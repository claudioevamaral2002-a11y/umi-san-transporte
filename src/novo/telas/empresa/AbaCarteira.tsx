import { Link } from 'react-router'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { useSessao } from '../../../lib/sessao.tsx'
import { ExtratoEmpresa } from '../../../telas/extrato/Extrato.tsx'
import { SaldoDaEmpresa } from '../../../telas/saldo/CartaoSaldo.tsx'
import { BOTAO_CONTORNO, CARTAO, useContextoPainel } from './componentes.tsx'

/**
 * Aba "Carteira" (/empresa/carteira): o saldo e o extrato da empresa (as mesmas peças do Extrato de hoje). O
 * Administrador vê a própria empresa; o Master, a escolhida no topo, com o atalho para recarga e ajuste.
 */
export function AbaCarteira() {
  const { perfil } = useSessao()
  const { ehAdm, empresa, semEmpresa, nomeEmpresa } = useContextoPainel()
  useTituloNaTela('oculto')
  const id = ehAdm ? empresa : (perfil?.empresa_id ?? null)

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <h1 className="sr-only">Carteira</h1>
      {semEmpresa ? (
        <p className={`${CARTAO} p-6`}>Nenhuma empresa cadastrada.</p>
      ) : !id ? (
        <Skeleton className="h-52 rounded-[20px]" />
      ) : (
        // `key` por empresa: ao trocar no topo, o saldo e o extrato recomeçam do banco.
        <div key={id} className="space-y-6">
          <div className="nao-imprimir">
            <SaldoDaEmpresa empresa={id} comoAdm={ehAdm} />
          </div>
          {ehAdm && (
            <p className="nao-imprimir">
              <Link to={`/adm/creditos/${id}`} className={BOTAO_CONTORNO}>
                Recarga e ajuste
              </Link>
            </p>
          )}
          <h2 className="nao-imprimir text-xl font-bold tracking-[-0.02em] md:text-2xl">Extrato</h2>
          <ExtratoEmpresa empresa={ehAdm ? id : null} empresaIdTopico={id} empresaNome={nomeEmpresa} adm={false} />
        </div>
      )}
    </main>
  )
}
