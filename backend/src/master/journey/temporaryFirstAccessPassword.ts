/**
 * Persistência cifrada da senha provisória de primeiro acesso (sem migration).
 * Permite reenviar o mesmo convite sem regenerar password_hash.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type TemporaryPasswordRegenerateReason =
  | 'force_new'
  | 'expired'
  | 'already_used'
  | 'invalidated'
  | 'missing_ciphertext'
  | 'hash_mismatch'
  | 'no_existing_hash';

export type TemporaryPasswordDecision =
  | { action: 'reuse' }
  | { action: 'regenerate'; reason: TemporaryPasswordRegenerateReason };

export function decideTemporaryPasswordAction(input: {
  forceNew: boolean;
  firstLoginAt: string | Date | null | undefined;
  expiresAt: string | Date | null | undefined;
  temporaryPasswordHash: string | null | undefined;
  encryptedPassword: string | null | undefined;
  /** false = senha já não é mais a provisória (alterada / invalidada). */
  mustChangePassword?: boolean | null;
  nowMs?: number;
}): TemporaryPasswordDecision {
  if (input.forceNew) return { action: 'regenerate', reason: 'force_new' };
  if (input.firstLoginAt) return { action: 'regenerate', reason: 'already_used' };
  if (input.mustChangePassword === false) {
    return { action: 'regenerate', reason: 'invalidated' };
  }

  const expiresMs = input.expiresAt ? new Date(input.expiresAt).getTime() : NaN;
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(expiresMs) || expiresMs <= now) {
    return { action: 'regenerate', reason: 'expired' };
  }

  if (!input.temporaryPasswordHash) {
    return { action: 'regenerate', reason: 'no_existing_hash' };
  }
  if (!input.encryptedPassword) {
    return { action: 'regenerate', reason: 'missing_ciphertext' };
  }
  return { action: 'reuse' };
}

function inviteCryptoKey(): Buffer {
  const material = String(
    process.env.MASTER_JWT_SECRET || process.env.JWT_SECRET || 'master-dev-secret-change-me',
  );
  return createHash('sha256').update(`master-invite-temp-password:v1:${material}`).digest();
}

/** AES-256-GCM; formato v1:iv:tag:ciphertext (base64url). */
export function encryptTemporaryPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', inviteCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptTemporaryPassword(payload: string): string | null {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', inviteCryptoKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256Password(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
