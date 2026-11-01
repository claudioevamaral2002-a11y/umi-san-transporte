import { NavLink, useLocation } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { atalhosDoPerfil } from '../navegacao.ts'

/**
 * Barra móvel persistente nas áreas principais de cada perfil; Mais reúne os demais destinos autorizados.
 * Troca de página pelo roteador (sem recarregar); a atual leva `aria-current="page"` (o NavLink marca).
 */
export function BarraCliente({ aoMais, papel = 'CLIENTE' }: { aoMais: () => void; papel?: string }) {
  const { pathname } = useLocation()
  const atalhos = atalhosDoPerfil(papel)
  const emMais = !atalhos.some(a => a.para === (pathname.replace(/\/+$/, '') || '/'))
  return (
    <nav
      aria-label="Atalhos"
      className="ivo-barra-cliente fixed inset-x-0 bottom-0 z-10 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {atalhos.map((a) => (
          <li key={a.para}>
            <NavLink
              to={a.para}
              end
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5 text-xs font-bold ${
                  isActive ? 'text-texto' : 'text-texto-suave'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icone nome={a.icone} tamanho={22} className={isActive ? 'text-laranja' : ''} />
                  {a.rotulo}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button type="button" onClick={aoMais} aria-haspopup="dialog" aria-current={emMais ? 'true' : undefined} className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5 text-xs font-bold ${emMais ? 'text-texto' : 'text-texto-suave'}`}>
            <Icone nome="menu" tamanho={22} className={emMais ? 'text-laranja' : ''} />
            Mais
          </button>
        </li>
      </ul>
    </nav>
  )
}
