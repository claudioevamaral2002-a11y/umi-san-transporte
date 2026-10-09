import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { Icone, type NomeIcone } from '../design/componentes/Icone.tsx'
import { gereEquipe } from '../lib/administracao.ts'
import { api } from '../lib/api.ts'
import { useConsulta } from '../lib/consulta.ts'
import { podeEditarContratos } from '../lib/contratos.ts'
import type { Papel, Perfil } from '../lib/estadoSessao.ts'
import { useSessao } from '../lib/sessao.tsx'
import { formatarDataLonga } from '../lib/valores.ts'

interface Atalho {
  para: string
  rotulo: string
  descricao: string
  icone: NomeIcone
}

const REGRAS: Atalho = {
  para: '/regras',
  rotulo: 'Regras do serviço',
  descricao: 'Cancelamento, prazos e validade',
  icone: 'lista',
}
const EQUIPE: Atalho = {
  para: '/equipe',
  rotulo: 'Equipe',
  descricao: 'Convidar colegas e controlar acessos',
  icone: 'usuarios',
}

/** Atalhos por perfil e, no cliente, por nível (Adendo A10). Gestor de frota não vê preços. */
function atalhosDe(perfil: Pick<Perfil, 'papel' | 'nivel'>): Atalho[] {
  const porPapel: Record<Papel, Atalho[]> = {
    ADM: [
      { para: '/adm/contratos', rotulo: 'Contratos', descricao: 'Tabela modelo e contrato de cada empresa', icone: 'tabela' },
      { para: '/adm/usuarios', rotulo: 'Usuários', descricao: 'Convidar, links e acessos', icone: 'usuarios' },
      { para: '/adm/empresas', rotulo: 'Empresas', descricao: 'Cadastro e logo das empresas', icone: 'predio' },
      { para: '/adm/auditoria', rotulo: 'Auditoria', descricao: 'Tudo o que foi feito no app', icone: 'lista' },
    ],
    GESTOR_FROTA: [],
    MOTORISTA: [{ para: '/tabela', rotulo: 'Tabela', descricao: 'Preços e prazos para orçar', icone: 'tabela' }],
    CLIENTE: gereEquipe(perfil) ? [REGRAS, EQUIPE] : [REGRAS],
  }
  return porPapel[perfil.papel]
}

/** Para o ADM: sem nenhuma versão da tabela modelo, chama para a primeira. */
function useSemModelo(papel: Papel | undefined): boolean {
  const pode = podeEditarContratos(papel)
  const { dados } = useConsulta(pode ? `inicio-${papel}` : 'inicio-nada', async () => {
    if (!pode) return false
    return (await api.historicoContrato(null)).length === 0
  })
  return dados === true
}

export function Inicio() {
  const { perfil } = useSessao()
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0]
  const semModelo = useSemModelo(perfil?.papel)
  const atalhos = perfil ? atalhosDe(perfil) : []

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
        {semModelo && (
          <Cartao className="space-y-3 border-[var(--cor-laranja)]" data-testid="chamada-primeira-tabela">
            <p className="flex items-center gap-2 ivo-sobretitulo text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Ação necessária
            </p>
            <h2 className="ivo-h3">Publique a tabela modelo</h2>
            <p className="ivo-corpo text-texto-suave">
              Ela é a base dos contratos das empresas. Sem contrato vigente, a empresa não consegue fazer pedidos.
            </p>
            <Link
              to="/adm/contratos/modelo?publicar=1"
              className="inline-flex min-h-12 items-center gap-2 rounded-cartao bg-acao px-5 ivo-botao text-acao-texto"
            >
              Publicar tabela modelo
              <Icone nome="setaDireita" tamanho={20} />
            </Link>
          </Cartao>
        )}

        {perfil?.papel === 'CLIENTE' && perfil.empresa_tem_contrato === false && (
          <Cartao className="space-y-2 border-[var(--cor-laranja)]" data-testid="aviso-sem-contrato">
            <p className="flex items-center gap-2 ivo-sobretitulo text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Sem contrato vigente
            </p>
            <p className="ivo-corpo">Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.</p>
          </Cartao>
        )}

        {perfil?.papel === 'GESTOR_FROTA' && (
          <Cartao className="space-y-2" data-testid="agenda-frota">
            <h2 className="ivo-sobretitulo text-texto-suave">Agenda da frota</h2>
            <div className="flex items-center gap-3 py-2">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-fundo text-marinho-2">
                <Icone nome="relogio" />
              </span>
              <div>
                <p className="ivo-h3">Agenda da frota chega na próxima fase</p>
                <p className="ivo-legenda text-texto-suave">
                  Aqui você vai ver a agenda dos motoristas e distribuir os pedidos.
                </p>
              </div>
            </div>
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
