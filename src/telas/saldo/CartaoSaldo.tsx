import { Link } from 'react-router'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { ValorAnimado } from '../../design/componentes/ValorAnimado.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { dinheiro, fracaoReservada, type Saldo } from '../../lib/saldo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoSaldo } from '../../lib/topicos.ts'

/**
 * Saldo da empresa, relido do servidor a cada evento `saldo` do tópico `saldo:<id>` (o evento não é dado).
 * Cliente: `empresa` = a própria (o banco força); ADM: a empresa escolhida.
 */
export function useSaldo(empresa: string | null, comoAdm = false) {
  const consulta = useConsulta(`saldo-${empresa ?? 'propria'}`, () => dinheiro.saldo(comoAdm ? empresa : null))
  useTempoReal(topicoSaldo(empresa), consulta.recarregar, 'saldo')
  return consulta
}

/** Barra disponível/reservado (decorativa: os valores estão escritos ao lado). */
function Barra({ saldo }: { saldo: Saldo }) {
  const reservado = fracaoReservada(saldo)
  return (
    <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-white/15" data-testid="saldo-barra">
      <span
        className="h-full bg-bloco-texto transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${(1 - reservado) * 100}%` }}
      />
      <span
        className="h-full bg-bloco-reservado transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${reservado * 100}%` }}
      />
    </div>
  )
}

export function CartaoSaldo({
  saldo,
  titulo = 'Saldo da empresa',
  linkExtrato,
}: {
  saldo: Saldo
  titulo?: string
  /** Mostra "Ver extrato" apontando para cá. */
  linkExtrato?: string
}) {
  const negativo = saldo.disponivel_cent < 0
  return (
    <section
      className="space-y-4 rounded-folha bg-bloco p-[18px] text-bloco-texto sobre-marinho"
      data-testid="cartao-saldo"
      aria-label={titulo}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ivo-legenda font-semibold text-bloco-suave">Disponível para novos pedidos</p>
          <ValorAnimado centavos={saldo.disponivel_cent} className="block ivo-valor" data-testid="saldo-disponivel" />
        </div>
        {saldo.abaixo_alerta && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--cor-laranja)] px-2.5 py-1 text-xs font-extrabold text-marinho">
            <Icone nome="alerta" tamanho={14} />
            Saldo baixo
          </span>
        )}
      </div>

      <div className="space-y-2">
        <Barra saldo={saldo} />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 ivo-legenda">
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-bloco-texto" />
            <dt className="text-bloco-suave">Disponível</dt>
            <dd className="ml-auto font-bold">
              <Dinheiro centavos={saldo.disponivel_cent} />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-bloco-reservado" />
            <dt className="text-bloco-suave">Reservado</dt>
            <dd className="ml-auto font-bold" data-testid="saldo-reservado">
              <Dinheiro centavos={saldo.reservado_cent} />
            </dd>
          </div>
          <div className="col-span-2 flex items-center gap-1.5 border-t border-white/15 pt-2">
            <dt className="text-bloco-suave">Total contábil</dt>
            <dd className="ml-auto font-bold" data-testid="saldo-contabil">
              <Dinheiro centavos={saldo.saldo_contabil_cent} />
            </dd>
          </div>
        </dl>
      </div>

      <p className="flex items-center gap-1.5 ivo-legenda text-bloco-suave" data-testid="saldo-limite">
        <Icone nome="escudo" tamanho={16} />
        Limite de crédito {formatarCentavos(saldo.limite_cent)}
        {negativo && <>, usando {formatarCentavos(-saldo.disponivel_cent)}</>}
      </p>

      {saldo.abaixo_alerta && (
        <p className="ivo-legenda font-semibold text-bloco-alerta" data-testid="saldo-alerta">
          Abaixo do alerta de {formatarCentavos(saldo.alerta_cent)}. Fale com a IVO Transportes para recarregar.
        </p>
      )}

      {linkExtrato && (
        <Link
          to={linkExtrato}
          viewTransition
          className="inline-flex min-h-11 items-center font-semibold text-bloco-texto underline underline-offset-4"
        >
          Ver extrato
        </Link>
      )}
    </section>
  )
}

/** Cartão de saldo com carregamento (skeleton) e erro discreto. */
export function SaldoDaEmpresa({ empresa, comoAdm = false, linkExtrato }: { empresa: string | null; comoAdm?: boolean; linkExtrato?: string }) {
  const { dados, erro, recarregar } = useSaldo(empresa, comoAdm)
  if (dados === undefined) {
    if (erro) {
      return (
        <Cartao className="space-y-2" role="alert">
          <p className="font-bold">Não foi possível carregar o saldo.</p>
          <button type="button" onClick={recarregar} className="min-h-12 font-semibold text-link underline">
            Tentar de novo
          </button>
        </Cartao>
      )
    }
    return <Skeleton className="h-52" />
  }
  return <CartaoSaldo saldo={dados} linkExtrato={linkExtrato} />
}
