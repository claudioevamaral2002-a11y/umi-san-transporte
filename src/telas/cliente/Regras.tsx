import type { ReactNode } from 'react'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone, type NomeIcone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { prazoPorExtenso } from '../../lib/contratos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { FaixasCancelamento } from '../contratos/CartoesContrato.tsx'

const SEM_CONTRATO = 'Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.'

function Regra({ icone, titulo, children }: { icone: NomeIcone; titulo: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-borda py-3 last:border-b-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fundo text-link">
        <Icone nome={icone} tamanho={20} />
      </span>
      <div className="min-w-0">
        <p className="font-bold">{titulo}</p>
        <p className="ivo-corpo text-texto-suave">{children}</p>
      </div>
    </li>
  )
}

/**
 * Cliente: as regras do contrato vigente da própria empresa, em linguagem simples.
 * Sem preços, limites, versão ou autor (o banco nem envia: `api.regras_do_servico`).
 */
export function Regras() {
  const { perfil } = useSessao()
  const { dados, erro, carregando, recarregar } = useConsulta('cliente-regras', api.regrasDoServico)

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={perfil?.empresa_nome ?? 'Sua empresa'}
        titulo="Regras do serviço"
        descricao="O que vale no contrato da sua empresa com a IVO Transportes."
      />

      {erro && dados === undefined && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && dados === undefined && (
        <div className="space-y-4" aria-busy="true" aria-label="Carregando as regras">
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
      )}

      {dados === null && (
        <EstadoVazio icone="alerta" titulo="Sem contrato vigente">
          {SEM_CONTRATO}
        </EstadoVazio>
      )}

      {dados && (
        <>
          <Cartao className="space-y-1" data-testid="regras-cancelamento">
            <h2 className="ivo-h3">Cancelamento</h2>
            <p className="ivo-corpo text-texto-suave">
              Se precisar cancelar um serviço já aprovado, a multa depende de quanto tempo antes do horário marcado você
              avisa. A multa é calculada sobre o valor aprovado.
            </p>
            <FaixasCancelamento faixas={dados.faixas_cancelamento} />
          </Cartao>

          <Cartao className="space-y-1" data-testid="regras-prazos">
            <h2 className="ivo-h3">Prazos</h2>
            <ul>
              <Regra icone="relogio" titulo={`Orçamento em até ${prazoPorExtenso(dados.prazo_orcar_horas)}`}>
                Depois que você faz o pedido, a IVO Transportes envia o orçamento dentro desse prazo.
              </Regra>
              <Regra icone="check" titulo={`Orçamento vale por ${prazoPorExtenso(dados.validade_orcamento_horas)}`}>
                Aprove dentro desse prazo. Depois disso, peça um novo orçamento.
              </Regra>
              <Regra icone="alerta" titulo={`Urgente: menos de ${prazoPorExtenso(dados.limiar_urgente_horas)}`}>
                Pedidos que começam em menos tempo que isso são tratados como urgentes.
              </Regra>
            </ul>
          </Cartao>
        </>
      )}
    </main>
  )
}
