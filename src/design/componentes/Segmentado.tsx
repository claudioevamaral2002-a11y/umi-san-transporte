/** Seletor em pílula (Dia/3 dias/Mês, filtros, Sim/Não): um só escolhido, com a cor de seleção e contorno laranja. */
export function Segmentado<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  rotuladoPor,
  testid,
}: {
  opcoes: ReadonlyArray<{ valor: T; rotulo: string }>
  valor: T
  aoMudar: (v: T) => void
  rotulo: string
  /** Id de um rótulo visível (ex.: a legenda do fieldset): usa `aria-labelledby` no lugar do `aria-label`. */
  rotuladoPor?: string
  testid?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotuladoPor ? undefined : rotulo}
      aria-labelledby={rotuladoPor}
      data-testid={testid}
      className="flex gap-1 rounded-full border-[1.5px] border-borda bg-superficie p-1"
    >
      {opcoes.map((o) => {
        const marcado = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={marcado}
            onClick={() => aoMudar(o.valor)}
            className={`min-h-10 flex-1 rounded-full px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${
              marcado ? 'ivo-escolhido' : 'text-texto-suave'
            }`}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
