import '@fontsource-variable/manrope'
import './design/estilos.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { recarregarQuandoNovoServiceWorkerAssumir } from './lib/atualizacao.ts'
import { SessaoProvider } from './lib/sessao.tsx'
import { roteador } from './rotas.tsx'

recarregarQuandoNovoServiceWorkerAssumir()

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    <SessaoProvider>
      <RouterProvider router={roteador} />
    </SessaoProvider>
  </StrictMode>,
)
