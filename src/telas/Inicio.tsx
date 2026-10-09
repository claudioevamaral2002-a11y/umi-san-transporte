import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { Icone, type NomeIcone } from '../design/componentes/Icone.tsx'
import { api } from '../lib/api.ts'
import { useConsulta } from '../lib/consulta.ts'
import type { Papel } from '../lib/estadoSessao.ts'
import { podeEditarParametros } from '../lib/parametros.ts'
import { useSessao } from '../lib/sessao.tsx'
import { formatarDataLonga } from '../lib/valores.ts'

interface Atalho {
  para: string
  rotulo: string
  descricao: string
  icone: NomeIcone
}

const TABELA: Atalho = {
  para: '/parametros',
  rotulo: 'Tabela de preços e regras',
  descricao: 'Valores vigentes e histórico',
  icone: 'tabela',
}

const ATALHOS: Record<Papel, Atalho[]> = {
  ADM: [
    { para: '/adm/usuarios', rotulo: 'Usuários', descricao: 'Convidar, links e acessos', icone: 'usuarios' },
    TABELA,
    { para: '/adm/auditoria', rotulo: 'Auditoria', descricao: 'Tudo o que foi feito no app', icone: 'lista' },
  ],
  // Fase 1B: cliente e motorista ganham "Regras do serviço" e a tabela por modalidade na Task 3.
  MOTORISTA: [],
  CLIENTE: [],
}

/** Para quem pode publicar (ADM): sem nenhuma versão da tabela modelo, chama para a primeira. */
function useSemTabela(papel: Papel | undefined): boolean {
  const pode = podeEditarParametros(papel)
  const { dados } = useConsulta(pode ? `inicio-${papel}` : 'inicio-nada', async () => {
    if (!pode) return false
    return !(await api.temParametros())
  })
  return dados === true
}

export function Inicio() {
  const { perfil } = useSessao()
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0]
  const semTabela = useSemTabela(perfil?.papel)
  const atalhos = perfil ? ATALHOS[perfil.papel] : []

  return (
    <main>
      <section className="sobre-marinho bg-marinho px-4 pt-4 pb-10 text-papel">
        <div className="mx-auto max-w-3xl">
          <p className="ivo-sobretitulo text-cinza-azulado">{formatarDataLonga(new Date())}</p>
          <h1 className="mt-1 ivo-h1">{primeiroNome ? `Olá, ${primeiroNome}` : 'Olá'}</h1>
          {perfil?.papel === 'CLIENTE' && perfil.empresa_nome && (
            <p className="mt-1 ivo-corpo text-cinza-azulado">{perfil.empresa_nome}</p>
          )}
          <span aria-hidden="true" className="mt-4 block h-[3px] w-[34px] rounded-full bg-[var(--cor-laranja)]" />
        </div>
      </section>

      <div className="mx-auto -mt-6 max-w-3xl space-y-4 px-4 pb-6">
        {semTabela && (
          <Cartao className="space-y-3 border-[var(--cor-laranja)]" data-testid="chamada-primeira-tabela">
            <p className="flex items-center gap-2 ivo-sobretitulo text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Ação necessária
            </p>
            <h2 className="ivo-h3">Publique a primeira tabela de preços</h2>
            <p className="ivo-corpo text-texto-suave">
              Enquanto não houver tabela publicada, ninguém consegue ver os valores e os orçamentos ficam bloqueados.
            </p>
            <Link
              to="/parametros?publicar=1"
              className="inline-flex min-h-12 items-center gap-2 rounded-cartao bg-acao px-5 ivo-botao text-acao-texto"
            >
              Publicar tabela
              <Icone nome="setaDireita" tamanho={20} />
            </Link>
          </Cartao>
        )}

        <Cartao className="space-y-2">
          <h2 className="ivo-sobretitulo text-texto-suave">Pendências</h2>
          <div className="flex items-center gap-3 py-2">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-fundo text-[var(--status-concluida)]">
              <Icone nome="check" />
            </span>
            <div>
              <p className="ivo-h3">Nada pendente por aqui.</p>
              <p className="ivo-legenda text-texto-suave">Quando algo precisar de você, aparece neste espaço.</p>
            </div>
          </div>
        </Cartao>

        {atalhos.length > 0 && (
          <section aria-labelledby="titulo-atalhos" className="space-y-2">
            <h2 id="titulo-atalhos" className="px-1 ivo-sobretitulo text-texto-suave">
              Atalhos
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {atalhos.map((a) => (
                <li key={a.para}>
                  <Link
                    to={a.para}
                    viewTransition
                    className="flex min-h-16 items-center gap-3 rounded-cartao border-[1.5px] border-borda bg-superficie p-4 shadow-[var(--sombra)] transition-colors hover:border-marinho-2"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-marinho text-papel">
                      <Icone nome={a.icone} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold">{a.rotulo}</span>
                      <span className="block ivo-legenda text-texto-suave">{a.descricao}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
