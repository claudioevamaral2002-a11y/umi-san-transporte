import { useState } from 'react'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import type { FormPedido } from '../../lib/novoPedido.ts'
import { pedidos, type LinhaOrcamento } from '../../lib/pedidos.ts'

type Calculo = { linhas: LinhaOrcamento[]; total_cent: number }

const quantidade = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

function Linhas({ linhas }: { linhas: LinhaOrcamento[] }) {
  return (
    <ul className="divide-y divide-borda" data-testid="previa-linhas">
      {linhas.map((l, i) => (
        <li key={`${l.codigo}-${i}`} className="flex items-baseline justify-between gap-4 py-2.5">
          <span className="min-w-0">
            <span className="block font-semibold">{l.descricao}</span>
            {l.quantidade !== null && l.unitario_cent !== null && (
              <span className="block ivo-legenda text-texto-suave tabular-nums">
                {quantidade(l.quantidade)} × <Dinheiro centavos={l.unitario_cent} />
              </span>
            )}
          </span>
          <Dinheiro centavos={l.valor_cent} className="shrink-0 font-bold" />
        </li>
      ))}
    </ul>
  )
}

/**
 * Fase 3A: prévia do orçamento em "Confira o pedido" (cliente N1 e N2), pela tabela do contrato vigente da empresa,
 * com os km estimados pela rota. Só estimativa: o valor final vem do orçamento do motorista. Valor de dinheiro: sempre
 * do servidor (sem memória das consultas). Sem km, no veículo do cliente ou com erro, o bloco não aparece.
 */
export function PreviaOrcamento({ f }: { f: FormPedido }) {
  const km = f.origemLocal && f.destinoLocal ? f.kmEstimado : null
  const ativa = km !== null && f.modalidade === 'VEICULO_PROPRIO'
  const base = { km: km ?? 0, levar: f.levar, trazer: f.trazer, modalidade: f.modalidade }
  const consulta = useConsulta(
    `previa-${km}-${f.reboque}-${f.levar}-${f.trazer}-${f.modalidade}`,
    async (): Promise<Calculo[] | null> => {
      if (!ativa) return null
      const opcoes = f.reboque === 'NAO_SEI' ? [false, true] : [f.reboque === 'SIM']
      return Promise.all(opcoes.map((usa_reboque) => pedidos.previaOrcamento({ ...base, usa_reboque })))
    },
  )
  const [abertas, setAbertas] = useState<boolean | null>(null)

  const calculos = consulta.dados
  if (!ativa || !calculos || calculos.length === 0) return null
  const duplo = calculos.length === 2
  const mostrarLinhas = abertas ?? !duplo

  return (
    <Cartao className="space-y-3" data-testid="previa-orcamento" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="ivo-h3">Prévia do orçamento</h2>
        <span className="ivo-legenda text-texto-suave">estimativa</span>
      </div>
      {duplo ? (
        <div className="grid grid-cols-2 gap-2">
          {(['Sem reboque', 'Com reboque'] as const).map((rotulo, i) => (
            <div
              key={rotulo}
              data-testid={i === 0 ? 'previa-sem-reboque' : 'previa-com-reboque'}
              className="rounded-campo border border-borda px-3 py-2.5"
            >
              <p className="ivo-legenda text-texto-suave">{rotulo}</p>
              <Dinheiro centavos={calculos[i]!.total_cent} className="text-xl font-extrabold" />
            </div>
          ))}
        </div>
      ) : (
        <Dinheiro centavos={calculos[0]!.total_cent} className="block ivo-valor" />
      )}
      {mostrarLinhas &&
        (duplo ? (
          <div className="space-y-2">
            <p className="ivo-legenda font-semibold text-texto-suave">Sem reboque</p>
            <Linhas linhas={calculos[0]!.linhas} />
            <p className="ivo-legenda font-semibold text-texto-suave">Com reboque</p>
            <Linhas linhas={calculos[1]!.linhas} />
          </div>
        ) : (
          <Linhas linhas={calculos[0]!.linhas} />
        ))}
      <button
        type="button"
        onClick={() => setAbertas(!mostrarLinhas)}
        aria-expanded={mostrarLinhas}
        className="min-h-11 font-semibold underline underline-offset-4"
      >
        {mostrarLinhas ? 'Ocultar as linhas' : 'Ver as linhas'}
      </button>
      <p className="ivo-legenda text-texto-suave">
        Estimativa pela tabela do contrato. O valor final vem no orçamento do motorista.
      </p>
    </Cartao>
  )
}
