import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto, Campo } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { ROTULO_TIPO, formatarComSinal } from '../../lib/extrato.ts'
import {
  Intencao,
  dinheiro,
  ordenarPorRisco,
  saldoAposLancamento,
  semResposta,
  type EmpresaPainel,
  type ItemExtrato,
  type Saldo,
} from '../../lib/saldo.ts'
import { formatarDataHora, reaisParaCentavos } from '../../lib/valores.ts'
import { ExtratoEmpresa } from '../extrato/Extrato.tsx'
import { Processando } from '../pedidos/Aprovar.tsx'
import { CartaoSaldo, useSaldo } from '../saldo/CartaoSaldo.tsx'

export function SeloAlerta() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cor-laranja)] px-2.5 py-0.5 text-xs font-extrabold text-marinho">
      <Icone nome="alerta" tamanho={14} />
      Abaixo do alerta
    </span>
  )
}

function Rotulado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="ivo-legenda text-texto-suave">{rotulo}</p>
      <p className="font-bold tabular-nums">{children}</p>
    </div>
  )
}

export function CartaoCreditoEmpresa({ e }: { e: EmpresaPainel }) {
  return (
    <Link
      to={`/adm/creditos/${e.empresa_id}`}
      viewTransition
      className={`block space-y-3 rounded-cartao border-[1.5px] bg-superficie p-4 shadow-[var(--sombra)] transition-colors hover:border-marinho-2 ${
        e.abaixo_alerta ? 'border-[var(--cor-laranja)]' : 'border-borda'
      }`}
      data-testid="credito-empresa"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate ivo-h3">{e.empresa_nome}</p>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {e.abaixo_alerta && <SeloAlerta />}
          {!e.tem_contrato && (
            <span className="rounded-full border border-borda px-2.5 py-0.5 text-xs font-bold text-texto-suave">Sem contrato</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Rotulado rotulo="Disponível">
          <Dinheiro centavos={e.disponivel_cent} />
        </Rotulado>
        <Rotulado rotulo="Reservado">
          <Dinheiro centavos={e.reservado_cent} />
        </Rotulado>
        <Rotulado rotulo="Limite">
          <Dinheiro centavos={e.limite_cent} />
        </Rotulado>
      </div>
    </Link>
  )
}

/** /adm/creditos — clientes e crédito: por empresa, do maior risco para o menor. */
export function Creditos() {
  const { dados, erro, recarregar } = useConsulta('adm-creditos', () => dinheiro.painel(null, null))
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Clientes e crédito"
        descricao="Saldo de cada empresa. Recarga, ajuste e estorno ficam no detalhe, sempre com motivo."
      />
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Carregando as empresas">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        )
      ) : dados.empresas.length === 0 ? (
        <EstadoVazio icone="predio" titulo="Nenhuma empresa cadastrada" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="lista-creditos">
          {ordenarPorRisco(dados.empresas).map((e) => (
            <li key={e.empresa_id}>
              <CartaoCreditoEmpresa e={e} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

// ------------------------------------------------------------------------------------------------
// Lançamentos do ADM (recarga, ajuste, estorno): formulário → confirmação com valores → servidor.
// ------------------------------------------------------------------------------------------------

type Operacao = { tipo: 'recarga' } | { tipo: 'ajuste' } | { tipo: 'estorno'; item: ItemExtrato }

const TITULO: Record<Operacao['tipo'], string> = { recarga: 'Recarga', ajuste: 'Ajuste de saldo', estorno: 'Estorno' }
const FEITO: Record<Operacao['tipo'], string> = { recarga: 'Recarga lançada', ajuste: 'Ajuste lançado', estorno: 'Estorno lançado' }

interface Pronto {
  efeito: number
  motivo: string
  comprovante: string | null
  assinatura: string
}

function Formulario({
  op,
  empresa,
  aoRevisar,
}: {
  op: Operacao
  empresa: string
  aoRevisar: (p: Pronto) => void
}) {
  const [valor, setValor] = useState('')
  const [credito, setCredito] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [comprovante, setComprovante] = useState('')
  const [erros, setErros] = useState<{ valor?: string; motivo?: string; comprovante?: string }>({})

  function revisar() {
    const e: typeof erros = {}
    const m = motivo.trim()
    const c = comprovante.trim()
    let efeito = 0
    if (op.tipo === 'estorno') {
      efeito = -op.item.efeito_contabil_cent
    } else {
      const v = reaisParaCentavos(valor)
      if (v === null || v <= 0) e.valor = 'Informe um valor maior que zero, em reais (ex.: 1.500,00).'
      else efeito = op.tipo === 'ajuste' && !credito ? -v : v
    }
    if (m.length < 3 || m.length > 500) e.motivo = 'Informe o motivo (de 3 a 500 caracteres).'
    if (c.length > 200) e.comprovante = 'Até 200 caracteres.'
    setErros(e)
    if (Object.keys(e).length > 0) return
    const alvo = op.tipo === 'estorno' ? `lancamento:${op.item.id}` : `empresa:${empresa}`
    aoRevisar({
      efeito,
      motivo: m,
      comprovante: op.tipo === 'recarga' && c ? c : null,
      assinatura: [op.tipo, alvo, efeito, m, c].join('|'),
    })
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        revisar()
      }}
    >
      {op.tipo === 'estorno' ? (
        <div className="space-y-1 rounded-xl bg-fundo p-3" data-testid="estorno-lancamento">
          <p className="font-bold">{ROTULO_TIPO[op.item.tipo]}</p>
          <p className="ivo-legenda text-texto-suave tabular-nums">{formatarDataHora(op.item.criado_em)}</p>
          <p className="tabular-nums">Valor original: {formatarComSinal(op.item.efeito_contabil_cent)}</p>
          <p className="ivo-legenda text-texto-suave">O estorno lança o valor oposto. Cada lançamento só pode ser estornado uma vez.</p>
        </div>
      ) : (
        <>
          {op.tipo === 'ajuste' && (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 ivo-legenda font-semibold">Tipo de ajuste</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de ajuste">
                {[
                  { v: true, r: 'Crédito', d: 'aumenta o saldo' },
                  { v: false, r: 'Débito', d: 'diminui o saldo' },
                ].map((o) => (
                  <button
                    key={o.r}
                    type="button"
                    role="radio"
                    aria-checked={credito === o.v}
                    onClick={() => setCredito(o.v)}
                    className={`min-h-14 rounded-xl border-[1.5px] px-3 text-left ${
                      credito === o.v ? 'border-marinho-2 bg-marinho-2 text-white' : 'border-borda bg-superficie'
                    }`}
                  >
                    <span className="block font-bold">{o.r}</span>
                    <span className="block ivo-legenda">{o.d}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <Campo
            rotulo="Valor"
            prefixo="R$"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            erro={erros.valor}
            placeholder="0,00"
          />
        </>
      )}
      <AreaTexto rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} erro={erros.motivo} />
      {op.tipo === 'recarga' && (
        <Campo
          rotulo="Comprovante (opcional)"
          ajuda="ID do Pix ou uma observação."
          value={comprovante}
          onChange={(e) => setComprovante(e.target.value)}
          maxLength={200}
          erro={erros.comprovante}
        />
      )}
      <Botao type="submit" variante="principal" className="w-full">
        Revisar
      </Botao>
    </form>
  )
}

function LinhaConfirma({ rotulo, children, testid }: { rotulo: string; children: ReactNode; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-texto-suave">{rotulo}</dt>
      <dd className="text-right font-bold tabular-nums" data-testid={testid}>
        {children}
      </dd>
    </div>
  )
}

function ConteudoLancamento({
  op,
  empresa,
  empresaNome,
  saldo,
  aoConcluir,
}: {
  op: Operacao
  empresa: string
  empresaNome: string
  saldo: Saldo
  aoConcluir: (mensagem: string) => void
}) {
  const [pronto, setPronto] = useState<Pronto | null>(null)
  const [estado, setEstado] = useState<{ fase: 'confirmar' | 'processando' } | { fase: 'erro'; codigo: string }>({ fase: 'confirmar' })
  const [intencao] = useState(() => new Intencao())

  if (!pronto) return <Formulario op={op} empresa={empresa} aoRevisar={setPronto} />

  async function enviar(p: Pronto) {
    setEstado({ fase: 'processando' })
    const chave = intencao.chave(p.assinatura)
    const r =
      op.tipo === 'recarga'
        ? await dinheiro.recarga(empresa, p.efeito, p.motivo, p.comprovante, chave)
        : op.tipo === 'ajuste'
          ? await dinheiro.ajuste(empresa, p.efeito, p.motivo, chave)
          : await dinheiro.estorno(op.item.id, p.motivo, chave)
    if (r.ok) {
      intencao.encerrar()
      const disp = typeof r.disponivel_cent === 'number' ? ` Disponível agora: ${formatarCentavos(r.disponivel_cent)}.` : ''
      aoConcluir(`${FEITO[op.tipo]}: ${formatarComSinal(p.efeito)}.${disp}`)
      return
    }
    if (op.tipo === 'estorno' && r.codigo === 'JA_PROCESSADO') {
      aoConcluir('Este lançamento já tinha sido estornado.')
      return
    }
    setEstado({ fase: 'erro', codigo: r.codigo ?? 'ERRO_INESPERADO' })
  }

  if (estado.fase === 'processando') return <Processando texto="Lançando no servidor…" />

  const depois = saldoAposLancamento(saldo, pronto.efeito)
  const rede = estado.fase === 'erro' && semResposta({ ok: false, codigo: estado.codigo })
  const verbo = op.tipo === 'recarga' ? 'Confirmar recarga' : op.tipo === 'ajuste' ? 'Confirmar ajuste' : 'Confirmar estorno'
  return (
    <div className="space-y-4" data-testid="confirmar-lancamento">
      <dl className="divide-y divide-borda rounded-xl border border-borda px-3">
        <LinhaConfirma rotulo="Empresa">{empresaNome}</LinhaConfirma>
        <LinhaConfirma rotulo="Lançamento" testid="confirmar-valor">
          {TITULO[op.tipo]} {formatarComSinal(pronto.efeito)}
        </LinhaConfirma>
        <LinhaConfirma rotulo="Disponível" testid="confirmar-disponivel">
          <Dinheiro centavos={saldo.disponivel_cent} /> → <Dinheiro centavos={depois.disponivel_depois_cent} />
        </LinhaConfirma>
        <LinhaConfirma rotulo="Total contábil">
          <Dinheiro centavos={saldo.saldo_contabil_cent} /> → <Dinheiro centavos={depois.contabil_depois_cent} />
        </LinhaConfirma>
        <LinhaConfirma rotulo="Motivo">
          <span className="font-semibold break-words">{pronto.motivo}</span>
        </LinhaConfirma>
        {pronto.comprovante && <LinhaConfirma rotulo="Comprovante">{pronto.comprovante}</LinhaConfirma>}
      </dl>
      <p className="ivo-legenda text-texto-suave">
        O lançamento é definitivo e fica no extrato da empresa. Para corrigir depois, use ajuste ou estorno.
      </p>
      {estado.fase === 'erro' &&
        (rede ? (
          <Mensagem tipo="erro">
            Não conseguimos confirmar com o servidor. Toque em “Tentar de novo”: se o lançamento já tiver sido feito, ele não
            será duplicado.
          </Mensagem>
        ) : (
          <Mensagem tipo="erro">{mensagemDoCodigo(estado.codigo)}</Mensagem>
        ))}
      <div className="grid grid-cols-2 gap-3">
        {/* Depois de falha sem resposta não volta a editar: a nova tentativa precisa ser a MESMA intenção. */}
        {!rede && (
          <Botao
            onClick={() => {
              setPronto(null)
              setEstado({ fase: 'confirmar' })
            }}
          >
            Voltar
          </Botao>
        )}
        <Botao variante="principal" className={rede ? 'col-span-2' : ''} onClick={() => void enviar(pronto)}>
          {rede ? 'Tentar de novo' : verbo}
        </Botao>
      </div>
    </div>
  )
}

/** /adm/creditos/:empresa — saldo, recarga/ajuste/estorno e extrato com motivo, comprovante e autor. */
export function CreditoEmpresa() {
  const { empresa = '' } = useParams()
  const empresas = useConsulta('adm-empresas', api.empresas)
  const saldo = useSaldo(empresa, true)
  const [op, setOp] = useState<Operacao | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const nome = empresas.dados?.find((e) => e.id === empresa)?.nome ?? 'Empresa'

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="nao-imprimir space-y-1">
        <Link to="/adm/creditos" viewTransition className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-xl px-2 font-semibold text-marinho-2">
          <Icone nome="setaEsquerda" tamanho={20} />
          Clientes e crédito
        </Link>
        <CabecalhoTela sobretitulo="Clientes e crédito" titulo={nome} />
      </div>
      {aviso && (
        <div className="nao-imprimir">
          <Mensagem tipo="sucesso">{aviso}</Mensagem>
        </div>
      )}
      <div className="nao-imprimir grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        {saldo.dados ? (
          <CartaoSaldo saldo={saldo.dados} titulo={`Saldo de ${nome}`} />
        ) : saldo.erro ? (
          <ErroAoCarregar onTentar={saldo.recarregar} />
        ) : (
          <Skeleton className="h-52" />
        )}
        <Cartao className="grid gap-3 md:w-56">
          <Botao variante="principal" disabled={!saldo.dados} onClick={() => setOp({ tipo: 'recarga' })}>
            Recarga
          </Botao>
          <Botao disabled={!saldo.dados} onClick={() => setOp({ tipo: 'ajuste' })}>
            Ajuste
          </Botao>
          <p className="ivo-legenda text-texto-suave">Para estornar, use “Estornar” no lançamento do extrato.</p>
        </Cartao>
      </div>

      <h2 className="nao-imprimir ivo-h2">Extrato</h2>
      <ExtratoEmpresa
        empresa={empresa}
        empresaIdTopico={empresa}
        empresaNome={nome}
        adm
        versao={versao}
        aoEstornar={(item) => setOp({ tipo: 'estorno', item })}
      />

      <Folha aberta={op !== null} titulo={op ? TITULO[op.tipo] : ''} sobretitulo={nome} onFechar={() => setOp(null)}>
        {op && saldo.dados && (
          <ConteudoLancamento
            op={op}
            empresa={empresa}
            empresaNome={nome}
            saldo={saldo.dados}
            aoConcluir={(m) => {
              setOp(null)
              setAviso(m)
              saldo.recarregar()
              setVersao((v) => v + 1)
            }}
          />
        )}
      </Folha>
    </main>
  )
}
