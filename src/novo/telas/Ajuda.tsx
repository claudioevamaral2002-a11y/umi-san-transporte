import type { ReactNode } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { useTituloNaTela } from '../../design/componentes/Tela.tsx'
import { ajudaCliente, type AjudaCliente } from '../../lib/ajuda.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { descreverFaixas } from '../../lib/contratos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { TextoContato, useContatoIvo } from '../../telas/saldo/ContatoIvo.tsx'

/** "12 horas", "1 hora", "2 dias" (múltiplos de 24 a partir de 48 h). */
export function formatarHoras(h: number): string {
  if (h >= 48 && h % 24 === 0) return `${h / 24} dias`
  return h === 1 ? '1 hora' : `${h} horas`
}

/** Pergunta que abre e fecha (`<details>`): o texto fica no código, os números vêm do banco. */
function Pergunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group border-b border-borda last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
        {titulo}
        <Icone nome="setaBaixo" tamanho={20} className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-2 pb-4 ivo-corpo text-texto-suave">{children}</div>
    </details>
  )
}

/** "Falar com a IVO": o contato de Configurações (link de telefone ou WhatsApp quando é número). */
function FalarComIvo() {
  const { dados, erro, recarregar } = useContatoIvo()
  return (
    <Cartao className="space-y-2" data-testid="falar-com-ivo">
      <h2 className="ivo-h3">Falar com a IVO</h2>
      {dados === undefined ? (
        erro ? (
          <div className="space-y-2">
            <Mensagem tipo="erro">Não foi possível carregar o contato.</Mensagem>
            <Botao onClick={recarregar}>Tentar de novo</Botao>
          </div>
        ) : (
          <Skeleton className="h-6 w-48" />
        )
      ) : dados ? (
        <p className="ivo-corpo">
          <TextoContato contato={dados} />
        </p>
      ) : (
        <p className="ivo-corpo text-texto-suave">Contato ainda não cadastrado</p>
      )}
    </Cartao>
  )
}

function PerguntasCliente({ ajuda, visualizador }: { ajuda: AjudaCliente | null; visualizador: boolean }) {
  const faixas = ajuda ? descreverFaixas(ajuda.faixas_cancelamento) : []
  return (
    <>
      {visualizador ? (
        <Pergunta titulo="O que eu vejo no app?">
          <p>
            Seu perfil acompanha os pedidos da empresa: as corridas, a agenda e a carteira. Quem faz e aprova os pedidos é
            o Solicitante ou o Administrador.
          </p>
        </Pergunta>
      ) : (
        <>
          <Pergunta titulo="Como funciona o orçamento?">
            <p>
              Você faz o pedido no Início e a IVO manda o orçamento
              {ajuda ? ` em até ${formatarHoras(ajuda.prazo_orcar_horas)}` : ''}. O horário fica pré-reservado enquanto o
              orçamento não é decidido.
            </p>
            {ajuda && <p>O orçamento vale por {formatarHoras(ajuda.validade_orcamento_horas)}. Depois disso, ele expira.</p>}
          </Pergunta>
          <Pergunta titulo="Como aprovo o orçamento?">
            <p>
              O orçamento aparece em Minhas corridas. Abra a corrida, confira os valores e aprove. Se algo estiver errado,
              peça revisão ou recuse.
            </p>
          </Pergunta>
        </>
      )}
      <Pergunta titulo="Posso cancelar? Tem multa?">
        {faixas.length > 0 ? (
          <>
            <p>A multa depende da antecedência, como no contrato da empresa:</p>
            <ul className="list-disc space-y-1 pl-5" data-testid="faixas-cancelamento">
              {faixas.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>As regras de cancelamento ficam no contrato da empresa. Fale com a IVO para saber as faixas de multa.</p>
        )}
      </Pergunta>
      {ajuda?.forma_cobranca === 'FATURADO' ? (
        <Pergunta titulo="Como a empresa paga?">
          <p>
            A empresa recebe fatura quinzenal com nota fiscal. As corridas concluídas entram na fatura; quem administra a
            empresa acompanha em Painel da empresa.
          </p>
        </Pergunta>
      ) : (
        <Pergunta titulo="Como recarregar o saldo?">
          <p>
            A empresa usa saldo pré-pago. Para recarregar, fale com a IVO pelo contato acima. O saldo e o extrato ficam em
            Carteira da empresa.
          </p>
        </Pergunta>
      )}
    </>
  )
}

function AjudaDoCliente() {
  const { perfil } = useSessao()
  const { dados, erro } = useConsulta('ajuda-cliente', ajudaCliente, { cache: true })
  if (dados === undefined && !erro) return <Skeleton className="h-48" />
  // Sem contrato vigente ou falha na leitura: as respostas sem os números do contrato.
  return <PerguntasCliente ajuda={dados ?? null} visualizador={perfil?.nivel === 3} />
}

function AjudaDoMotorista() {
  return (
    <>
      <Pergunta titulo="Como orçar um pedido?">
        <p>
          A chamada nova aparece no Início. Confira a rota e o horário, escolha o veículo e aceite pela tabela, ou proponha
          outro valor. A empresa recebe o orçamento e aprova.
        </p>
      </Pergunta>
      <Pergunta titulo="Como registro a saída?">
        <p>
          No horário da corrida, abra-a no Início e deslize para sair. A saída fica registrada e a empresa passa a
          acompanhar a viagem no mapa.
        </p>
      </Pergunta>
      <Pergunta titulo="Como concluo a corrida?">
        <p>Ao chegar ao destino, toque em Concluir serviço. A corrida passa a contar em Corridas do mês.</p>
      </Pergunta>
    </>
  )
}

function AjudaDoMaster() {
  return (
    <>
      <Pergunta titulo="Onde ficam os contratos?">
        <p>Em Contratos: cada empresa tem a sua versão vigente, com preços, prazos e faixas de cancelamento.</p>
      </Pergunta>
      <Pergunta titulo="Onde mudo as categorias e os preços?">
        <p>Em Categorias e preços: o lápis de cada categoria muda o nome, os preços e até quantas pessoas ela leva.</p>
      </Pergunta>
      <Pergunta titulo="Onde recarrego o saldo de uma empresa?">
        <p>Em Créditos: escolha a empresa para recarregar ou ajustar o saldo.</p>
      </Pergunta>
      <Pergunta titulo="Onde ficam as faturas?">
        <p>Em Faturas: as empresas no Faturado, com a quinzena a faturar e as faturas vencidas.</p>
      </Pergunta>
      <Pergunta titulo="Onde vejo quem fez o quê?">
        <p>Em Auditoria: as ações de todos, com filtro por pessoa, ação e período.</p>
      </Pergunta>
    </>
  )
}

/** v2.2 (§5.5): Ajuda de cada perfil, com "Falar com a IVO" e perguntas que abrem e fecham. */
export function Ajuda() {
  // O h1 daqui é o nome da página: o cabeçalho "← Início" do app novo não o repete.
  useTituloNaTela('visivel')
  const { perfil } = useSessao()
  if (!perfil) return null
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4">
      <h1 className="ivo-h2">Ajuda</h1>
      <FalarComIvo />
      <Cartao>
        <h2 className="sr-only">Perguntas</h2>
        {perfil.papel === 'CLIENTE' ? (
          <AjudaDoCliente />
        ) : perfil.papel === 'MOTORISTA' ? (
          <AjudaDoMotorista />
        ) : (
          <AjudaDoMaster />
        )}
      </Cartao>
    </main>
  )
}
