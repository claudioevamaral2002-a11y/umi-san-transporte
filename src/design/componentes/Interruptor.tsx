/** Chave liga/desliga acessível (role=switch), alvo de 48 px, estado também em texto. */
export function Interruptor({
  ligado,
  rotulo,
  onAlternar,
  desabilitado,
  descricaoId,
}: {
  ligado: boolean
  rotulo: string
  onAlternar: () => void
  desabilitado?: boolean
  descricaoId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      aria-describedby={descricaoId}
      disabled={desabilitado}
      onClick={onAlternar}
      className="flex min-h-12 shrink-0 items-center gap-2.5 rounded-xl px-1 font-semibold disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 items-center rounded-full border-[1.5px] transition-colors duration-150 motion-reduce:transition-none ${
          ligado ? 'border-marinho-2 bg-marinho-2' : 'border-borda bg-borda'
        }`}
      >
        <span
          className={`absolute size-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none ${
            ligado ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="w-20 text-left text-sm">{ligado ? 'Ligada' : 'Desligada'}</span>
    </button>
  )
}
