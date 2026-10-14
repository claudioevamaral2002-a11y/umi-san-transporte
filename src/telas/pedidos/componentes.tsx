// Peças comuns das telas de pedidos, agenda e orçamento.
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { MarcaAgora } from '../../design/componentes/MarcaAgora.tsx'
import { StatusBadge, type Status } from '../../design/componentes/StatusBadge.tsx'
import type { ItemPedido, LinhaOrcamento } from '../../lib/pedidos.ts'
import { ETAPAS, etapaDoPedido, statusExibido } from '../../lib/situacao.ts'
import { formatarContagem, formatarDuracao, formatarQuando, numeroPedido } from '../../lib/tempo.ts'
import { useAgora } from '../../lib/useAgora.ts'
import { formatarPercentual } from '../../lib/valores.ts'

/** Grupo de escolha única em chips (role=radiogroup); alvo de 48 px. */
export function Escolhas<T extends string>({
  rotulo,
  opcoes,
  valor,
  aoMudar,
  tamanho = 'normal',
}: {
  rotulo: string
  opcoes: ReadonlyArray<{ valor: T; rotulo: string }>
  valor: T | null
  aoMudar: (v: T) => void
  tamanho?: 'normal' | 'largo'
}) {
  const id = useId()
  return (
    <div>
      <p id={id} className="mb-2 font-semibold">
        {rotulo}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {opcoes.map((o) => {
          const marcado = o.valor === valor
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={marcado}
              onClick={() => aoMudar(o.valor)}
              className={`min-h-12 rounded-full border-[1.5px] px-4 font-semibold transition-colors duration-150 motion-reduce:transition-none ${
                tamanho === 'largo' ? 'flex-1' : ''
              } ${marcado ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto hover:border-marinho-2'}`}
            >
              {o.rotulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Caixa de marcar em formato de chip (checkbox de verdade, rotulado). */
export function CaixaChip({ rotulo, marcado, aoMudar }: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <label
      className={`relative flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-[1.5px] px-4 font-semibold transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--cor-foco)] motion-reduce:transition-none ${
        marcado ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
      }`}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => aoMudar(e.target.checked)}
        className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
      />
      {rotulo}
    </label>
  )
}

/** Contador com − e + (alvo de 48 px). `formatar` mostra o valor; o leitor de tela ouve a mudança. */
export function Contador({
  rotulo,
  valor,
  min,
  max,
  passo = 1,
  aoMudar,
  formatar = String,
  detalhe,
  children,
}: {
  rotulo: string
  valor: number
  min: number
  max: number
  passo?: number
  aoMudar: (v: number) => void
  formatar?: (v: number) => string
  detalhe?: ReactNode
  /** Substitui o valor exibido (por exemplo, um campo de digitação). */
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-2" role="group" aria-labelledby={id}>
      <div className="min-w-0">
        <p id={id} className="font-semibold">
          {rotulo}
        </p>
        {detalhe && <div className="ivo-legenda text-texto-suave">{detalhe}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => aoMudar(Math.max(min, valor - passo))}
          disabled={valor <= min}
          aria-label={`Diminuir ${rotulo.toLowerCase()}`}
          className="flex size-12 items-center justify-center rounded-campo border-[1.5px] border-borda bg-superficie text-texto active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100"
        >
          <Icone nome="menos" />
        </button>
        {children ?? (
          <output aria-live="polite" className="min-w-14 text-center text-lg font-bold tabular-nums">
            {formatar(valor)}
          </output>
        )}
        <button
          type="button"
          onClick={() => aoMudar(Math.min(max, valor + passo))}
          disabled={valor >= max}
          aria-label={`Aumentar ${rotulo.toLowerCase()}`}
          className="flex size-12 items-center justify-center rounded-campo border-[1.5px] border-borda bg-superficie text-texto active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100"
        >
          <Icone nome="mais" />
        </button>
      </div>
    </div>
  )
}

/**
 * Contagem regressiva (atualiza a cada minuto). `anunciar` liga o aria-live (no máximo uma por tela, para não
 * tagarelar). Vencido → `vencido`.
 */
export function Contagem({
  prazo,
  prefixo,
  vencido = 'Prazo vencido',
  anunciar = false,
  className = '',
}: {
  prazo: string
  prefixo: string
  vencido?: string
  anunciar?: boolean
  className?: string
}) {
  const agora = useAgora()
  const resto = formatarContagem(prazo, agora)
  return (
    <span aria-live={anunciar ? 'polite' : undefined} className={`tabular-nums ${className}`} data-testid="contagem">
      {resto ? `${prefixo} ${resto}` : vencido}
    </span>
  )
}

/** Origem → destino com a linha da rota (anel marinho → triângulo laranja). */
export function Rota({ origem, destino, compacta = false }: { origem: string; destino: string; compacta?: boolean }) {
  return (
    <div className="flex gap-3" data-testid="rota">
      <div aria-hidden="true" className="flex w-3.5 flex-col items-center pt-1.5">
        <span className="size-3 rounded-full border-[2.5px] border-[var(--marcador-meu)]" />
        <span
          className={`w-0.5 flex-1 bg-[repeating-linear-gradient(var(--cor-texto-suave)_0_3px,transparent_3px_7px)] opacity-60 ${compacta ? 'my-0.5 min-h-3' : 'my-1 min-h-5'}`}
        />
        <MarcaAgora tamanho={14} />
      </div>
      <div className={`min-w-0 flex-1 ${compacta ? 'space-y-1' : 'space-y-2.5'}`}>
        <p className="truncate font-semibold">
          <span className="sr-only">Origem: </span>
          {origem}
        </p>
        <p className="truncate font-semibold">
          <span className="sr-only">Destino: </span>
          {destino}
        </p>
      </div>
    </div>
  )
}

/** Status sempre com ícone + texto; o badge fica numa pílula clara para valer também sobre o azul. */
export function SelosStatus({ status, prazoVencido }: { status: Status; prazoVencido: boolean }) {
  return (
    <span className="inline-flex rounded-full bg-superficie">
      <StatusBadge status={statusExibido(status, prazoVencido)} />
    </span>
  )
}

/** Cartão da lista de pedidos (vai para o detalhe). */
export function CartaoPedido({ item, mostrarEmpresa = false }: { item: ItemPedido; mostrarEmpresa?: boolean }) {
  const aberto = !item.prazo_vencido
  const prazo =
    aberto && item.status === 'SOLICITADA' && item.prazo_orcar_ate
      ? { prazo: item.prazo_orcar_ate, prefixo: 'Orçamento em até' }
      : aberto && item.status === 'ORCADA' && item.valido_ate
        ? { prazo: item.valido_ate, prefixo: 'Aprovar em até' }
        : null
  return (
    <Link
      to={`/pedidos/${item.id}`}
      viewTransition
      className="block rounded-cartao bg-superficie p-4 shadow-[var(--sombra)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold tabular-nums">
            Pedido {numeroPedido(item.numero)}
            {mostrarEmpresa && item.empresa_nome ? `, ${item.empresa_nome}` : ''}
          </p>
          <p className="mt-0.5 ivo-legenda text-texto-suave tabular-nums">
            {formatarQuando(item.inicio)}, {formatarDuracao(item.duracao_min)}
          </p>
        </div>
        <StatusBadge status={statusExibido(item.status, item.prazo_vencido)} />
      </div>
      <div className="mt-3">
        <Rota origem={item.origem} destino={item.destino} compacta />
      </div>
      {(prazo || item.total_cent !== null) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-borda pt-3">
          {prazo ? (
            <span className="flex items-center gap-1.5 ivo-legenda font-semibold text-alerta-texto">
              <Icone nome="relogio" tamanho={16} />
              <Contagem prazo={prazo.prazo} prefixo={prazo.prefixo} />
            </span>
          ) : (
            <span />
          )}
          {item.total_cent !== null && <Dinheiro centavos={item.total_cent} className="font-bold" />}
        </div>
      )}
    </Link>
  )
}

const quantidade = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 6 })

/** Memorial de cálculo: cada linha como o servidor calculou e o total (soma das linhas, também do servidor). */
export function Memorial({ linhas, total }: { linhas: LinhaOrcamento[]; total: number }) {
  return (
    <div>
      <p className="font-semibold">Memorial de cálculo</p>
      <ul className="mt-2" data-testid="memorial">
        {linhas.map((l, i) => (
          <li key={`${l.codigo}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-borda py-2.5">
            <span className="min-w-0">
              <span className={`block ${l.codigo === 'OUTROS' ? 'font-bold text-alerta-texto' : 'font-semibold'}`}>
                {l.descricao}
              </span>
              <span className="block ivo-legenda text-texto-suave tabular-nums">
                {l.percentual_bp !== null && l.base_cent !== null ? (
                  <>
                    {formatarPercentual(l.percentual_bp)} de <Dinheiro centavos={l.base_cent} />
                  </>
                ) : l.quantidade !== null && l.unitario_cent !== null ? (
                  <>
                    {quantidade(l.quantidade)} × <Dinheiro centavos={l.unitario_cent} />
                  </>
                ) : null}
              </span>
            </span>
            <Dinheiro centavos={l.valor_cent} className="shrink-0 font-bold" />
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-4 pt-3">
        <span className="font-bold">Total</span>
        <Dinheiro centavos={total} className="text-xl font-extrabold" />
      </div>
    </div>
  )
}

/**
 * Linha do tempo estilo rastreio: etapas concluídas em azul, a atual destacada (com o carrinho) e, se o pedido
 * terminou sem serviço, o status final em vermelho. Sem animação contínua (movimento reduzido respeitado).
 */
export function LinhaDoTempo({
  status,
  historico,
}: {
  status: Status
  historico: Array<{ de: Status | null; para: Status }>
}) {
  const { atual, encerrado } = etapaDoPedido(status, historico)
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Andamento do pedido" data-testid="linha-do-tempo">
      {ETAPAS.map((nome, i) => {
        const feita = i < atual || (i === atual && status === 'CONCLUIDA')
        const ehAtual = i === atual
        return (
          <li key={nome} className="flex flex-col items-center gap-1.5 text-center" aria-current={ehAtual ? 'step' : undefined}>
            <div className="relative flex w-full items-center">
              <span
                aria-hidden="true"
                className={`h-1 flex-1 rounded-full ${i === 0 ? 'opacity-0' : i <= atual ? 'bg-marinho-2' : 'bg-borda'}`}
              />
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 motion-reduce:transition-none ${
                  ehAtual && encerrado
                    ? 'border-[var(--status-cancelada)] bg-[var(--status-cancelada)] text-white'
                    : ehAtual
                      ? 'border-transparent bg-transparent'
                      : feita
                        ? 'border-marinho-2 bg-marinho-2 text-white'
                        : 'border-borda bg-superficie text-texto-suave'
                }`}
              >
                {ehAtual && encerrado ? (
                  <Icone nome="fechar" tamanho={16} />
                ) : ehAtual ? (
                  <MarcaAgora tamanho={20} />
                ) : feita ? (
                  <Icone nome="check" tamanho={16} />
                ) : (
                  <span className="size-1.5 rounded-full bg-borda" />
                )}
              </span>
              <span
                aria-hidden="true"
                className={`h-1 flex-1 rounded-full ${i === ETAPAS.length - 1 ? 'opacity-0' : i < atual ? 'bg-marinho-2' : 'bg-borda'}`}
              />
            </div>
            <span className={`text-xs leading-tight ${ehAtual ? 'font-bold text-texto' : 'font-medium text-texto-suave'}`}>
              {nome}
              {ehAtual && <span className="sr-only"> (etapa atual{encerrado ? ', encerrado' : ''})</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Barra de ações presa ao pé da tela (uso com uma mão). */
export function BarraInferior({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-borda bg-superficie/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      {children}
    </div>
  )
}
