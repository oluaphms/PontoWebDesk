export type SecretDefinition = {
  name: string;
  required: boolean;
  minLength: number;
  rotationDays?: number;
  managed?: boolean;
  description: string;
};

export type SecretValidationResult = {
  name: string;
  configured: boolean;
  valid: boolean;
  issues: string[];
};

export const SECRET_REGISTRY: SecretDefinition[] = [
  {
    name: 'JWT_SECRET',
    required: true,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Assinatura dos JWTs da API local.',
  },
  {
    name: 'MASTER_JWT_SECRET',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Assinatura exclusiva dos JWTs do Painel Master.',
  },
  {
    name: 'MASTER_API_KEY',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Chave de bootstrap e automação do Painel Master.',
  },
  {
    name: 'API_KEY',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Chave legada compartilhada das APIs serverless.',
  },
  {
    name: 'REP_API_KEY',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Chave dedicada dos agentes REP.',
  },
  {
    name: 'CLOCK_AGENT_API_KEY',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Chave de autenticação do agente de relógio.',
  },
  {
    name: 'REP_BRIDGE_TOKEN',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Token legado do bridge REP.',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    required: false,
    minLength: 32,
    rotationDays: 90,
    managed: true,
    description: 'Credencial privilegiada server-side do Supabase.',
  },
  {
    name: 'DEVICE_CREDENTIALS_MASTER_KEY',
    required: true,
    minLength: 32,
    rotationDays: 180,
    managed: true,
    description: 'Chave mestre AES-256-GCM para credenciais operacionais.',
  },
  {
    name: 'DATABASE_URL',
    required: true,
    minLength: 16,
    rotationDays: 180,
    description: 'Conexão PostgreSQL.',
  },
  {
    name: 'REDIS_URL',
    required: false,
    minLength: 16,
    rotationDays: 180,
    description: 'Redis distribuído para rate limiting.',
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN',
    required: false,
    minLength: 16,
    rotationDays: 180,
    description: 'Token Upstash Redis REST para rate limiting distribuído.',
  },
  {
    name: 'CRON_SECRET',
    required: false,
    minLength: 24,
    rotationDays: 90,
    managed: true,
    description: 'Segredo server-side para jobs agendados.',
  },
];

function looksWeak(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    ['test', '123456', 'changeme', 'secret', 'password', 'admin'].includes(lower) ||
    /(?:change[-_ ]?me|generate[-_ ]|placeholder|your[_-].*key)/i.test(value)
  );
}

export function validateSecret(definition: SecretDefinition): SecretValidationResult {
  const value = String(process.env[definition.name] || '').trim();
  const issues: string[] = [];
  if (!value && definition.required) issues.push('missing');
  if (value && value.length < definition.minLength) issues.push('too_short');
  if (value && looksWeak(value)) issues.push('weak_default');
  return {
    name: definition.name,
    configured: Boolean(value),
    valid: issues.length === 0,
    issues,
  };
}

export function validateSecretRegistry(): SecretValidationResult[] {
  return SECRET_REGISTRY.map(validateSecret);
}

export function rotationDue(name: string, lastRotatedAt?: Date | string | null): boolean {
  const definition = SECRET_REGISTRY.find((secret) => secret.name === name);
  if (!definition?.rotationDays || !lastRotatedAt) return false;
  const last = new Date(lastRotatedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= definition.rotationDays * 24 * 60 * 60 * 1000;
}

export function assertRegisteredSecret(name: string): void {
  if (!SECRET_REGISTRY.some((secret) => secret.name === name)) {
    throw new Error('SECRET_NOT_REGISTERED');
  }
}
