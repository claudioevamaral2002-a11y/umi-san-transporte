import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { limparConsultas } from './consulta.ts'
import { derivarEstado, type EstadoSessao, type Perfil } from './estadoSessao.ts'
import { lerLinkDeEntrada } from './linkDeEntrada.ts'
import { limparUltimoCentroCusto } from '../novo/preferencias.ts'

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
  /**
   * Abre a sessão devolvida pelo resgate do link curto (convite/recuperação) como "aberta por link"
   * e devolve o novo estado já carregado (ou `null` se falhou).
   */
  entrarPorLink: (tokens: { access_token: string; refresh_token: string }) => Promise<EstadoSessao | null>
}

const ContextoSessao = createContext<ValorSessao | null>(null)

type Resultado = { estado: Exclude<EstadoSessao, 'carregando'>; perfil: Perfil | null; email: string | null }

// O cliente Supabase (~57 KB gzip) sai da carga inicial: o casco do app pinta antes.
const cliente = () => import('./supabase.ts').then((m) => m.supabase)

// Lido aqui, na carga do app, ANTES de o cliente consumir o fragmento (`detectSessionInUrl` limpa a URL).
const link = lerLinkDeEntrada(typeof window === 'undefined' ? '' : window.location.hash)
// Aberto por link de convite/recuperação: vale até a senha ser definida ou a pessoa sair.
let viaLink = link.definirSenha

/** `session_id` do JWT de acesso (sem validar: só para não renovar duas vezes a mesma sessão). */
function sessaoDoToken(jwt: string): string | null {
  try {
    const corpo = jwt.split('.')[1] ?? ''
    const json = atob(corpo.replace(/-/g, '+').replace(/_/g, '/'))
    const id = (JSON.parse(json) as { session_id?: unknown }).session_id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

// Sessão (id) já renovada para conferir o 2FA no servidor nesta carga do app.
let sessaoJaRenovada: string | null = null

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
  const entrada = {
    temSessao: true,
    perfil: perfil.data,
    aalAtual: aal.data.currentLevel,
    aalProximo: aal.data.nextLevel,
    viaLink,
  }
  let estado = derivarEstado(entrada)
  // O nível (aal) que o app lê vem do token de ACESSO guardado no aparelho; o servidor guarda o nível da SESSÃO.
  // Se o token guardado é anterior ao 2FA (resposta da verificação perdida ao trocar de app para copiar o código,
  // app fechado no meio, outra aba/janela do app com o token antigo), o app pedia o código de novo mesmo com a
  // sessão já verificada no servidor. Antes de pedir o código, renova uma vez: o servidor só devolve aal2 se a
  // sessão já passou pelo 2FA (nada é liberado sem o código).
  // Uma vez por sessão (a renovação dispara TOKEN_REFRESHED, que chama carregar de novo).
  const idSessao = sessaoDoToken(sessao.access_token)
  if (estado === 'verificar_2fa' && aal.data.currentLevel === 'aal1' && idSessao && idSessao !== sessaoJaRenovada) {
    sessaoJaRenovada = idSessao
    const renovada = await supabase.auth.refreshSession()
    if (!renovada.error && renovada.data.session) {
      const depois = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!depois.error) {
        estado = derivarEstado({ ...entrada, aalAtual: depois.data.currentLevel, aalProximo: depois.data.nextLevel })
      }
    }
  }
  return { estado, perfil: perfil.data, email: sessao.user.email ?? null }
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
          // Outra conta pode entrar no mesmo aparelho: nada da anterior fica na memória das telas.
          if (evento === 'SIGNED_OUT' || evento === 'SIGNED_IN') limparConsultas()
          // O último centro de custo (app novo) é da conta que saiu: não fica no aparelho para a próxima.
          if (evento === 'SIGNED_OUT') limparUltimoCentroCusto()
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

  const entrarPorLink = useCallback(async (tokens: { access_token: string; refresh_token: string }) => {
    const supabase = await cliente()
    viaLink = true
    const { error } = await supabase.auth.setSession(tokens)
    if (error) {
      viaLink = false
      return null
    }
    // Descarta cargas antigas (de antes da sessão nova) e já entrega o estado novo à guarda.
    ++sequencia.current
    const r = await carregar().catch(() => null)
    if (!r) return null
    setResultado(r)
    setFalhou(false)
    return r.estado
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
      entrarPorLink,
    }),
    [resultado, falhou, aviso, atualizar, sair, entrarPorLink],
  )

  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
}

export function useSessao(): ValorSessao {
  const valor = useContext(ContextoSessao)
  if (!valor) throw new Error('useSessao fora do SessaoProvider')
  return valor
}
