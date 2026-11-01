import '../design/estilos.css'
import './tokens.css'
import './fontes.css'
import './moldura.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ProvedorPublicacaoPorCategoria } from '../lib/publicacaoPorCategoria.tsx'
import { ProvedorRotulos, ROTULOS_APP_NOVO } from '../lib/rotulos.tsx'
import { SessaoProvider } from '../lib/sessao.tsx'
import { AvisoNovaVersao } from './AvisoNovaVersao.tsx'
import { roteadorNovo } from './rotas.tsx'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz ausente no novo.html')

createRoot(raiz).render(
  <StrictMode>
    <SessaoProvider>
      {/* Rótulos do app novo (Ruling R13): Master, Administrador, Solicitante e Visualizador. Toda versão de contrato
          publicada aqui leva o preço por categoria (também pela tela Contratos de hoje). */}
      <ProvedorRotulos rotulos={ROTULOS_APP_NOVO}>
        <ProvedorPublicacaoPorCategoria>
          <RouterProvider router={roteadorNovo} />
        </ProvedorPublicacaoPorCategoria>
      </ProvedorRotulos>
      <AvisoNovaVersao />
    </SessaoProvider>
  </StrictMode>,
)
