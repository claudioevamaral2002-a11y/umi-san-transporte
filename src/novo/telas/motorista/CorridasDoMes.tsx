import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { EstadoVazio, ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { resumirPorMes } from '../../../lib/corridasDoMes.ts'
import { pedidos } from '../../../lib/pedidos.ts'

/** As 500 corridas concluídas mais recentes (o teto de `meus_pedidos`): cobre muitos meses de uso. */
const LIMITE = 500

const corridas = (n: number) => (n === 1 ? '1 corrida' : `${n} corridas`)

/**
 * "Corridas do mês" do motorista (especificação §6.7, mockup 13): quantas corridas concluídas e o total cobrado dos
 * clientes em cada mês. Não é o repasse ao motorista, que ainda não existe. Dinheiro sempre do servidor (sem cache).
 */
export function CorridasDoMes() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const { dados, erro, recarregar } = useConsulta('novo-corridas-do-mes', () => pedidos.listar(['CONCLUIDA'], LIMITE))
  const meses = dados ? resumirPorMes(dados) : undefined
  const [atual, ...anteriores] = meses ?? []

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <header className="space-y-1">
        <h1 className="ivo-h2">Corridas do mês</h1>
        <p className="ivo-legenda text-texto-suave">
          Corridas concluídas e o total cobrado dos clientes. Não é o repasse ao motorista.
        </p>
      </header>
      {meses === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando as corridas…
            </p>
            <Skeleton className="h-32" />
            <Skeleton className="h-16" />
          </div>
        )
      ) : !atual ? (
        <EstadoVazio icone="grafico" titulo="Nenhuma corrida concluída ainda">
          Quando você concluir uma corrida, ela aparece aqui, somada ao mês dela.
        </EstadoVazio>
      ) : (
        <>
          <Cartao className="space-y-1" data-testid="mes-atual">
            <p className="ivo-sobretitulo text-texto-suave">{atual.rotulo}</p>
            <p className="ivo-valor">
              <Dinheiro centavos={atual.total_cent} />
            </p>
            <p className="ivo-corpo font-semibold">{corridas(atual.quantidade)}</p>
          </Cartao>
          {anteriores.length > 0 && (
            <section aria-labelledby="meses-anteriores" className="space-y-2">
              <h2 id="meses-anteriores" className="ivo-h3">
                Meses anteriores
              </h2>
              <ul className="divide-y divide-borda rounded-cartao bg-superficie shadow-[var(--sombra)]">
                {anteriores.map((m) => (
                  <li key={m.mes} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                    <span>
                      <span className="block font-semibold first-letter:uppercase">{m.rotulo}</span>
                      <span className="ivo-legenda text-texto-suave">{corridas(m.quantidade)}</span>
                    </span>
                    <Dinheiro centavos={m.total_cent} className="font-bold" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
