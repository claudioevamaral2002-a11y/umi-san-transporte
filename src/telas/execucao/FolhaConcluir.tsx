import { useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { execucao } from '../../lib/execucao.ts'
import { minutosDeViagem } from '../../lib/execucaoExibicao.ts'
import type { DetalhePedido } from '../../lib/pedidos.ts'
import { formatarDuracao, horaDe } from '../../lib/tempo.ts'
import { ResumoViagem } from './comum.tsx'
import { EnvioDeFotos } from './EnvioDeFotos.tsx'

function Conteudo({ pedido, aoConcluido }: { pedido: DetalhePedido; aoConcluido: (mensagem: string) => void }) {
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [subindoFotos, setSubindoFotos] = useState(false)
  const [agora] = useState(() => Date.now())
  const minutos = minutosDeViagem(pedido.saiu_em, null, agora)

  async function concluir() {
    setEnviando(true)
    setErro(null)
    const r = await execucao.concluir(pedido.id, observacao.trim() || null)
    setEnviando(false)
    if (r.ok) aoConcluido('Serviço concluído. O trajeto foi apagado e o resumo ficou no pedido.')
    else setErro(mensagemDoCodigo(r.codigo))
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void concluir()
      }}
    >
      <EnvioDeFotos id={pedido.id} jaEnviadas={pedido.fotos_qtd ?? 0} aoOcupado={setSubindoFotos} />
      <AreaTexto
        rotulo="Observação (opcional)"
        value={observacao}
        maxLength={1000}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Ex.: equipamento entregue ao Sr. Paulo no galpão 2"
      />
      <ResumoViagem
        itens={[
          { rotulo: 'Saída', valor: pedido.saiu_em ? horaDe(pedido.saiu_em) : null },
          { rotulo: 'Agora', valor: horaDe(new Date(agora)) },
          { rotulo: 'Duração', valor: minutos !== null ? formatarDuracao(Math.max(1, minutos)) : null },
        ]}
      />
      <p className="ivo-legenda text-texto-suave">
        Concluir não cobra nada: o valor já foi debitado na saída. O trajeto é apagado e fica só o resumo.
      </p>
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
      <Botao type="submit" variante="principal" className="w-full" disabled={enviando || subindoFotos}>
        {enviando ? 'Concluindo…' : subindoFotos ? 'Aguardando as fotos…' : 'Concluir serviço'}
      </Botao>
    </form>
  )
}

/** "Concluir serviço": fotos (opcionais), observação e o resumo da viagem. Não cobra (especificação §4.5). */
export function FolhaConcluir({
  aberta,
  pedido,
  aoFechar,
  aoConcluido,
}: {
  aberta: boolean
  pedido: DetalhePedido
  aoFechar: () => void
  aoConcluido: (mensagem: string) => void
}) {
  return (
    <Folha aberta={aberta} titulo="Concluir serviço" onFechar={aoFechar}>
      <Conteudo pedido={pedido} aoConcluido={aoConcluido} />
    </Folha>
  )
}
