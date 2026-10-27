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
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fundo text-link">
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

const porDia = (n: number) => `${n.toLocaleString('pt-BR')} por dia`

/** Fase 3A: teto diário de buscas de endereço por empresa (freio de custo do Google). */
function TetoMapas({ atual, onSalvo }: { atual: Configuracao; onSalvo: (texto: string) => void }) {
  const [editando, setEditando] = useState(false)
  const [teto, setTeto] = useState(String(atual.mapas_teto_diario_empresa))
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const valor = inteiroPositivo(teto.replace(/\./g, ''), 1000000)
    if (valor === null) {
      setErro('Informe um número inteiro, de 1 a 1.000.000.')
      return
    }
    setErro(undefined)
    setFalha(null)
    setEnviando(true)
    // Sem atualização otimista: o valor exibido só muda com a confirmação do servidor.
    const r = await api.definirTetoMapas(valor)
    setEnviando(false)
    if (r.ok) {
      setEditando(false)
      onSalvo(`Cada empresa pode fazer até ${valor.toLocaleString('pt-BR')} buscas de endereço por dia.`)
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <Cartao className="space-y-3" data-testid="cartao-teto-mapas">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fundo text-link">
          <Icone nome="local" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="ivo-h3">Busca de endereços</h2>
          <p className="ivo-legenda text-texto-suave">
            Limite de chamadas ao Google por empresa, por dia. Acima dele, o cliente escreve o local e o motorista confere
            os km.
          </p>
        </div>
      </div>
      {editando ? (
        <form onSubmit={salvar} noValidate className="space-y-3">
          <Campo
            rotulo="Buscas por empresa, por dia"
            inputMode="numeric"
            autoComplete="off"
            value={teto}
            erro={erro}
            onChange={(e) => setTeto(e.target.value)}
          />
          <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Botao
              disabled={enviando}
              onClick={() => {
                setEditando(false)
                setTeto(String(atual.mapas_teto_diario_empresa))
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
            <dt className="ivo-corpo text-texto-suave">Buscas por empresa</dt>
            <dd className="font-bold tabular-nums">{porDia(atual.mapas_teto_diario_empresa)}</dd>
          </dl>
          <Botao className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => setEditando(true)}>
            <Icone nome="lapis" tamanho={18} />
            Alterar teto
          </Botao>
        </>
      )}
    </Cartao>
  )
}

/** Fase 4 (§6.9): o contato da IVO. v2.2: aparece também na Ajuda e na Carteira do cliente. */
function ContatoRecarga({ atual, onSalvo }: { atual: Configuracao; onSalvo: (texto: string) => void }) {
  const [editando, setEditando] = useState(false)
  const [contato, setContato] = useState(atual.contato_recarga ?? '')
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const valor = contato.trim()
    if (valor.length > 60) {
      setErro('Use até 60 caracteres.')
      return
    }
    setErro(undefined)
    setFalha(null)
    setEnviando(true)
    // Sem atualização otimista: o valor exibido só muda com a confirmação do servidor.
    const r = await api.definirContatoRecarga(valor)
    setEnviando(false)
    if (r.ok) {
      setEditando(false)
      onSalvo(valor ? `O painel das empresas mostra "${valor}" para recarregar.` : 'Contato de recarga apagado.')
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <Cartao className="space-y-3" data-testid="cartao-contato-recarga">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fundo text-link">
          <Icone nome="conversa" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="ivo-h3">Contato da IVO (aparece na Ajuda e na Carteira)</h2>
          <p className="ivo-legenda text-texto-suave">
            Também aparece no Painel da empresa, em &quot;Para recarregar, fale com a IVO&quot;. Telefone ou WhatsApp.
          </p>
        </div>
      </div>
      {editando ? (
        <form onSubmit={salvar} noValidate className="space-y-3">
          <Campo
            rotulo="Telefone ou WhatsApp"
            autoComplete="off"
            maxLength={60}
            value={contato}
            erro={erro}
            onChange={(e) => setContato(e.target.value)}
          />
          <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Botao
              disabled={enviando}
              onClick={() => {
                setEditando(false)
                setContato(atual.contato_recarga ?? '')
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
            <dt className="ivo-corpo text-texto-suave">Contato</dt>
            <dd className="font-bold">{atual.contato_recarga ?? 'Não informado'}</dd>
          </dl>
          {/* v2.2: sem contato, o cliente fica sem canal na Ajuda e na Carteira. */}
          {!atual.contato_recarga?.trim() && (
            <p className="flex items-start gap-2 ivo-legenda font-semibold text-alerta-texto" data-testid="aviso-sem-contato">
              <Icone nome="alerta" tamanho={18} className="mt-px shrink-0" />
              <span>Sem contato, a Ajuda e a Carteira mostram &apos;Contato ainda não cadastrado&apos;.</span>
            </p>
          )}
          <Botao className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => setEditando(true)}>
            <Icone nome="lapis" tamanho={18} />
            Alterar contato
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
        <TetoMapas
          key={`teto-${dados.mapas_teto_diario_empresa}-${dados.alterado_em}`}
          atual={dados}
          onSalvo={(texto) => {
            setAviso(texto)
            recarregar()
          }}
        />
      )}
      {dados && (
        <ContatoRecarga
          key={`contato-${dados.contato_recarga ?? ''}-${dados.alterado_em}`}
          atual={dados}
          onSalvo={(texto) => {
            setAviso(texto)
            recarregar()
          }}
        />
      )}
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
