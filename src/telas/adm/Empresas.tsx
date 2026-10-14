import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { validarLogo } from '../../lib/administracao.ts'
import { api, type Empresa } from '../../lib/api.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { supabase } from '../../lib/supabase.ts'

/** URLs assinadas (1 h) dos logos, por caminho. */
function useLogos(caminhos: string[]) {
  const chave = caminhos.join('|')
  const { dados } = useConsulta(`logos:${chave}`, async () => {
    if (caminhos.length === 0) return {} as Record<string, string>
    const { data } = await supabase.storage.from('logos').createSignedUrls(caminhos, 3600)
    const mapa: Record<string, string> = {}
    for (const item of data ?? []) if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl
    return mapa
  })
  return dados ?? {}
}

function Logo({ url, nome }: { url: string | undefined; nome: string }) {
  const [falhou, setFalhou] = useState(false)
  return (
    <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-borda bg-white">
      {url && !falhou ? (
        <img src={url} alt={`Logo de ${nome}`} className="max-h-10 max-w-18 object-contain" onError={() => setFalhou(true)} />
      ) : (
        <Icone nome="predio" className="text-cinza-azulado" />
      )}
    </span>
  )
}

function FormNome({
  empresa,
  onSalvo,
}: {
  empresa: Empresa | null
  onSalvo: (texto: string, criada?: { id: string; nome: string }) => void
}) {
  const [nome, setNome] = useState(empresa?.nome ?? '')
  const [erro, setErro] = useState<string | undefined>()
  const [falha, setFalha] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    if (nome.trim().length < 2 || nome.trim().length > 120) {
      setErro('Informe o nome (2 a 120 caracteres).')
      return
    }
    setErro(undefined)
    setFalha(null)
    setEnviando(true)
    const r = await api.salvarEmpresa(empresa?.id ?? null, nome.trim())
    setEnviando(false)
    if (r.ok && empresa) onSalvo(`Empresa renomeada para ${nome.trim()}.`)
    else if (r.ok) {
      const id = typeof r.id === 'string' ? r.id : null
      onSalvo(`Empresa ${nome.trim()} criada.`, id ? { id, nome: nome.trim() } : undefined)
    }
    else setFalha(mensagemDoCodigo(r.codigo))
  }

  return (
    <form onSubmit={salvar} noValidate className="space-y-3">
      <Campo rotulo="Nome da empresa" icone="predio" value={nome} erro={erro} onChange={(e) => setNome(e.target.value)} />
      <div aria-live="assertive">{falha && <Mensagem tipo="erro">{falha}</Mensagem>}</div>
      <Botao type="submit" variante="principal" className="w-full" disabled={enviando}>
        {enviando ? 'Salvando…' : empresa ? 'Salvar nome' : 'Criar empresa'}
      </Botao>
    </form>
  )
}

