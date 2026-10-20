import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto, Campo } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Interruptor } from '../../design/componentes/Interruptor.tsx'
import { MarcaAgora } from '../../design/componentes/MarcaAgora.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import type { PrecosParaOrcar } from '../../lib/contratos.ts'
import { formatarRota } from '../../lib/enderecos.ts'
import { rota } from '../../lib/enderecosRemoto.ts'
import { mensagemAoOrcar, mensagemDoCodigo } from '../../lib/erros.ts'
import {
  DIARIAS_MAX,
  ESPERA_MAX_MEIAS,
  KM_MAX_DECIMOS,
  MAX_OUTROS,
  formDaEntrada,
  kmParaTexto,
  meiasParaTexto,
  montarEntrada,
  textoParaKmDecimos,
  type FormOrcamento,
} from '../../lib/orcar.ts'
import { ErroLeitura, pedidos, type RespostaPedido } from '../../lib/pedidos.ts'
import { ROTULO_MODALIDADE, rotuloTrajeto } from '../../lib/situacao.ts'
import { formatarDuracao, formatarQuando, numeroPedido } from '../../lib/tempo.ts'
import { useAgora } from '../../lib/useAgora.ts'
import { deEntradaDataHora, formatarPercentual } from '../../lib/valores.ts'
import { Contador, Contagem, Escolhas, Memorial, Rota } from './componentes.tsx'
import { usePrevia } from './usePrevia.ts'

function Unitario({ centavos, por }: { centavos: number; por: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icone nome="cadeado" tamanho={13} />
      <span>
        × <Dinheiro centavos={centavos} />/{por}
      </span>
    </span>
  )
}

