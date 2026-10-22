import { useState, type FormEvent } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { AreaTexto, Campo, CampoSelecao } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone, type NomeIcone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { filtrarUsuarios, LISTA_NIVEIS, motivoValido, NIVEIS_AJUDA } from '../../lib/administracao.ts'
import { useRotulos } from '../../lib/rotulos.tsx'
import { api, type Empresa, type Usuario } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import type { Nivel, Papel } from '../../lib/estadoSessao.ts'
import { chamarFuncao } from '../../lib/funcoes.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { linkSeguro } from '../../lib/whatsapp.ts'
import { LinkGerado } from './LinkGerado.tsx'

const ALVO_ADM =
  'Para administradores, novo link e reset do 2FA não são feitos pelo app: o dono do sistema usa o procedimento manual (workflow no GitHub, descrito no RUNBOOK).'

function mensagem(codigo: string | undefined): string {
  return codigo === 'ALVO_ADM' ? ALVO_ADM : mensagemDoCodigo(codigo)
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * `adm`: tela Usuários do administrador (todos os perfis).
 * `equipe`: tela Equipe do gestor da empresa (cliente N1): só colegas cliente da própria empresa
 * (o banco força a empresa e recusa o resto; aqui só não oferecemos o que não vale).
 */
export type Modo = 'adm' | 'equipe'

function Chip({ cor, icone, children }: { cor: string; icone: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap"
      style={{ color: cor, borderColor: cor }}
    >
      <span aria-hidden="true">{icone}</span>
      {children}
    </span>
  )
}

function Situacao({ u }: { u: Usuario }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {u.ativo ? (
        <Chip cor="var(--status-concluida)" icone="●">
          Ativo
        </Chip>
      ) : (
        <Chip cor="var(--status-cancelada)" icone="○">
          Inativo
        </Chip>
      )}
      {u.senha_pendente && (
        <Chip cor="var(--status-aguardando)" icone="◔">
          Senha pendente
        </Chip>
      )}
      {u.papel !== 'CLIENTE' &&
        (u.tem_2fa ? (
          <Chip cor="var(--status-agendada)" icone="✓">
            2FA ok
          </Chip>
        ) : (
          <Chip cor="var(--status-aguardando)" icone="!">
            2FA pendente
          </Chip>
        ))}
    </span>
  )
}

function SeletorNivel({ nivel, onNivel }: { nivel: Nivel; onNivel: (n: Nivel) => void }) {
  // Rótulos do app em que a tela abre (o app novo troca os nomes dos níveis, Ruling R13).
  const { niveis: NIVEIS } = useRotulos()
  return (
    <CampoSelecao
      rotulo="Nível na empresa"
      value={nivel}
      ajuda={NIVEIS_AJUDA[nivel]}
      onChange={(e) => onNivel(Number(e.target.value) as Nivel)}
    >
      {LISTA_NIVEIS.map((n) => (
        <option key={n} value={n}>
          {NIVEIS[n]}
        </option>
      ))}
    </CampoSelecao>
  )
}

function SeletorPapel({
  papel,
  nivel,
  empresa,
  empresas,
  onPapel,
  onNivel,
  onEmpresa,
  erroEmpresa,
  desabilitarPapel,
}: {
  papel: Papel
  nivel: Nivel
  empresa: string
  empresas: Empresa[]
  onPapel: (p: Papel) => void
  onNivel: (n: Nivel) => void
  onEmpresa: (id: string) => void
  erroEmpresa?: string
  desabilitarPapel?: boolean
}) {
  // Rótulos do app em que a tela abre (o app novo troca os nomes dos níveis, Ruling R13).
  const { papeis: PAPEIS } = useRotulos()
  return (
    <>
      <CampoSelecao
        rotulo="Perfil"
        value={papel}
        disabled={desabilitarPapel}
        ajuda={desabilitarPapel ? 'Você não pode alterar o seu próprio perfil.' : undefined}
        onChange={(e) => onPapel(e.target.value as Papel)}
      >
        {(Object.keys(PAPEIS) as Papel[]).map((p) => (
          <option key={p} value={p}>
            {PAPEIS[p]}
          </option>
        ))}
      </CampoSelecao>
      {papel === 'CLIENTE' && (
        <CampoSelecao rotulo="Empresa" value={empresa} erro={erroEmpresa} onChange={(e) => onEmpresa(e.target.value)}>
          <option value="">Escolha a empresa</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </CampoSelecao>
      )}
      {papel === 'CLIENTE' && <SeletorNivel nivel={nivel} onNivel={onNivel} />}
    </>
  )
}

