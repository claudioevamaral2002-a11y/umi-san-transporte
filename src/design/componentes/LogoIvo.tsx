import simboloAzul from '../../assets/marca/ivo-simbolo-azul.svg'
import simboloBranco from '../../assets/marca/ivo-simbolo-branco.svg'
import logotipoAzul from '../../assets/marca/ivo-logotipo-azul.svg'
import logotipoBranco from '../../assets/marca/ivo-logotipo-branco.svg'
import horizontalAzul from '../../assets/marca/ivo-logotipo-horizontal-azul.svg'
import horizontalBranco from '../../assets/marca/ivo-logotipo-horizontal-branco.svg'

type Variante = 'simbolo' | 'logotipo' | 'horizontal'
type Cor = 'azul' | 'branco'

// Arquivos oficiais do kit da marca (o "IVO" é lettering em curvas: nunca recriar com fonte).
const ARQUIVOS: Record<Variante, Record<Cor, { src: string; largura: number; altura: number }>> = {
  simbolo: {
    azul: { src: simboloAzul, largura: 172, altura: 148 },
    branco: { src: simboloBranco, largura: 172, altura: 148 },
  },
  logotipo: {
    azul: { src: logotipoAzul, largura: 351, altura: 165 },
    branco: { src: logotipoBranco, largura: 351, altura: 165 },
  },
  horizontal: {
    azul: { src: horizontalAzul, largura: 682, altura: 129 },
    branco: { src: horizontalBranco, largura: 682, altura: 129 },
  },
}

export function LogoIvo({
  variante = 'horizontal',
  cor = 'azul',
  altura = 32,
  className = '',
}: {
  variante?: Variante
  cor?: Cor
  /** Altura em px; a largura segue a proporção do arquivo. */
  altura?: number
  className?: string
}) {
  const a = ARQUIVOS[variante][cor]
  return (
    <img
      src={a.src}
      alt="IVO Transportes"
      height={altura}
      width={Math.round((a.largura / a.altura) * altura)}
      className={className}
    />
  )
}
