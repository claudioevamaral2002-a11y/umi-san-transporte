import { createBrowserRouter } from 'react-router'
import { Moldura } from './telas/Moldura.tsx'

export const roteador = createBrowserRouter([
  {
    path: '/',
    Component: Moldura,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./telas/Inicio.tsx')).Inicio }) },
      { path: 'vitrine', lazy: async () => ({ Component: (await import('./telas/Vitrine.tsx')).Vitrine }) },
    ],
  },
])
