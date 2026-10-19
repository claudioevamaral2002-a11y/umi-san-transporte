import { Botao } from '../../design/componentes/Botao.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import type { EstadoGps } from '../../lib/viagem.ts'

/** Estado do GPS da viagem: compartilhando, procurando o sinal, bloqueado ou indisponível. */
export function SeloGps({ estado }: { estado: EstadoGps }) {
  if (estado === 'negado' || estado === 'indisponivel') {
    return (
      <Mensagem tipo="erro">
        {estado === 'negado'
          ? 'A localização está bloqueada para o app. Libere nas configurações do navegador para o cliente acompanhar a viagem.'
          : 'Não foi possível usar o GPS agora. A viagem segue normalmente; o cliente vê "localização indisponível".'}
      </Mensagem>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-selecao-suave px-3 py-1.5 ivo-legenda font-bold" data-testid="selo-localizacao" data-estado={estado}>
      <span
        aria-hidden="true"
        className={`size-2.5 rounded-full ${estado === 'ativo' ? 'bg-[var(--status-concluida)] motion-safe:animate-pulse' : 'bg-texto-suave'}`}
      />
      {estado === 'ativo' ? 'Compartilhando sua localização' : 'Procurando o sinal do GPS…'}
    </span>
  )
}

/** Antes da primeira viagem: o que é compartilhado, com quem e até quando (LGPD, §5 da fase 3B). */
export function AvisoLocalizacao({ aoAceitar }: { aoAceitar: () => void }) {
  return (
    <div className="space-y-3" data-testid="aviso-localizacao">
      <h2 className="ivo-h3">Compartilhar sua localização</h2>
      <p className="ivo-corpo text-texto-suave">
        Enquanto esta viagem estiver em andamento, quem pediu o serviço vê no mapa onde você está e a hora prevista de
        chegada. Só durante a viagem e só com o app aberto. Ao concluir, o trajeto é apagado e fica só o resumo.
      </p>
      <Botao variante="principal" className="w-full" onClick={aoAceitar}>
        Começar a compartilhar
      </Botao>
    </div>
  )
}
