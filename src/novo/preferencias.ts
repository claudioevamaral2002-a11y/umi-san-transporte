// Preferências só deste aparelho (o banco não depende delas). Armazenamento bloqueado (navegação privada) não quebra
// a tela: a leitura volta vazia e a gravação é ignorada.

export const CHAVE_CENTRO_CUSTO = 'ivo:ultimo-centro-custo'
export const CHAVE_CATEGORIA = 'ivo:ultima-categoria'

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

function gravar(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave)
    else localStorage.setItem(chave, valor)
  } catch {
    // Sem onde guardar: na próxima vez o campo só não vem preenchido.
  }
}

/** Último centro de custo confirmado neste aparelho (até 80 caracteres, como no banco). */
export const lerUltimoCentroCusto = () => (ler(CHAVE_CENTRO_CUSTO) ?? '').slice(0, 80)
export const gravarUltimoCentroCusto = (v: string) => gravar(CHAVE_CENTRO_CUSTO, v.trim() === '' ? null : v.trim().slice(0, 80))

/** Última categoria pedida neste aparelho (vem selecionada na próxima vez, se estiver disponível). */
export const lerUltimaCategoria = () => ler(CHAVE_CATEGORIA)
export const gravarUltimaCategoria = (codigo: string) => gravar(CHAVE_CATEGORIA, codigo)
