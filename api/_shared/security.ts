/**
 * Módulo de segurança centralizado para APIs serverless.
 *
 * Fornece:
 * - CORS seguro com whitelist de origens
 * - Validação de variáveis de ambiente
 * - Rate limiting por IP
 * - Helpers de segurança comuns
 *
 * @security Nível: CRÍTICO - Alterações devem ser revisadas por segurança
 */

// ============================================================================
// CONFIGURAÇÃO DE CORS
// ============================================================================

/** Origens permitidas para CORS em produção */
const PRODUCTION_ORIGINS = [
  // Adicione seus domínios de produção aqui
  // Exemplo: 'https://app.seudominio.com'
];

/** Origens permitidas para desenvolvimento */
const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3010',
  'http://localhost:5173', // Vite default
  'http://localhost:4173', // Vite preview
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3010',
  'http://127.0.0.1:5173',
];

function toOrigin(raw: string | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function inferAllowedOriginsFromEnv(): string[] {
  const candidates = [
    process.env.CORS_APP_ORIGIN,
    process.env.APP_URL,
    process.env.VITE_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ];
  const out = new Set<string>();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) out.add(origin);
  }
  return Array.from(out);
}

/**
 * Obtém as origens permitidas para CORS.
 * Pode ser configurado via variável de ambiente CORS_ALLOWED_ORIGINS.
 */
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  }
  const inferred = inferAllowedOriginsFromEnv();

  const isDev = process.env.NODE_ENV !== 'production' ||
                process.env.VERCEL_ENV === 'development' ||
                process.env.VITE_APP_ENV === 'development';

  if (isDev) {
    return [...DEVELOPMENT_ORIGINS, ...PRODUCTION_ORIGINS, ...inferred];
  }

  return [...PRODUCTION_ORIGINS, ...inferred];
}

function isDevelopmentEnv(): boolean {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL_ENV === 'development' ||
    process.env.VITE_APP_ENV === 'development'
  );
}

/**
 * Valida se uma origem está na whitelist.
 * Retorna a origem se permitida, ou null se não.
 */
function validateOrigin(origin: string | null): string | null {
  if (!origin) return null;

  const allowed = getAllowedOrigins();

  // Se não há whitelist definida, aceitar apenas em dev local.
  if (allowed.length === 0) {
    return isDevelopmentEnv() ? origin : null;
  }

  // Verifica match exato
  if (allowed.includes(origin)) {
    return origin;
  }

  // Verifica wildcard para subdomínios (ex: *.seudominio.com)
  for (const allowedOrigin of allowed) {
    if (allowedOrigin.startsWith('*.')) {
      const domain = allowedOrigin.slice(2);
      if (origin.endsWith(domain)) {
        return origin;
      }
    }
  }

  return null;
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    const reqOrigin = new URL(request.url).origin;
    return origin === reqOrigin;
  } catch {
    return false;
  }
}

/**
 * Gera headers CORS seguros baseados na origem da requisição.
 * NUNCA retorna '*' em produção.
 */