// ------------------------------------------------------------------------------------------------
// Convidar
// ------------------------------------------------------------------------------------------------

function Convidar({
  modo,
  empresas,
  onConvidado,
  onVerNaLista,
}: {
  modo: Modo
  empresas: Empresa[]
  onConvidado: () => void
  onVerNaLista: (email: string) => void
}) {
  const equipe = modo === 'equipe'
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>(equipe ? 'CLIENTE' : 'MOTORISTA')
  // ADM convidando cliente: o primeiro da empresa costuma ser o gestor (N1); colega: solicitante (N2).
  const [nivel, setNivel] = useState<Nivel>(equipe ? 2 : 1)
  const [empresa, setEmpresa] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<{ texto: string; jaExiste: boolean } | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const novos: Record<string, string> = {}
    if (nome.trim().length < 2 || nome.trim().length > 120) novos.nome = 'Informe o nome (2 a 120 caracteres).'
    if (!EMAIL.test(email.trim()) || email.trim().length > 254) novos.email = 'Informe um e-mail válido.'
    if (!equipe && papel === 'CLIENTE' && !empresa) novos.empresa = 'Escolha a empresa do cliente.'
    setErros(novos)
    setFalha(null)
    if (Object.keys(novos).length > 0) return
    setEnviando(true)
    // Equipe: sem empresa (o servidor usa a do gestor). A permissão é decidida no banco.
    const r = await chamarFuncao('convidar', {
      email: email.trim(),
      nome: nome.trim(),
      papel: equipe ? 'CLIENTE' : papel,
      empresa_id: !equipe && papel === 'CLIENTE' ? empresa : null,
      nivel: equipe || papel === 'CLIENTE' ? nivel : null,
    })
    setEnviando(false)
    const seguro = r.ok ? linkSeguro(r.link) : null
    if (seguro) {
      setLink(seguro)
      onConvidado()
    } else {
      const codigo = r.ok ? 'ERRO_INESPERADO' : r.codigo
      setFalha({ texto: mensagem(codigo), jaExiste: codigo === 'JA_CADASTRADO' || codigo === 'EMAIL_EM_USO' })
    }
  }

  if (link) {
    return (
      <div className="space-y-3">
        <Mensagem tipo="sucesso">Convite criado para {nome.trim()}.</Mensagem>
        <LinkGerado nome={nome.trim()} link={link} tipo="convite" />
      </div>
    )
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-3">
      <Campo rotulo="Nome" autoComplete="off" value={nome} erro={erros.nome} onChange={(e) => setNome(e.target.value)} />
      <Campo
        rotulo="E-mail"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        value={email}
        erro={erros.email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {equipe ? (
        <SeletorNivel nivel={nivel} onNivel={setNivel} />
      ) : (
        <SeletorPapel
          papel={papel}
          nivel={nivel}
          empresa={empresa}
          empresas={empresas}
          onPapel={setPapel}
          onNivel={setNivel}
          onEmpresa={setEmpresa}
          erroEmpresa={erros.empresa}
        />
      )}
      {papel !== 'CLIENTE' && (
        <p className="ivo-legenda text-texto-suave">
          Administradores, gestores de frota e motoristas cadastram o 2FA no primeiro acesso.
        </p>
      )}
      <div aria-live="assertive" className="space-y-2">
        {falha && <Mensagem tipo="erro">{falha.texto}</Mensagem>}
        {falha?.jaExiste && (
          <Botao className="w-full" onClick={() => onVerNaLista(email.trim().toLowerCase())}>
            {equipe ? 'Ver na lista da equipe' : 'Ver na lista de usuários'}
          </Botao>
        )}
      </div>
      <Botao type="submit" variante="principal" className="w-full" disabled={enviando}>
        {enviando ? 'Gerando convite…' : 'Gerar link de convite'}
      </Botao>
    </form>
  )
}

