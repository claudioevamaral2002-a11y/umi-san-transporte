import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { contatoIvo, linkContato } from '../../lib/ajuda.ts'
import { useConsulta } from '../../lib/consulta.ts'

/** v2.2: contato da IVO (Configurações → "Contato da IVO"), lido uma vez e guardado enquanto o app está aberto. */
export function useContatoIvo() {
  return useConsulta('contato-ivo', contatoIvo, { cache: true })
}

/** O contato com link (telefone ou WhatsApp) quando dá; senão, o texto como foi cadastrado. */
export function TextoContato({ contato }: { contato: string }) {
  const link = linkContato(contato)
  return link ? (
    <a
      href={link}
      {...(link.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="font-semibold break-words text-link underline underline-offset-2"
    >
      {contato}
    </a>
  ) : (
    <span className="font-semibold break-words">{contato}</span>
  )
}

/**
 * v2.2 (§5.5): na Carteira da empresa no Crédito, "Para recarregar, fale com a IVO: contato". Sem contato cadastrado,
 * "Contato ainda não cadastrado". Se a leitura falhar, não mostra nada (o resto da Carteira segue).
 */
export function ContatoRecarga() {
  const { dados, erro } = useContatoIvo()
  if (dados === undefined) return erro ? null : <Skeleton className="h-6 w-64" />
  return (
    <p className="ivo-corpo" data-testid="contato-recarga">
      Para recarregar, fale com a IVO:{' '}
      {dados ? <TextoContato contato={dados} /> : <span className="text-texto-suave">Contato ainda não cadastrado</span>}
    </p>
  )
}
