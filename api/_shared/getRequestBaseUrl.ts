/**
 * Base absoluta para `new URL()` em handlers serverless (Vercel/Node).
 * `request.url` costuma ser só o path (ex.: `/api/rep-bridge?slug=punch`) — sem base, `new URL(request.url)` lança TypeError.
 * Ficheiro sob `api/_shared` para o bundler da Vercel incluir sempre no grafo das funções em `api/`.
 */

export function getBaseUrl(request: Request): string {
  const rawProto = request.headers.get('x-forwarded-proto') || 'https';
  const protocol = String(rawProto).split(',')[0]?.trim() || 'https';
  const host = request.headers.get('host');
  if (!host) {
    throw new Error('Host header ausente');
  }
  return `${protocol}://${host}`;
}

/** Resolve `request.url` contra a origem derivada dos cabeçalhos (URL absoluta válida). */
export function resolveRequestUrl(request: Request): URL {
  return new URL(request.url, getBaseUrl(request));
}
