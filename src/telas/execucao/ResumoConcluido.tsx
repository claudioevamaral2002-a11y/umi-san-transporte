import { useEffect, useState } from 'react'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { execucao, type FotoDoPedido } from '../../lib/execucao.ts'
import { formatarKm, minutosDeViagem } from '../../lib/execucaoExibicao.ts'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import { formatarDuracao, horaDe } from '../../lib/tempo.ts'
import { ResumoViagem } from './comum.tsx'
import { EnvioDeFotos } from './EnvioDeFotos.tsx'

/** Foto por URL assinada curta (5 min), pedida ao abrir. */
export function Foto({ foto }: { foto: FotoDoPedido }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void execucao.urlDaFoto(foto.caminho).then((u) => {
      if (vivo) setUrl(u)
    })
    return () => {
      vivo = false
    }
  }, [foto.caminho])
  return (
    <li className="aspect-square overflow-hidden rounded-campo bg-fundo">
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt="Foto do serviço" className="size-full object-cover" loading="lazy" />
        </a>
      )}
    </li>
  )
}

/** Serviço concluído: saída, chegada, duração, km rodados (GPS, aproximado), fotos e a observação do motorista. */
export function ResumoConcluido({ pedido, podeEnviarFotos }: { pedido: DetalhePedido; podeEnviarFotos: boolean }) {
  const fotos = useConsulta(`fotos-${pedido.id}-${pedido.fotos_qtd ?? 0}`, () => execucao.fotos(pedido.id))
  // Concluído: a duração vai da saída à conclusão (o "agora" não entra na conta).
  const minutos = pedido.concluiu_em ? minutosDeViagem(pedido.saiu_em, pedido.concluiu_em, 0) : null
  const lista = fotos.dados ?? []
  return (
    <Cartao className="space-y-4" data-testid="resumo-concluido">
      <h2 className="ivo-h3">Resumo da viagem</h2>
      <ResumoViagem
        itens={[
          { rotulo: 'Saída', valor: pedido.saiu_em ? horaDe(pedido.saiu_em) : null },
          { rotulo: 'Chegada', valor: pedido.concluiu_em ? horaDe(pedido.concluiu_em) : null },
          { rotulo: 'Duração', valor: minutos !== null ? formatarDuracao(Math.max(1, minutos)) : null },
          { rotulo: 'Km rodados', valor: formatarKm(pedido.km_rodados) },
        ]}
      />
      {pedido.km_rodados !== null && pedido.km_rodados !== undefined && (
        <p className="ivo-legenda text-texto-suave">Km pelo GPS do motorista, aproximado. O valor cobrado é o do orçamento aprovado.</p>
      )}
      {lista.length > 0 && (
        <section aria-label="Fotos do serviço" className="space-y-2">
          <h3 className="font-semibold">Fotos</h3>
          <ul className="grid grid-cols-4 gap-2" data-testid="fotos-concluido">
            {lista.map((f) => (
              <Foto key={f.id} foto={f} />
            ))}
          </ul>
        </section>
      )}
      {pedido.observacao_conclusao && (
        <p className="ivo-corpo break-words whitespace-pre-line" data-testid="observacao-conclusao">
          “{pedido.observacao_conclusao}”
        </p>
      )}
      {podeEnviarFotos && (
        <div className="border-t border-borda pt-4">
          <EnvioDeFotos id={pedido.id} jaEnviadas={lista.length} aoEnviada={fotos.recarregar} />
        </div>
      )}
    </Cartao>
  )
}
