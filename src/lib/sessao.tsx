import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { derivarEstado, type EstadoSessao, type Perfil } from './estadoSessao.ts'
import { lerLinkDeEntrada } from './linkDeEntrada.ts'

export type { EstadoSessao, Papel, Perfil } from './estadoSessao.ts'

interface ValorSessao {
  estado: EstadoSessao
  perfil: Perfil | null
  email: string | null
  /** Falhou ao carregar a conta (sem rede, por exemplo) antes de saber o estado. */
  falhou: boolean
  /** Mensagem para a tela de entrada (ex.: "Senha criada. Entre com a nova senha."). */
  aviso: string | null
  limparAviso: () => void
  recarregar: () => void
  /** Encerra a sessão (revoga o refresh token no servidor) e, se houver, deixa um aviso para /entrar. */
  sair: (aviso?: string) => Promise<void>
}

const ContextoSessao = createContext<ValorSessao | null>(null)

type Resultado = { estado: Exclude<EstadoSessao, 'carregando'>; perfil: Perfil | null; email: string | null }

// O cliente Supabase (~57 KB gzip) sai da carga inicial: o casco do app pinta antes.
const cliente = () => import('./supabase.ts').then((m) => m.supabase)

// Lido aqui, na carga do app, ANTES de o cliente consumir o fragmento (`detectSessionInUrl` limpa a URL).
const link = lerLinkDeEntrada(typeof window === 'undefined' ? '' : window.location.hash)
// Aberto por link de convite/recuperação: vale até a senha ser definida ou a pessoa sair.
let viaLink = link.definirSenha

async function carregar(): Promise<Resultado | null> {
  const supabase = await cliente()
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  const sessao = data.session
  if (!sessao) return { estado: 'anonimo', perfil: null, email: null }

  const [perfil, aal] = await Promise.all([
    supabase.rpc('meu_perfil').maybeSingle<Perfil>(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])
  if (perfil.error || aal.error) return null
  return {
    estado: derivarEstado({
      temSessao: true,
      perfil: perfil.data,
      aalAtual: aal.data.currentLevel,
      aalProximo: aal.data.nextLevel,
      viaLink,
    }),
    perfil: perfil.data,
    email: sessao.user.email ?? null,
  }
}

const AVISO_LINK_INVALIDO = 'Este link expirou ou já foi usado. Peça um novo ao administrador.'

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [aviso, setAviso] = useState<string | null>(link.erro ? AVISO_LINK_INVALIDO : null)
  const sequencia = useRef(0)

  const atualizar = useCallback(() => {
    const minha = ++sequencia.current
    carregar().then(
      (r) => {
        if (minha !== sequencia.current) return
        if (r) {
          setResultado(r)
          setFalhou(false)
        } else {
          // Já com estado conhecido, uma falha de rede na renovação não derruba a tela.
          setFalhou(true)
        }
      },
      () => {
        if (minha === sequencia.current) setFalhou(true)
      },
    )
  }, [])

  useEffect(() => {
    let cancelar: (() => void) | null = null
    let ativo = true
    cliente().then(
      (supabase) => {
        if (!ativo) return
        // Não chamar o Supabase dentro do callback (trava o lock do Auth): agenda fora dele.
        // O INITIAL_SESSION da inscrição dispara a primeira avaliação.
        const { data } = supabase.auth.onAuthStateChange((evento) => {
          if (evento === 'PASSWORD_RECOVERY') viaLink = true
          if (evento === 'SIGNED_OUT') viaLink = false
          setTimeout(atualizar, 0)
        })
        cancelar = () => data.subscription.unsubscribe()
      },
      () => {
        if (ativo) setFalhou(true)
      },
    )
    return () => {
      ativo = false
      cancelar?.()
    }
  }, [atualizar])

  const sair = useCallback(async (novoAviso?: string) => {
    viaLink = false
    setAviso(novoAviso ?? null)
    const supabase = await cliente()
    const { error } = await supabase.auth.signOut()
    // Sem rede o servidor não revoga; ainda assim a sessão local é apagada.
    if (error) await supabase.auth.signOut({ scope: 'local' })
  }, [])

  const valor = useMemo<ValorSessao>(
    () => ({
      estado: resultado?.estado ?? 'carregando',
      perfil: resultado?.perfil ?? null,
      email: resultado?.email ?? null,
      falhou: falhou && !resultado,
      aviso,
      limparAviso: () => setAviso(null),
      recarregar: atualizar,
      sair,
    }),
    [resultado, falhou, aviso, atualizar, sair],
  )

  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
}

export function useSessao(): ValorSessao {
  const valor = useContext(ContextoSessao)
  if (!valor) throw new Error('useSessao fora do SessaoProvider')
  return valor
}
