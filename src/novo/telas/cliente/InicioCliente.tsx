import { useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import type { Local } from '../../../lib/enderecos.ts'
import { pontoDaRota } from '../../../lib/enderecosRemoto.ts'
import { MAX_PARADAS } from '../../../lib/paradas.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { saudacao } from '../../../lib/tempo.ts'
import { CampoEndereco, type ValorEndereco } from '../../../telas/pedidos/CampoEndereco.tsx'
import { FolhaMarcarNoMapa } from '../../../telas/pedidos/FolhaMarcarNoMapa.tsx'
import { podeCriarPedido, usePedidoIndisponivel } from '../../../telas/pedidos/Pedidos.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { lerPedirDaqui, lerPedirDeNovo } from '../../pedirDeNovo.ts'
import { EscolherCategoria, type EnderecoEscolhido } from './EscolherCategoria.tsx'

const VAZIO: ValorEndereco = { texto: '', local: null }

const temPonto = (v: ValorEndereco): v is EnderecoEscolhido => !!v.local && pontoDaRota(v.local) !== null

/** Todos os pontos com local (origem, cada parada e destino): dá para traçar a rota e ver as categorias. */
const completo = (o: ValorEndereco, ps: readonly ValorEndereco[], d: ValorEndereco) => temPonto(o) && temPonto(d) && ps.every(temPonto)

const coordenadas = (l: Local | null) => (l && l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : undefined)

/** Campo do mapa aberto em "Marcar no mapa": origem, destino ou a parada de índice `n`. */
type AlvoDoMapa = 'origem' | 'destino' | number

/**
 * Mockup 1 (fase 4.1): início do cliente sobre o mapa. "De" começa vazio (os locais da empresa aparecem primeiro na
 * busca), "+ Adicionar parada" (até 3, cada uma com ×) e "Para". Cada campo busca os locais da empresa, depois o
 * Google, e "Marcar no mapa". Com todos os pontos, sobem as categorias (mockup 2). O N3 só acompanha: não vê o pedido.
 */
export function InicioCliente() {
  const { perfil } = useSessao()
  const [ola] = useState(() => saudacao(new Date()))
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0] ?? ''
  const pode = podeCriarPedido(perfil)
  const indisponivel = usePedidoIndisponivel(perfil)
  // "Pedir de novo" (fim da corrida): chega pelo estado da navegação com a rota e a categoria, sem data.
  const { state } = useLocation()
  const [de] = useState(() => lerPedirDeNovo(state))
  // v2.2: "Pedir daqui" (Locais salvos): o mesmo caminho, só com o De preenchido.
  const [origem, setOrigem] = useState<ValorEndereco>(() => de?.origem ?? lerPedirDaqui(state) ?? VAZIO)
  const [destino, setDestino] = useState<ValorEndereco>(de?.destino ?? VAZIO)
  const [paradas, setParadas] = useState<ValorEndereco[]>([])
  // Identidade estável de cada campo de parada (a `key`): remover a do meio não troca o estado dos outros campos.
  const [idsParadas, setIdsParadas] = useState<number[]>([])
  const proximoId = useRef(0)
  const [mapaPara, setMapaPara] = useState<AlvoDoMapa | null>(null)
  const [escolhendo, setEscolhendo] = useState(de !== null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const campos = useRef<HTMLDivElement>(null)

  useCamadasDoMapa(escolhendo ? {} : { centro: coordenadas(origem.local), destino: coordenadas(destino.local) })

  function mudar(o: ValorEndereco, ps: ValorEndereco[], d: ValorEndereco) {
    setOrigem(o)
    setParadas(ps)
    setDestino(d)
    if (completo(o, ps, d)) setEscolhendo(true)
  }
  const mudarOrigem = (v: ValorEndereco) => mudar(v, paradas, destino)
  const mudarDestino = (v: ValorEndereco) => mudar(origem, paradas, v)
  const mudarParada = (i: number, v: ValorEndereco) => mudar(origem, paradas.map((p, j) => (j === i ? v : p)), destino)

  /** Abre um campo de parada vazio (até 3) e põe o foco nele. */
  function adicionarParada() {
    if (paradas.length >= MAX_PARADAS) return
    const n = paradas.length + 1
    setParadas((ps) => [...ps, VAZIO])
    setIdsParadas((ids) => [...ids, proximoId.current++])
    setEscolhendo(false)
    requestAnimationFrame(() => campos.current?.querySelector<HTMLInputElement>(`input[aria-label="Parada ${n}"]`)?.focus())
  }
  /** Tira a parada `i` e leva o foco à parada seguinte (que passa a ser a `i`) ou, sem ela, ao "+ Adicionar parada". */
  function removerParada(i: number) {
    const seguinte = i + 1 < paradas.length
    setParadas((ps) => ps.filter((_, j) => j !== i))
    setIdsParadas((ids) => ids.filter((_, j) => j !== i))
    requestAnimationFrame(() =>
      campos.current
        ?.querySelector<HTMLElement>(seguinte ? `input[aria-label="Parada ${i + 1}"]` : '[data-adicionar-parada]')
        ?.focus(),
    )
  }

  if (pode && !indisponivel && escolhendo && temPonto(origem) && temPonto(destino) && paradas.every(temPonto)) {
    return (
      <EscolherCategoria
        origem={origem}
        destino={destino}
        paradas={paradas.filter(temPonto)}
        aoAdicionarParada={paradas.length < MAX_PARADAS ? adicionarParada : undefined}
        categoriaInicial={de?.categoria ?? undefined}
        diariasIniciais={de?.diarias}
        semData={de !== null}
        aoVoltar={() => {
          setEscolhendo(false)
          requestAnimationFrame(() => titulo.current?.focus())
        }}
      />
    )
  }

  const prontos = completo(origem, paradas, destino)
  const semLocal = [origem, ...paradas, destino].some((v) => v.texto.trim() !== '' && !v.local)
  return (
    <FolhaMapa rotulo="Pedir uma corrida">
      <h1 ref={titulo} tabIndex={-1} className="mb-3 ivo-h2 outline-none">
        {primeiroNome ? `${ola}, ${primeiroNome}` : ola}
      </h1>
      {!pode ? (
        <p className="ivo-corpo text-texto-suave">
          Seu perfil acompanha as corridas da empresa. Os pedidos são feitos por quem é solicitante.
        </p>
      ) : indisponivel ? (
        <div className="flex items-start gap-2.5 rounded-campo bg-fundo px-3.5 py-3" data-testid="pedido-indisponivel">
          <Icone nome="alerta" tamanho={20} className="mt-0.5 shrink-0 text-alerta-texto" />
          <p className="ivo-corpo">{indisponivel}</p>
        </div>
      ) : (
        <div ref={campos} className="space-y-3">
          <CampoEndereco
            rotulo="De"
            placeholder="De onde sai?"
            valor={origem}
            aoMudar={mudarOrigem}
            aoMarcarNoMapa={() => setMapaPara('origem')}
          />
          {paradas.map((p, i) => (
            <div key={idsParadas[i] ?? `p${i}`} className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <CampoEndereco
                  rotulo="Parada"
                  rotuloAcessivel={`Parada ${i + 1}`}
                  placeholder="Onde parar?"
                  valor={p}
                  aoMudar={(v) => mudarParada(i, v)}
                  aoMarcarNoMapa={() => setMapaPara(i)}
                />
              </div>
              <button
                type="button"
                onClick={() => removerParada(i)}
                aria-label={`Remover parada ${i + 1}`}
                className="mt-7 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave"
              >
                <Icone nome="fechar" tamanho={20} />
              </button>
            </div>
          ))}
          <CampoEndereco
            rotulo="Para"
            placeholder="Para onde?"
            valor={destino}
            aoMudar={mudarDestino}
            aoMarcarNoMapa={() => setMapaPara('destino')}
          />
          {paradas.length < MAX_PARADAS && (
            <button
              type="button"
              onClick={adicionarParada}
              data-adicionar-parada
              className="flex min-h-12 items-center font-semibold text-link underline underline-offset-4"
            >
              + Adicionar parada
            </button>
          )}
          {prontos ? (
            <Botao variante="principal" className="w-full" onClick={() => setEscolhendo(true)}>
              Ver categorias
            </Botao>
          ) : (
            semLocal ? (
              <p className="ivo-legenda text-texto-suave">Escolha um local da lista ou marque no mapa para ver o trajeto.</p>
            ) : null
          )}
        </div>
      )}
      <FolhaMarcarNoMapa
        aberta={mapaPara !== null}
        centro={coordenadas(origem.local) ?? null}
        aoFechar={() => setMapaPara(null)}
        aoUsar={(local) => {
          const v = { texto: local.nome, local }
          if (mapaPara === 'origem') mudarOrigem(v)
          else if (mapaPara === 'destino') mudarDestino(v)
          else if (mapaPara !== null) mudarParada(mapaPara, v)
          setMapaPara(null)
        }}
      />
    </FolhaMapa>
  )
}
