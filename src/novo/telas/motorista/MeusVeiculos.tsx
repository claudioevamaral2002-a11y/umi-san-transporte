import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Cartao } from '../../../design/componentes/Cartao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Segmentado } from '../../../design/componentes/Segmentado.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { EstadoVazio, ErroAoCarregar } from '../../../design/componentes/Tela.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import { NOMES_CATEGORIA, SITUACOES, veiculos, type SituacaoVeiculo, type Veiculo } from '../../../lib/veiculos.ts'

const OPCOES_SITUACAO = (Object.keys(SITUACOES) as SituacaoVeiculo[]).map((valor) => ({ valor, rotulo: SITUACOES[valor] }))

const fmtKg = new Intl.NumberFormat('pt-BR')

/** "Ativo · 4 lugares · 800 kg · reboque: prancha" */
function resumo(v: Veiculo): string {
  const partes = [SITUACOES[v.situacao], `${v.lugares} ${v.lugares === 1 ? 'lugar' : 'lugares'}`, `${fmtKg.format(v.carga_max_kg)} kg`]
  if (v.reboque_desc) partes.push(`reboque: ${v.reboque_desc}`)
  return partes.join(' · ')
}

/** Cartão do mockup 8: modelo, cor, placa, situação e as categorias que o veículo atende, como etiquetas. */
function CartaoVeiculo({
  v,
  adm,
  aoMudar,
}: {
  v: Veiculo
  adm: boolean
  aoMudar: (texto: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const parado = v.situacao !== 'ATIVO'

  // Sem mudança otimista: a situação mostrada é sempre a do servidor (relida depois da resposta).
  async function mudar(situacao: SituacaoVeiculo) {
    if (enviando || situacao === v.situacao) return
    setEnviando(true)
    setFalha(null)
    const r = await veiculos.mudarSituacao(v.id, situacao)
    setEnviando(false)
    if (r.ok) aoMudar(`${v.modelo} ${v.placa}: ${SITUACOES[situacao].toLowerCase()}.`)
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <li>
      <Cartao className={`space-y-3 ${parado ? 'border-[1.5px] border-dashed border-borda shadow-none' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">
              {v.modelo} {v.cor} ·{' '}
              <span className="rounded border border-borda px-1.5 tracking-wide">{v.placa}</span>
            </p>
            <p className="mt-0.5 ivo-legenda text-texto-suave">{resumo(v)}</p>
            {adm && v.motorista_nome && <p className="ivo-legenda text-texto-suave">Motorista: {v.motorista_nome}</p>}
          </div>
          <Link
            to={adm ? `/adm/veiculos/${v.id}` : `/veiculos/${v.id}`}
            aria-label={`Editar ${v.modelo} ${v.placa}`}
            className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
          >
            <Icone nome="lapis" tamanho={20} />
          </Link>
        </div>
        <ul aria-label="Categorias que atende" className="flex flex-wrap gap-1.5">
          {v.categorias.map((c) => (
            <li
              key={c}
              className={`rounded-full border px-2.5 py-0.5 ivo-legenda font-bold ${parado ? 'border-borda text-texto-suave' : 'border-marinho-2 text-texto'}`}
            >
              {NOMES_CATEGORIA[c]}
            </li>
          ))}
        </ul>
        <fieldset disabled={enviando} className="space-y-1.5">
          <legend className="sr-only">Situação</legend>
          <Segmentado
            rotulo={`Situação de ${v.modelo} ${v.placa}`}
            opcoes={OPCOES_SITUACAO}
            valor={v.situacao}
            aoMudar={(s) => void mudar(s)}
          />
        </fieldset>
        {v.situacao === 'MANUTENCAO' && (
          <p className="ivo-legenda text-texto-suave">Em manutenção, o veículo não aparece na chamada.</p>
        )}
        <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      </Cartao>
    </li>
  )
}

/** Lista de veículos: os do motorista (Meus veículos) ou os de todos os motoristas (Veículos do ADM). */
export function ListaDeVeiculos({ adm = false }: { adm?: boolean }) {
  const { dados, erro, recarregar } = useConsulta(adm ? 'novo-veiculos-adm' : 'novo-meus-veiculos', () => veiculos.meus())
  const local = useLocation()
  const [aviso, setAviso] = useState<string | null>(() => (local.state as { aviso?: string } | null)?.aviso ?? null)
  const novo = adm ? '/adm/veiculos/novo' : '/veiculos/novo'

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <header className="space-y-1">
        <h1 className="ivo-h2">{adm ? 'Veículos' : 'Meus veículos'}</h1>
        <p className="ivo-legenda text-texto-suave">
          {adm
            ? 'Os veículos de todos os motoristas. O que está em manutenção não aparece na chamada.'
            : 'Cada veículo diz que categorias atende. O que está em manutenção não aparece na chamada.'}
        </p>
      </header>
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando os veículos…
            </p>
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        )
      ) : dados.length === 0 ? (
        <EstadoVazio icone="caminhao" titulo="Nenhum veículo cadastrado">
          {adm ? 'Cadastre o veículo de um motorista.' : 'Cadastre o seu veículo para receber chamadas.'}
        </EstadoVazio>
      ) : (
        <ul aria-label="Veículos" className="space-y-3">
          {dados.map((v) => (
            <CartaoVeiculo
              key={v.id}
              v={v}
              adm={adm}
              aoMudar={(t) => {
                setAviso(t)
                recarregar()
              }}
            />
          ))}
        </ul>
      )}
      <Link
        to={novo}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-botao bg-acao px-5 ivo-botao text-acao-texto"
      >
        <Icone nome="mais" tamanho={20} />
        Cadastrar veículo
      </Link>
    </main>
  )
}

/** Mockup 8: os veículos do motorista. */
export function MeusVeiculos() {
  return <ListaDeVeiculos />
}
