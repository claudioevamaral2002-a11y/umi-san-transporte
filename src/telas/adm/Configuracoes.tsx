import { useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api, type Configuracao } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { formatarValor } from '../../lib/contratos.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { formatarDataHora, inteiroPositivo } from '../../lib/valores.ts'

function RetencaoFotos({ atual, onSalvo }: { atual: Configuracao; onSalvo: (texto: string) => void }) {
  const [editando, setEditando] = useState(false)
  const [dias, setDias] = useState(String(atual.retencao_fotos_dias))
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const valor = inteiroPositivo(dias, 3650)
    if (valor === null) {
      setErro('Informe um número inteiro de dias, de 1 a 3650.')
      return
    }
    setErro(undefined)
    setFalha(null)
    setEnviando(true)
    // Sem atualização otimista: o valor exibido só muda com a confirmação do servidor.
    const r = await api.definirRetencaoFotos(valor)
    setEnviando(false)
    if (r.ok) {
      setEditando(false)
      onSalvo(`Fotos passam a ser guardadas por ${formatarValor('dias', valor)} após a entrega.`)
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <Cartao className="space-y-3" data-testid="cartao-retencao-fotos">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fundo text-marinho-2">
          <Icone nome="imagem" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="ivo-h3">Fotos das entregas</h2>
          <p className="ivo-legenda text-texto-suave">
            Vale para todas as empresas. Depois do prazo, as fotos de coleta e entrega são apagadas.
          </p>
        </div>
      </div>
      {editando ? (
        <form onSubmit={salvar} noValidate className="space-y-3">
          <Campo
            rotulo="Fotos guardadas após a entrega"
            inputMode="numeric"
            sufixo="dias"
            autoComplete="off"
            value={dias}
            erro={erro}
            onChange={(e) => setDias(e.target.value)}
          />
          <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Botao
              disabled={enviando}
              onClick={() => {
                setEditando(false)
                setDias(String(atual.retencao_fotos_dias))
                setErro(undefined)
                setFalha(null)
              }}
            >
              Cancelar
            </Botao>
            <Botao type="submit" variante="principal" disabled={enviando}>
              {enviando ? 'Salvando…' : 'Salvar'}
            </Botao>
          </div>
        </form>
      ) : (
        <>
          <dl className="flex items-baseline justify-between gap-4 border-t border-borda pt-3">
            <dt className="ivo-corpo text-texto-suave">Fotos guardadas após a entrega</dt>
            <dd className="font-bold tabular-nums">{formatarValor('dias', atual.retencao_fotos_dias)}</dd>
          </dl>
          <p className="ivo-legenda text-texto-suave">
            Alterado em <span className="tabular-nums">{formatarDataHora(atual.alterado_em)}</span>
          </p>
          <Botao className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => setEditando(true)}>
            <Icone nome="lapis" tamanho={18} />
            Alterar prazo
          </Botao>
        </>
      )}
    </Cartao>
  )
}

export function Configuracoes() {
  const { dados, erro, carregando, recarregar } = useConsulta('adm-configuracoes', api.configuracao)
  const [aviso, setAviso] = useState<string | null>(null)

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <CabecalhoTela sobretitulo="Administração" titulo="Configurações" descricao="Regras gerais do app, iguais para todas as empresas." />
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && <Skeleton className="h-40" />}
      {dados && (
        <RetencaoFotos
          key={`${dados.retencao_fotos_dias}-${dados.alterado_em}`}
          atual={dados}
          onSalvo={(texto) => {
            setAviso(texto)
            recarregar()
          }}
        />
      )}
    </main>
  )
}
