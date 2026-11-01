import { NavLink } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { atalhosDoPerfil } from '../navegacao.ts'

/**
 * Barra fixa embaixo do cliente, só no celular (especificação §6.4, mockup 4): Solicitar · Corridas · Agenda · Mais (v2.2.1: sai a Carteira).
 * Troca de página pelo roteador (sem recarregar); a atual leva `aria-current="page"` (o NavLink marca).
 */
export function BarraCliente({ aoMais, papel = 'CLIENTE' }: { aoMais: () => void; papel?: string }) {
  return (
    <nav
      aria-label="Atalhos"
      className="ivo-barra-cliente fixed inset-x-0 bottom-0 z-10 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {atalhosDoPerfil(papel).map((a) => (
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
          <button type="button" onClick={aoMais} aria-haspopup="dialog" className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5 text-xs font-bold text-texto-suave">
            <Icone nome="menu" tamanho={22} />
            Mais
          </button>
        </li>
      </ul>
    </nav>
  )
}
