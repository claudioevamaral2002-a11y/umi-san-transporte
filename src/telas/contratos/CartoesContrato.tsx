import type { ReactNode } from 'react'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import {
  descreverFaixas,
  formatarValor,
  GRUPOS,
  type DefinicaoCampo,
  type Faixa,
  type ValoresContrato,
  type VersaoContrato,
} from '../../lib/contratos.ts'
import { formatarDataHora } from '../../lib/valores.ts'

export function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-borda py-2.5 last:border-b-0">
      <dt className="ivo-corpo text-texto-suave">{rotulo}</dt>
      <dd className="text-right font-bold whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  )
}

/** Valores de uma lista de campos (dinheiro com o componente de dinheiro; o resto formatado). */
export function ListaValores<T extends Partial<Record<DefinicaoCampo['campo'], number>>>({
  campos,
  valores,
}: {
  campos: DefinicaoCampo[]
  valores: T
}) {
  return (
    <dl>
      {campos.map((c) => {
        const v = valores[c.campo] ?? 0
        return (
          <Linha key={c.campo} rotulo={c.rotulo}>
            {c.tipo === 'dinheiro' ? <Dinheiro centavos={v} /> : formatarValor(c.tipo, v)}
          </Linha>
        )
      })}
    </dl>
  )
}

/** Faixas de cancelamento em frases, uma por linha. */
export function FaixasCancelamento({ faixas }: { faixas: Faixa[] }) {
  return (
    <ul className="mt-2 space-y-2" data-testid="faixas-cancelamento">
      {descreverFaixas(faixas).map((t) => (
        <li key={t} className="flex items-start gap-2.5 rounded-xl bg-fundo px-3 py-2.5 tabular-nums">
          <Icone nome="relogio" tamanho={18} className="mt-0.5 shrink-0 text-marinho-2" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** Os quatro cartões de um contrato (ADM): modalidades, regras e crédito da empresa. */
export function CartoesContrato({ versao }: { versao: ValoresContrato }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {GRUPOS.map((g) => (
        <Cartao key={g.id} className="space-y-1" data-testid={`cartao-${g.id}`}>
          <h2 className="ivo-h3">{g.titulo}</h2>
          <p className="ivo-legenda text-texto-suave">{g.descricao}</p>
          {g.id === 'regras' && (
            <section aria-label="Cancelamento" className="pt-2">
              <h3 className="font-bold">Cancelamento</h3>
              <p className="ivo-legenda text-texto-suave">Multa sobre o valor aprovado, pela antecedência do aviso.</p>
              <FaixasCancelamento faixas={versao.faixas_cancelamento} />
            </section>
          )}
          <div className="pt-1">
            <ListaValores campos={g.campos} valores={versao} />
          </div>
        </Cartao>
      ))}
    </div>
  )
}

function Selo({ cor, icone, children }: { cor: string; icone: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
      style={{ color: cor, borderColor: cor }}
    >
      <span aria-hidden="true">{icone}</span>
      {children}
    </span>
  )
}

export const SeloVigente = () => (
  <Selo cor="var(--status-concluida)" icone="✓">
    Vigente
  </Selo>
)
export const SeloAgendada = () => (
  <Selo cor="var(--status-agendada)" icone="▣">
    Agendada
  </Selo>
)
export const SeloSemContrato = () => (
  <Selo cor="var(--status-aguardando)" icone="!">
    Sem contrato
  </Selo>
)

/** Histórico de versões (ADM): versão, vigência, autor. */
export function Historico({
  historico,
  vigente,
  agora,
}: {
  historico: VersaoContrato[]
  vigente: VersaoContrato | null
  agora: number
}) {
  return (
    <section aria-labelledby="titulo-historico" className="space-y-2">
      <h2 id="titulo-historico" className="px-1 ivo-sobretitulo text-texto-suave">
        Histórico de versões
      </h2>
      <Cartao className="p-0">
        <ul data-testid="historico-contrato">
          {historico.map((v) => {
            const futura = new Date(v.vigente_desde).getTime() > agora
            return (
              <li key={v.versao} className="space-y-1 border-b border-borda px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold tabular-nums">Versão {v.versao}</span>
                  {vigente?.versao === v.versao && <SeloVigente />}
                  {futura && <SeloAgendada />}
                </div>
                <p className="ivo-legenda text-texto-suave">
                  Vigente desde <span className="tabular-nums text-texto">{formatarDataHora(v.vigente_desde)}</span>
                  {v.publicado_por_nome && (
                    <>
                      {' · '}publicada por <span className="text-texto">{v.publicado_por_nome}</span>
                    </>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      </Cartao>
    </section>
  )
}
