import { useRef, useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { api } from '../../lib/api.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import {
  diferencas,
  formularioDe,
  GRUPOS,
  MAX_FAIXAS,
  validarFormulario,
  type CampoNumerico,
  type DefinicaoCampo,
  type ErrosFormulario,
  type FormularioParametros,
  type ValoresParametros,
  type VersaoParametros,
} from '../../lib/parametros.ts'
import { deEntradaDataHora, formatarDataHora, paraEntradaDataHora } from '../../lib/valores.ts'

const ANO_MS = 365 * 24 * 3600_000

const ENTRADA: Record<DefinicaoCampo['tipo'], { inputMode: 'decimal' | 'numeric'; prefixo?: string; sufixo?: string; placeholder: string }> = {
  dinheiro: { inputMode: 'decimal', prefixo: 'R$', placeholder: '0,00' },
  percentual: { inputMode: 'decimal', sufixo: '%', placeholder: '0' },
  horas: { inputMode: 'numeric', sufixo: 'h', placeholder: '0' },
  dias: { inputMode: 'numeric', sufixo: 'dias', placeholder: '0' },
}

function validarVigencia(valor: string): { data: Date } | { erro: string } {
  const data = deEntradaDataHora(valor)
  if (!data) return { erro: 'Informe a data e a hora.' }
  if (data.getTime() < Date.now() - 60_000) return { erro: 'A vigência precisa ser agora ou no futuro.' }
  if (data.getTime() > Date.now() + ANO_MS) return { erro: 'A vigência pode ser no máximo 1 ano à frente.' }
  return { data }
}

interface Revisao {
  valores: ValoresParametros
  vigencia: Date
}

