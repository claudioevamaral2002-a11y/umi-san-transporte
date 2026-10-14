import { useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { EXIGE_2FA } from '../../lib/estadoSessao.ts'
import { avaliarSenha, normalizarSenha } from '../../lib/forcaSenha.ts'
import { chamarFuncao } from '../../lib/funcoes.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { CabecalhoEntrada } from './CabecalhoEntrada.tsx'

const NIVEIS = ['Muito fraca', 'Fraca', 'Razoável', 'Quase lá', 'Forte'] as const

export function DefinirSenha() {
  const { perfil, sair } = useSessao()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const avaliacao = avaliarSenha(senha)
  const confere = confirmacao.length > 0 && normalizarSenha(confirmacao) === normalizarSenha(senha)
  const comPasso = perfil ? EXIGE_2FA.includes(perfil.papel) : false

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!avaliacao.valida || !confere || enviando) return
    setEnviando(true)
    setErro(null)
    const r = await chamarFuncao('definir-senha', { senha: normalizarSenha(senha) })
    if (r.ok) {
      // A troca de senha encerra a sessão do link: entra de novo com a senha nova (e o 2FA, se houver).
      await sair('Senha criada. Entre com a nova senha.')
      return
    }
    setErro(mensagemDoCodigo(r.codigo))
    setEnviando(false)
  }

  return (
    <main className="flex min-h-dvh flex-col bg-fundo">
      <CabecalhoEntrada
        passo={comPasso ? 'Passo 1 de 2' : 'Primeiro acesso'}
        aoVoltar={() => void sair()}
        rotuloVoltar="Cancelar e sair"
      />
      <form
        onSubmit={enviar}
        noValidate
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        <div className="space-y-2">
          <h1 className="ivo-h1">Crie sua senha</h1>
          <p className="ivo-corpo text-texto-suave">
            {perfil?.nome ? `${perfil.nome.split(' ')[0]}, escolha` : 'Escolha'} uma senha que só você saiba. Ela vale para
            entrar no app daqui em diante.
          </p>
        </div>

        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}

        <Campo
          rotulo="Nova senha"
          icone="cadeado"
          type="password"
          name="nova-senha"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          aria-invalid={senha.length > 0 && !avaliacao.valida}
        />

        <div aria-live="polite" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4].map((n) => (
                <span
                  key={n}
                  className="h-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none"
                  style={{
                    background:
                      avaliacao.nivel >= n
                        ? avaliacao.valida
                          ? 'var(--status-concluida)'
                          : avaliacao.nivel >= 3
                            ? 'var(--status-aguardando)'
                            : 'var(--status-cancelada)'
                        : 'var(--cor-borda)',
                  }}
                />
              ))}
            </div>
            <span className="w-24 text-right ivo-legenda font-semibold text-texto-suave">
              Força: {senha ? NIVEIS[avaliacao.nivel] : '—'}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 min-[380px]:grid-cols-2">
            {avaliacao.regras.map((r) => (
              <li
                key={r.id}
                className={`flex items-center gap-2 ivo-legenda ${r.ok ? 'text-[var(--status-concluida)]' : 'text-texto-suave'}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-5 items-center justify-center rounded-full border ${
                    r.ok ? 'border-[var(--status-concluida)] bg-[var(--status-concluida)] text-fundo' : 'border-borda'
                  }`}
                >
                  {r.ok && <Icone nome="check" tamanho={14} />}
                </span>
                {r.rotulo}
                <span className="sr-only">{r.ok ? ' — atendido' : ' — pendente'}</span>
              </li>
            ))}
          </ul>
          {avaliacao.longaDemais && <Mensagem tipo="erro">{mensagemDoCodigo('SENHA_LONGA')}</Mensagem>}
        </div>

        <Campo
          rotulo="Repita a senha"
          icone="cadeado"
          type="password"
          name="confirmar-senha"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          aria-invalid={confirmacao.length > 0 && !confere}
          ajuda={confirmacao.length > 0 && !confere ? 'As senhas não são iguais.' : undefined}
        />

        <p className="ivo-legenda text-texto-suave">
          Também conferimos, de forma anônima, se a senha já apareceu em vazamentos conhecidos.
        </p>

        <Botao
          type="submit"
          variante="principal"
          className="mt-auto flex w-full items-center justify-center gap-2"
          disabled={!avaliacao.valida || !confere || enviando}
        >
          {enviando ? 'Salvando…' : 'Criar senha'}
        </Botao>
      </form>
    </main>
  )
}
