import { useState } from 'react'
import { CampoSelecao } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { api, type Empresa } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { MODALIDADE_CLIENTE, MODALIDADE_PROPRIO, PRAZOS } from '../../lib/contratos.ts'
import { ListaValores } from '../contratos/CartoesContrato.tsx'

/** Preços e prazos do contrato vigente de uma empresa (sem limites, versão, autor ou fotos). */
function PrecosDaEmpresa({ empresa }: { empresa: Empresa }) {
  const { dados, erro, carregando, recarregar } = useConsulta(`motorista-precos-${empresa.id}`, () =>
    api.precosParaOrcar(empresa.id),
  )

  if (erro && dados === undefined) return <ErroAoCarregar onTentar={recarregar} />
  if (carregando && dados === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Carregando os preços">
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (!dados) {
    return (
      <EstadoVazio icone="tabela" titulo="Sem contrato vigente">
        {empresa.nome} ainda não tem contrato vigente com a IVO Transportes. Os pedidos dela não podem ser orçados.
      </EstadoVazio>
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="precos-para-orcar">
      {[MODALIDADE_PROPRIO, MODALIDADE_CLIENTE].map((g) => (
        <Cartao key={g.id} className="space-y-1" data-testid={`cartao-${g.id}`}>
          <h2 className="ivo-h3">{g.titulo}</h2>
          <p className="ivo-legenda text-texto-suave">{g.descricao}</p>
          <div className="pt-1">
            <ListaValores campos={g.campos} valores={dados} />
          </div>
        </Cartao>
      ))}
      <Cartao className="space-y-1 md:col-span-2" data-testid="cartao-prazos">
        <h2 className="ivo-h3">Prazos</h2>
        <p className="ivo-legenda text-texto-suave">Valem para as duas modalidades.</p>
        <div className="pt-1">
          <ListaValores campos={PRAZOS} valores={dados} />
        </div>
      </Cartao>
    </div>
  )
}

/**
 * Motorista: o que usa para orçar (preços unitários das modalidades e prazos do contrato da empresa).
 * Na v1 há uma empresa só na prática; o seletor aparece quando houver mais de uma.
 */
export function Tabela() {
  const { dados: empresas, erro, carregando, recarregar } = useConsulta('motorista-empresas', api.empresas)
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const empresa = empresas?.find((e) => e.id === escolhida) ?? empresas?.[0] ?? null

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={empresa && (empresas?.length ?? 0) <= 1 ? empresa.nome : 'Preços para orçar'}
        titulo="Tabela"
        descricao="Preços unitários do contrato da empresa. No orçamento, você preenche só as quantidades."
      />

      {erro && !empresas && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !empresas && <Skeleton className="h-56" />}

      {empresas && empresas.length === 0 && (
        <EstadoVazio icone="predio" titulo="Nenhuma empresa cliente">
          Quando a IVO Transportes cadastrar uma empresa com contrato, os preços aparecem aqui.
        </EstadoVazio>
      )}

      {empresas && empresas.length > 1 && (
        <CampoSelecao rotulo="Empresa" value={empresa?.id ?? ''} onChange={(e) => setEscolhida(e.target.value)}>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </CampoSelecao>
      )}

      {empresa && <PrecosDaEmpresa key={empresa.id} empresa={empresa} />}
    </main>
  )
}
