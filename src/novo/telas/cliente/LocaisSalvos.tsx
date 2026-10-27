import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo } from '../../../design/componentes/Campo.tsx'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { EstadoVazio, ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { gereEquipe } from '../../../lib/administracao.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import {
  excluirLocal,
  listarLocais,
  localDoPedido,
  NOME_LOCAL_MAX,
  nomeLocalValido,
  renomearLocal,
  type LocalSalvo,
} from '../../../lib/locais.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { podeCriarPedido } from '../../../telas/pedidos/Pedidos.tsx'
import { pedirDaquiDe } from '../../pedirDeNovo.ts'

const usos = (n: number) => (n === 1 ? 'Usado em 1 pedido' : `Usado em ${n} pedidos`)

/** Folha do lápis (só o N1): novo nome, de 2 a 80 caracteres. Nada otimista: fecha só com o ok do banco. */
function Renomear({ local, aoFechar, aoSalvar }: { local: LocalSalvo; aoFechar: () => void; aoSalvar: () => void }) {
  const [nome, setNome] = useState(local.nome)
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setFalha(null)
    if (!nomeLocalValido(nome)) {
      setErro('O nome precisa ter de 2 a 80 caracteres.')
      return
    }
    setErro(undefined)
    setEnviando(true)
    const r = await renomearLocal(local.id, nome)
    setEnviando(false)
    if (r.ok) aoSalvar()
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form onSubmit={(e) => void salvar(e)} noValidate className="space-y-4">
      <Campo rotulo="Nome do local" value={nome} maxLength={NOME_LOCAL_MAX} erro={erro} onChange={(e) => setNome(e.target.value)} />
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" variante="principal" disabled={enviando}>
          Salvar nome
        </Botao>
        <Botao onClick={aoFechar}>Cancelar</Botao>
      </div>
    </form>
  )
}

/** Confirmação do Excluir (só o N1): apaga o local salvo; os pedidos não mudam. */
function Excluir({ local, aoFechar, aoExcluir }: { local: LocalSalvo; aoFechar: () => void; aoExcluir: () => void }) {
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function excluir() {
    if (enviando) return
    setFalha(null)
    setEnviando(true)
    const r = await excluirLocal(local.id)
    setEnviando(false)
    if (r.ok) aoExcluir()
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-4">
      <p className="ivo-corpo">
        <span className="font-semibold break-words">{local.nome}</span> sai da lista de locais da empresa. Os pedidos que já
        usaram este local não mudam.
      </p>
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <div className="flex flex-wrap gap-2">
        <Botao variante="perigo" onClick={() => void excluir()} disabled={enviando}>
          Excluir
        </Botao>
        <Botao onClick={aoFechar}>Cancelar</Botao>
      </div>
    </div>
  )
}

/**
 * v2.2 (§5.5): "Locais salvos": todos os locais da empresa, mais usados primeiro. "Pedir daqui" abre o Início com o De
 * preenchido (o mesmo caminho do "Pedir de novo"). Só o Administrador (N1) vê o lápis e o Excluir; o banco confere.
 */
export function LocaisSalvos() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const { perfil } = useSessao()
  const navegar = useNavigate()
  const { dados, erro, recarregar } = useConsulta('novo-locais-salvos', listarLocais)
  const [editando, setEditando] = useState<LocalSalvo | null>(null)
  const [excluindo, setExcluindo] = useState<LocalSalvo | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const admin = gereEquipe(perfil)
  const pede = podeCriarPedido(perfil)

  const concluir = (texto: string) => {
    setEditando(null)
    setExcluindo(null)
    setAviso(texto)
    recarregar()
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <header className="space-y-1">
        <h1 className="ivo-h2">Locais salvos</h1>
        <p className="ivo-legenda text-texto-suave">Os lugares dos pedidos da empresa, dos mais usados para os menos usados.</p>
      </header>
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando os locais…
            </p>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )
      ) : dados.length === 0 ? (
        <EstadoVazio icone="local" titulo="Nenhum local salvo">
          Os lugares dos seus pedidos aparecem aqui.
        </EstadoVazio>
      ) : (
        <ul aria-label="Locais salvos" className="space-y-3">
          {dados.map((l) => {
            const daqui = pede ? pedirDaquiDe(localDoPedido(l)) : null
            return (
              <li key={l.id} data-testid="local-salvo">
                <Cartao className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Icone nome="local" tamanho={20} className="mt-0.5 text-texto-suave" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{l.nome}</p>
                      {l.endereco && <p className="ivo-legenda break-words text-texto-suave">{l.endereco}</p>}
                      <p className="ivo-legenda text-texto-suave">{usos(l.usos)}</p>
                    </div>
                    {admin && (
                      <button
                        type="button"
                        onClick={() => {
                          setAviso(null)
                          setEditando(l)
                        }}
                        aria-label={`Renomear ${l.nome}`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full text-texto-suave"
                      >
                        <Icone nome="lapis" tamanho={20} />
                      </button>
                    )}
                  </div>
                  {(daqui || admin) && (
                    <div className="flex flex-wrap gap-2">
                      {daqui && (
                        <Botao variante="principal" onClick={() => navegar('/', { state: { pedirDaqui: daqui } })}>
                          Pedir daqui
                        </Botao>
                      )}
                      {admin && (
                        <Botao
                          onClick={() => {
                            setAviso(null)
                            setExcluindo(l)
                          }}
                          aria-label={`Excluir ${l.nome}`}
                        >
                          Excluir
                        </Botao>
                      )}
                    </div>
                  )}
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}
      <Folha aberta={editando !== null} titulo="Renomear local" onFechar={() => setEditando(null)}>
        {editando && <Renomear local={editando} aoFechar={() => setEditando(null)} aoSalvar={() => concluir('Local renomeado.')} />}
      </Folha>
      <Folha aberta={excluindo !== null} titulo="Excluir local?" onFechar={() => setExcluindo(null)}>
        {excluindo && <Excluir local={excluindo} aoFechar={() => setExcluindo(null)} aoExcluir={() => concluir('Local excluído.')} />}
      </Folha>
    </main>
  )
}
