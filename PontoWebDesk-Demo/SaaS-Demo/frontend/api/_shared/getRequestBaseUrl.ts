/**
 * Base absoluta para `new URL()` em handlers serverless (Vercel/Node).
 * `request.url` costuma ser só o path (ex.: `/api/rep/punch`) — sem base, `new URL(request.url)` lança TypeError.
 *
 * Nota: em Node (Undici), `Request` com URL absoluta **não** expõe `Host` em `request.headers` — usar
 * `x-forwarded-host` (Vercel) ou o hostname já presente em `request.url`.
 */

export function getBaseUrl(request: Request): string {
  const rawProto = request.headers.get('x-forwarded-proto') || 'https';
  const protocol = String(rawProto).split(',')[0]?.trim() || 'https';

  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = request.headers.get('host')?.trim();
  let host = forwarded || hostHeader || '';

  if (!host) {
    try {
      const parsed = new URL(request.url);
      if (parsed.host) host = parsed.host;
    } catch {
      /* ignorar */
    }
  }

  if (!host) {
    throw new Error('Host header ausente');
  }
  return `${protocol}://${host}`;
}

/** Resolve `request.url` contra a origem derivada dos cabeçalhos (URL absoluta válida). */
export function resolveRequestUrl(request: Request): URL {
  try {
    const direct = new URL(request.url);
    if (direct.host) return direct;
  } catch {
    /* URL relativa — continuar com base */
  }
  return new URL(request.url, getBaseUrl(request));
}
