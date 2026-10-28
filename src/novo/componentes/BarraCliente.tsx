import { NavLink } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { ATALHOS_CLIENTE } from '../navegacao.ts'

/**
 * Barra fixa embaixo do cliente, só no celular (especificação §6.4, mockup 4): Pedir · Corridas · Agenda (v2.2.1: sai a Carteira).
 * Troca de página pelo roteador (sem recarregar); a atual leva `aria-current="page"` (o NavLink marca).
 */
export function BarraCliente() {
  return (
    <nav
      aria-label="Atalhos"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-3">
        {ATALHOS_CLIENTE.map((a) => (
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
      </ul>
    </nav>
  )
}
