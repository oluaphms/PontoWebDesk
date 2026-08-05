/**
 * Políticas de cache HTTP por endpoint (sem cache global).
 * Uso: construir `Response` com os headers de segurança/CORS e depois aplicar uma das funções abaixo.
 */

export function cachePublic(res: Response, seconds: number, swr = 0): Response {
  res.headers.set(
    'Cache-Control',
    `public, s-maxage=${seconds}, stale-while-revalidate=${swr}`,
  );
  return res;
}

export function cachePrivate(res: Response, seconds: number): Response {
  res.headers.set('Cache-Control', `private, max-age=${seconds}`);
  return res;
}

export function noCache(res: Response): Response {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Evita cache compartilhado indevido quando a resposta depende do Bearer. */
export function varyAuthorization(res: Response): void {
  const existing = res.headers.get('Vary');
  const parts = existing
    ? existing.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (!parts.includes('Authorization')) {
    parts.push('Authorization');
  }
  res.headers.set('Vary', parts.join(', '));
}
