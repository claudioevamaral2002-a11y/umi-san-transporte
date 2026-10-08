import { useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { LogoIvo } from '../../design/componentes/LogoIvo.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Turnstile, type ControleTurnstile } from '../../design/componentes/Turnstile.tsx'
import { mensagemErroAuth } from '../../lib/erros.ts'
import { normalizarSenha } from '../../lib/forcaSenha.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { supabase } from '../../lib/supabase.ts'

export function Entrar() {
  const { aviso, limparAviso } = useSessao()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const turnstile = useRef<ControleTurnstile>(null)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!token || enviando) return
    setEnviando(true)
    setErro(null)
    limparAviso()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: normalizarSenha(senha),
      options: { captchaToken: token },
    })
    if (error) {
      setErro(mensagemErroAuth(error))
      setSenha('')
      // O token do CAPTCHA é de uso único: gera outro para a próxima tentativa.
      turnstile.current?.reiniciar()
      setEnviando(false)
    }
    // Com sucesso, a sessão muda e a guarda leva para a próxima etapa (2FA ou início).
  }

  return (
    <main className="flex min-h-dvh flex-col bg-fundo">
      <section className="bg-marinho px-6 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-10 text-papel">
        <div className="mx-auto w-full max-w-md">
          <LogoIvo variante="simbolo" cor="branco" altura={46} />
          <p className="mt-8 max-w-[18ch] text-[1.875rem] leading-[1.12] font-extrabold tracking-[-0.035em] text-balance">
            Movimento que conecta novos horizontes
          </p>
          <span aria-hidden="true" className="mt-4 block h-[3px] w-[34px] rounded-full bg-[var(--cor-laranja)]" />
        </div>
      </section>

      <form
        onSubmit={entrar}
        noValidate
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 pt-8 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        <h1 className="ivo-sobretitulo text-texto-suave">Entrar</h1>

        {aviso && <Mensagem tipo={aviso.startsWith('Senha criada') ? 'sucesso' : 'info'}>{aviso}</Mensagem>}
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}

        <Campo
          rotulo="E-mail"
          icone="email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com.br"
        />
        <Campo
          rotulo="Senha"
          icone="cadeado"
          type="password"
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        <Turnstile acao="login" ref={turnstile} aoMudarToken={setToken} />

        <Botao
          type="submit"
          variante="principal"
          className="mt-1 flex w-full items-center justify-center gap-2 text-[1.0625rem]"
          disabled={enviando || !token || !email.trim() || !senha}
          aria-describedby={!token ? 'verificando' : undefined}
        >
          {enviando ? 'Entrando…' : 'Entrar'}
          {!enviando && <Icone nome="setaDireita" tamanho={20} />}
        </Botao>
        {!token && (
          <p id="verificando" className="-mt-2 text-center ivo-legenda text-texto-suave" aria-live="polite">
            Verificando a conexão com segurança…
          </p>
        )}

        <p className="mt-auto pt-8 text-center text-[0.6875rem] font-bold tracking-[0.32em] text-texto-suave">
          IVO TRANSPORTES
        </p>
      </form>
    </main>
  )
}
