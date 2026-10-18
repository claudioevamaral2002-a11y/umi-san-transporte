import { useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { execucao } from '../../lib/execucao.ts'
import { opcoesDePrevisao } from '../../lib/execucaoExibicao.ts'
import { horaDe, numeroPedido } from '../../lib/tempo.ts'

function Conteudo({ id, aoSalvo }: { id: string; aoSalvo: (mensagem: string) => void }) {
  const [opcoes] = useState(() => opcoesDePrevisao(Date.now()))
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar() {
    if (!escolhido) {
      setErro('Escolha o novo horário de término.')
      return
    }
    setEnviando(true)
    setErro(null)
    const r = await execucao.informarPrevisao(id, escolhido, motivo.trim() || null)
    setEnviando(false)
    if (!r.ok) {
      setErro(mensagemDoCodigo(r.codigo))
      return
    }
    aoSalvo(
      r.conflito && typeof r.proximo_numero === 'number'
        ? `Previsão salva: ${horaDe(escolhido)}. O cliente do pedido ${numeroPedido(r.proximo_numero)} foi avisado do atraso.`
        : `Previsão salva: ${horaDe(escolhido)}.`,
    )
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void salvar()
      }}
    >
      <p className="ivo-legenda text-texto-suave">Hoje, em passos de 15 min. A agenda se ajusta e, se passar do próximo serviço, o cliente dele é avisado.</p>
      <div role="radiogroup" aria-label="Novo término" className="grid grid-cols-4 gap-2" data-testid="opcoes-previsao">
        {opcoes.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={escolhido === o}
            onClick={() => setEscolhido(o)}
            className={`h-11 rounded-campo border-[1.5px] text-[15px] font-semibold tabular-nums ${
              escolhido === o ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
            }`}
          >
            {horaDe(o)}
          </button>
        ))}
      </div>
      <AreaTexto rotulo="Motivo (opcional)" value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} />
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
      <Botao type="submit" variante="principal" className="w-full" disabled={enviando}>
        {enviando ? 'Salvando…' : escolhido ? `Salvar previsão ${horaDe(escolhido)}` : 'Salvar previsão'}
      </Botao>
    </form>
  )
}

/** "Nova previsão de término" (motorista em viagem): estende a agenda; o banco avisa o próximo cliente se colidir. */
export function FolhaPrevisao({
  aberta,
  id,
  aoFechar,
  aoSalvo,
}: {
  aberta: boolean
  id: string
  aoFechar: () => void
  aoSalvo: (mensagem: string) => void
}) {
  return (
    <Folha aberta={aberta} titulo="Nova previsão de término" onFechar={aoFechar}>
      <Conteudo id={id} aoSalvo={aoSalvo} />
    </Folha>
  )
}
