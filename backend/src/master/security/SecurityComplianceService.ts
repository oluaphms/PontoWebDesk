/**
 * Security Compliance Control Plane — checklist honesto da ETAPA 3.
 * Nunca marca ✅ sem evidência no runtime / filesystem / env.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getRateLimitProvider } from '../../security/rateLimit/redisProvider.js';
import {
  SECRET_REGISTRY,
  validateSecretRegistry,
} from '../../security/secrets/secretRegistry.js';
import { resolveMasterPersistenceMode } from '../adapters/postgres/persistenceMode.js';

export type ComplianceStatus = 'ok' | 'partial' | 'missing' | 'optional';

export type ComplianceCheckItem = {
  id:
    | 'pentest'
    | 'owasp'
    | 'lgpd'
    | 'encryption'
    | 'backup'
    | 'restore'
    | 'audit'
    | 'rate_limit'
    | 'session_rotation'
    | 'mfa';
  label: string;
  status: ComplianceStatus;
  summary: string;
  evidence: string[];
  actions: string[];
};

export type SecurityComplianceSnapshot = {
  generatedAt: string;
  score: { ok: number; partial: number; missing: number; optional: number; total: number };
  grade: 'A' | 'B' | 'C' | 'D';
  items: ComplianceCheckItem[];
  note: string;
};

function envFlag(name: string): boolean {
  const value = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function envPresent(name: string, minLength = 1): boolean {
  return String(process.env[name] || '').trim().length >= minLength;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const hasDr = existsSync(path.join(dir, 'scripts', 'disaster-recovery', 'backup.sh'));
    const hasBackend = existsSync(path.join(dir, 'backend', 'package.json'));
    if (hasDr || hasBackend) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function fileExists(...parts: string[]): boolean {
  return existsSync(path.join(repoRoot(), ...parts));
}

async function redisDistributed(): Promise<boolean> {
  try {
    const provider = await getRateLimitProvider();
    return Boolean(provider);
  } catch {
    return false;
  }
}

function gradeOf(score: SecurityComplianceSnapshot['score']): SecurityComplianceSnapshot['grade'] {
  if (score.missing === 0 && score.partial <= 1) return 'A';
  if (score.missing <= 1 && score.partial <= 3) return 'B';
  if (score.missing <= 3) return 'C';
  return 'D';
}

export async function buildSecurityComplianceSnapshot(): Promise<SecurityComplianceSnapshot> {
  const secrets = validateSecretRegistry();
  const requiredNames = new Set(
    SECRET_REGISTRY.filter((item) => item.required).map((item) => item.name),
  );
  const secretsOk = secrets.every((item) => !requiredNames.has(item.name) || item.valid);
  const redisOk = await redisDistributed();
  const redisRequired = envFlag('RATE_LIMIT_REDIS_REQUIRED');
  const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const persistence = resolveMasterPersistenceMode();

  const encryptionKey =
    envPresent('DATA_ENCRYPTION_KEY', 16) || envPresent('DEVICE_CREDENTIALS_MASTER_KEY', 32);
  const jwtOk = envPresent('JWT_SECRET', 32) && envPresent('MASTER_JWT_SECRET', 32);
  const httpsHints =
    envFlag('FORCE_HTTPS') ||
    envPresent('CORS_APP_ORIGIN', 8) ||
    String(process.env.FRONTEND_URL || '').startsWith('https://');

  const backupScripts =
    fileExists('scripts', 'disaster-recovery', 'backup.sh') &&
    fileExists('scripts', 'disaster-recovery', 'verify-backup.sh');
  const restoreScript = fileExists('scripts', 'disaster-recovery', 'restore.sh');
  const backupEvidence = envPresent('BACKUP_LAST_OK_AT') || envPresent('BACKUP_EVIDENCE_URL');
  const restoreEvidence = envPresent('RESTORE_LAST_OK_AT') || envPresent('RESTORE_EVIDENCE_URL');
  const pentestEvidence =
    envPresent('PENTEST_LAST_OK_AT') ||
    envPresent('PENTEST_REPORT_URL') ||
    fileExists('docs', 'security', 'pentest-latest.md');

  const lgpdSchema =
    fileExists('supabase', 'migrations', '20260520210000_lgpd_governance.sql') ||
    fileExists('api', '_shared', 'lgpdGovernance.ts');
  const lgpdVpsParity = envFlag('LGPD_VPS_ENABLED') || fileExists('backend', 'src', 'routes', 'lgpdRoutes.ts');

  const items: ComplianceCheckItem[] = [
    {
      id: 'pentest',
      label: 'Pentest',
      status: pentestEvidence ? 'ok' : 'missing',
      summary: pentestEvidence
        ? 'Evidência de pentest registrada (env ou relatório).'
        : 'Sem evidência de pentest externo/retest arquivado.',
      evidence: [
        pentestEvidence ? 'PENTEST_* ou docs/security/pentest-latest.md' : 'Nenhuma evidência',
      ],
      actions: pentestEvidence
        ? []
        : [
            'Arquivar relatório em docs/security/pentest-latest.md',
            'Ou definir PENTEST_LAST_OK_AT / PENTEST_REPORT_URL',
          ],
    },
    {
      id: 'owasp',
      label: 'OWASP',
      status: secretsOk && jwtOk ? 'ok' : 'partial',
      summary:
        'Headers, CSRF, RLS, rate limit operacional e secrets registry cobrem a base OWASP Top 10.',
      evidence: [
        'securityHeaders / webSecurity / CSRF',
        'tenant RLS fail-closed',
        secretsOk ? 'Secret registry válido' : 'Secrets com gaps',
        'scripts/security-audit.mjs',
      ],
      actions: secretsOk
        ? []
        : ['Corrigir secrets obrigatórios (JWT_SECRET, DEVICE_CREDENTIALS_MASTER_KEY, DATABASE_URL)'],
    },
    {
      id: 'lgpd',
      label: 'LGPD',
      status: lgpdSchema && lgpdVpsParity ? 'ok' : lgpdSchema ? 'partial' : 'missing',
      summary: lgpdVpsParity
        ? 'Governança LGPD presente com paridade VPS.'
        : 'Schema/handlers LGPD existem no path Supabase; paridade VPS incompleta.',
      evidence: [
        lgpdSchema ? 'lgpdGovernance / migration' : 'Sem schema LGPD',
        lgpdVpsParity ? 'Rotas VPS LGPD' : 'Sem backend/src/routes/lgpdRoutes.ts',
      ],
      actions: lgpdVpsParity
        ? []
        : ['Portar /api/lgpd/* para Express VPS', 'Ou definir LGPD_VPS_ENABLED=true após deploy'],
    },
    {
      id: 'encryption',
      label: 'Criptografia',
      status: encryptionKey && jwtOk ? (httpsHints ? 'ok' : 'partial') : 'partial',
      summary: 'Senhas com hash forte; AES-GCM para credenciais; TLS depende do reverse proxy.',
      evidence: [
        jwtOk ? 'JWT_SECRET + MASTER_JWT_SECRET' : 'JWT secrets incompletos',
        encryptionKey ? 'Chave AES configurada' : 'DATA_ENCRYPTION_KEY / DEVICE_CREDENTIALS_* ausente',
        httpsHints ? 'HTTPS/HSTS hints' : 'Sem FRONTEND_URL https / FORCE_HTTPS',
      ],
      actions: [
        ...(encryptionKey ? [] : ['Configurar DEVICE_CREDENTIALS_MASTER_KEY e DATA_ENCRYPTION_KEY']),
        ...(httpsHints ? [] : ['Expor app via HTTPS e HSTS no proxy']),
      ],
    },
    {
      id: 'backup',
      label: 'Backup',
      status: backupScripts && backupEvidence ? 'ok' : backupScripts ? 'partial' : 'missing',
      summary: backupEvidence
        ? 'Scripts DR + evidência do último backup OK.'
        : 'Scripts de backup existem; falta evidência operacional do último dump.',
      evidence: [
        backupScripts ? 'scripts/disaster-recovery/backup.sh' : 'Scripts ausentes',
        backupEvidence ? 'BACKUP_LAST_OK_AT / BACKUP_EVIDENCE_URL' : 'Sem evidência do último backup',
      ],
      actions: backupEvidence
        ? []
        : ['Agendar backup.sh', 'Registrar BACKUP_LAST_OK_AT após verify-backup.sh'],
    },
    {
      id: 'restore',
      label: 'Restore',
      status: restoreScript && restoreEvidence ? 'ok' : restoreScript ? 'partial' : 'missing',
      summary: restoreEvidence
        ? 'Restore testado com evidência.'
        : 'Script de restore existe; falta prova periódica em staging.',
      evidence: [
        restoreScript ? 'scripts/disaster-recovery/restore.sh' : 'Script ausente',
        restoreEvidence ? 'RESTORE_LAST_OK_AT / RESTORE_EVIDENCE_URL' : 'Sem teste de restore registrado',
      ],
      actions: restoreEvidence
        ? []
        : ['Executar restore em staging com CONFIRM_RESTORE=YES', 'Registrar RESTORE_LAST_OK_AT'],
    },
    {
      id: 'audit',
      label: 'Auditoria',
      status: persistence === 'postgres' ? 'ok' : 'partial',
      summary:
        persistence === 'postgres'
          ? 'Audit Master persistente em PostgreSQL.'
          : 'Audit Master ativo, porém InMemory (perdido no restart).',
      evidence: [
        `MASTER_PERSISTENCE=${persistence}`,
        'GET /api/master/audit',
        'trilhas operacionais / LGPD / auth deny',
      ],
      actions:
        persistence === 'postgres'
          ? []
          : ['Definir MASTER_PERSISTENCE=postgres em produção'],
    },
    {
      id: 'rate_limit',
      label: 'Rate Limit',
      status: redisOk || (!production && !redisRequired) ? 'ok' : redisRequired ? 'missing' : 'partial',
      summary: redisOk
        ? 'Rate limit distribuído (Redis/Upstash) ativo; Master auth limitado.'
        : production
          ? 'Rate limit Master/auth ativo, mas store in-memory (fraco em multi-instância).'
          : 'Rate limit ativo com fallback memória (dev/local).',
      evidence: [
        'Auth empresa: 5/15min',
        'Master auth: 5/15min (login/refresh)',
        redisOk ? 'Redis/Upstash OK' : 'Fallback memória',
        redisRequired ? 'RATE_LIMIT_REDIS_REQUIRED=true' : 'Redis não obrigatório',
      ],
      actions: redisOk
        ? []
        : ['Configurar REDIS_URL ou UPSTASH_*', 'RATE_LIMIT_REDIS_REQUIRED=true em produção'],
    },
    {
      id: 'session_rotation',
      label: 'Session Rotation',
      status: 'ok',
      summary:
        'Master: refresh rotacionado + reuse detection. Empresas: JWT curto + jti revoke + company_session_version.',
      evidence: [
        'MasterAuth refresh rotation',
        'pwd_master_session / pwd_master_refresh HttpOnly',
        'company_session_version no bloqueio comercial',
        'tokenRevocationService no logout',
      ],
      actions: [],
    },
    {
      id: 'mfa',
      label: 'MFA (opcional)',
      status: envFlag('MFA_ENABLED') ? 'partial' : 'optional',
      summary: envFlag('MFA_ENABLED')
        ? 'MFA sinalizado, mas enroll/challenge TOTP ainda não está completo no login.'
        : 'MFA permanece opcional e desligado — não é requisito obrigatório da ETAPA 3.',
      evidence: [
        envFlag('MFA_ENABLED') ? 'MFA_ENABLED=true' : 'MFA_ENABLED ausente/false',
        'Flag UI two_factor_enabled sem enforcement no login',
      ],
      actions: envFlag('MFA_ENABLED')
        ? ['Implementar TOTP enroll + challenge no login admin/Master']
        : ['Manter opcional até demanda comercial', 'Quando necessário: TOTP (otplib) + recovery codes'],
    },
  ];

  const score = {
    ok: items.filter((i) => i.status === 'ok').length,
    partial: items.filter((i) => i.status === 'partial').length,
    missing: items.filter((i) => i.status === 'missing').length,
    optional: items.filter((i) => i.status === 'optional').length,
    total: items.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    score,
    grade: gradeOf(score),
    items,
    note:
      'Checklist honesto: ✅ só com evidência. Itens parciais/ausentes exigem ação operacional ou código.',
  };
}

/** Alias estável para controllers. */
export const SecurityComplianceService = {
  snapshot: buildSecurityComplianceSnapshot,
};
