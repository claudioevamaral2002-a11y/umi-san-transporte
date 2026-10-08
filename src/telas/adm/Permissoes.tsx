import { useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Interruptor } from '../../design/componentes/Interruptor.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { motivoValido, PERMISSOES, type DefinicaoPermissao } from '../../lib/administracao.ts'
import { api } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { formatarDataHora } from '../../lib/valores.ts'

interface Mudanca {
  def: DefinicaoPermissao
  ativo: boolean
}

function Confirmar({ mudanca, onConcluido }: { mudanca: Mudanca; onConcluido: (texto: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    if (!motivoValido(motivo)) {
      setErro('Explique o motivo (3 a 500 caracteres).')
      return
    }
    setErro(undefined)
    setFalha(null)
    setEnviando(true)
    const r = await api.definirPermissao(mudanca.def.chave, mudanca.ativo, motivo.trim())
    setEnviando(false)
    if (r.ok) onConcluido(`"${mudanca.def.titulo}" ${mudanca.ativo ? 'ligada' : 'desligada'}.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form onSubmit={confirmar} noValidate className="space-y-3">
      <p className="ivo-corpo">
        {mudanca.ativo ? 'Ligar' : 'Desligar'} <strong>{mudanca.def.titulo.toLowerCase()}</strong>?
      </p>
      <p className="ivo-legenda text-texto-suave">{mudanca.def.explicacao} A mudança vale na hora e fica na auditoria.</p>
      <AreaTexto
        rotulo="Motivo"
        ajuda="De 3 a 500 caracteres."
        maxLength={500}
        value={motivo}
        erro={erro}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <Botao type="submit" variante="principal" className="w-full" disabled={enviando}>
        {enviando ? 'Salvando…' : mudanca.ativo ? 'Ligar permissão' : 'Desligar permissão'}
      </Botao>
    </form>
  )
}

export function Permissoes() {
  const { dados, erro, carregando, recarregar } = useConsulta('adm-permissoes', api.permissoes)
  const [mudanca, setMudanca] = useState<Mudanca | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Permissões"
        descricao="Delegações além do perfil de cada pessoa. Tudo começa desligado; cada mudança pede um motivo."
      />
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && <Skeleton className="h-56" />}

      {dados && (
        <ul className="space-y-3">
          {PERMISSOES.map((def) => {
            const atual = dados.find((p) => p.chave === def.chave)
            const ativo = atual?.ativo ?? false
            return (
              <li key={def.chave}>
                <Cartao className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-testid={`permissao-${def.chave}`}>
                  <div className="min-w-0 space-y-1">
                    <h2 className="ivo-h3">{def.titulo}</h2>
                    <p id={`explica-${def.chave}`} className="ivo-corpo text-texto-suave">
                      {def.explicacao}
                    </p>
                    <p className="ivo-legenda text-texto-suave">
                      {atual?.alterado_em ? (
                        <>
                          Última alteração: <span className="tabular-nums">{formatarDataHora(atual.alterado_em)}</span>
                        </>
                      ) : (
                        'Nunca alterada.'
                      )}
                    </p>
                  </div>
                  <Interruptor
                    ligado={ativo}
                    rotulo={def.titulo}
                    descricaoId={`explica-${def.chave}`}
                    desabilitado={!atual}
                    onAlternar={() => {
                      setAviso(null)
                      setMudanca({ def, ativo: !ativo })
                    }}
                  />
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}

      <Folha aberta={mudanca !== null} onFechar={() => setMudanca(null)} sobretitulo="Permissões" titulo="Confirmar mudança">
        {mudanca && (
          <Confirmar
            mudanca={mudanca}
            onConcluido={(texto) => {
              setAviso(texto)
              setMudanca(null)
              recarregar()
            }}
          />
        )}
      </Folha>
    </main>
  )
}
