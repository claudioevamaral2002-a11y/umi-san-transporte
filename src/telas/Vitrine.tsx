import { useState } from 'react'
import { Link } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { Dinheiro } from '../design/componentes/Dinheiro.tsx'
import { Skeleton } from '../design/componentes/Skeleton.tsx'
import { StatusBadge, type Status } from '../design/componentes/StatusBadge.tsx'

const STATUS: Status[] = ['SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA']

function alternarContraste() {
  const raiz = document.documentElement
  if (raiz.dataset.contraste === 'alto') delete raiz.dataset.contraste
  else raiz.dataset.contraste = 'alto'
}

export function Vitrine() {
  const [carregando, setCarregando] = useState(false)
  function simular(ms: number) {
    setCarregando(true)
    setTimeout(() => setCarregando(false), ms)
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-2xl font-bold">Design system</h1>

      <Cartao className="space-y-2">
        <h2 className="font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS.map((s) => <StatusBadge key={s} status={s} />)}
        </div>
      </Cartao>

      <Cartao className="space-y-1">
        <h2 className="font-semibold">Valores</h2>
        <p className="text-2xl font-bold"><Dinheiro centavos={123456} /></p>
        <p><Dinheiro centavos={-5000} className="text-[var(--status-cancelada)]" /></p>
      </Cartao>

      <Cartao className="space-y-3">
        <h2 className="font-semibold">Botões</h2>
        <Botao variante="principal" className="w-full">Ação principal</Botao>
        <Botao className="w-full" onClick={alternarContraste}>Alternar alto contraste</Botao>
        <Botao variante="perigo" className="w-full">Cancelar</Botao>
      </Cartao>

      <Cartao className="space-y-3">
        <h2 className="font-semibold">Carregamento</h2>
        <div className="flex gap-2">
          <Botao onClick={() => simular(200)}>Simular 200 ms</Botao>
          <Botao onClick={() => simular(1500)}>Simular 1500 ms</Botao>
        </div>
        <CarregandoPickup ativo={carregando} />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </Cartao>

      <Link to="/" viewTransition className="block font-semibold underline underline-offset-4">Voltar</Link>
    </main>
  )
}
