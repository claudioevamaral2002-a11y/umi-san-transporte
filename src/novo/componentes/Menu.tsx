import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Icone, type NomeIcone } from '../../design/componentes/Icone.tsx'
import { Interruptor } from '../../design/componentes/Interruptor.tsx'
import { gereEquipe } from '../../lib/administracao.ts'
import type { Perfil } from '../../lib/estadoSessao.ts'
import { rotuloCurto, useRotulos, type Rotulos } from '../../lib/rotulos.tsx'
import { useSessao } from '../../lib/sessao.tsx'
import { gravarDisponivel, lerDisponivel } from '../disponivel.ts'
import { itemAtual } from '../navegacao.ts'

/** A v1 (o app anterior, em outra origem). Na v2, só o gestor de frota é mandado para lá (Ruling R13). */
export const APP_V1 = 'https://ivo-v1.pages.dev'

export interface ItemMenu {
  rotulo: string
  icone: NomeIcone
  /** Caminho do app novo. As telas de hoje (pedidos, agenda, extrato, equipe, /adm/*) abrem aqui dentro (Ruling R12). */
  para: string
  /** Nome da página (cabeçalho e h1), quando o rótulo do menu é uma descrição ("Minhas corridas e Pendências"). */
  titulo?: string
}

const PERFIL_E_SEGURANCA: ItemMenu = { rotulo: 'Perfil e segurança', icone: 'escudo', para: '/perfil' }
const AJUDA: ItemMenu = { rotulo: 'Ajuda', icone: 'conversa', para: '/ajuda' }
const PAINEL_EMPRESA: ItemMenu = { rotulo: 'Painel da empresa', icone: 'grafico', para: '/empresa' }

/** "Painel da empresa": o N1 (a própria empresa) e o ADM (qualquer empresa). Especificação §6.9. */
export const vePainelEmpresa = (p: Pick<Perfil, 'papel' | 'nivel'>) => p.papel === 'ADM' || gereEquipe(p)

/** Itens do menu ☰ por perfil (especificação §6.7). O interruptor "Disponível" do motorista fica à parte. */
export function itensDoMenu(p: Perfil): ItemMenu[] {
  switch (p.papel) {
    case 'CLIENTE':
      return [
        { rotulo: 'Minhas corridas', icone: 'lista', para: '/pedidos' },
        { rotulo: 'Agenda', icone: 'calendario', para: '/agenda' },
        { rotulo: 'Carteira da empresa', icone: 'dinheiro', para: '/extrato' },
        { rotulo: 'Locais salvos', icone: 'local', para: '/locais' },
        ...(gereEquipe(p) ? [{ rotulo: 'Equipe', icone: 'usuarios', para: '/equipe' } satisfies ItemMenu, PAINEL_EMPRESA] : []),
        PERFIL_E_SEGURANCA,
        AJUDA,
      ]
    case 'MOTORISTA':
      return [
        { rotulo: 'Minhas corridas e Pendências', titulo: 'Minhas corridas', icone: 'lista', para: '/pedidos' },
        { rotulo: 'Agenda', icone: 'calendario', para: '/agenda' },
        { rotulo: 'Meus veículos', icone: 'caminhao', para: '/veiculos' },
        { rotulo: 'Corridas do mês', icone: 'grafico', para: '/corridas-do-mes' },
        PERFIL_E_SEGURANCA,
        AJUDA,
      ]
    case 'ADM':
      return [
        { rotulo: 'Painel e Corridas em andamento', titulo: 'Painel', icone: 'grafico', para: '/adm/painel' },
        { rotulo: 'Contratos', icone: 'tabela', para: '/adm/contratos' },
        { rotulo: 'Créditos', icone: 'dinheiro', para: '/adm/creditos' },
        { rotulo: 'Faturas', icone: 'lista', para: '/adm/faturas' },
        { rotulo: 'Usuários', icone: 'usuarios', para: '/adm/usuarios' },
        { rotulo: 'Empresas', icone: 'predio', para: '/adm/empresas' },
        { rotulo: 'Configurações', icone: 'chave', para: '/adm/configuracoes' },
        { rotulo: 'Auditoria', icone: 'lista', para: '/adm/auditoria' },
        { rotulo: 'Categorias e preços', icone: 'tabela', para: '/adm/categorias' },
        { rotulo: 'Veículos', icone: 'caminhao', para: '/adm/veiculos' },
        PAINEL_EMPRESA,
        PERFIL_E_SEGURANCA,
        AJUDA,
      ]
    case 'GESTOR_FROTA':
      // Sem telas no app novo (Ruling R13): a moldura mostra "Sem acesso a este app".
      return []
  }
}

