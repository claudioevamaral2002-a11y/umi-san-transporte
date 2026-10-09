import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { CODIGO_VAZIO, CodigoSeisDigitos, codigoCompleto } from '../../design/componentes/CodigoSeisDigitos.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { mensagemErroAuth } from '../../lib/erros.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { supabase } from '../../lib/supabase.ts'
import { CabecalhoEntrada } from './CabecalhoEntrada.tsx'

interface Cadastro {
  fatorId: string
  qr: string
  segredo: string
  uri: string
}

/** O Supabase devolve `data:image/svg+xml;utf-8,<svg…>`; recodifica para um data URI sempre válido. */
function qrComoDataUri(qr: string): string {
  const svg = qr.replace(/^data:image\/svg\+xml;utf-8,/, '')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function prepararCadastro(): Promise<Cadastro | string> {
  // Fatores não confirmados de tentativas anteriores impedem um cadastro novo: remove antes.
  const lista = await supabase.auth.mfa.listFactors()
  if (lista.error) return mensagemErroAuth(lista.error, '2fa')
  for (const f of lista.data.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Autenticador',
    issuer: 'IVO Transportes',
  })
  if (error) return mensagemErroAuth(error, '2fa')
  return { fatorId: data.id, qr: qrComoDataUri(data.totp.qr_code), segredo: data.totp.secret, uri: data.totp.uri }
}

async function fatorVerificado(): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors()
  return data?.totp[0]?.id ?? null
}

function SegredoCopiavel({ segredo }: { segredo: string }) {
  const [copiado, setCopiado] = useState(false)
  const agrupado = segredo.match(/.{1,4}/g)?.join(' ') ?? segredo
  return (
    <div className="flex items-center gap-2 rounded-xl border border-borda bg-superficie p-1.5 pl-3.5">
      <code className="min-w-0 flex-1 font-mono text-[0.9375rem] font-semibold tracking-wider break-all text-texto">
        {agrupado}
      </code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(segredo).then(
            () => setCopiado(true),
            () => setCopiado(false),
          )
        }
        className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-texto hover:bg-borda/60"
      >
        <Icone nome={copiado ? 'check' : 'copiar'} tamanho={18} />
        <span aria-live="polite">{copiado ? 'Copiado' : 'Copiar'}</span>
      </button>
    </div>
  )
}

export function Seguranca2fa() {
  const { estado, perfil, sair, recarregar } = useSessao()
  const cadastrando = estado === 'cadastrar_2fa'
  const [cadastro, setCadastro] = useState<Cadastro | null>(null)
  const [codigo, setCodigo] = useState(CODIGO_VAZIO)
  const [erro, setErro] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)
  const iniciou = useRef(false)

  useEffect(() => {
    if (!cadastrando || iniciou.current) return
    iniciou.current = true
    void prepararCadastro().then((r) => {
      if (typeof r === 'string') setErro(r)
      else setCadastro(r)
    })
  }, [cadastrando])

  async function confirmar(completo: string | null) {
    if (!completo || verificando) return
    setVerificando(true)
    setErro(null)
    const fatorId = cadastrando ? cadastro?.fatorId : await fatorVerificado()
    if (!fatorId) {
      setErro(mensagemErroAuth(null, '2fa'))
      setVerificando(false)
      return
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: completo })
    if (error) {
      setErro(mensagemErroAuth(error, 'codigo'))
      setCodigo(CODIGO_VAZIO)
      setVerificando(false)
      document.querySelector<HTMLInputElement>('[aria-label="Dígito 1 de 6"]')?.focus()
      return
    }
    // Sessão agora em aal2: a guarda leva ao início.
    recarregar()
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    void confirmar(codigoCompleto(codigo))
  }

  const perfilTexto =
    perfil?.papel === 'ADM'
      ? 'de administrador'
      : perfil?.papel === 'GESTOR_FROTA'
        ? 'de gestor de frota'
        : perfil?.papel === 'MOTORISTA'
          ? 'de motorista'
          : ''

  return (
    <main className="flex min-h-dvh flex-col bg-fundo">
      <CabecalhoEntrada
        passo={cadastrando ? 'Passo 2 de 2' : 'Verificação em duas etapas'}
        aoVoltar={() => void sair()}
        rotuloVoltar="Voltar e sair"
      />
      <form
        onSubmit={enviar}
        noValidate
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-6 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        <div className="space-y-2">
          <h1 className="ivo-h1">{cadastrando ? `Proteja sua conta ${perfilTexto}`.trim() : 'Digite o código'}</h1>
          <p className="ivo-corpo text-texto-suave">
            {cadastrando
              ? 'Abra o Google Authenticator, toque em + e leia o código.'
              : 'Abra o app autenticador e digite o código de 6 dígitos da IVO Transportes.'}
          </p>
        </div>

        {cadastrando && (
          <div className="space-y-3">
            <div className="mx-auto flex size-[13.5rem] items-center justify-center rounded-3xl bg-white p-3 shadow-[var(--sombra)]">
              {cadastro ? (
                <img
                  src={cadastro.qr}
                  alt="Código QR para cadastrar a IVO Transportes no app autenticador"
                  width={192}
                  height={192}
                  className="size-48"
                />
              ) : (
                <Skeleton className="size-48" />
              )}
            </div>
            {cadastro && (
              <>
                <p className="text-center ivo-legenda text-texto-suave">
                  Está no celular?{' '}
                  <a href={cadastro.uri} className="font-semibold text-texto underline underline-offset-4">
                    Abrir no app autenticador
                  </a>{' '}
                  ou copie a chave:
                </p>
                <SegredoCopiavel segredo={cadastro.segredo} />
              </>
            )}
          </div>
        )}

        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}

        <div className="space-y-2.5">
          <p id="rotulo-codigo" className="ivo-legenda font-semibold text-texto">
            Código de 6 dígitos
          </p>
          <CodigoSeisDigitos
            idRotulo="rotulo-codigo"
            valor={codigo}
            aoMudar={(v) => {
              setCodigo(v)
              if (erro) setErro(null)
            }}
            aoCompletar={(c) => void confirmar(c)}
            desabilitado={verificando || (cadastrando && !cadastro)}
            invalido={Boolean(erro)}
          />
        </div>

        <Botao
          type="submit"
          variante="principal"
          className="mt-auto flex w-full items-center justify-center gap-2"
          disabled={!codigoCompleto(codigo) || verificando || (cadastrando && !cadastro)}
        >
          {cadastrando && <Icone nome="escudo" tamanho={20} />}
          {verificando ? 'Conferindo…' : cadastrando ? 'Ativar proteção' : 'Confirmar'}
        </Botao>
      </form>
    </main>
  )
}
