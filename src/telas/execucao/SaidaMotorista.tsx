import { useRef, useState } from 'react'
import { CarregandoPickup } from '../../design/componentes/CarregandoPickup.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { TrilhoSair } from '../../design/componentes/TrilhoSair.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { execucao } from '../../lib/execucao.ts'
import { Intencao, semResposta } from '../../lib/saldoExibicao.ts'
import { horaDe } from '../../lib/tempo.ts'
import { useAgora } from './comum.tsx'

/**
 * Trilho "Deslize para sair" com a chamada ao servidor (reserva → débito numa transação). Sem UI otimista: a pickup
 * "parte" enquanto o servidor responde, e a tela só vira "Em andamento" depois do OK. Uma chave por intenção: se a
 * resposta se perder, deslizar de novo repete o mesmo resultado em vez de tentar outra saída.
 */
export function SaidaMotorista({
  id,
  liberadaEm,
  aoSair,
}: {
  id: string
  /** ISO: 1 h antes do início (D1). */
  liberadaEm: string | null
  aoSair: () => void
}) {
  const intencao = useRef(new Intencao())
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const agora = useAgora(15_000)
  const liberada = !liberadaEm || Date.parse(liberadaEm) <= agora

  async function sair() {
    setOcupado(true)
    setErro(null)
    const r = await execucao.registrarSaida(id, intencao.current.chave(id))
    setOcupado(false)
    if (r.ok) {
      intencao.current.encerrar()
      aoSair()
      return
    }
    if (!semResposta(r)) intencao.current.encerrar()
    setErro(r.codigo === 'STATUS_INVALIDO' ? 'Este serviço mudou de situação (saiu ou foi cancelado). Atualize a página.' : mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-2" data-testid="saida-motorista">
      {ocupado ? (
        <CarregandoPickup ativo rotulo="Registrando a saída… o valor do serviço sai do saldo da empresa agora." />
      ) : (
        <TrilhoSair desabilitado={!liberada} ocupado={ocupado} aoConfirmar={() => void sair()} />
      )}
      {!liberada && liberadaEm && (
        <p className="text-center ivo-legenda text-texto-suave">Disponível a partir de {horaDe(liberadaEm)} (1 h antes do início)</p>
      )}
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
    </div>
  )
}
