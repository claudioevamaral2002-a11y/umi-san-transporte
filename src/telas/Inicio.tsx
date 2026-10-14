import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { Dinheiro } from '../design/componentes/Dinheiro.tsx'
import { Icone, type NomeIcone } from '../design/componentes/Icone.tsx'
import { Skeleton } from '../design/componentes/Skeleton.tsx'
import { gereEquipe } from '../lib/administracao.ts'
import { api } from '../lib/api.ts'
import { useConsulta } from '../lib/consulta.ts'
import { podeEditarContratos } from '../lib/contratos.ts'
import type { Papel, Perfil } from '../lib/estadoSessao.ts'
import { pedidos, type ItemPendencia, type Pendencias } from '../lib/pedidos.ts'
import { useSessao } from '../lib/sessao.tsx'
import { formatarDuracao, formatarQuando, numeroPedido, saudacao } from '../lib/tempo.ts'
import { useTempoReal } from '../lib/tempoReal.ts'
import { topicoDoPerfil } from '../lib/topicos.ts'
import { PainelResumo } from './adm/Painel.tsx'
import { Contagem, Rota } from './pedidos/componentes.tsx'
import { BotaoNovoPedido, podeCriarPedido } from './pedidos/Pedidos.tsx'
import { SaldoDaEmpresa } from './saldo/CartaoSaldo.tsx'

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
const AGENDA: Atalho = {
  para: '/agenda',
  rotulo: 'Agenda',
  descricao: 'Mês, dia e horários livres',
  icone: 'calendario',
}
const PEDIDOS: Atalho = {
  para: '/pedidos',
  rotulo: 'Pedidos',
  descricao: 'Em aberto, agendados e encerrados',
  icone: 'lista',
}
const EXTRATO: Atalho = {
  para: '/extrato',
  rotulo: 'Extrato',
  descricao: 'Recargas, reservas e cobranças; CSV e PDF',
  icone: 'dinheiro',
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
      { para: '/adm/creditos', rotulo: 'Créditos', descricao: 'Saldo por cliente: recarga, ajuste e estorno', icone: 'dinheiro' },
      { para: '/adm/painel', rotulo: 'Painel', descricao: 'Crédito, corridas, pendências e reconciliação', icone: 'grafico' },
    ],
    GESTOR_FROTA: [AGENDA, PEDIDOS],
    MOTORISTA: [
      AGENDA,
      PEDIDOS,
      { para: '/tabela', rotulo: 'Tabela', descricao: 'Preços e prazos para orçar', icone: 'tabela' },
    ],
    CLIENTE: gereEquipe(perfil) ? [PEDIDOS, AGENDA, REGRAS, EXTRATO, EQUIPE] : [PEDIDOS, AGENDA, REGRAS, EXTRATO],
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
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-1 pb-6">
        <h1 className="ivo-h2">{primeiroNome ? `${saudacao()}, ${primeiroNome}` : saudacao()}</h1>
        {semModelo && (
          <Cartao className="space-y-3 border-2 border-laranja" data-testid="chamada-primeira-tabela">
            <p className="flex items-center gap-2 ivo-legenda font-bold text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Ação necessária
            </p>
            <h2 className="ivo-h3">Publique a tabela modelo</h2>
            <p className="ivo-corpo text-texto-suave">
              Ela é a base dos contratos das empresas. Sem contrato vigente, a empresa não consegue fazer pedidos.
            </p>
            <Link
              to="/adm/contratos/modelo?publicar=1"
              className="inline-flex min-h-12 items-center gap-2 rounded-botao bg-acao px-5 ivo-botao text-acao-texto"
            >
              Publicar tabela modelo
            </Link>
          </Cartao>
        )}

        {perfil?.papel === 'CLIENTE' && perfil.empresa_tem_contrato === false && (
          <Cartao className="space-y-2 border-2 border-laranja" data-testid="aviso-sem-contrato">
            <p className="flex items-center gap-2 ivo-legenda font-bold text-alerta-texto">
              <Icone nome="alerta" tamanho={16} />
              Sem contrato vigente
            </p>
            <p className="ivo-corpo">Sua empresa ainda não tem contrato vigente. Fale com a IVO Transportes.</p>
          </Cartao>
        )}

        {/* Saldo da empresa: todo cliente (N1, N2 e N3) vê; relido a cada evento de saldo. */}
        {perfil?.papel === 'CLIENTE' && perfil.empresa_id && <SaldoDaEmpresa empresa={perfil.empresa_id} linkExtrato="/extrato" />}

        {(perfil?.papel === 'GESTOR_FROTA' || perfil?.papel === 'MOTORISTA') && (
          <Link
            to="/agenda"
            viewTransition
            data-testid="atalho-agenda"
            className="flex min-h-16 items-center gap-3 rounded-cartao bg-superficie p-4 shadow-[var(--sombra)]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-campo bg-selecao-suave text-texto">
              <Icone nome="calendario" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{perfil.papel === 'GESTOR_FROTA' ? 'Agenda da frota' : 'Minha agenda'}</span>
              <span className="block ivo-legenda text-texto-suave">Pedidos, pré-reservas e horários livres do mês</span>
            </span>
            <Icone nome="setaDireita" className="text-texto-suave" />
          </Link>
        )}

        {perfil && podeCriarPedido(perfil) && <BotaoNovoPedido perfil={perfil} grande soDesktop />}

        {perfil && <PendenciasDoPerfil perfil={perfil} />}

        {perfil?.papel === 'ADM' && <PainelResumo />}

        {atalhos.length > 0 && (
          <section aria-labelledby="titulo-atalhos" className="space-y-2">
            <h2 id="titulo-atalhos" className="px-1 ivo-h3">
              Atalhos
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {atalhos.map((a) => (
                <li key={a.para}>
                  <Link
                    to={a.para}
                    viewTransition
                    className="flex min-h-16 items-center gap-3 rounded-cartao bg-superficie p-4 shadow-[var(--sombra)]"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-campo bg-selecao-suave text-texto">
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

type Tipo = 'aprovar' | 'orcar' | 'acompanhar' | 'proximo'

const PREFIXO: Record<Tipo, string> = {
  aprovar: 'Aprovar em até',
  orcar: 'Responder em',
  acompanhar: 'Orçamento em até',
  proximo: '',
}

function CartaoPendencia({
  item,
  tipo,
  mostrarEmpresa,
  aguardaVoce,
}: {
  item: ItemPendencia
  tipo: Tipo
  mostrarEmpresa: boolean
  /** O pedido espera uma ação desta pessoa: única borda laranja da tela. */
  aguardaVoce: boolean
}) {
  const destino = tipo === 'orcar' ? `/pedidos/${item.id}/orcar` : `/pedidos/${item.id}`
  const total = item.total_cent ?? null
  return (
    <Link
      to={destino}
      viewTransition
      className={`block rounded-cartao bg-superficie p-4 shadow-[var(--sombra)] ${aguardaVoce ? 'border-2 border-laranja' : ''}`}
      data-testid={`pendencia-${tipo}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold tabular-nums">
            Pedido {numeroPedido(item.numero)}
            {mostrarEmpresa && item.empresa_nome ? `, ${item.empresa_nome}` : ''}
          </p>
          <p className="mt-0.5 ivo-legenda text-texto-suave tabular-nums">
            {formatarQuando(item.inicio)}, {formatarDuracao(item.duracao_min)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.urgente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cor-laranja)]/15 px-2.5 py-0.5 text-xs font-bold text-alerta-texto">
              <Icone nome="alerta" tamanho={12} />
              Urgente
            </span>
          )}
          {item.revisao && (
            <span className="rounded-full border border-marinho-2 px-2.5 py-0.5 text-xs font-bold text-link">Revisão</span>
          )}
        </div>
      </div>
      <div className="mt-3">
        <Rota origem={item.origem} destino={item.destino} compacta />
      </div>
      {((item.prazo && tipo !== 'proximo') || total !== null) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-borda pt-3">
          {item.prazo && tipo !== 'proximo' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cor-laranja)]/15 px-3 py-1 ivo-legenda font-bold text-alerta-texto">
              <Icone nome="relogio" tamanho={16} />
              <Contagem prazo={item.prazo} prefixo={PREFIXO[tipo]} />
            </span>
          ) : (
            <span />
          )}
          {total !== null && <Dinheiro centavos={total} className="font-bold" />}
        </div>
      )}
    </Link>
  )
}

function GrupoPendencias({
  titulo,
  itens,
  tipo,
  mostrarEmpresa,
  aguardaVoce = false,
  vazio,
}: {
  titulo: string
  itens: ItemPendencia[]
  tipo: Tipo
  mostrarEmpresa: boolean
  aguardaVoce?: boolean
  vazio?: string
}) {
  const id = `pend-${tipo}`
  return (
    <section aria-labelledby={id} className="space-y-2" data-testid={`grupo-${tipo}`}>
      <h2 id={id} className="flex items-center gap-2 px-1 ivo-sobretitulo text-texto-suave">
        {titulo}
        {itens.length > 0 && (
          <span className="rounded-full bg-marinho px-2 py-0.5 text-[11px] text-papel tabular-nums">{itens.length}</span>
        )}
      </h2>
      {itens.length === 0 && vazio ? (
        <p className="px-1 ivo-corpo text-texto-suave">{vazio}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {itens.map((i) => (
            <li key={i.id}>
              <CartaoPendencia item={i} tipo={tipo} mostrarEmpresa={mostrarEmpresa} aguardaVoce={aguardaVoce} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NadaPendente() {
  return (
    <Cartao className="space-y-2" data-testid="nada-pendente">
      <h2 className="sr-only">Pendências</h2>
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
  )
}

interface DefGrupo {
  titulo: string
  itens: ItemPendencia[]
  tipo: Tipo
  /** Mostra o grupo mesmo vazio, com este texto. */
  vazio?: string
}

/** Grupos de pendências por perfil (especificação 5): o banco já filtra o que cada um vê. */
function gruposDe(perfil: Perfil, p: Pendencias): DefGrupo[] {
  switch (perfil.papel) {
    case 'CLIENTE':
      return [
        { titulo: 'Aguardando sua aprovação', itens: p.aguardando_aprovacao, tipo: 'aprovar' },
        { titulo: 'Em andamento', itens: p.aguardando_orcamento, tipo: 'acompanhar' },
        { titulo: 'Próximos', itens: p.proximos, tipo: 'proximo' },
      ]
    case 'MOTORISTA':
      return [
        { titulo: 'Aguardando seu orçamento', itens: p.aguardando_orcamento, tipo: 'orcar' },
        // Serviços agendados chegam com a aprovação (fase 2B).
        { titulo: 'Próximos serviços', itens: p.proximos, tipo: 'proximo', vazio: 'Nenhum serviço agendado por enquanto.' },
      ]
    case 'ADM':
      return [
        { titulo: 'Aguardando orçamento', itens: p.aguardando_orcamento, tipo: 'orcar' },
        { titulo: 'Aguardando aprovação do cliente', itens: p.aguardando_aprovacao, tipo: 'aprovar' },
        { titulo: 'Próximos serviços', itens: p.proximos, tipo: 'proximo' },
      ]
    case 'GESTOR_FROTA':
      return [
        { titulo: 'Aguardando orçamento', itens: p.aguardando_orcamento, tipo: 'acompanhar' },
        { titulo: 'Aguardando aprovação do cliente', itens: p.aguardando_aprovacao, tipo: 'aprovar' },
        { titulo: 'Próximos serviços', itens: p.proximos, tipo: 'proximo' },
      ]
  }
}

function PendenciasDoPerfil({ perfil }: { perfil: Perfil }) {
  const { dados, erro, carregando, recarregar } = useConsulta(`inicio-pendencias-${perfil.papel}`, pedidos.pendencias)
  useTempoReal(topicoDoPerfil(perfil), recarregar)
  if (erro && dados === undefined) return null
  if (carregando && dados === undefined) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando as pendências">
        <Skeleton className="h-32" />
      </div>
    )
  }
  if (!dados) return null
  const grupos = gruposDe(perfil, dados).filter((g) => g.itens.length > 0 || g.vazio)
  const aguardaVoce = (tipo: Tipo) =>
    (perfil.papel === 'CLIENTE' && tipo === 'aprovar') || (perfil.papel === 'MOTORISTA' && tipo === 'orcar')
  if (grupos.every((g) => g.itens.length === 0)) {
    return (
      <>
        <NadaPendente />
        {grupos.map((g) => (
          <GrupoPendencias key={g.tipo} {...g} mostrarEmpresa={perfil.papel !== 'CLIENTE'} aguardaVoce={aguardaVoce(g.tipo)} />
        ))}
      </>
    )
  }
  return (
    <div className="space-y-5" data-testid="pendencias">
      {grupos.map((g) => (
        <GrupoPendencias key={g.tipo} {...g} mostrarEmpresa={perfil.papel !== 'CLIENTE'} aguardaVoce={aguardaVoce(g.tipo)} />
      ))}
    </div>
  )
}
