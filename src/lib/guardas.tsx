import { Navigate, Outlet } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { rotaDoEstado, type EstadoSessao, type Nivel, type Papel } from './estadoSessao.ts'
import { useSessao } from './sessao.tsx'

/** Aviso curto mostrado no Início quando a pessoa tenta abrir uma área do app que o perfil dela não acessa. */
export const AVISO_AREA_INDISPONIVEL = 'Essa área não está disponível para o seu perfil'

/**
 * Libera a rota só nos estados permitidos; senão leva a pessoa para a tela do seu estado.
 * Só experiência: quem protege de verdade é o banco (RLS + `app.pode_acessar`).
 */
export function Guarda({ permitidos }: { permitidos: EstadoSessao[] }) {
  const { estado, falhou, recarregar, sair } = useSessao()

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

  // Sem "voltar para onde estava": ao entrar (ou terminar o 2FA/senha) a pessoa sempre cai no Início.
  // Guardar o caminho anterior fazia quem entrava com perfil menor no mesmo aparelho cair na área
  // que o perfil anterior (ex.: ADM) deixou aberta.
  return <Navigate to={rotaDoEstado(estado) ?? '/'} replace />
}

/**
 * Telas por perfil (ex.: Administração só para ADM; Equipe só para o cliente N1). O banco recusa do mesmo jeito.
 * `niveis` restringe o nível do cliente.
 */
export function GuardaPapel({ papeis, niveis }: { papeis: Papel[]; niveis?: Nivel[] }) {
  const { perfil } = useSessao()
  const permitido =
    !!perfil && papeis.includes(perfil.papel) && (!niveis || (perfil.nivel !== null && niveis.includes(perfil.nivel)))
  // Área fora do perfil (link antigo, URL digitada, aba restaurada): volta ao Início com um aviso curto.
  return permitido ? <Outlet /> : <Navigate to="/" replace state={{ avisoGuarda: AVISO_AREA_INDISPONIVEL }} />
}
