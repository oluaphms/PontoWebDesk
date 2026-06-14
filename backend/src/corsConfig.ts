/**
 * Origens permitidas para o frontend (Vercel + dev local).
 * CORS_ORIGINS/CORS_ALLOWED_ORIGINS no .env acrescentam mais URLs (separadas por vírgula).
 */
const DEFAULT_ORIGINS = [
  'https://pontowebdesk.vercel.app',
  'https://pontowebdesk.com.br',
  'https://www.pontowebdesk.com.br',
  'https://api.phmsdev.com.br',
  'http://localhost:3010',
  'http://localhost:5173',
];

/** Preview deployments Vercel: pontowebdesk-xxx.vercel.app */
const VERCEL_PREVIEW_RE = /^https:\/\/pontowebdesk-[a-z0-9-]+\.vercel\.app$/i;

export function buildCorsAllowList(): string[] {
  const fromEnv = `${process.env.CORS_ORIGINS || ''},${process.env.CORS_ALLOWED_ORIGINS || ''}`
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

export function isOriginAllowed(origin: string | undefined, allowList: string[]): boolean {
  if (!origin) return true;
  if (allowList.includes(origin)) return true;
  return VERCEL_PREVIEW_RE.test(origin);
}

export function resolveCorsOrigin(
  origin: string | undefined,
  allowList: string[],
): string | boolean {
  if (!origin) return true;
  if (isOriginAllowed(origin, allowList)) return origin;
  return false;
}
