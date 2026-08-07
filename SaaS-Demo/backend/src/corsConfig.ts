/**
 * Origens permitidas para o frontend (Vercel + prod).
 * CORS_ORIGINS/CORS_ALLOWED_ORIGINS no .env acrescentam mais URLs (separadas por vírgula).
 * localhost NÃO entra em production — use CORS_ORIGINS no staging.
 */
const DEFAULT_ORIGINS_PROD = [
  'https://pontowebdesk.vercel.app',
  'https://pontowebdesk.com.br',
  'https://www.pontowebdesk.com.br',
  'https://api.phmsdev.com.br',
];

const DEFAULT_ORIGINS_DEV = [
  ...DEFAULT_ORIGINS_PROD,
  'http://localhost:3010',
  'http://localhost:5173',
];

/** Preview deployments Vercel: pontowebdesk-xxx.vercel.app */
const VERCEL_PREVIEW_RE = /^https:\/\/pontowebdesk-[a-z0-9-]+\.vercel\.app$/i;

export function buildCorsAllowList(): string[] {
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const defaults = isProd ? DEFAULT_ORIGINS_PROD : DEFAULT_ORIGINS_DEV;
  const fromEnv = `${process.env.CORS_ORIGINS || ''},${process.env.CORS_ALLOWED_ORIGINS || ''}`
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
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
