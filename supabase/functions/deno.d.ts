// Declaração mínima dos globais do Deno usados pelas funções (o tsc do projeto roda em Node).
declare const Deno: {
  env: { get(nome: string): string | undefined }
  serve(manipulador: (req: Request) => Response | Promise<Response>): unknown
}
