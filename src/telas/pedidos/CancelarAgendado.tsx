import { useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { faixaAplicada, type Faixa } from '../../lib/contratos.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { Intencao, dinheiro, semResposta, type Simulacao } from '../../lib/saldo.ts'
import { numeroPedido } from '../../lib/tempo.ts'
import { Processando } from './Aprovar.tsx'

/** Resultado confirmado pelo servidor (`api.cancelar_agendado`). */
export interface Cancelamento {
  liberado_cent: number
  multa_cent: number
}

/** "Cancelando agora: multa de R$ 355,00 (50% — de 6 h a menos de 24 h antes)" / "…: sem multa (24 h ou mais antes)". */
export function fraseMulta(s: Pick<Simulacao, 'cobra_multa' | 'multa_cent' | 'faixa'>, faixas: readonly Faixa[] | undefined): string {
  if (!s.cobra_multa) return 'Cancelando agora: sem custo para o cliente.'
  const f = s.faixa ? faixaAplicada(faixas, s.faixa) : null
  if (s.multa_cent > 0) {
    return `Cancelando agora: multa de ${formatarCentavos(s.multa_cent)}${f ? ` (${f.percentual} — ${f.quando})` : ''}`
  }
  return `Cancelando agora: sem multa${f ? ` (${f.quando})` : ''}`
}

function ConteudoCancelar({
  atividade,
  faixas,
  aoCancelado,
  aoJaCancelado,
  aoMudou,
  aoFechar,
}: {
  atividade: string
  faixas: readonly Faixa[] | undefined
  aoCancelado: (c: Cancelamento) => void
  aoJaCancelado: () => void
  aoMudou: () => void
  aoFechar: () => void
}) {
  const simulacao = useConsulta(`simular-${atividade}`, () => dinheiro.simularCancelamento(atividade))
  const [motivo, setMotivo] = useState('')
  const [erroMotivo, setErroMotivo] = useState<string | null>(null)
  const [estado, setEstado] = useState<{ fase: 'previa' | 'processando' } | { fase: 'erro'; codigo: string }>({ fase: 'previa' })
  const [intencao] = useState(() => new Intencao())

  const s = simulacao.dados
  if (s === undefined) {
    if (simulacao.erro) {
      return (
        <div className="space-y-3">
          <Mensagem tipo="erro">Não foi possível calcular o cancelamento agora. Verifique a internet e tente de novo.</Mensagem>
          <Botao className="w-full" onClick={simulacao.recarregar}>
            Tentar de novo
          </Botao>
        </div>
      )
    }
    return <Skeleton className="h-40" />
  }

  async function confirmar(sim: Simulacao) {
    const m = motivo.trim()
    if ((sim.motivo_obrigatorio && (m.length < 3 || m.length > 500)) || m.length > 500) {
      setErroMotivo('Informe o motivo (de 3 a 500 caracteres).')
      return
    }
    setErroMotivo(null)
    setEstado({ fase: 'processando' })
    const r = await dinheiro.cancelarAgendado(atividade, m || null, intencao.chave(atividade))
    if (r.ok) {
      intencao.encerrar()
      aoCancelado({ liberado_cent: Number(r.liberado_cent), multa_cent: Number(r.multa_cent) })
      return
    }
    if (r.codigo === 'JA_PROCESSADO') {
      aoJaCancelado()
      return
    }
    if (r.codigo === 'STATUS_INVALIDO') aoMudou()
    setEstado({ fase: 'erro', codigo: r.codigo ?? 'ERRO_INESPERADO' })
  }

  if (estado.fase === 'processando') return <Processando texto="Confirmando o cancelamento com o servidor…" />

  const comMulta = s.cobra_multa && s.multa_cent > 0
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void confirmar(s)
      }}
    >
      <div
        className={`flex items-start gap-2.5 rounded-xl border-[1.5px] p-3 ${comMulta ? 'border-[var(--cor-laranja)]' : 'border-borda'}`}
        data-testid="previa-multa"
      >
        <Icone nome={comMulta ? 'alerta' : 'check'} tamanho={20} className={comMulta ? 'text-alerta-texto' : 'text-[var(--status-concluida)]'} />
        <div className="space-y-1">
          <p className="font-bold">{fraseMulta(s, faixas)}</p>
          <p className="ivo-legenda text-texto-suave">
            A reserva de {formatarCentavos(s.liberado_cent)} volta para o saldo disponível da empresa
            {comMulta ? ' e a multa é lançada no extrato.' : '.'}
          </p>
        </div>
      </div>
      <AreaTexto
        rotulo={s.motivo_obrigatorio ? 'Motivo' : 'Motivo (opcional)'}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={500}
        required={s.motivo_obrigatorio}
        erro={erroMotivo ?? undefined}
        ajuda={s.motivo_obrigatorio ? 'O cliente vê o motivo no histórico do pedido.' : undefined}
      />
      {estado.fase === 'erro' &&
        (semResposta({ ok: false, codigo: estado.codigo }) ? (
          <Mensagem tipo="erro">
            Não conseguimos confirmar com o servidor. Verifique a internet e toque de novo em “Confirmar cancelamento” — o
            cancelamento não será feito duas vezes.
          </Mensagem>
        ) : (
          <Mensagem tipo="erro">{mensagemDoCodigo(estado.codigo)}</Mensagem>
        ))}
      {estado.fase === 'erro' && estado.codigo === 'STATUS_INVALIDO' ? (
        <Botao className="w-full" onClick={aoFechar}>
          Ver pedido atualizado
        </Botao>
      ) : (
        <Botao type="submit" variante="perigo" className="w-full">
          Confirmar cancelamento
        </Botao>
      )}
    </form>
  )
}

/** Cancelar AGENDADA (especificação 4.6): mostra a multa calculada no servidor ANTES de confirmar. */
export function FolhaCancelarAgendado({
  aberta,
  atividade,
  numero,
  faixas,
  aoFechar,
  aoCancelado,
  aoJaCancelado,
  aoMudou,
}: {
  aberta: boolean
  atividade: string
  numero: number
  faixas: readonly Faixa[] | undefined
  aoFechar: () => void
  aoCancelado: (c: Cancelamento) => void
  aoJaCancelado: () => void
  aoMudou: () => void
}) {
  return (
    <Folha aberta={aberta} titulo="Cancelar agendamento" sobretitulo={`Pedido ${numeroPedido(numero)}`} onFechar={aoFechar}>
      <ConteudoCancelar
        atividade={atividade}
        faixas={faixas}
        aoCancelado={aoCancelado}
        aoJaCancelado={aoJaCancelado}
        aoMudou={aoMudou}
        aoFechar={aoFechar}
      />
    </Folha>
  )
}

/** Frase do resultado (valores do servidor). */
export function avisoCancelamento(c: Cancelamento): string {
  const multa = c.multa_cent > 0 ? `Multa: ${formatarCentavos(c.multa_cent)}.` : 'Sem multa.'
  return `Agendamento cancelado. Liberado: ${formatarCentavos(c.liberado_cent)}. ${multa}`
}