/** Iniciais do nome para o avatar ("Marina Souza" → "MS"). */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0]![0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

/** "Master", "Motorista" ou "Umi San · Administrador" (rótulos do app novo, Ruling R13). */
function subtitulo(p: Perfil, rotulos: Rotulos): string {
  const rotulo = rotuloCurto(rotulos, p.papel, p.nivel)
  return p.papel === 'CLIENTE' && p.empresa_nome ? `${p.empresa_nome} · ${rotulo}` : rotulo
}

const CLASSE_ITEM = 'flex min-h-12 w-full items-center gap-3.5 border-b border-borda py-1 font-semibold text-texto'
/** Item atual: o fundo transborda 0,75 rem para os lados (-mx-3 + px-3), então o ícone e o texto não saem do lugar. */
const CLASSE_LINK = 'flex min-h-12 items-center gap-3.5 border-b py-1 font-semibold text-texto'
const CLASSE_LINK_ATUAL = `${CLASSE_LINK} -mx-3 w-[calc(100%+1.5rem)] rounded-xl border-transparent bg-selecao-suave px-3`
const CLASSE_LINK_OUTRO = `${CLASSE_LINK} w-full border-borda`

/**
 * Menu ☰ do canto superior esquerdo (mockups 12 e 13): botão redondo sobre o mapa e uma gaveta à esquerda.
 * A gaveta é um `<dialog>` modal: o resto fica inerte (foco preso), Esc e o fundo fecham, e o foco volta ao ☰.
 */
export function Menu({ perfil }: { perfil: Perfil }) {
  const { sair } = useSessao()
  const gaveta = useRef<HTMLDialogElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const local = useLocation()
  const idTitulo = useId()
  const rotulos = useRotulos()
  const [disponivel, setDisponivel] = useState(lerDisponivel)
  const itens = itensDoMenu(perfil)
  // A página atual fica destacada (especificação §6.4): troca de uma para outra direto pelo ☰.
  const atual = itemAtual(itens, local.pathname)

  // Fecha ao trocar de tela (toque num item do app novo).
  useEffect(() => {
    gaveta.current?.close()
  }, [local.pathname])

  const alternarDisponivel = () => {
    const novo = !disponivel
    setDisponivel(novo)
    gravarDisponivel(novo)
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => gaveta.current?.showModal()}
        aria-haspopup="dialog"
        aria-label="Abrir menu"
        className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] left-4 z-20 flex size-12 items-center justify-center rounded-full bg-superficie text-texto shadow-[var(--sombra)]"
      >
        <Icone nome="menu" />
      </button>

      <dialog
        ref={gaveta}
        aria-label="Menu"
        aria-describedby={idTitulo}
        onClose={() => {
          if (botao.current?.isConnected) botao.current.focus()
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
        className="m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none overflow-y-auto overscroll-contain rounded-r-folha bg-superficie p-0 text-texto shadow-[10px_0_30px_rgb(10_37_64/0.25)] backdrop:bg-marinho/45"
      >
        <div className="flex min-h-full flex-col px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <span
              aria-hidden="true"
              className="mt-2 flex size-[52px] shrink-0 items-center justify-center rounded-full bg-laranja text-lg font-extrabold text-marinho"
            >
              {iniciais(perfil.nome)}
            </span>
            <button
              type="button"
              onClick={() => gaveta.current?.close()}
              aria-label="Fechar menu"
              className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
            >
              <Icone nome="fechar" />
            </button>
          </div>
          <div id={idTitulo} className="mt-2.5 mb-3">
            <p className="ivo-h3">{perfil.nome}</p>
            <p className="ivo-legenda text-texto-suave">{subtitulo(perfil, rotulos)}</p>
          </div>

          <ul aria-label="Itens do menu">
            {perfil.papel === 'MOTORISTA' && (
              <li className={`${CLASSE_ITEM} justify-between`}>
                <span>Disponível para chamadas</span>
                <Interruptor ligado={disponivel} rotulo="Disponível para chamadas" onAlternar={alternarDisponivel} />
              </li>
            )}
            {itens.map((item) => (
              <li key={item.rotulo}>
                <Link
                  to={item.para}
                  aria-current={item === atual ? 'page' : undefined}
                  className={item === atual ? CLASSE_LINK_ATUAL : CLASSE_LINK_OUTRO}
                >
                  <Icone nome={item.icone} tamanho={20} className={item === atual ? 'text-laranja' : 'text-texto-suave'} />
                  <span className="flex-1">{item.rotulo}</span>
                </Link>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void sair()}
            className="mt-auto flex min-h-12 w-full items-center gap-3.5 pt-4 font-semibold text-texto"
          >
            <Icone nome="sair" tamanho={20} className="text-texto-suave" />
            Sair
          </button>
        </div>
      </dialog>
    </>
  )
}