function Calculadora({ r, precos }: { r: RespostaPedido; precos: PrecosParaOrcar }) {
  const p = r.pedido
  const anterior = r.orcamento_anterior ?? null
  const navegar = useNavigate()
  // Revisão pedida: começa do orçamento anterior (o motorista só ajusta o que o cliente pediu).
  const [f, setF] = useState<FormOrcamento>(() => formDaEntrada(anterior?.entrada ?? null, p.modalidade, p.reboque))
  const [kmTexto, setKmTexto] = useState(() => kmParaTexto(f.kmDecimos))
  // Fase 3A: sem revisão, os km começam com a rota calculada agora (o app não guarda km nem coordenadas do Google).
  // Com Levar e Trazer o banco diz que são 2 trechos (ida e volta). O motorista confere e ajusta.
  const trechos = p.trechos_km === 2 ? 2 : 1
  const [rotaPedido, setRotaPedido] = useState<{ km: number; minutos: number | null } | null>(null)
  const kmTocado = useRef(false)
  const pontos = [p.origem_place_id, p.origem_lat, p.origem_lng, p.destino_place_id, p.destino_lat, p.destino_lng]
  const chavePontos = JSON.stringify(pontos)
  useEffect(() => {
    if (anterior || p.modalidade !== 'VEICULO_PROPRIO') return
    const [op, ola, olg, dp, dla, dlg] = JSON.parse(chavePontos) as Array<string | number | null | undefined>
    const ponto = (place: unknown, lat: unknown, lng: unknown) => ({
      place_id: typeof place === 'string' ? place : null,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
    })
    let vivo = true
    void rota(ponto(op, ola, olg), ponto(dp, dla, dlg)).then((r) => {
      if (!vivo || r.km === null) return
      setRotaPedido({ km: r.km, minutos: r.minutos })
      if (kmTocado.current) return
      const decimos = Math.round(r.km * trechos * 10)
      setF((a) => ({ ...a, kmDecimos: decimos }))
      setKmTexto(kmParaTexto(decimos))
    })
    return () => {
      vivo = false
    }
  }, [anterior, p.modalidade, chavePontos, trechos])
  const avisoKm = rotaPedido
    ? (() => {
        const t = formatarRota(rotaPedido.km, rotaPedido.minutos)
        const trecho = t.km.replace(' pela rota', '')
        if (trechos === 2) {
          const tempo = t.tempo ? `, ${t.tempo} cada trecho` : ''
          return `Estimado pela rota: ${trecho} por trecho, ${Math.round(rotaPedido.km * 2)} km ida e volta${tempo}. Confira.`
        }
        return `Estimado pela rota: ${[trecho, t.tempo].filter(Boolean).join(', ')}. Confira.`
      })()
    : null
  const [sugerir, setSugerir] = useState(false)
  const [sugerido, setSugerido] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [recusar, setRecusar] = useState(false)
  const kmValido = textoParaKmDecimos(kmTexto) !== null
  const montado = montarEntrada(f)
  const entrada = montado.ok && kmValido ? montado.entrada : null
  const previa = usePrevia(p.id, entrada)
  const proprio = f.modalidade === 'VEICULO_PROPRIO'
  const trechoUnico = !(p.levar && p.trazer)
  const agora = useAgora()
  const horarioSugerido = sugerir ? deEntradaDataHora(sugerido) : null
  const sugestaoInvalida = sugerir && (!horarioSugerido || horarioSugerido.getTime() <= agora.getTime())

  const mudar = (x: Partial<FormOrcamento>) => {
    if ('kmDecimos' in x) kmTocado.current = true
    setF((a) => ({ ...a, ...x }))
    setErroEnvio(null)
  }
  const mudarKm = (decimos: number) => {
    mudar({ kmDecimos: decimos })
    setKmTexto(kmParaTexto(decimos))
  }

  async function enviar() {
    if (!entrada || sugestaoInvalida) return
    setEnviando(true)
    setErroEnvio(null)
    const resposta = await pedidos.enviarOrcamento(p.id, entrada, horarioSugerido ? horarioSugerido.toISOString() : null)
    setEnviando(false)
    if (resposta.ok) {
      navegar(`/pedidos/${p.id}`, { replace: true, state: { aviso: 'Orçamento enviado. O cliente já pode ver o memorial.' } })
    } else {
      setErroEnvio(mensagemAoOrcar(resposta.codigo))
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-lg space-y-4 p-4">
        {anterior && (
          <div className="space-y-2" data-testid="revisao-pedida">
            <Mensagem tipo="info">
              Revisão pedida: {anterior.motivo_revisao ?? 'sem motivo informado'}
            </Mensagem>
            <p className="ivo-legenda text-texto-suave tabular-nums">
              Preenchido com a versão {anterior.versao} (<Dinheiro centavos={anterior.total_cent} />). Ajuste e envie de novo.
            </p>
          </div>
        )}
        <Escolhas
          rotulo="Modalidade"
          tamanho="largo"
          opcoes={(['VEICULO_PROPRIO', 'VEICULO_CLIENTE'] as const).map((v) => ({ valor: v, rotulo: ROTULO_MODALIDADE[v] }))}
          valor={f.modalidade}
          aoMudar={(modalidade) => mudar({ modalidade, diarias: modalidade === 'VEICULO_CLIENTE' && f.diarias === 0 ? 1 : f.diarias })}
        />
        {f.modalidade !== p.modalidade && (
          <p className="ivo-legenda font-semibold text-alerta-texto">
            O cliente pediu {ROTULO_MODALIDADE[p.modalidade].toLowerCase()}; o orçamento vai na modalidade escolhida aqui.
          </p>
        )}

        <Cartao className="divide-y divide-borda py-1" data-testid="quantidades">
          <p className="py-2 ivo-sobretitulo text-texto-suave">Quantidades</p>
          {proprio ? (
            <>
              <Contador
                rotulo="Km rodados"
                valor={f.kmDecimos}
                min={0}
                max={KM_MAX_DECIMOS}
                aoMudar={mudarKm}
                detalhe={
                  <>
                    <Unitario centavos={f.usaReboque ? precos.km_com_reboque_cent : precos.km_sem_reboque_cent} por="km" />
                    <span className="block">{p.levar && p.trazer ? 'Ida e volta' : 'Trecho único'}</span>
                  </>
                }
              >
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Quilometragem"
                  aria-invalid={!kmValido || undefined}
                  value={kmTexto}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    setKmTexto(e.target.value)
                    const d = textoParaKmDecimos(e.target.value)
                    if (d !== null) mudar({ kmDecimos: d })
                  }}
                  className="h-12 w-20 rounded-xl border-[1.5px] border-borda bg-superficie text-center text-lg font-bold tabular-nums outline-none focus:border-acao aria-[invalid=true]:border-[var(--status-cancelada)]"
                />
              </Contador>
              {!kmValido && <p className="pb-2 ivo-legenda text-[var(--status-cancelada)]">Km com até 1 casa decimal, por exemplo 120,5.</p>}
              {avisoKm && (
                <p data-testid="km-estimado" className="flex items-center gap-1.5 pb-2 ivo-legenda font-semibold text-alerta-texto">
                  <MarcaAgora tamanho={12} />
                  <span>{avisoKm}</span>
                </p>
              )}
              {trechoUnico && precos.retorno_trecho_unico_bp > 0 && (
                <p className="py-2 ivo-legenda text-texto-suave">
                  Trecho único: o servidor soma o retorno de {formatarPercentual(precos.retorno_trecho_unico_bp)} sobre os km.
                </p>
              )}
              <div className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-semibold">Reboque</p>
                  <p className="ivo-legenda text-texto-suave">
                    <Unitario centavos={precos.taxa_fixa_reboque_cent} por="taxa fixa" /> e km com reboque
                  </p>
                </div>
                <Interruptor ligado={f.usaReboque} rotulo="Usa reboque" onAlternar={() => mudar({ usaReboque: !f.usaReboque })} />
              </div>
              <Contador
                rotulo="Espera"
                valor={f.esperaMeias}
                min={0}
                max={ESPERA_MAX_MEIAS}
                aoMudar={(esperaMeias) => mudar({ esperaMeias })}
                formatar={(v) => `${meiasParaTexto(v)} h`}
                detalhe={<Unitario centavos={precos.hora_espera_cent} por="h" />}
              />
            </>
          ) : (
            <Contador
              rotulo="Diárias do motorista"
              valor={f.diarias}
              min={0}
              max={DIARIAS_MAX}
              aoMudar={(diarias) => mudar({ diarias })}
              detalhe={<Unitario centavos={precos.diaria_motorista_cent} por="diária" />}
            />
          )}
          <Contador
            rotulo="Hospedagem"
            valor={f.hospedagemDiarias}
            min={0}
            max={DIARIAS_MAX}
            aoMudar={(hospedagemDiarias) => mudar({ hospedagemDiarias })}
            formatar={(v) => (v === 1 ? '1 diária' : `${v} diárias`)}
            detalhe={<Unitario centavos={precos.hospedagem_diaria_cent} por="diária" />}
          />
          <div className="py-3">
            <Campo
              rotulo="Pedágio/balsa"
              prefixo="R$"
              inputMode="decimal"
              placeholder="0,00"
              value={f.pedagio}
              onChange={(e) => mudar({ pedagio: e.target.value })}
              erro={!montado.ok ? montado.erros.pedagio : undefined}
              ajuda="Valor estimado, cobrado como informado."
            />
          </div>
          <p className="flex items-center gap-2 py-3 ivo-legenda text-texto-suave" data-testid="precos-travados">
            <Icone nome="cadeado" tamanho={16} />
            Preços do contrato {p.empresa_nome} — não editáveis
          </p>
        </Cartao>

        <Cartao className="space-y-3" data-testid="outros">
          <div className="flex items-center justify-between">
            <p className="ivo-sobretitulo text-texto-suave">Outros</p>
            <span className="ivo-legenda text-texto-suave">
              {f.outros.length} de {MAX_OUTROS}
            </span>
          </div>
          <p className="ivo-legenda text-texto-suave">Custos fora da tabela, com descrição. Aparecem destacados para o cliente.</p>
          {f.outros.map((o, i) => (
            <div key={i} className="flex items-end gap-2">
              <Campo
                className="flex-1"
                rotulo={`Descrição ${i + 1}`}
                value={o.descricao}
                maxLength={120}
                onChange={(e) => mudar({ outros: f.outros.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })}
              />
              <Campo
                className="w-32"
                rotulo={`Valor ${i + 1}`}
                prefixo="R$"
                inputMode="decimal"
                value={o.valor}
                onChange={(e) => mudar({ outros: f.outros.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })}
              />
              <button
                type="button"
                aria-label={`Remover outro custo ${i + 1}`}
                onClick={() => mudar({ outros: f.outros.filter((_, j) => j !== i) })}
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
              >
                <Icone nome="lixeira" />
              </button>
            </div>
          ))}
          {!montado.ok && montado.erros.outros && (
            <p className="ivo-legenda font-semibold text-[var(--status-cancelada)]">{montado.erros.outros}</p>
          )}
          {f.outros.length < MAX_OUTROS && (
            <Botao className="flex w-full items-center justify-center gap-2" onClick={() => mudar({ outros: [...f.outros, { descricao: '', valor: '' }] })}>
              <Icone nome="mais" />
              Adicionar outro custo
            </Botao>
          )}
        </Cartao>

        <Cartao className="space-y-3">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 font-semibold">
            <input type="checkbox" checked={sugerir} onChange={(e) => setSugerir(e.target.checked)} className="size-5 accent-[var(--cor-marinho-2)]" />
            Sugerir outro horário
          </label>
          {sugerir && (
            <Campo
              rotulo="Horário sugerido"
              type="datetime-local"
              value={sugerido}
              onChange={(e) => setSugerido(e.target.value)}
              erro={sugerido && sugestaoInvalida ? 'Escolha um horário no futuro.' : undefined}
              ajuda="O cliente vê a sugestão junto do orçamento."
            />
          )}
        </Cartao>

        <Cartao className="space-y-3" data-testid="previa">
          {previa?.estado === 'ok' ? (
            previa.linhas.length > 0 ? (
              <Memorial linhas={previa.linhas} total={previa.total} />
            ) : (
              <p className="ivo-corpo text-texto-suave">Informe as quantidades para ver o memorial.</p>
            )
          ) : previa?.estado === 'erro' ? (
            <Mensagem tipo="erro">{previa.mensagem}</Mensagem>
          ) : (
            <p className="ivo-corpo text-texto-suave">{entrada ? 'Calculando…' : 'Confira os campos destacados.'}</p>
          )}
        </Cartao>

        {erroEnvio && <Mensagem tipo="erro">{erroEnvio}</Mensagem>}

        <Botao className="w-full !text-[var(--status-cancelada)]" onClick={() => setRecusar(true)}>
          Recusar pedido
        </Botao>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-borda bg-superficie/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-4">
          <div className="min-w-0 flex-1" data-testid="total-ao-vivo" aria-live="polite">
            <p className="ivo-legenda font-semibold text-texto-suave">Total do orçamento{previa?.estado === 'calculando' ? ', calculando…' : ''}</p>
            {previa?.estado === 'ok' ? (
              <Dinheiro centavos={previa.total} className="text-2xl font-extrabold" />
            ) : (
              <span className="text-2xl font-extrabold text-texto-suave">—</span>
            )}
          </div>
          <Botao
            variante="principal"
            onClick={() => void enviar()}
            disabled={!entrada || sugestaoInvalida || enviando || previa?.estado !== 'ok'}
          >
            {enviando ? 'Enviando…' : 'Enviar orçamento'}
          </Botao>
        </div>
      </div>

      <FolhaRecusar
        aberta={recusar}
        id={p.id}
        aoFechar={() => setRecusar(false)}
        aoConcluir={() => navegar(`/pedidos/${p.id}`, { replace: true, state: { aviso: 'Pedido recusado.' } })}
      />
    </>
  )
}

