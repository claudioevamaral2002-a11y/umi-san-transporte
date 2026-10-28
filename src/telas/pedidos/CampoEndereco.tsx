import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { criarSessaoDeBusca, type Local, type Sugestao } from '../../lib/enderecos.ts'
import { buscarSugestoes, detalhar, type ResultadoBusca } from '../../lib/enderecosRemoto.ts'

export type ValorEndereco = { texto: string; local: Local | null }

export const AVISO_SEM_BUSCA = 'Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km.'

const ESPERA_MS = 250
const FECHAR_APOS_MS = 200

/**
 * Fase 3A: campo de origem/destino com sugestões (padrão ARIA combobox + listbox). Locais da empresa primeiro (desde
 * 0 letras, ao focar; com o campo vazio, "Últimos lugares" desde a v2.2.1), depois o Google (3 letras ou mais, 250 ms
 * sem digitar), e no fim "Marcar no mapa". Escolher uma sugestão do Google busca as coordenadas na mesma sessão de
 * busca e a encerra; fechar sem escolher também encerra.
 * Se o Google não responder, o campo segue como texto livre, com aviso.
 */
export function CampoEndereco({
  rotulo,
  rotuloAcessivel,
  valor,
  aoMudar,
  aoMarcarNoMapa,
  erro,
  placeholder,
}: {
  /** App atual: "Origem"/"Destino"; app novo (fase 4.1): "De", "Parada" e "Para". */
  rotulo: string
  /** Nome do campo para leitores de tela quando o rótulo visível se repete (ex.: "Parada 2"). */
  rotuloAcessivel?: string
  valor: ValorEndereco
  aoMudar: (v: ValorEndereco) => void
  aoMarcarNoMapa: () => void
  erro?: string
  placeholder?: string
}) {
  const id = useId()
  const idLista = `${id}-lista`
  const sessao = useRef(criarSessaoDeBusca<ResultadoBusca>(undefined, buscarSugestoes))
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fechamento = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aberta, setAberta] = useState(false)
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [ativo, setAtivo] = useState(-1)
  const [indisponivel, setIndisponivel] = useState(false)
  const [detalhando, setDetalhando] = useState(false)
  // v2.2: cada digitação ou escolha conta uma mudança; o detalhe do Google que chega depois de outra mudança neste
  // campo é velho e não sobrescreve o que o cliente digitou ou escolheu.
  const mudancas = useRef(0)

  useEffect(
    () => () => {
      if (espera.current) clearTimeout(espera.current)
      if (fechamento.current) clearTimeout(fechamento.current)
    },
    [],
  )

  const daEmpresa = sugestoes.filter((s) => s.daEmpresa)
  const doGoogle = sugestoes.filter((s) => !s.daEmpresa)
  // Ordem das opções no teclado: empresa, Google e, por último, "Marcar no mapa".
  const opcoes: Array<Sugestao | 'mapa'> = [...daEmpresa, ...doGoogle, 'mapa']
  const idOpcao = (i: number) => `${id}-op-${i}`
  const listaVisivel = aberta && !(indisponivel && sugestoes.length === 0)

  async function buscar(texto: string) {
    const r = await sessao.current.buscar(texto)
    if (!r) return // resposta velha
    setSugestoes(r.sugestoes)
    setIndisponivel(r.indisponivel)
    setAtivo(-1)
  }

  function agendarBusca(texto: string) {
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => void buscar(texto), ESPERA_MS)
  }

  function fechar(encerrar = true) {
    if (espera.current) clearTimeout(espera.current)
    setAberta(false)
    setAtivo(-1)
    // Sessão abandonada: a próxima busca começa outra (reaproveitar o token faria o Google cobrar cada chamada).
    if (encerrar) sessao.current.encerrar()
  }

  async function escolher(opcao: Sugestao | 'mapa') {
    // O detalhar usa o token da mesma sessão das sugestões; só depois a sessão é encerrada.
    const token = sessao.current.token()
    const minha = ++mudancas.current
    fechar(opcao === 'mapa' || opcao.daEmpresa)
    if (opcao === 'mapa') {
      aoMarcarNoMapa()
      return
    }
    if (opcao.daEmpresa) {
      const local: Local = { nome: opcao.nome, endereco: opcao.endereco, lat: opcao.lat, lng: opcao.lng, place_id: opcao.place_id }
      aoMudar({ texto: local.nome, local })
      return
    }
    aoMudar({ texto: opcao.nome, local: null })
    setDetalhando(true)
    const local = await detalhar(opcao.place_id, opcao.nome, token)
    sessao.current.encerrar()
    if (minha !== mudancas.current) return // o cliente já mudou o campo: resposta velha
    setDetalhando(false)
    if (local) aoMudar({ texto: local.nome, local })
    else setIndisponivel(true)
  }

  function teclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!listaVisivel) {
        setAberta(true)
        void buscar(valor.texto)
        return
      }
      const n = opcoes.length
      setAtivo((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n))
    } else if (e.key === 'Enter' && listaVisivel && ativo >= 0) {
      e.preventDefault()
      void escolher(opcoes[ativo]!)
    } else if (e.key === 'Escape' && aberta) {
      e.preventDefault()
      fechar()
    }
  }

  const contagem = sugestoes.length === 1 ? '1 sugestão' : sugestoes.length === 0 ? 'Nenhuma sugestão' : `${sugestoes.length} sugestões`
  // Sem `rotuloAcessivel` (app atual), o mesmo de sempre; com ele, um por campo ("endereco-parada-2").
  const testid = `endereco-${(rotuloAcessivel ?? rotulo).toLowerCase().replace(/\s+/g, '-')}`

  const item = (opcao: Sugestao, i: number) => (
    <li
      key={`${opcao.daEmpresa ? 'e' : 'g'}-${opcao.place_id ?? `${opcao.nome}-${i}`}`}
      id={idOpcao(i)}
      role="option"
      aria-selected={ativo === i}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void escolher(opcao)}
      className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${
        opcao.daEmpresa ? 'bg-selecao-suave' : ''
      } ${ativo === i ? 'ring-2 ring-acao ring-inset' : ''}`}
    >
      <Icone nome={opcao.daEmpresa ? 'predio' : 'local'} tamanho={20} className="mt-0.5 text-texto-suave" />
      <span className="min-w-0">
        <span className="block font-semibold text-texto">{opcao.nome}</span>
        {opcao.endereco && <span className="block ivo-legenda text-texto-suave">{opcao.endereco}</span>}
      </span>
    </li>
  )

  // v2.2.1: com o campo vazio, a lista mostra os últimos lugares usados pela empresa (o banco já os ordena assim).
  const tituloDaEmpresa = valor.texto.trim() === '' ? 'Últimos lugares' : 'Locais da empresa'

  const lista = () => (
    <ul
      id={idLista}
      role="listbox"
      aria-label={`Sugestões para ${rotuloAcessivel ?? rotulo}`}
      onMouseDown={(e) => e.preventDefault()}
      className="max-h-[60dvh] space-y-1 overflow-y-auto rounded-cartao border border-borda bg-superficie p-2 shadow-[var(--sombra)]"
    >
      {daEmpresa.length > 0 && (
        <li role="presentation">
          <p aria-hidden="true" className="px-3 pt-1 pb-1 ivo-legenda font-semibold text-texto-suave">
            {tituloDaEmpresa}
          </p>
          <ul role="group" aria-label={tituloDaEmpresa} className="space-y-1">
            {daEmpresa.map((s, i) => item(s, i))}
          </ul>
        </li>
      )}
      {doGoogle.length > 0 && (
        <li role="presentation">
          <p aria-hidden="true" className="px-3 pt-2 pb-1 ivo-legenda font-semibold text-texto-suave">
            Sugestões
          </p>
          <ul role="group" aria-label="Sugestões" className="space-y-1">
            {doGoogle.map((s, i) => item(s, daEmpresa.length + i))}
          </ul>
          {/* Atribuição exigida para resultados do Google mostrados fora de um mapa do Google. */}
          <p aria-hidden="true" className="px-3 pt-1 text-right text-[11px] text-texto-suave">
            Google Maps
          </p>
        </li>
      )}
      <li
        id={idOpcao(opcoes.length - 1)}
        role="option"
        aria-selected={ativo === opcoes.length - 1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void escolher('mapa')}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border-t border-borda px-3 py-3 font-semibold text-texto ${
          ativo === opcoes.length - 1 ? 'ring-2 ring-acao ring-inset' : ''
        }`}
      >
        <Icone nome="local" tamanho={20} className="text-texto-suave" />
        <span className="underline underline-offset-4">Não achou? Marcar no mapa</span>
      </li>
    </ul>
  )

  return (
    <div>
      <Campo
        rotulo={rotulo}
        aria-label={rotuloAcessivel}
        value={valor.texto}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={200}
        erro={erro}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listaVisivel}
        aria-controls={idLista}
        aria-activedescendant={listaVisivel && ativo >= 0 ? idOpcao(ativo) : undefined}
        onChange={(e) => {
          const texto = e.target.value
          mudancas.current++
          setDetalhando(false)
          aoMudar({ texto, local: null })
          setAberta(true)
          agendarBusca(texto)
        }}
        onFocus={() => {
          if (fechamento.current) clearTimeout(fechamento.current)
          if (valor.local) return
          setAberta(true)
          void buscar(valor.texto)
        }}
        onBlur={() => {
          // Fecha depois do toque terminar: fechar na hora encolhe a tela entre o toque e o clique, e o clique cairia
          // em outro lugar (ex.: o "Levar" logo abaixo).
          if (fechamento.current) clearTimeout(fechamento.current)
          fechamento.current = setTimeout(() => fechar(), FECHAR_APOS_MS)
        }}
        onKeyDown={teclar}
      />
      {listaVisivel && <div className="mt-2">{lista()}</div>}
      {valor.local?.endereco && (
        <p data-testid={testid} className="mt-1 ivo-legenda text-texto-suave">
          {valor.local.endereco}
        </p>
      )}
      {detalhando && <p className="mt-1 ivo-legenda text-texto-suave">Buscando o endereço…</p>}
      <p role="status" className="sr-only">
        {listaVisivel ? contagem : ''}
      </p>
      {indisponivel && (
        <div role="note" className="mt-2 flex items-start gap-2.5 rounded-campo bg-[var(--cor-laranja)]/10 px-3.5 py-3">
          <Icone nome="relogio" tamanho={20} className="mt-0.5 text-alerta-texto" />
          <p className="ivo-legenda text-texto">{AVISO_SEM_BUSCA}</p>
        </div>
      )}
    </div>
  )
}
