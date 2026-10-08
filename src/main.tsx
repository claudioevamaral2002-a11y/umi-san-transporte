import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    <h1>Umi San Transporte</h1>
  </StrictMode>,
)