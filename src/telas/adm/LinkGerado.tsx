import { useRef, useState } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { mensagemDoLink, urlWhatsApp } from '../../lib/whatsapp.ts'

/** Link de convite/recuperação: copiar ou abrir o WhatsApp com o texto pronto (nada é enviado sozinho). */
export function LinkGerado({ nome, link, tipo }: { nome: string; link: string; tipo: 'convite' | 'recuperacao' }) {
  const [copiado, setCopiado] = useState<'sim' | 'falhou' | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado('sim')
    } catch {
      // Sem permissão de área de transferência: seleciona o texto para a pessoa copiar.
      campo.current?.select()
      setCopiado('falhou')
    }
  }

  return (
    <div className="space-y-3" data-testid="link-gerado">
      <div className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-[var(--cor-laranja)] bg-[rgb(255_106_0/0.06)] px-3.5 py-3">
        <Icone nome="alerta" tamanho={20} className="mt-0.5 text-alerta-texto" />
        <p className="text-[0.9375rem] font-semibold">Link válido por 24 h, uso único. Envie só para {nome || 'a pessoa'}.</p>
      </div>
      <label className="block">
        <span className="mb-1.5 block ivo-legenda font-semibold">Link</span>
        <input
          ref={campo}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-12 w-full rounded-xl border border-borda bg-fundo px-3.5 font-mono text-sm text-texto"
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Botao className="flex items-center justify-center gap-2" onClick={() => void copiar()}>
          <Icone nome={copiado === 'sim' ? 'check' : 'copiar'} tamanho={20} />
          {copiado === 'sim' ? 'Copiado' : 'Copiar'}
        </Botao>
        <a
          href={urlWhatsApp(mensagemDoLink(nome, link, tipo))}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-cartao bg-marinho px-5 ivo-botao text-papel"
        >
          <Icone nome="conversa" tamanho={20} />
          Enviar no WhatsApp
        </a>
      </div>
      <p aria-live="polite" className="ivo-legenda text-texto-suave">
        {copiado === 'sim' && 'Link copiado.'}
        {copiado === 'falhou' && 'Não foi possível copiar automaticamente. O link está selecionado: copie manualmente.'}
      </p>
    </div>
  )
}
