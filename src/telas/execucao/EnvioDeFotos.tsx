import { useEffect, useRef, useState } from 'react'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { execucao } from '../../lib/execucao.ts'
import { FOTOS_MAX, paraBase64, reduzirFoto } from '../../lib/fotos.ts'

interface FotoLocal {
  chave: string
  url: string
  estado: 'enviando' | 'ok' | 'erro'
}

/**
 * Fotos do serviço (opcionais, até 10 no total): cada uma é reduzida no aparelho e sobe na hora pela função
 * `enviar-foto`, que confere o tipo pelos bytes. `aoOcupado` avisa enquanto alguma estiver subindo.
 */
export function EnvioDeFotos({
  id,
  jaEnviadas,
  aoEnviada,
  aoOcupado,
}: {
  id: string
  jaEnviadas: number
  aoEnviada?: () => void
  aoOcupado?: (ocupado: boolean) => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [fotos, setFotos] = useState<FotoLocal[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const urls = useRef<string[]>([])
  const ocupado = fotos.some((f) => f.estado === 'enviando')
  const restantes = FOTOS_MAX - jaEnviadas - fotos.filter((f) => f.estado !== 'erro').length

  useEffect(() => aoOcupado?.(ocupado), [ocupado, aoOcupado])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  async function enviar(arquivo: File) {
    const chave = crypto.randomUUID()
    const reduzida = await reduzirFoto(arquivo)
    if (!reduzida) {
      setErro(mensagemDoCodigo('FOTO_INVALIDA'))
      return
    }
    const url = URL.createObjectURL(reduzida)
    urls.current.push(url)
    setFotos((l) => [...l, { chave, url, estado: 'enviando' }])
    const r = await execucao.enviarFoto(id, await paraBase64(reduzida))
    setFotos((l) => l.map((f) => (f.chave === chave ? { ...f, estado: r.ok ? 'ok' : 'erro' } : f)))
    if (r.ok) aoEnviada?.()
    else setErro(mensagemDoCodigo(r.codigo))
  }

  return (
    <div className="space-y-2" data-testid="envio-fotos">
      <p className="font-semibold">
        Fotos <span className="ivo-legenda font-medium text-texto-suave">(opcional, até {FOTOS_MAX})</span>
      </p>
      <ul className="grid grid-cols-4 gap-2">
        {fotos.map((f) => (
          <li key={f.chave} className="relative aspect-square overflow-hidden rounded-campo bg-fundo" data-estado={f.estado}>
            <img src={f.url} alt="Foto do serviço" className="size-full object-cover" />
            {f.estado !== 'ok' && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-bold text-white">
                {f.estado === 'enviando' ? 'Enviando…' : 'Falhou'}
              </span>
            )}
          </li>
        ))}
        {restantes > 0 && (
          <li>
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              className="flex aspect-square w-full items-center justify-center rounded-campo border-[1.5px] border-dashed border-texto-suave text-texto-suave"
              aria-label="Adicionar foto"
            >
              <Icone nome="camera" tamanho={26} />
            </button>
          </li>
        )}
      </ul>
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        data-testid="entrada-fotos"
        onChange={(e) => {
          setErro(null)
          const lista = [...(e.target.files ?? [])].slice(0, Math.max(0, restantes))
          e.target.value = ''
          for (const arquivo of lista) void enviar(arquivo)
        }}
      />
      {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
    </div>
  )
}