function Conteudo({
  base,
  onPublicado,
  onCancelar,
}: {
  base: VersaoParametros | null
  onPublicado: (texto: string) => void
  onCancelar: () => void
}) {
  const [form, setForm] = useState<FormularioParametros>(() => formularioDe(base))
  const [vigencia, setVigencia] = useState(() => paraEntradaDataHora(new Date(Date.now() + 5 * 60_000)))
  const [erros, setErros] = useState<ErrosFormulario & { vigencia?: string }>({})
  const [revisao, setRevisao] = useState<Revisao | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const formulario = useRef<HTMLFormElement>(null)
  const topo = useRef<HTMLDivElement>(null)

  const mudarCampo = (campo: CampoNumerico, valor: string) =>
    setForm((f) => ({ ...f, campos: { ...f.campos, [campo]: valor } }))
  const mudarFaixa = (i: number, parte: 'horas' | 'multa', valor: string) =>
    setForm((f) => ({ ...f, faixas: f.faixas.map((x, j) => (j === i ? { ...x, [parte]: valor } : x)) }))

  function revisar(e: FormEvent) {
    e.preventDefault()
    setFalha(null)
    const r = validarFormulario(form)
    const v = validarVigencia(vigencia)
    const novos = { ...(r.ok ? {} : r.erros), ...('erro' in v ? { vigencia: v.erro } : {}) }
    setErros(novos)
    if (!r.ok || 'erro' in v) {
      // Leva o foco ao primeiro campo com problema.
      requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setRevisao({ valores: r.valores, vigencia: v.data })
    requestAnimationFrame(() => topo.current?.focus())
  }

  async function publicar() {
    if (!revisao || enviando) return
    setEnviando(true)
    setFalha(null)
    // Sem atualização otimista: a tela só muda com a confirmação do servidor.
    const r = await api.publicarParametros(revisao.valores, revisao.vigencia, base?.retencao_fotos_dias ?? null)
    setEnviando(false)
    if (r.ok) {
      onPublicado(`Versão ${String(r.versao)} publicada. Vale a partir de ${formatarDataHora(revisao.vigencia)}.`)
    } else {
      setFalha(mensagemDoCodigo(r.codigo))
    }
  }

  if (revisao) {
    const lista = diferencas(base, revisao.valores)
    const mudaram = lista.filter((d) => d.mudou).length
    return (
      <div className="space-y-4" data-testid="confirmacao-parametros">
        <div ref={topo} tabIndex={-1} className="space-y-1 outline-none">
          <p className="ivo-corpo">
            Passa a valer em <strong className="tabular-nums">{formatarDataHora(revisao.vigencia)}</strong> (horário de
            Brasília).
          </p>
          <p className="ivo-legenda text-texto-suave">
            {base
              ? mudaram === 0
                ? 'Nenhum valor muda em relação à versão atual.'
                : `${mudaram} ${mudaram === 1 ? 'item muda' : 'itens mudam'} em relação à versão ${base.versao}.`
              : 'Primeira versão da tabela.'}
          </p>
        </div>
        <ul className="divide-y divide-borda rounded-cartao border-[1.5px] border-borda">
          {lista.map((d) => (
            <li
              key={d.campo}
              className={`px-3.5 py-2.5 ${d.mudou && base ? 'border-l-4 border-l-[var(--cor-laranja)] bg-[rgb(255_106_0/0.06)]' : ''}`}
              data-mudou={d.mudou ? 'sim' : 'nao'}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="ivo-legenda font-semibold">{d.rotulo}</span>
                {d.mudou && base && <span className="ivo-sobretitulo text-alerta-texto">Alterado</span>}
              </div>
              <p className="tabular-nums">
                {d.mudou && d.antes !== null && (
                  <>
                    <span className="text-texto-suave line-through">{d.antes}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> passa a </span>
                  </>
                )}
                <span className="font-bold">{d.depois}</span>
              </p>
            </li>
          ))}
        </ul>
        <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Botao onClick={() => setRevisao(null)} disabled={enviando}>
            Voltar e editar
          </Botao>
          <Botao variante="principal" onClick={() => void publicar()} disabled={enviando}>
            {enviando ? 'Publicando…' : 'Publicar versão'}
          </Botao>
        </div>
      </div>
    )
  }

  const mostrados = new Set<CampoNumerico>()
  const totalErros = Object.keys(erros).length
  return (
    <form ref={formulario} onSubmit={revisar} noValidate className="space-y-5">
      <div aria-live="polite">
        {totalErros > 0 && (
          <Mensagem tipo="erro">
            {totalErros === 1 ? 'Há 1 campo para corrigir.' : `Há ${totalErros} campos para corrigir.`}
          </Mensagem>
        )}
      </div>

      {GRUPOS.map((g) => {
        const campos = g.campos.filter((c) => !mostrados.has(c.campo))
        const repetidos = g.campos.filter((c) => mostrados.has(c.campo))
        campos.forEach((c) => mostrados.add(c.campo))
        return (
          <fieldset key={g.id} className="space-y-3">
            <legend className="mb-1 ivo-sobretitulo text-texto-suave">{g.titulo}</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {campos.map((c) => {
                const e = ENTRADA[c.tipo]
                return (
                  <Campo
                    key={c.campo}
                    name={c.campo}
                    rotulo={c.rotulo}
                    ajuda={c.ajuda}
                    erro={erros[c.campo]}
                    inputMode={e.inputMode}
                    prefixo={e.prefixo}
                    sufixo={e.sufixo}
                    placeholder={e.placeholder}
                    autoComplete="off"
                    value={form.campos[c.campo]}
                    onChange={(ev) => mudarCampo(c.campo, ev.target.value)}
                  />
                )
              })}
            </div>
            {repetidos.length > 0 && (
              <p className="ivo-legenda text-texto-suave">
                {repetidos.map((c) => c.rotulo).join(', ')}: o mesmo valor do veículo próprio.
              </p>
            )}
            {g.id === 'comuns' && (
              <div className="space-y-2 pt-1">
                <p className="ivo-legenda font-semibold">Faixas de cancelamento</p>
                <p id="ajuda-faixas" className="ivo-legenda text-texto-suave">
                  Da maior para a menor antecedência. A última começa em 0 h e vale até o horário do serviço.
                </p>
                <ol className="space-y-2" aria-describedby="ajuda-faixas">
                  {form.faixas.map((f, i) => (
                    <li key={i} className="flex items-end gap-2 rounded-xl bg-fundo p-2.5">
                      <Campo
                        className="flex-1"
                        rotulo={`Faixa ${i + 1}: a partir de`}
                        inputMode="numeric"
                        sufixo="h"
                        autoComplete="off"
                        value={f.horas}
                        aria-invalid={erros.faixas ? true : undefined}
                        onChange={(ev) => mudarFaixa(i, 'horas', ev.target.value)}
                      />
                      <Campo
                        className="flex-1"
                        rotulo="multa de"
                        inputMode="decimal"
                        sufixo="%"
                        autoComplete="off"
                        value={f.multa}
                        aria-invalid={erros.faixas ? true : undefined}
                        onChange={(ev) => mudarFaixa(i, 'multa', ev.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`Remover faixa ${i + 1}`}
                        disabled={form.faixas.length <= 1}
                        onClick={() => setForm((x) => ({ ...x, faixas: x.faixas.filter((_, j) => j !== i) }))}
                        className="flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60 disabled:opacity-40"
                      >
                        <Icone nome="lixeira" />
                      </button>
                    </li>
                  ))}
                </ol>
                {erros.faixas && (
                  <p role="alert" className="ivo-legenda font-semibold text-[var(--status-cancelada)]">
                    {erros.faixas}
                  </p>
                )}
                <Botao
                  className="flex items-center gap-2"
                  disabled={form.faixas.length >= MAX_FAIXAS}
                  onClick={() => setForm((x) => ({ ...x, faixas: [...x.faixas, { horas: '0', multa: '' }] }))}
                >
                  <Icone nome="mais" tamanho={20} />
                  Adicionar faixa
                </Botao>
              </div>
            )}
          </fieldset>
        )
      })}

      <fieldset className="space-y-3">
        <legend className="mb-1 ivo-sobretitulo text-texto-suave">Vigência</legend>
        <Campo
          type="datetime-local"
          name="vigente_desde"
          rotulo="Vale a partir de"
          ajuda="Horário de Brasília. Orçamentos criados antes continuam com os valores antigos."
          erro={erros.vigencia}
          value={vigencia}
          onChange={(ev) => setVigencia(ev.target.value)}
        />
      </fieldset>

      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-borda bg-superficie px-4 py-3 md:-mx-6 md:flex-row md:justify-end md:px-6">
        <Botao onClick={onCancelar}>Cancelar</Botao>
        <Botao type="submit" variante="principal">
          Revisar e publicar
        </Botao>
      </div>
    </form>
  )
}

export function PublicarParametros({
  aberta,
  base,
  onFechar,
  onPublicado,
}: {
  aberta: boolean
  base: VersaoParametros | null
  onFechar: () => void
  onPublicado: (texto: string) => void
}) {
  return (
    <Folha aberta={aberta} onFechar={onFechar} sobretitulo="Tabela de preços e regras" titulo="Publicar nova versão" largura="md:max-w-2xl">
      <Conteudo base={base} onPublicado={onPublicado} onCancelar={onFechar} />
    </Folha>
  )
}