function FormLogo({ empresa, atual, onSalvo }: { empresa: Empresa; atual: string | undefined; onSalvo: (texto: string) => void }) {
  const [arquivo, setArquivo] = useState<{ file: File; extensao: 'png' | 'webp'; previa: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Libera a pré-visualização anterior.
  useEffect(() => {
    const previa = arquivo?.previa
    return () => {
      if (previa) URL.revokeObjectURL(previa)
    }
  }, [arquivo])

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setErro(null)
    if (!file) return
    const v = validarLogo(file)
    if (!v.ok) {
      setArquivo(null)
      setErro(v.erro)
      e.target.value = ''
      return
    }
    setArquivo({ file, extensao: v.extensao, previa: URL.createObjectURL(file) })
  }

  async function enviar() {
    if (!arquivo || enviando) return
    setEnviando(true)
    setErro(null)
    const caminho = `${empresa.id}/logo.${arquivo.extensao}`
    const envio = await supabase.storage
      .from('logos')
      .upload(caminho, arquivo.file, { upsert: true, contentType: arquivo.file.type, cacheControl: '300' })
    if (envio.error) {
      setEnviando(false)
      setErro('Não foi possível enviar a imagem. Confira o arquivo (PNG ou WebP, até 500 KB) e tente de novo.')
      return
    }
    const r = await api.definirLogo(empresa.id, caminho)
    if (r.ok) {
      // O arquivo com a outra extensão (se houver) deixa de ser usado.
      const outro = `${empresa.id}/logo.${arquivo.extensao === 'png' ? 'webp' : 'png'}`
      if (empresa.logo_caminho === outro) void supabase.storage.from('logos').remove([outro])
      onSalvo(`Logo de ${empresa.nome} atualizado.`)
    } else {
      setEnviando(false)
      setErro(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="space-y-1 text-center">
          <p className="ivo-legenda text-texto-suave">Atual</p>
          <Logo url={atual} nome={empresa.nome} />
        </div>
        {arquivo && (
          <>
            <Icone nome="setaDireita" className="text-texto-suave" />
            <div className="space-y-1 text-center">
              <p className="ivo-legenda text-texto-suave">Novo</p>
              <span className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-[var(--cor-laranja)] bg-white">
                <img src={arquivo.previa} alt="Pré-visualização do novo logo" className="max-h-14 max-w-26 object-contain" />
              </span>
            </div>
          </>
        )}
      </div>
      <div>
        <label
          htmlFor="arquivo-logo"
          className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-cartao border border-dashed border-marinho-2 bg-fundo px-4 ivo-botao text-texto focus-within:outline-3 focus-within:outline-[var(--cor-foco)]"
        >
          <Icone nome="imagem" tamanho={20} />
          {arquivo ? 'Escolher outra imagem' : 'Escolher imagem'}
        </label>
        <input id="arquivo-logo" type="file" accept="image/png,image/webp" className="sr-only" onChange={escolher} />
        <p className="mt-1.5 ivo-legenda text-texto-suave">PNG ou WebP, até 500 KB. Aparece no topo das telas do cliente.</p>
      </div>
      <div aria-live="assertive">{erro && <Mensagem tipo="erro">{erro}</Mensagem>}</div>
      <Botao variante="principal" className="w-full" disabled={!arquivo || enviando} onClick={() => void enviar()}>
        {enviando ? 'Enviando…' : 'Salvar logo'}
      </Botao>
    </div>
  )
}

type Edicao = { tipo: 'nova' } | { tipo: 'nome'; empresa: Empresa } | { tipo: 'logo'; empresa: Empresa }

export function Empresas() {
  const { dados, erro, carregando, recarregar } = useConsulta('adm-empresas', api.empresas)
  const logos = useLogos((dados ?? []).flatMap((e) => (e.logo_caminho ? [e.logo_caminho] : [])))
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Empresa recém-criada: próximo passo é o contrato (sem contrato vigente, os clientes dela não fazem pedidos).
  const [criada, setCriada] = useState<{ id: string; nome: string } | null>(null)

  const concluir = (texto: string, nova?: { id: string; nome: string }) => {
    setAviso(texto)
    setCriada(nova ?? null)
    setEdicao(null)
    recarregar()
  }
  const abrir = (e: Edicao) => {
    setAviso(null)
    setCriada(null)
    setEdicao(e)
  }
  const urlDe = (e: Empresa) => (e.logo_caminho ? logos[e.logo_caminho] : undefined)

  const acoes = (e: Empresa) => (
    <div className="flex gap-2">
      <Botao className="flex flex-1 items-center justify-center gap-2" onClick={() => abrir({ tipo: 'nome', empresa: e })} aria-label={`Renomear ${e.nome}`}>
        <Icone nome="lapis" tamanho={18} />
        Renomear
      </Botao>
      <Botao className="flex flex-1 items-center justify-center gap-2" onClick={() => abrir({ tipo: 'logo', empresa: e })} aria-label={`Logo de ${e.nome}`}>
        <Icone nome="imagem" tamanho={18} />
        Logo
      </Botao>
    </div>
  )

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Empresas"
        descricao="Empresas clientes: nome e logo exibido para os clientes de cada uma. Preços e regras ficam em Contratos."
        acao={
          <Botao variante="principal" className="flex w-full items-center justify-center gap-2 md:w-auto" onClick={() => abrir({ tipo: 'nova' })}>
            <Icone nome="mais" tamanho={20} />
            Nova empresa
          </Botao>
        }
      />
      <div aria-live="polite">{aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}</div>
      {criada && (
        <Cartao className="space-y-3 border-[var(--cor-laranja)]" data-testid="proximo-passo-contrato">
          <p className="flex items-center gap-2 ivo-legenda font-semibold text-alerta-texto">
            <Icone nome="alerta" tamanho={16} />
            Próximo passo
          </p>
          <p className="ivo-corpo">
            {criada.nome} ainda não tem contrato. Sem contrato vigente, os clientes dela não conseguem fazer pedidos.
          </p>
          <Link
            to={`/adm/contratos/${criada.id}?publicar=1`}
            className="inline-flex min-h-12 items-center gap-2 rounded-cartao bg-acao px-5 ivo-botao text-acao-texto"
          >
            Criar contrato a partir da tabela modelo
          </Link>
        </Cartao>
      )}

      {erro && !dados && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && !dados && <Skeleton className="h-40" />}
      {dados && dados.length === 0 && (
        <EstadoVazio icone="predio" titulo="Nenhuma empresa cadastrada">
          Cadastre a empresa antes de convidar os clientes dela.
        </EstadoVazio>
      )}

      {dados && dados.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden">
            {dados.map((e) => (
              <li key={e.id}>
                <Cartao className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Logo url={urlDe(e)} nome={e.nome} />
                    <p className="min-w-0 truncate font-bold">{e.nome}</p>
                  </div>
                  {acoes(e)}
                </Cartao>
              </li>
            ))}
          </ul>
          <Cartao className="hidden p-0 md:block">
            <table className="w-full text-left">
              <caption className="sr-only">Empresas</caption>
              <thead className="border-b border-borda">
                <tr className="ivo-sobretitulo text-texto-suave">
                  <th scope="col" className="w-28 px-4 py-3">
                    Logo
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Nome
                  </th>
                  <th scope="col" className="w-80 px-4 py-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.map((e) => (
                  <tr key={e.id} className="border-b border-borda last:border-b-0">
                    <td className="px-4 py-3">
                      <Logo url={urlDe(e)} nome={e.nome} />
                    </td>
                    <td className="px-4 py-3 font-bold">{e.nome}</td>
                    <td className="px-4 py-3">{acoes(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cartao>
        </>
      )}

      <Folha
        aberta={edicao !== null}
        onFechar={() => setEdicao(null)}
        sobretitulo="Empresas"
        titulo={edicao?.tipo === 'nova' ? 'Nova empresa' : edicao?.tipo === 'nome' ? `Renomear ${edicao.empresa.nome}` : `Logo de ${edicao?.empresa.nome ?? ''}`}
      >
        {edicao?.tipo === 'nova' && <FormNome empresa={null} onSalvo={concluir} />}
        {edicao?.tipo === 'nome' && <FormNome empresa={edicao.empresa} onSalvo={concluir} />}
        {edicao?.tipo === 'logo' && <FormLogo empresa={edicao.empresa} atual={urlDe(edicao.empresa)} onSalvo={concluir} />}
      </Folha>
    </main>
  )
}
