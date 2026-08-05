import { observabilityConsole } from '../logger/observabilityConsole.js';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/index.js';

let revocationTableReady: boolean | null = null;

async function ensureRevocationTable(): Promise<boolean> {
  if (revocationTableReady === true) return true;
  if (revocationTableReady === false) return false;
  try {
    await pool.queryTrustedBootstrap(`
      CREATE TABLE IF NOT EXISTS public.revoked_tokens (
        jti text PRIMARY KEY,
        user_id text NOT NULL,
        revoked_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz
      )
    `);
    await pool.queryTrustedBootstrap(`
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON public.revoked_tokens (user_id)
    `);
    revocationTableReady = true;
    return true;
  } catch (e) {
    observabilityConsole.warn('[tokenRevocation] tabela indisponível:', e);
    revocationTableReady = false;
    return false;
  }
}

export function newTokenJti(): string {
  return randomUUID();
}

export async function isTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti?.trim()) return false;
  if (!(await ensureRevocationTable())) return false;
  // Bootstrap: revoked_tokens é global (sem company_id) — evita falso positivo/negativo sob RLS tenant.
  const r = await pool.queryTrustedBootstrap(
    'SELECT 1 FROM public.revoked_tokens WHERE jti = $1 LIMIT 1',
    [jti],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function revokeToken(jti: string, userId: string, expiresAt?: Date): Promise<void> {
  if (!jti?.trim() || !userId?.trim()) return;
  if (!(await ensureRevocationTable())) return;
  await pool.queryTrustedBootstrap(
    `INSERT INTO public.revoked_tokens (jti, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, userId, expiresAt ?? null],
  );
}
