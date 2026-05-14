/**
 * Handler mínimo (diagnóstico Vercel / limite de funções Hobby).
 * GET ou POST /api/rep-punch-test — sem dependências.
 */

export default async function handler(_request: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      ok: true,
      message: 'pong',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
