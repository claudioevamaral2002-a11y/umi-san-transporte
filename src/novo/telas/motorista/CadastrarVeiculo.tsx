import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Campo, CampoSelecao } from '../../../design/componentes/Campo.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar } from '../../../design/componentes/Tela.tsx'
import { api } from '../../../lib/api.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../../lib/erros.ts'
import {
  categoriasDeVeiculo,
  formDoVeiculo,
  FORM_VEICULO_VAZIO,
  validarVeiculo,
  veiculos,
  type CategoriaDoVeiculo,
  type ErrosVeiculo,
  type FormVeiculo,
  type Veiculo,
} from '../../../lib/veiculos.ts'

/** Etiqueta marcável (mockup 9): um checkbox de verdade, com a cara das etiquetas da lista. */
function EtiquetaCategoria({ nome, marcada, aoMudar }: { nome: string; marcada: boolean; aoMudar: (m: boolean) => void }) {
  return (
    <label
      className={`relative inline-flex min-h-12 cursor-pointer items-center rounded-full border-[1.5px] px-4 font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-acao ${
        marcada ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto-suave'
      }`}
    >
      <input
        type="checkbox"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        checked={marcada}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      {nome}
    </label>
  )
}

function Formulario({ adm, atual, categorias }: { adm: boolean; atual: Veiculo | null; categorias: CategoriaDoVeiculo[] }) {
  const navegar = useNavigate()
  const [f, setF] = useState<FormVeiculo>(() => (atual ? formDoVeiculo(atual) : FORM_VEICULO_VAZIO))
  const [motorista, setMotorista] = useState('')
  const [erros, setErros] = useState<ErrosVeiculo & { motorista?: string }>({})
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const formulario = useRef<HTMLFormElement>(null)
  const motoristas = useConsulta(adm && !atual ? 'novo-motoristas' : 'sem-motoristas', async () =>
    adm && !atual ? (await api.usuarios()).filter((u) => u.papel === 'MOTORISTA' && u.ativo) : [],
  )
  const lista = adm ? '/adm/veiculos' : '/veiculos'
  // Só as ativas que usam veículo da IVO, com os nomes atuais do banco (renomear muda o rótulo).
  const opcoes = categoriasDeVeiculo(categorias)
  const codigos = opcoes.map((c) => c.codigo)
  const mudar = <K extends keyof FormVeiculo>(campo: K, valor: FormVeiculo[K]) => setF((x) => ({ ...x, [campo]: valor }))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setFalha(null)
    const r = validarVeiculo(f)
    const semMotorista = adm && !atual && motorista === ''
    const novos = { ...(r.ok ? {} : r.erros), ...(semMotorista ? { motorista: 'Escolha o motorista.' } : {}) }
    setErros(novos)
    if (!r.ok || semMotorista) {
      requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setEnviando(true)
    const resposta = await veiculos.salvar({
      ...r.entrada,
      ...(atual ? { id: atual.id } : {}),
      ...(adm && !atual ? { motorista_id: motorista } : {}),
    })
    setEnviando(false)
    if (resposta.ok) {
      void navegar(lista, { replace: true, state: { aviso: `${r.entrada.modelo} ${r.entrada.placa} salvo.` } })
    } else if (resposta.codigo === 'PLACA_DUPLICADA') {
      setErros({ placa: mensagemDoCodigo(resposta.codigo) })
    } else {
      setFalha(mensagemDoCodigo(resposta.codigo))
    }
  }

  return (
    <form ref={formulario} onSubmit={(e) => void salvar(e)} noValidate className="space-y-4">
      {adm && !atual && (
        <CampoSelecao
          rotulo="Motorista"
          value={motorista}
          erro={erros.motorista}
          onChange={(e) => setMotorista(e.target.value)}
        >
          <option value="">{motoristas.dados === undefined ? 'Carregando…' : 'Escolha o motorista'}</option>
          {(motoristas.dados ?? []).map((m) => (
            <option key={m.usuario_id} value={m.usuario_id}>
              {m.nome}
            </option>
          ))}
        </CampoSelecao>
      )}
      <Campo
        rotulo="Modelo"
        placeholder="Toyota Hilux"
        autoComplete="off"
        maxLength={60}
        erro={erros.modelo}
        value={f.modelo}
        onChange={(e) => mudar('modelo', e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Campo
          rotulo="Cor"
          placeholder="Branca"
          autoComplete="off"
          maxLength={30}
          erro={erros.cor}
          value={f.cor}
          onChange={(e) => mudar('cor', e.target.value)}
        />
        <Campo
          rotulo="Placa"
          placeholder="ABC1D23"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={9}
          erro={erros.placa}
          value={f.placa}
          onChange={(e) => mudar('placa', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo
          rotulo="Lugares"
          inputMode="numeric"
          placeholder="4"
          autoComplete="off"
          erro={erros.lugares}
          value={f.lugares}
          onChange={(e) => mudar('lugares', e.target.value)}
        />
        <Campo
          rotulo="Carga máx."
          inputMode="numeric"
          sufixo="kg"
          placeholder="800"
          autoComplete="off"
          erro={erros.cargaMaxKg}
          value={f.cargaMaxKg}
          onChange={(e) => mudar('cargaMaxKg', e.target.value)}
        />
      </div>
      <Campo
        rotulo="Reboque (opcional)"
        placeholder="Prancha até 1.500 kg"
        ajuda="Só se o veículo puxa reboque."
        autoComplete="off"
        maxLength={60}
        erro={erros.reboqueDesc}
        value={f.reboqueDesc}
        onChange={(e) => mudar('reboqueDesc', e.target.value)}
      />
      <fieldset aria-describedby={erros.categorias ? 'erro-categorias' : undefined} className="space-y-2">
        <legend className="mb-1 font-semibold">Atende quais categorias?</legend>
        <div className="flex flex-wrap gap-2">
          {opcoes.map((c) => (
            <EtiquetaCategoria
              key={c.codigo}
              nome={c.nome}
              marcada={f.categorias.includes(c.codigo)}
              aoMudar={(m) =>
                mudar(
                  'categorias',
                  // Na ordem da lista; uma categoria já marcada que saiu da lista (desativada) continua no veículo.
                  m
                    ? [...f.categorias.filter((x) => !codigos.includes(x)), ...codigos.filter((x) => x === c.codigo || f.categorias.includes(x))]
                    : f.categorias.filter((x) => x !== c.codigo),
                )
              }
            />
          ))}
        </div>
        {erros.categorias && (
          <p id="erro-categorias" role="alert" className="ivo-legenda font-semibold text-[var(--status-cancelada)]">
            {erros.categorias}
          </p>
        )}
      </fieldset>
      <p className="ivo-legenda text-texto-suave">Foto e documento do veículo ficam para depois.</p>
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <div className="flex flex-col gap-2">
        <Botao type="submit" variante="principal" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar veículo'}
        </Botao>
        <Link to={lista} className="flex min-h-12 items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto">
          Cancelar
        </Link>
      </div>
    </form>
  )
}

/** Mockup 9: cadastrar (ou editar, com `:id`) um veículo. O ADM escolhe o motorista ao cadastrar. */
export function CadastrarVeiculo({ adm = false }: { adm?: boolean }) {
  const { id } = useParams()
  const { dados, erro, recarregar } = useConsulta(id ? `novo-veiculo-${id}` : 'novo-veiculo-novo', async () => {
    const [categorias, atual] = await Promise.all([
      veiculos.categorias(),
      id ? veiculos.meus().then((l) => l.find((v) => v.id === id) ?? null) : Promise.resolve(null),
    ])
    return { categorias, atual }
  })
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <h1 className="ivo-h2">{id ? 'Editar veículo' : 'Novo veículo'}</h1>
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando…
            </p>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )
      ) : id && dados.atual === null ? (
        <Mensagem tipo="erro">Não encontramos este veículo. Volte à lista e tente de novo.</Mensagem>
      ) : (
        <Formulario adm={adm} atual={dados.atual} categorias={dados.categorias} />
      )}
    </main>
  )
}
