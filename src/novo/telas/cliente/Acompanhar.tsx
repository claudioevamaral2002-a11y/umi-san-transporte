import { useEffect, useRef, useState } from 'react'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import type { RespostaPedido } from '../../../lib/pedidos.ts'
import { horaDe } from '../../../lib/tempo.ts'
import { textoDoSinal } from '../../../telas/execucao/MapaAoVivo.tsx'
import type { Chegada } from '../../../lib/acompanhamento.ts'
import type { Acompanhamento } from '../../acompanhamento.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { iniciais } from '../../formatos.ts'
import { TrilhoCorrida } from './Aguardando.tsx'

/** Texto de "Compartilhar": sem link de rastreio no MVP. Só a chegada que o motorista transmitiu entra; estimativa não. */
export function textoParaCompartilhar(chegada: Chegada | null): string {
  return chegada && !chegada.estimada ? `IVO a caminho, chegada ~${horaDe(chegada.iso)}` : 'IVO a caminho'
}

/**
 * Mockup 10: o mapa fica com a tela toda (o carro, o trajeto e o destino são do `CorridaCliente`); aqui embaixo vêm a
 * chegada prevista, o motorista e o veículo, o sinal e "Compartilhar". O sinal e a chegada são regiões `aria-live`.
 */
export function Acompanhar({ r, a }: { r: RespostaPedido; a: Acompanhamento }) {
  const p = r.pedido
  const [aviso, setAviso] = useState('')
  const limpar = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (limpar.current) clearTimeout(limpar.current)
    },
    [],
  )

  async function compartilhar() {
    try {
      await navigator.clipboard.writeText(textoParaCompartilhar(a.chegada))
      setAviso('Texto copiado.')
    } catch {
      setAviso('Não foi possível copiar o texto.')
    }
    if (limpar.current) clearTimeout(limpar.current)
    limpar.current = setTimeout(() => setAviso(''), 4_000)
  }

  const perdido = a.sinal === 'perdido'
  const nome = p.motorista_nome ?? 'Motorista'
  return (
    <FolhaMapa rotulo="Acompanhando a corrida">
      <h1 className="sr-only">Acompanhando a corrida</h1>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ivo-legenda font-semibold text-texto-suave">
            {a.chegada?.estimada ? 'Chegada estimada' : 'Chegada prevista'}
          </p>
          <p
            className={`ivo-valor ${perdido ? 'text-texto-suave' : ''}`}
            data-testid="chegada-cliente"
            aria-live="polite"
            aria-atomic="true"
          >
            {a.chegada ? `${a.chegada.estimada ? 'Estimativa ' : ''}~${horaDe(a.chegada.iso)}` : '—'}
          </p>
        </div>
        {p.saiu_em && <p className="text-right ivo-legenda text-texto-suave">saiu {horaDe(p.saiu_em)}</p>}
      </div>
      <p
        className={`mt-2 flex items-start gap-2 ivo-legenda font-semibold ${perdido ? 'text-alerta-texto' : 'text-texto-suave'}`}
        aria-live="polite"
        data-testid="sinal-motorista"
      >
        <Icone nome={perdido ? 'alerta' : 'sinal'} tamanho={16} className="mt-0.5 shrink-0" />
        <span>{textoDoSinal(a.sinal, a.idadeS)}</span>
      </p>
      <div className="my-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-marinho-2 font-bold text-white"
        >
          {iniciais(nome)}
        </span>
        <div className="min-w-0">
          <p className="font-bold break-words">{nome}</p>
          {p.veiculo && (
            <p className="ivo-legenda text-texto-suave">
              {p.veiculo.modelo} {p.veiculo.cor} ·{' '}
              <span className="rounded border border-borda px-1.5 font-bold tracking-wide text-texto">{p.veiculo.placa}</span>
            </p>
          )}
        </div>
      </div>
      <Botao className="w-full" onClick={() => void compartilhar()}>
        Compartilhar
      </Botao>
      <p role="status" className="mt-1 min-h-5 ivo-legenda text-texto-suave">
        {aviso}
      </p>
      <details className="mt-1 rounded-cartao border border-borda">
        <summary className="flex min-h-12 cursor-pointer items-center px-3 ivo-legenda font-semibold text-texto">
          Detalhes do pedido
        </summary>
        <div className="px-3 pb-3">
          <TrilhoCorrida r={r} />
        </div>
      </details>
    </FolhaMapa>
  )
}
