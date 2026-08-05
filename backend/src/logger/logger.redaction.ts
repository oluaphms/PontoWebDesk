const SENSITIVE_KEYS = new Set([
  'password',
  'senha',
  'newpassword',
  'authorization',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'jwt',
  'cookie',
  'set-cookie',
  'x-master-key',
  'x-api-key',
  'otp',
  'magiclink',
  'magic_link',
  'resetcode',
  'reset_code',
  'apikey',
  'api_key',
  'master_api_key',
  'secret',
  'sig',
  'contentbase64',
  'base64',
  'buffer',
  'file',
  'cpf',
  'email',
  'identifier',
  'login',
  'passwordhash',
  'password_hash',
  'encrypted_password',
  'telefone',
  'endereco',
]);

const JWT_REGEX = /\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const BASE64_LONG_REGEX = /\b(?:[A-Za-z0-9+/]{256,}={0,2})\b/g;

function redactString(value: string): string {
  return value
    .replace(BEARER_REGEX, '[REDACTED_BEARER_TOKEN]')
    .replace(JWT_REGEX, '[REDACTED_JWT]')
    .replace(BASE64_LONG_REGEX, '[REDACTED_BASE64_PAYLOAD]');
}

function isBinaryLike(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Buffer !== 'undefined' && value instanceof Buffer)
  );
}

export function redactForLogs<T>(input: T): T {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, keyHint?: string): unknown => {
    if (value == null) return value;

    if (isBinaryLike(value)) {
      return '[REDACTED_BINARY_PAYLOAD]';
    }

    const key = String(keyHint || '').toLowerCase();
    if (key && SENSITIVE_KEYS.has(key)) {
      return '[REDACTED]';
    }

    if (typeof value === 'string') {
      return redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    if (typeof value === 'object') {
      if (seen.has(value as object)) return '[CIRCULAR]';
      seen.add(value as object);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, k);
      }
      return out;
    }

    return value;
  };

  return walk(input) as T;
}
