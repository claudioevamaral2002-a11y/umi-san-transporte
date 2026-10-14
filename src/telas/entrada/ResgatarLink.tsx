import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { normalizarCodigo } from '../../../supabase/functions/_compartilhado/links.ts'
import { Botao } from '../../design/componentes/Botao.tsx'
import { LogoIvo } from '../../design/componentes/LogoIvo.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { rotaDoEstado } from '../../lib/estadoSessao.ts'
import { chamarFuncaoPublica } from '../../lib/funcoesPublicas.ts'
import { useSessao } from '../../lib/sessao.tsx'

const AVISO_LINK_INVALIDO = 'Este link expirou ou já foi usado. Peça um novo ao administrador.'

/** Códigos que significam "este link não serve mais": sem botão de tentar de novo. */
const DEFINITIVOS = new Set(['NAO_ENCONTRADO', 'EXPIRADO', 'CAMPOS_INVALIDOS'])

/**
 * `/c/<código>`: link curto de convite/recuperação. Abrir a página NÃO gasta o link (pré-visualização do
 * WhatsApp, pré-carregamento do navegador e varredores só fazem GET). Só o toque em "Continuar" chama o
 * resgate (POST), que valida o token no servidor e devolve a sessão.
 */
export function ResgatarLink() {
  const { codigo: bruto } = useParams()
  const codigo = normalizarCodigo(bruto)
  const { entrarPorLink } = useSessao()
  const navegar = useNavigate()
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<{ texto: string; definitivo: boolean } | null>(
    codigo ? null : { texto: AVISO_LINK_INVALIDO, definitivo: true },
  )

  async function continuar() {
    if (!codigo || enviando) return
    setEnviando(true)
    setErro(null)
    const r = await chamarFuncaoPublica('resgatar-link', { codigo })
    if (r.ok && typeof r.access_token === 'string' && typeof r.refresh_token === 'string') {
      const estado = await entrarPorLink({ access_token: r.access_token, refresh_token: r.refresh_token })
      if (estado) {
        // `replace`: o código sai da barra de endereço e do histórico.
        navegar(rotaDoEstado(estado) ?? '/definir-senha', { replace: true })
        return
      }
      // O link já foi gasto no resgate: não adianta tentar de novo.
      setErro({ texto: AVISO_LINK_INVALIDO, definitivo: true })
      setEnviando(false)
      return
    }
    const definitivo = !r.ok && DEFINITIVOS.has(r.codigo ?? '')
    setErro({ texto: definitivo ? AVISO_LINK_INVALIDO : mensagemDoCodigo(r.codigo), definitivo })
    setEnviando(false)
  }

  return (
    <main className="flex min-h-dvh flex-col bg-fundo">
      <div className="bg-marinho px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-6">
        <div className="mx-auto w-full max-w-md">
          <LogoIvo variante="simbolo" cor="branco" altura={36} />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 pt-8 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <p className="ivo-legenda font-semibold text-texto-suave">Primeiro acesso</p>
        <div className="space-y-2">
          <h1 className="ivo-h1">Crie sua senha</h1>
          <p className="ivo-corpo text-texto-suave">Toque em Continuar para validar seu link de acesso.</p>
        </div>

        {erro && <Mensagem tipo="erro">{erro.texto}</Mensagem>}

        {erro?.definitivo ? (
          <Link
            to="/entrar"
            replace
            className="mt-auto flex min-h-12 w-full items-center justify-center rounded-cartao border border-borda bg-superficie px-5 ivo-botao text-texto"
          >
            Ir para a entrada
          </Link>
        ) : (
          <Botao
            variante="principal"
            className="mt-auto flex w-full items-center justify-center gap-2"
            disabled={enviando}
            onClick={() => void continuar()}
          >
            {enviando ? 'Validando…' : 'Continuar'}
          </Botao>
        )}
      </div>
    </main>
  )
}
