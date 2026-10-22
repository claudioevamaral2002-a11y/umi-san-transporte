import { useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { contato, formatarTelefone, mascararTelefoneDoPerfil, normalizarTelefone } from '../../lib/perfilContato.ts'
import { rotuloCurto, useRotulos } from '../../lib/rotulos.tsx'
import { useSessao } from '../../lib/sessao.tsx'
import { useTituloNaTela } from '../../design/componentes/Tela.tsx'

function Telefone({ atual, aoSalvar }: { atual: string | null; aoSalvar: () => void }) {
  const [texto, setTexto] = useState(() => formatarTelefone(atual))
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setAviso(null)
    setFalha(null)
    const n = normalizarTelefone(texto)
    if (!n.ok) {
      setErro(mensagemDoCodigo('TELEFONE_INVALIDO'))
      return
    }
    setErro(undefined)
    setEnviando(true)
    // Sem mudança otimista: "salvo" só depois da resposta do servidor.
    const r = await contato.salvarTelefone(n.digitos)
    setEnviando(false)
    if (r.ok) {
      setAviso(n.digitos ? 'Telefone salvo.' : 'Telefone apagado.')
      aoSalvar()
    } else if (r.codigo === 'TELEFONE_INVALIDO') {
      setErro(mensagemDoCodigo(r.codigo))
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <form onSubmit={(e) => void salvar(e)} noValidate className="space-y-3">
      <Campo
        rotulo="Telefone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="(47) 99999-1234"
        ajuda="Com DDD. Aparece no botão Ligar das corridas. Deixe em branco para apagar."
        erro={erro}
        value={texto}
        onChange={(e) => setTexto(mascararTelefoneDoPerfil(e.target.value))}
      />
      <div aria-live="polite">
        {aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}
        {falha && <Mensagem tipo="erro">{falha}</Mensagem>}
      </div>
      <Botao type="submit" variante="principal" disabled={enviando}>
        {enviando ? 'Salvando…' : 'Salvar telefone'}
      </Botao>
    </form>
  )
}

/**
 * "Perfil e segurança" do app novo (Ruling R15): nome e e-mail só para ler (quem muda é o administrador), o telefone
 * editável (para o "Ligar") e a situação da verificação em duas etapas.
 */
export function PerfilSeguranca() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const { perfil, email } = useSessao()
  const rotulos = useRotulos()
  const tel = useConsulta('novo-meu-telefone', () => contato.meuTelefone())
  if (!perfil) return null

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <h1 className="ivo-h2">Perfil e segurança</h1>
      <Cartao className="space-y-3">
        <h2 className="ivo-h3">Seus dados</h2>
        <dl className="space-y-2">
          <div>
            <dt className="ivo-legenda text-texto-suave">Nome</dt>
            <dd className="font-semibold">{perfil.nome}</dd>
          </div>
          <div>
            <dt className="ivo-legenda text-texto-suave">E-mail</dt>
            <dd className="font-semibold break-all">{email ?? '—'}</dd>
          </div>
          <div>
            <dt className="ivo-legenda text-texto-suave">Perfil</dt>
            <dd className="font-semibold">
              {perfil.papel === 'CLIENTE' && perfil.empresa_nome ? `${perfil.empresa_nome} · ` : ''}
              {rotuloCurto(rotulos, perfil.papel, perfil.nivel)}
            </dd>
          </div>
        </dl>
        <p className="ivo-legenda text-texto-suave">Para mudar o nome ou o e-mail, fale com o administrador da IVO.</p>
        {tel.dados === undefined ? (
          tel.erro ? (
            <div className="space-y-2">
              <Mensagem tipo="erro">Não foi possível carregar o telefone.</Mensagem>
              <Botao onClick={tel.recarregar}>Tentar de novo</Botao>
            </div>
          ) : (
            <Skeleton className="h-20" />
          )
        ) : (
          <Telefone atual={tel.dados} aoSalvar={tel.recarregar} />
        )}
      </Cartao>
      <Cartao className="space-y-2">
        <h2 className="ivo-h3">Segurança</h2>
        <p className="flex items-center gap-2 font-semibold">
          <Icone nome={perfil.tem_2fa ? 'escudo' : 'alerta'} tamanho={20} />
          {perfil.tem_2fa ? 'Verificação em duas etapas ativa' : 'Verificação em duas etapas não cadastrada'}
        </p>
        <p className="ivo-legenda text-texto-suave">
          O código do app autenticador é pedido ao entrar. Para trocar a senha ou o autenticador (aparelho novo ou
          perdido), peça um novo link ao administrador da IVO: o link leva às telas de senha e de verificação.
        </p>
      </Cartao>
    </main>
  )
}