function FolhaRecusar({ aberta, id, aoFechar, aoConcluir }: { aberta: boolean; id: string; aoFechar: () => void; aoConcluir: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function confirmar() {
    const m = motivo.trim()
    if (m.length < 3) {
      setErro('Informe o motivo (de 3 a 500 caracteres).')
      return
    }
    setEnviando(true)
    const r = await pedidos.recusar(id, m)
    setEnviando(false)
    if (r.ok) aoConcluir()
    else setErro(mensagemDoCodigo(r.codigo))
  }
  return (
    <Folha aberta={aberta} titulo="Recusar pedido" onFechar={aoFechar}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void confirmar()
        }}
      >
        <p className="ivo-corpo text-texto-suave">O cliente vê o motivo e o horário fica livre.</p>
        <AreaTexto rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} required minLength={3} />
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        <Botao type="submit" variante="perigo" className="w-full" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Recusar pedido'}
        </Botao>
      </form>
    </Folha>
  )
}

/** Motorista atribuído / ADM: calculadora do orçamento (quantidades; preço e total sempre do servidor). */
export function Orcar() {
  const { id = '' } = useParams()
  const detalhe = useConsulta(`orcar-${id}`, () =>
    pedidos.detalhe(id).catch((e: unknown) => {
      if (e instanceof ErroLeitura && (e.codigo === 'NAO_ENCONTRADO' || e.codigo === 'SEM_PERMISSAO')) return null
      throw e
    }),
  )
  const empresa = detalhe.dados?.pedido.empresa_id ?? null
  const precos = useConsulta(`orcar-precos-${empresa ?? '-'}`, async () => (empresa ? api.precosParaOrcar(empresa) : null))
  const r = detalhe.dados

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="sobre-marinho border-b border-borda bg-comando px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-5 text-comando-texto">
        <div className="mx-auto max-w-lg space-y-2">
          <Link
            to={`/pedidos/${id}`}
            aria-label="Fechar e voltar ao pedido"
            className="-ml-3 flex size-12 items-center justify-center rounded-xl hover:bg-white/10"
          >
            <Icone nome="fechar" />
          </Link>
          <p className="ivo-legenda font-semibold text-bloco-suave">Orçar{r ? `, ${r.pedido.empresa_nome}` : ''}</p>
          <h1 className="ivo-h1 tabular-nums">{r ? `Pedido ${numeroPedido(r.pedido.numero)}` : 'Orçar pedido'}</h1>
          {r && (
            <>
              <div className="rounded-cartao bg-white/10 p-3">
                <Rota origem={r.pedido.origem} destino={r.pedido.destino} compacta />
                <p className="mt-2 ivo-legenda text-bloco-suave tabular-nums">
                  {formatarQuando(r.pedido.inicio)}, {formatarDuracao(r.pedido.duracao_min)}, {rotuloTrajeto(r.pedido.levar, r.pedido.trazer)}
                </p>
              </div>
              {r.acoes.orcar && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold text-bloco-alerta">
                  <Icone nome="relogio" tamanho={16} />
                  <Contagem anunciar prazo={r.pedido.prazo_orcar_ate} prefixo="Responder em" />
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {detalhe.dados === undefined ? (
        detalhe.erro ? (
          <main className="mx-auto w-full max-w-lg p-4">
            <ErroAoCarregar onTentar={detalhe.recarregar} />
          </main>
        ) : (
          <main className="mx-auto w-full max-w-lg space-y-4 p-4" aria-busy="true" aria-label="Carregando o pedido">
            <Skeleton className="h-64" />
            <Skeleton className="h-32" />
          </main>
        )
      ) : r === null ? (
        <main className="mx-auto w-full max-w-lg p-4">
          <EstadoVazio icone="busca" titulo="Pedido não encontrado">
            Ele não existe ou não está atribuído a você.
          </EstadoVazio>
        </main>
      ) : r && !r.acoes.orcar ? (
        <main className="mx-auto w-full max-w-lg p-4">
          <EstadoVazio icone="relogio" titulo="Este pedido não está aguardando orçamento">
            Ele mudou de situação ou o prazo venceu.{' '}
            <Link to={`/pedidos/${id}`} className="font-semibold text-link underline">
              Ver o pedido
            </Link>
          </EstadoVazio>
        </main>
      ) : precos.dados === undefined ? (
        <main className="mx-auto w-full max-w-lg space-y-4 p-4" aria-busy="true" aria-label="Carregando os preços">
          {precos.erro ? <ErroAoCarregar onTentar={precos.recarregar} /> : <Skeleton className="h-64" />}
        </main>
      ) : precos.dados === null ? (
        <main className="mx-auto w-full max-w-lg p-4">
          <EstadoVazio icone="tabela" titulo="Sem contrato vigente">
            {r!.pedido.empresa_nome} não tem contrato vigente. Este pedido não pode ser orçado agora.
          </EstadoVazio>
        </main>
      ) : (
        <main className="flex-1">
          <Calculadora r={r!} precos={precos.dados} />
        </main>
      )}
    </div>
  )
}