export function getSecureCorsHeaders(
  request: Request,
  options?: {
    allowMethods?: string;
    allowHeaders?: string;
    maxAge?: string;
  }
): Record<string, string> {
  const requestOrigin = request.headers.get('Origin');
  let allowedOrigin = validateOrigin(requestOrigin);
  if (!allowedOrigin && isSameOriginRequest(request) && requestOrigin) {
    allowedOrigin = requestOrigin;
  }

  // Se a origem não é permitida, não retorna header CORS (bloqueia por padrão)
  if (!allowedOrigin && requestOrigin) {
    console.warn(`[CORS] Origem bloqueada: ${requestOrigin}`);
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': options?.allowMethods || 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': options?.allowHeaders || 'Content-Type, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };

  if (options?.maxAge) {
    headers['Access-Control-Max-Age'] = options.maxAge;
  }

  // Não retornar wildcard e só ecoar origem validada.
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  if (isSameOriginRequest(request)) return true;
  return validateOrigin(origin) !== null;
}

export function requireTrustedOrigin(
  request: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  if (isTrustedOrigin(request)) return null;
  return Response.json(
    { error: 'Origem não permitida.', code: 'FORBIDDEN_ORIGIN' },
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ============================================================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// ============================================================================

interface EnvValidation {
  name: string;
  required: boolean;
  minLength?: number;
  pattern?: RegExp;
  description: string;
}

const REQUIRED_ENV_VARS: EnvValidation[] = [
  {
    name: 'SUPABASE_URL',
    required: true,
    pattern: /^https:\/\/[a-z0-9-]+\.supabase\.co$/,
    description: 'URL do projeto Supabase',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    required: true,
    minLength: 32,
    description: 'Service Role Key do Supabase (NUNCA exponha no frontend!)',
  },
  {
    name: 'API_KEY',
    required: true,
    minLength: 16,
    description: 'Chave de API para autenticação serverless',
  },
  {
    name: 'TIMESTAMP_SECRET_KEY',
    required: false,
    minLength: 32,
    description: 'Chave para assinatura de timestamps (recomendado mínimo 32 chars)',
  },
];

/**
 * Valida variáveis de ambiente críticas.
 * Lança erro se alguma variável obrigatória estiver ausente ou inválida.
 */
export function validateEnvVars(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const env of REQUIRED_ENV_VARS) {
    const value = (process.env[env.name] || '').trim();

    if (env.required && !value) {
      errors.push(`[CRÍTICO] ${env.name}: ${env.description} - NÃO CONFIGURADA`);
      continue;
    }

    if (value && env.minLength && value.length < env.minLength) {
      errors.push(`[AVISO] ${env.name}: Muito curta (mínimo ${env.minLength} caracteres)`);
    }

    if (value && env.pattern && !env.pattern.test(value)) {
      errors.push(`[AVISO] ${env.name}: Formato inválido (esperado: ${env.pattern})`);
    }
  }

  // Validações específicas de segurança
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (serviceKey.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')) {
    errors.push('[CRÍTICO] SUPABASE_SERVICE_ROLE_KEY: Parece ser uma chave de EXEMPLO/TESTE - Gere uma nova chave!');
  }

  const apiKey = process.env.API_KEY || '';
  if (apiKey && (apiKey === 'test' || apiKey === '123456' || apiKey === 'changeme')) {
    errors.push('[CRÍTICO] API_KEY: Chave fraca ou padrão detectada - Gere uma chave forte (openssl rand -hex 32)!');
  }

  return { valid: errors.filter(e => e.includes('[CRÍTICO]')).length === 0, errors };
}

/**
 * Validação fail-fast - lança exceção se env vars críticas estiverem faltando.
 * Use no startup da aplicação.
 */
export function assertEnvVars(): void {
  const { valid, errors } = validateEnvVars();

  if (errors.length > 0) {
    console.error('='.repeat(60));
    console.error('ERROS DE CONFIGURAÇÃO DE SEGURANÇA:');
    console.error('='.repeat(60));
    errors.forEach(e => console.error(e));
    console.error('='.repeat(60));
  }

  if (!valid) {
    throw new Error(
      'Variáveis de ambiente críticas não configuradas. ' +
      'Verifique o console para detalhes e configure o arquivo .env.local'
    );
  }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Store em memória (apenas para serverless/functions - não persiste entre execuções)
const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  maxRequests: number;    // Máximo de requisições
  windowMs: number;       // Janela de tempo em ms
  keyPrefix?: string;     // Prefixo para identificar o tipo de limit
}

const DEFAULT_RATE_LIMITS = {
  general: { maxRequests: 100, windowMs: 60 * 1000 },      // 100 req/min
  login: { maxRequests: 5, windowMs: 60 * 1000 },            // 5 tentativas/min
  api: { maxRequests: 60, windowMs: 60 * 1000 },            // 60 req/min para APIs
  punch: { maxRequests: 10, windowMs: 60 * 1000 },           // 10 batidas/min
};

/**
 * Rate limiting por IP.
 * Retorna true se a requisição está dentro do limite, false se excedeu.
 */
export function checkRateLimit(
  identifier: string,  // IP ou userId
  type: 'general' | 'login' | 'api' | 'punch' = 'general'
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const config = DEFAULT_RATE_LIMITS[type];
  const key = `${type}:${identifier}`;

  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // Nova janela
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  // Dentro da janela atual
  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Extrai IP do request (considera headers de proxy).
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback (não confiável em produção com proxies)
  return 'unknown';
}

// ============================================================================
// UTILITÁRIOS DE SEGURANÇA
// ============================================================================

/**
 * Sanitiza input de usuário para prevenir XSS.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/&/g, '&amp;');
}

/**
 * Gera um token seguro aleatório.
 */
export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);

  // Usa crypto.getRandomValues se disponível (navegador)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
  } else {
    // Fallback para Node.js
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }

  return result;
}

/**
 * Valida Bearer token de autorização.
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Compara strings em tempo constante (previne timing attacks).
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
