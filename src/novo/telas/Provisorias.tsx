import { useState } from 'react'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { useSessao } from '../../lib/sessao.tsx'
import { FolhaMapa } from '../componentes/FolhaMapa.tsx'
import { useTituloNaTela } from '../../design/componentes/Tela.tsx'
import { PendenciasFaturas } from './adm/Faturas.tsx'

function saudacao(agora: Date): string {
  const h = agora.getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Início provisório sobre o mapa: a tela de cada perfil chega nas Tarefas 8 (cliente) e 10 (motorista). */
export function InicioProvisorio() {
  const { perfil } = useSessao()
  const [ola] = useState(() => saudacao(new Date()))
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0] ?? ''
  return (
    <FolhaMapa>
      <h1 className="ivo-h2">{primeiroNome ? `${ola}, ${primeiroNome}` : ola}</h1>
      <p className="mt-1 ivo-corpo text-texto-suave">As telas novas chegam em breve. O menu ☰ leva às de hoje.</p>
      {/* v2.1: pendências das faturas do Master ("Quinzena fechada: … pronta para faturar", "Faturas vencidas"). */}
      {perfil?.papel === 'ADM' && (
        <div className="mt-4">
          <PendenciasFaturas />
        </div>
      )}
    </FolhaMapa>
  )
}

/** Tela de página ainda por fazer (Locais salvos, Painel da empresa, Ajuda), com o título do menu. */
export function EmBreve({ titulo }: { titulo: string }) {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  return (
    <main className="mx-auto max-w-md p-4">
      <Cartao className="space-y-2">
        <h1 className="ivo-h2">{titulo}</h1>
        <p className="ivo-corpo text-texto-suave">Esta tela chega em breve.</p>
      </Cartao>
    </main>
  )
}
