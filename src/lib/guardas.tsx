import { Navigate, Outlet, useLocation } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { rotaDoEstado, type EstadoSessao, type Nivel, type Papel } from './estadoSessao.ts'
import { useSessao } from './sessao.tsx'

/** Só caminhos internos (evita redirecionamento aberto via `state.de`). */
function destinoSeguro(caminho: unknown): string | null {
  return typeof caminho === 'string' && /^\/(?!\/)/.test(caminho) && !caminho.includes('\\') ? caminho : null
}

/**
 * Libera a rota só nos estados permitidos; senão leva a pessoa para a tela do seu estado.
 * Só experiência: quem protege de verdade é o banco (RLS + `app.pode_acessar`).
 */
export function Guarda({ permitidos }: { permitidos: EstadoSessao[] }) {
  const { estado, falhou, recarregar, sair } = useSessao()
  const local = useLocation()

  if (estado === 'carregando') {
    if (!falhou) return <CarregandoPickup ativo rotulo="Abrindo sua conta…" />
    return (
      <main className="mx-auto max-w-md p-4">
        <Cartao className="space-y-4">
          <h1 className="ivo-h3">Não foi possível abrir sua conta</h1>
          <p className="ivo-corpo text-texto-suave">Verifique a conexão com a internet e tente de novo.</p>
          <Botao variante="principal" className="w-full" onClick={recarregar}>
            Tentar de novo
          </Botao>
          <Botao className="w-full" onClick={() => void sair()}>
            Sair
          </Botao>
        </Cartao>
      </main>
    )
  }

  if (permitidos.includes(estado)) return <Outlet />

  // Guarda o destino pedido para voltar a ele depois da entrada.
  const de =
    destinoSeguro((local.state as { de?: unknown } | null)?.de) ??
    (estado === 'anonimo' && local.pathname !== '/' && local.pathname !== '/entrar' ? local.pathname : null)
  if (estado === 'pronto' && de) return <Navigate to={de} replace />
  return <Navigate to={rotaDoEstado(estado) ?? '/'} replace state={de ? { de } : undefined} />
}

export function SemPermissao() {
  return (
    <main className="mx-auto max-w-md p-4">
      <Cartao className="space-y-2">
        <p className="ivo-sobretitulo text-alerta-texto">Acesso restrito</p>
        <h1 className="ivo-h2">Sem permissão</h1>
        <p className="ivo-corpo text-texto-suave">Esta área não está disponível para o seu perfil.</p>
      </Cartao>
    </main>
  )
}

/**
 * Telas por perfil (ex.: Administração só para ADM; Equipe só para o cliente N1). O banco recusa do mesmo jeito.
 * `niveis` restringe o nível do cliente.
 */
export function GuardaPapel({ papeis, niveis }: { papeis: Papel[]; niveis?: Nivel[] }) {
  const { perfil } = useSessao()
  const permitido =
    !!perfil && papeis.includes(perfil.papel) && (!niveis || (perfil.nivel !== null && niveis.includes(perfil.nivel)))
  return permitido ? <Outlet /> : <SemPermissao />
}
