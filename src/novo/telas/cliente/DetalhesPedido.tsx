// v2.2 (especificação §5.2): o que o cliente informou ao pedir, recolhido, em todas as etapas da corrida. Só mostra o
// que existe no pedido; nada aqui é editável.
import type { ReactNode } from 'react'
import type { DetalhePedido, RespostaPedido } from '../../../lib/pedidos.ts'
import { paradasDoDetalhe } from './paradasDoDetalhe.ts'

const texto = (v: string | null | undefined) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

const peso = (kg: number) => `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`

/** Pessoas e/ou carga ("2 pessoas", "Bomba d’água · 85,5 kg · 1 × 1 × 1 m"), conforme o tipo do pedido. */
function linhasDaCarga(p: DetalhePedido): Array<{ rotulo: string; valor: string }> {
  const linhas: Array<{ rotulo: string; valor: string }> = []
  const pessoas = p.carga === 'PESSOAS' || p.carga === 'AMBOS'
  const carga = p.carga === 'EQUIPAMENTO' || p.carga === 'AMBOS'
  if (pessoas && p.pessoas_qtd && p.pessoas_qtd > 0) {
    linhas.push({ rotulo: 'Pessoas', valor: p.pessoas_qtd === 1 ? '1 pessoa' : `${p.pessoas_qtd} pessoas` })
  }
  if (carga) {
    const partes = [texto(p.equipamento_desc), p.peso_kg && p.peso_kg > 0 ? peso(p.peso_kg) : null, texto(p.dimensoes)]
    const valor = partes.filter(Boolean).join(' · ')
    if (valor) linhas.push({ rotulo: 'Carga', valor })
  }
  return linhas
}

/** As linhas de "Detalhes do pedido" que existem neste pedido, na ordem da especificação. */
function linhasDoDetalhe(p: DetalhePedido): Array<{ rotulo: string; valor: ReactNode }> {
  const linhas: Array<{ rotulo: string; valor: ReactNode }> = [...linhasDaCarga(p)]
  const paradas = paradasDoDetalhe(p).textos.filter((t) => t.trim() !== '')
  if (paradas.length === 1) linhas.push({ rotulo: 'Parada', valor: paradas[0] })
  else if (paradas.length > 1) {
    linhas.push({
      rotulo: 'Paradas',
      valor: (
        <ol className="space-y-0.5">
          {paradas.map((t, i) => (
            <li key={`${i}-${t}`}>{t}</li>
          ))}
        </ol>
      ),
    })
  }
  const diarias = p.diarias_estimadas ?? 0
  if (diarias > 0) linhas.push({ rotulo: 'Diárias', valor: diarias === 1 ? '1 diária' : `${diarias} diárias` })
  const outros = texto(p.outros_custos)
  if (outros) linhas.push({ rotulo: 'Outros custos', valor: outros })
  const obs = texto(p.observacoes)
  if (obs) linhas.push({ rotulo: 'Observações', valor: obs })
  const centro = texto(p.centro_custo)
  if (centro) linhas.push({ rotulo: 'Centro de custo', valor: centro })
  const contato = [texto(p.contato_nome), texto(p.contato_telefone)].filter(Boolean).join(' · ')
  if (contato) linhas.push({ rotulo: 'Contato', valor: contato })
  return linhas
}

/**
 * "Detalhes do pedido", recolhido (`<details>`: abre e fecha pelo teclado e o leitor de tela anuncia o estado). `antes`
 * entra no topo do conteúdo (o Acompanhar põe ali o trilho, que já ficava recolhido). Sem nada a mostrar, não aparece.
 */
export function DetalhesPedido({ r, antes }: { r: RespostaPedido; antes?: ReactNode }) {
  const linhas = linhasDoDetalhe(r.pedido)
  if (linhas.length === 0 && !antes) return null
  return (
    <details className="rounded-cartao border border-borda" data-testid="detalhes-pedido">
      <summary className="flex min-h-12 cursor-pointer items-center px-3 ivo-legenda font-semibold text-texto">
        Detalhes do pedido
      </summary>
      <div className="space-y-3 px-3 pb-3">
        {antes}
        {linhas.length > 0 && (
          <dl className="space-y-2">
            {linhas.map((l) => (
              <div key={l.rotulo}>
                <dt className="ivo-legenda text-texto-suave">{l.rotulo}</dt>
                <dd className="font-semibold break-words">{l.valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}