// ------------------------------------------------------------------------------------------------
// Gerenciar uma pessoa
// ------------------------------------------------------------------------------------------------

function ItemAcao({ onClick, icone, titulo, texto }: { onClick: () => void; icone: NomeIcone; titulo: string; texto: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-fundo"
      >
        <Icone nome={icone} className="text-link" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{titulo}</span>
          <span className="block ivo-legenda text-texto-suave">{texto}</span>
        </span>
        <Icone nome="setaDireita" tamanho={18} className="text-texto-suave" />
      </button>
    </li>
  )
}

type Visao = 'menu' | 'link' | 'ativo' | 'perfil' | '2fa'

function Gerenciar({
  modo,
  u,
  souEu,
  empresas,
  onConcluido,
}: {
  modo: Modo
  u: Usuario
  souEu: boolean
  empresas: Empresa[]
  onConcluido: (texto: string) => void
}) {
  const equipe = modo === 'equipe'
  const { papeis: PAPEIS, niveis: NIVEIS } = useRotulos()
  const [visao, setVisao] = useState<Visao>('menu')
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroMotivo, setErroMotivo] = useState<string | undefined>()
  const [nome, setNome] = useState(u.nome)
  const [papel, setPapel] = useState<Papel>(u.papel)
  const [empresa, setEmpresa] = useState(u.empresa_id ?? '')
  const [nivel, setNivel] = useState<Nivel>(u.nivel ?? 1)
  const ehAdm = u.papel === 'ADM'

  const ir = (v: Visao) => {
    setFalha(null)
    setVisao(v)
  }

  async function executar(acao: () => Promise<{ ok: boolean; codigo?: string; [k: string]: unknown }>, sucesso?: string) {
    if (enviando) return null
    setEnviando(true)
    setFalha(null)
    const r = await acao()
    setEnviando(false)
    if (!r.ok) {
      setFalha(mensagem(r.codigo))
      return null
    }
    if (sucesso) onConcluido(sucesso)
    return r
  }

  async function gerarLink() {
    const r = await executar(() => chamarFuncao('gerir-usuario', { acao: 'GERAR_LINK', usuario_id: u.usuario_id }))
    if (!r) return
    const seguro = linkSeguro(r.link)
    if (seguro) setLink(seguro)
    else setFalha(mensagemDoCodigo('ERRO_INESPERADO'))
  }

  function definirAtivo(e: FormEvent) {
    e.preventDefault()
    if (!motivoValido(motivo)) {
      setErroMotivo('Explique o motivo (3 a 500 caracteres).')
      return
    }
    setErroMotivo(undefined)
    void executar(
      () =>
        chamarFuncao('gerir-usuario', {
          acao: u.ativo ? 'DESATIVAR' : 'REATIVAR',
          usuario_id: u.usuario_id,
          motivo: motivo.trim(),
        }),
      u.ativo ? `${u.nome} foi desativado(a).` : `${u.nome} foi reativado(a).`,
    )
  }

  function salvarPerfil(e: FormEvent) {
    e.preventDefault()
    if (nome.trim().length < 2 || (papel === 'CLIENTE' && !empresa)) {
      setFalha(mensagemDoCodigo('CAMPOS_INVALIDOS'))
      return
    }
    void executar(
      () =>
        api.alterarPerfil(
          u.usuario_id,
          nome.trim(),
          papel,
          papel === 'CLIENTE' ? empresa : null,
          papel === 'CLIENTE' ? nivel : null,
        ),
      `Perfil de ${nome.trim()} atualizado.`,
    )
  }

  const erro = <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
  const voltar = (
    <Botao onClick={() => ir('menu')} disabled={enviando}>
      Voltar
    </Botao>
  )

  if (visao === 'link') {
    return (
      <div className="space-y-3">
        {link ? (
          <LinkGerado nome={u.nome} link={link} tipo="recuperacao" />
        ) : (
          <>
            <p className="ivo-corpo">
              Gera um link para {u.nome} criar uma nova senha. A pessoa precisará entrar de novo depois de usá-lo.
            </p>
            {erro}
            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              {voltar}
              <Botao variante="principal" onClick={() => void gerarLink()} disabled={enviando}>
                {enviando ? 'Gerando…' : 'Gerar link'}
              </Botao>
            </div>
          </>
        )}
      </div>
    )
  }

  if (visao === 'ativo') {
    return (
      <form onSubmit={definirAtivo} noValidate className="space-y-3">
        <p className="ivo-corpo">
          {u.ativo
            ? `${u.nome} perde o acesso imediatamente.`
            : `${u.nome} volta a ter acesso.`}{' '}
          A pessoa precisará entrar de novo.
        </p>
        <AreaTexto
          rotulo="Motivo"
          ajuda="Fica registrado na auditoria. De 3 a 500 caracteres."
          maxLength={500}
          value={motivo}
          erro={erroMotivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        {erro}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {voltar}
          <Botao type="submit" variante={u.ativo ? 'perigo' : 'principal'} disabled={enviando}>
            {enviando ? 'Salvando…' : u.ativo ? 'Desativar' : 'Reativar'}
          </Botao>
        </div>
      </form>
    )
  }

  if (visao === 'perfil') {
    return (
      <form onSubmit={salvarPerfil} noValidate className="space-y-3">
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <SeletorPapel
          papel={papel}
          nivel={nivel}
          empresa={empresa}
          empresas={empresas}
          onPapel={setPapel}
          onNivel={setNivel}
          onEmpresa={setEmpresa}
          desabilitarPapel={souEu}
        />
        {papel !== u.papel && papel !== 'CLIENTE' && (
          <p className="ivo-legenda text-texto-suave">Com o novo perfil, a pessoa precisará do 2FA para entrar.</p>
        )}
        {erro}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {voltar}
          <Botao type="submit" variante="principal" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </Botao>
        </div>
      </form>
    )
  }

  if (visao === '2fa') {
    return (
      <div className="space-y-3">
        <p className="ivo-corpo">
          Remove o autenticador de {u.nome}. No próximo acesso, a pessoa cadastra o 2FA de novo. Use só quando ela perdeu
          o celular ou o app autenticador.
        </p>
        {erro}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {voltar}
          <Botao
            variante="perigo"
            disabled={enviando}
            onClick={() =>
              void executar(
                () => chamarFuncao('gerir-usuario', { acao: 'RESETAR_2FA', usuario_id: u.usuario_id }),
                `2FA de ${u.nome} resetado.`,
              )
            }
          >
            {enviando ? 'Resetando…' : 'Resetar 2FA'}
          </Botao>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="ivo-legenda text-texto-suave">{u.email}</p>
        <p className="ivo-legenda">
          {equipe && u.nivel ? NIVEIS[u.nivel] : PAPEIS[u.papel]}
          {!equipe && u.empresa_nome ? `, ${u.empresa_nome}` : ''}
          {!equipe && u.papel === 'CLIENTE' && u.nivel ? `, ${NIVEIS[u.nivel]}` : ''}
        </p>
        <Situacao u={u} />
      </div>
      <ul className="divide-y divide-borda rounded-cartao border-[1.5px] border-borda">
        {!ehAdm && <ItemAcao onClick={() => ir('link')} icone="link" titulo="Gerar novo link" texto="Para criar nova senha (esqueceu ou não usou o convite)" />}
        {!equipe && (
          <ItemAcao onClick={() => ir('perfil')} icone="lapis" titulo="Trocar perfil" texto="Nome, perfil, empresa e nível" />
        )}
        {!souEu && (
          <ItemAcao
            onClick={() => ir('ativo')}
            icone={u.ativo ? 'cadeado' : 'check'}
            titulo={u.ativo ? 'Desativar' : 'Reativar'}
            texto={u.ativo ? 'Bloqueia o acesso, com motivo' : 'Libera o acesso de novo, com motivo'}
          />
        )}
        {!equipe && !ehAdm && u.tem_2fa && <ItemAcao onClick={() => ir('2fa')} icone="escudo" titulo="Resetar 2FA" texto="Quando a pessoa perdeu o autenticador" />}
      </ul>
      {ehAdm && <p className="ivo-legenda text-texto-suave">{ALVO_ADM}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------
// Telas: Usuários (ADM) e Equipe (gestor da empresa, cliente N1)
// ------------------------------------------------------------------------------------------------

function Perfil({ u, modo }: { u: Usuario; modo: Modo }) {
  // Rótulos do app em que a tela abre (o app novo troca os nomes dos níveis, Ruling R13).
  const { papeis: PAPEIS, niveis: NIVEIS } = useRotulos()
  if (modo === 'equipe') return <>{u.nivel ? NIVEIS[u.nivel] : PAPEIS[u.papel]}</>
  return <>{PAPEIS[u.papel]}</>
}

/** ADM: empresa e nível do cliente. */
function Detalhe({ u }: { u: Usuario }) {
  // Rótulos do app em que a tela abre (o app novo troca os nomes dos níveis, Ruling R13).
  const { niveis: NIVEIS } = useRotulos()
  return (
    <>
      {u.empresa_nome}
      {u.papel === 'CLIENTE' && u.nivel && <>, {NIVEIS[u.nivel]}</>}
    </>
  )
}

function GestaoPessoas({ modo, empresa }: { modo: Modo; empresa?: string }) {
  const equipe = modo === 'equipe'
  const { papeis: PAPEIS } = useRotulos()
  const { email: meuEmail, perfil } = useSessao()
  const { dados, erro, carregando, recarregar } = useConsulta(equipe ? 'equipe' : 'adm-usuarios', async () => {
    // A equipe não precisa da lista de empresas: o servidor usa a empresa do gestor.
    const [usuarios, empresas] = await Promise.all([api.usuarios(), equipe ? Promise.resolve([]) : api.empresas()])
    return { usuarios, empresas }
  })
  const [busca, setBusca] = useState('')
  const [papel, setPapel] = useState<Papel | 'TODOS'>('TODOS')
  const [convidando, setConvidando] = useState(false)
  const [gerindo, setGerindo] = useState<Usuario | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const daEmpresa = dados && empresa ? dados.usuarios.filter((u) => u.empresa_id === empresa) : dados?.usuarios
  const lista = daEmpresa ? filtrarUsuarios(daEmpresa, busca, equipe ? 'TODOS' : papel) : []
  const souEu = (u: Usuario) => !!meuEmail && u.email === meuEmail.trim().toLowerCase()
  // Na equipe ninguém age sobre a própria conta (o banco recusa do mesmo jeito).
  const podeGerir = (u: Usuario) => !equipe || !souEu(u)
  const abrir = (u: Usuario) => {
    setAviso(null)
    setGerindo(u)
  }
  const rotuloConvidar = equipe ? 'Convidar colega' : 'Convidar'

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={equipe ? (perfil?.empresa_nome ?? 'Sua empresa') : 'Administração'}
        titulo={equipe ? 'Equipe' : 'Usuários'}
        descricao={
          equipe
            ? 'Convide colegas da sua empresa, gere novos links e controle quem tem acesso.'
            : 'Convide pessoas, gere novos links e controle quem tem acesso.'
        }
        acao={
          <Botao
            variante="principal"
            className="flex w-full items-center justify-center gap-2 md:w-auto"
            onClick={() => {
              setAviso(null)
              setConvidando(true)
            }}
          >
            <Icone nome="mais" tamanho={20} />
            {rotuloConvidar}
          </Botao>
        }
      />

      <div className={equipe ? '' : 'grid gap-3 md:grid-cols-[1fr_14rem]'}>
        <Campo
          rotulo="Buscar por nome ou e-mail"
          icone="busca"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {!equipe && (
          <CampoSelecao rotulo="Perfil" value={papel} onChange={(e) => setPapel(e.target.value as Papel | 'TODOS')}>
            <option value="TODOS">Todos</option>
            {(Object.keys(PAPEIS) as Papel[]).map((p) => (
              <option key={p} value={p}>
                {PAPEIS[p]}
              </option>
            ))}
          </CampoSelecao>
        )}
      </div>

      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && <Skeleton className="h-48" />}

      {dados && lista.length === 0 && (
        <EstadoVazio icone="usuarios" titulo={dados.usuarios.length === 0 ? 'Ninguém cadastrado ainda' : 'Nenhum resultado'}>
          {dados.usuarios.length === 0
            ? `Use "${rotuloConvidar}" para cadastrar a primeira pessoa.`
            : 'Ajuste a busca ou o filtro.'}
        </EstadoVazio>
      )}

      {dados && lista.length > 0 && (
        <>
          <p className="sr-only" aria-live="polite">
            {lista.length} {lista.length === 1 ? 'pessoa' : 'pessoas'} na lista
          </p>
          {/* Celular: cartões */}
          <ul className="space-y-3 md:hidden" data-testid="lista-usuarios">
            {lista.map((u) => (
              <li key={u.usuario_id}>
                <Cartao className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        {u.nome}
                        {souEu(u) && <span className="font-medium text-texto-suave"> (você)</span>}
                      </p>
                      <p className="truncate ivo-legenda text-texto-suave">{u.email}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-marinho px-2.5 py-0.5 text-xs font-bold text-papel">
                      <Perfil u={u} modo={modo} />
                    </span>
                  </div>
                  {!equipe && u.empresa_nome && (
                    <p className="ivo-legenda">
                      <Detalhe u={u} />
                    </p>
                  )}
                  <Situacao u={u} />
                  {podeGerir(u) && (
                    <Botao className="w-full" onClick={() => abrir(u)} aria-label={`Gerenciar ${u.nome}`}>
                      Gerenciar
                    </Botao>
                  )}
                </Cartao>
              </li>
            ))}
          </ul>
          {/* Desktop: tabela */}
          <Cartao className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-left">
              <caption className="sr-only">{equipe ? 'Equipe' : 'Usuários'}</caption>
              <thead className="border-b border-borda">
                <tr className="ivo-sobretitulo text-texto-suave">
                  <th scope="col" className="px-4 py-3">
                    Pessoa
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {equipe ? 'Nível' : 'Perfil'}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Situação
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.usuario_id} className="border-b border-borda last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-bold">
                        {u.nome}
                        {souEu(u) && <span className="font-medium text-texto-suave"> (você)</span>}
                      </p>
                      <p className="ivo-legenda text-texto-suave">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">
                        <Perfil u={u} modo={modo} />
                      </p>
                      {!equipe && u.empresa_nome && (
                        <p className="ivo-legenda text-texto-suave">
                          <Detalhe u={u} />
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Situacao u={u} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {podeGerir(u) && (
                        <Botao onClick={() => abrir(u)} aria-label={`Gerenciar ${u.nome}`}>
                          Gerenciar
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cartao>
        </>
      )}

      <Folha
        aberta={convidando}
        onFechar={() => setConvidando(false)}
        sobretitulo={equipe ? 'Equipe' : 'Usuários'}
        titulo={equipe ? 'Convidar colega' : 'Convidar pessoa'}
      >
        <Convidar
          modo={modo}
          empresas={dados?.empresas ?? []}
          onConvidado={recarregar}
          onVerNaLista={(email) => {
            setBusca(email)
            setPapel('TODOS')
            setConvidando(false)
          }}
        />
      </Folha>

      <Folha aberta={gerindo !== null} onFechar={() => setGerindo(null)} sobretitulo="Gerenciar" titulo={gerindo?.nome ?? ''}>
        {gerindo && (
          <Gerenciar
            modo={modo}
            u={gerindo}
            souEu={souEu(gerindo)}
            empresas={dados?.empresas ?? []}
            onConcluido={(texto) => {
              setAviso(texto)
              setGerindo(null)
              recarregar()
            }}
          />
        )}
      </Folha>
    </main>
  )
}

/** ADM: todas as pessoas, de todos os perfis. */
/** `empresa`: só as pessoas dessa empresa (o painel da empresa, escolhida pelo Master no topo). */
export function Usuarios({ empresa }: { empresa?: string } = {}) {
  return <GestaoPessoas modo="adm" empresa={empresa} />
}

/** Gestor da empresa (cliente N1): colegas da própria empresa. */
export function Equipe() {
  return <GestaoPessoas modo="equipe" />
}
