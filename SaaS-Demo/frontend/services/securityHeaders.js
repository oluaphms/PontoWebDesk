/**
 * Headers de segurança HTTP para todas as respostas da API.
 *
 * Implementa:
 * - Content-Security-Policy (CSP)
 * - HTTP Strict Transport Security (HSTS)
 * - X-Frame-Options (clickjacking)
 * - X-Content-Type-Options (MIME sniffing)
 * - Referrer-Policy
 * - Permissions-Policy
 * - X-XSS-Protection (legado, mas ainda útil)
 *
 * Uso:
 *   import { applySecurityHeaders } from './securityHeaders.js';
 *   const headers = applySecurityHeaders({ ...corsHeaders });
 */

/**
 * Retorna objeto de headers de segurança para APIs.
 * Não inclui CSP restritivo (APIs retornam JSON, não HTML).
 *
 * @param {Record<string, string>} [base] — headers base para mesclar
 * @returns {Record<string, string>}
 */
export function apiSecurityHeaders(base = {}) {
  return {
    ...base,
    // Previne MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Previne clickjacking
    'X-Frame-Options': 'DENY',
    // HSTS: força HTTPS por 1 ano
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    // Não vazar URL de referência
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Desabilitar features desnecessárias
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // XSS protection (legado)
    'X-XSS-Protection': '1; mode=block',
    // Remover informações do servidor
    'X-Powered-By': '',
    // Cache: APIs não devem ser cacheadas por proxies
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  };
}

/**
 * Headers de segurança para respostas HTML/frontend.
 * CSP mais restritivo.
 *
 * @param {{ nonce?: string, allowedOrigins?: string[] }} [opts]
 * @returns {Record<string, string>}
 */
export function frontendSecurityHeaders(opts = {}) {
  const { nonce, allowedOrigins = [] } = opts;
  const nonceDirective = nonce ? ` 'nonce-${nonce}'` : '';
  const originsDirective = allowedOrigins.length ? ` ${allowedOrigins.join(' ')}` : '';

  const csp = [
    `default-src 'self'${originsDirective}`,
    `script-src 'self'${nonceDirective} 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,  // necessário para Tailwind/CSS-in-JS
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  return {
    ...apiSecurityHeaders(),
    'Content-Security-Policy': csp,
  };
}

/**
 * Aplica headers de segurança a um objeto Response existente.
 * @param {Response} response
 * @param {'api' | 'frontend'} [type]
 * @returns {Response}
 */
export function withSecurityHeaders(response, type = 'api') {
  const headers = type === 'frontend' ? frontendSecurityHeaders() : apiSecurityHeaders();
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (value) newHeaders.set(key, value);
    else newHeaders.delete(key);
  }
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers:    newHeaders,
  });
}

/**
 * Middleware para adicionar headers de segurança a handlers de API.
 * @param {(req: Request) => Promise<Response>} handler
 * @returns {(req: Request) => Promise<Response>}
 */
export function withSecurity(handler) {
  return async (request) => {
    const response = await handler(request);
    return withSecurityHeaders(response, 'api');
  };
}
