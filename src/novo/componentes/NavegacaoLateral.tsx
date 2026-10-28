import { Link, useLocation } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Interruptor } from '../../design/componentes/Interruptor.tsx'
import { LogoIvo } from '../../design/componentes/LogoIvo.tsx'
import type { Perfil } from '../../lib/estadoSessao.ts'
import { useRotulos } from '../../lib/rotulos.tsx'
import { useSessao } from '../../lib/sessao.tsx'
import { gravarDisponivel, useDisponivel } from '../disponivel.ts'
import { itemAtual } from '../navegacao.ts'
import { iniciais, itensDoMenu, subtitulo, type ItemMenu } from './Menu.tsx'

/** A mesma lista autorizada do menu móvel. Não cria rotas, permissões nem dados próprios. */
export function NavegacaoLateral({ perfil }: { perfil: Perfil }) {
  const { pathname } = useLocation()
  const { sair } = useSessao()
  const rotulos = useRotulos()
  const disponivel = useDisponivel()
  const itens: ItemMenu[] = [
    { rotulo: 'Início', icone: 'mapa', para: '/' },
    ...itensDoMenu(perfil),
  ]
  const atual = itemAtual(itens, pathname)

  return (
    <aside className="ivo-lateral sobre-marinho nao-imprimir" aria-label="Navegação do aplicativo">
      <Link to="/" className="ivo-lateral-marca" aria-label="IVO Transportes · Início" viewTransition>
        <LogoIvo cor="branco" altura={28} />
        <span>Transporte corporativo</span>
      </Link>
      <nav aria-label="Menu principal" className="ivo-lateral-itens">
        <ul>
          {itens.map((item) => (
            <li key={item.para}>
              <Link
                to={item.para}
                aria-current={item === atual ? 'page' : undefined}
                className="ivo-lateral-link"
                viewTransition
              >
                <Icone nome={item.icone} tamanho={20} />
                <span>{item.rotulo}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ivo-lateral-rodape">
        {perfil.papel === 'MOTORISTA' && (
          <div className="ivo-lateral-disponivel">
            <p>Disponível para chamadas</p>
            <Interruptor ligado={disponivel} rotulo="Disponível para chamadas" onAlternar={() => gravarDisponivel(!disponivel)} />
          </div>
        )}
        <div className="ivo-lateral-pessoa">
          <span className="ivo-avatar" aria-hidden="true">{iniciais(perfil.nome)}</span>
          <div>
            <p className="ivo-lateral-nome">{perfil.nome}</p>
            <p className="ivo-lateral-perfil">{subtitulo(perfil, rotulos)}</p>
          </div>
        </div>
        <button type="button" className="ivo-lateral-sair" onClick={() => void sair()}>
          <Icone nome="sair" tamanho={18} /> Sair
        </button>
      </div>
    </aside>
  )
}
