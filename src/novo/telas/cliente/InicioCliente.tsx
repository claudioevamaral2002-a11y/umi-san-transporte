import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import type { Local } from '../../../lib/enderecos.ts'
import { buscarSugestoes, pontoDaRota } from '../../../lib/enderecosRemoto.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { saudacao } from '../../../lib/tempo.ts'
import { CampoEndereco, type ValorEndereco } from '../../../telas/pedidos/CampoEndereco.tsx'
import { FolhaMarcarNoMapa } from '../../../telas/pedidos/FolhaMarcarNoMapa.tsx'
import { podeCriarPedido, usePedidoIndisponivel } from '../../../telas/pedidos/Pedidos.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { lerPedirDeNovo } from '../../pedirDeNovo.ts'
import { EscolherCategoria, type EnderecoEscolhido } from './EscolherCategoria.tsx'

const VAZIO: ValorEndereco = { texto: '', local: null }

const temPonto = (v: ValorEndereco): v is EnderecoEscolhido => !!v.local && pontoDaRota(v.local) !== null

const coordenadas = (l: Local | null) => (l && l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : undefined)

/**
 * Mockup 1: início do cliente sobre o mapa. A origem já vem com o local mais usado da empresa; "Para onde?" busca os
 * locais da empresa primeiro, depois o Google, e "Marcar no mapa". Com os dois pontos, sobem as categorias (mockup 2).
 * O N3 só acompanha: não vê o pedido.
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
  const [origem, setOrigem] = useState<ValorEndereco>(de?.origem ?? VAZIO)
  const [destino, setDestino] = useState<ValorEndereco>(de?.destino ?? VAZIO)
  const [mapaPara, setMapaPara] = useState<'origem' | 'destino' | null>(null)
  const [escolhendo, setEscolhendo] = useState(de !== null)
  const origemMexida = useRef(de !== null)
  const titulo = useRef<HTMLHeadingElement>(null)

  // Origem: o local mais usado da empresa (só os locais da empresa; nenhuma chamada ao Google).
  useEffect(() => {
    if (!pode) return
    let vivo = true
    void buscarSugestoes('', 'inicio').then((r) => {
      const l = r.sugestoes.find((s) => s.daEmpresa)
      if (!vivo || !l || !l.daEmpresa || origemMexida.current) return
      setOrigem({ texto: l.nome, local: { nome: l.nome, endereco: l.endereco, lat: l.lat, lng: l.lng, place_id: l.place_id } })
    })
    return () => {
      vivo = false
    }
  }, [pode])

  useCamadasDoMapa(escolhendo ? {} : { centro: coordenadas(origem.local), destino: coordenadas(destino.local) })

  function mudarOrigem(v: ValorEndereco) {
    origemMexida.current = true
    setOrigem(v)
    if (temPonto(v) && temPonto(destino)) setEscolhendo(true)
  }
  function mudarDestino(v: ValorEndereco) {
    setDestino(v)
    if (temPonto(v) && temPonto(origem)) setEscolhendo(true)
  }

  if (pode && !indisponivel && escolhendo && temPonto(origem) && temPonto(destino)) {
    return (
      <EscolherCategoria
        origem={origem}
        destino={destino}
        categoriaInicial={de?.categoria ?? undefined}
        idaEVoltaInicial={de?.idaEVolta}
        semData={de !== null}
        aoVoltar={() => {
          setEscolhendo(false)
          requestAnimationFrame(() => titulo.current?.focus())
        }}
      />
    )
  }

  const prontos = temPonto(origem) && temPonto(destino)
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
        <div className="space-y-3">
          <CampoEndereco
            rotulo="Destino"
            placeholder="Para onde?"
            valor={destino}
            aoMudar={mudarDestino}
            aoMarcarNoMapa={() => setMapaPara('destino')}
          />
          <CampoEndereco
            rotulo="Origem"
            placeholder="De onde sai?"
            valor={origem}
            aoMudar={mudarOrigem}
            aoMarcarNoMapa={() => setMapaPara('origem')}
          />
          {prontos ? (
            <Botao variante="principal" className="w-full" onClick={() => setEscolhendo(true)}>
              Ver categorias
            </Botao>
          ) : (
            (origem.texto.trim() !== '' && !origem.local) || (destino.texto.trim() !== '' && !destino.local) ? (
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
          else mudarDestino(v)
          setMapaPara(null)
        }}
      />
    </FolhaMapa>
  )
}
