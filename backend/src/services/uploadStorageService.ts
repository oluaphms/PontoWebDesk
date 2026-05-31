import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeFilename } from '../upload/sanitizeFilename.js';
import { extensionForImageMime, type DetectedImageMime } from '../upload/magicBytes.js';
import { resolveAndAssertWithinRoot } from '../upload/sanitizeStoragePath.js';
import { logger } from '../logger/logger.js';
const MAX_SIGNED_URL_TTL_SEC = 3600;

function uploadRoot(): string {
  const root = (process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads')).trim();
  const resolved = path.resolve(root);
  if (resolved.toLowerCase().includes(`${path.sep}public${path.sep}`) || resolved.toLowerCase().endsWith(`${path.sep}public`)) {
    throw new Error('UPLOAD_DIR_PUBLIC_FORBIDDEN');
  }
  return resolved;
}

function signingSecret(): string {
  return (
    process.env.UPLOAD_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    ''
  ).trim();
}


export function ensureUploadDirs(userId: string): string {
  const relative = `photos/${userId.replace(/[^\w-]/g, '')}`;
  const dir = resolveAndAssertWithinRoot(uploadRoot(), relative);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function savePhotoFile(
  userId: string,
  kind: 'punch' | 'avatar',
  detectedMime: DetectedImageMime,
  buffer: Buffer,
): { fileName: string; absolutePath: string } {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const ext = extensionForImageMime(detectedMime);
  const fileName = `${kind}-${Date.now()}.${ext}`;
  const dir = ensureUploadDirs(safeUser);
  const absolutePath = resolveAndAssertWithinRoot(uploadRoot(), `photos/${safeUser}/${sanitizeFilename(fileName)}`);
  fs.writeFileSync(absolutePath, buffer, { mode: 0o640 });
  return { fileName, absolutePath };
}

export function buildSignedPhotoUrl(req: { protocol: string; get: (h: string) => string | undefined }, userId: string, fileName: string): string {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  const exp = Math.floor(Date.now() / 1000) + MAX_SIGNED_URL_TTL_SEC;
  const payload = `${safeUser}/${safeName}:${exp}`;
  const secret = signingSecret();
  if (!secret) {
    throw new Error('UPLOAD_SIGNING_SECRET_MISSING');
  }
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const host = req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const base = `${proto}://${host}`;
  return `${base}/api/uploads/files/${encodeURIComponent(safeUser)}/${encodeURIComponent(safeName)}?exp=${exp}&sig=${sig}`;
}

export function resolvePhotoFilePath(userId: string, fileName: string): string | null {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  let full: string;
  try {
    full = resolveAndAssertWithinRoot(uploadRoot(), `photos/${safeUser}/${safeName}`);
  } catch (error) {
    logger.warn({
      module: 'upload.storage',
      action: 'UPLOAD_PATH_RESOLUTION_FAILED',
      message: 'Falha ao resolver caminho de foto',
      error,
      meta: { userId: safeUser },
    });
    return null;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

export function verifySignedPhotoUrl(userId: string, fileName: string, exp: string, sig: string): boolean {
  const secret = signingSecret();
  if (!secret || !exp || !sig) return false;
  const expNum = Number(exp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expNum) || expNum < nowSec) return false;
  if (expNum - nowSec > MAX_SIGNED_URL_TTL_SEC + 60) return false;
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  const payload = `${safeUser}/${safeName}:${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch (error) {
    logger.warn({
      module: 'upload.storage',
      action: 'UPLOAD_SIGNATURE_COMPARE_FAILED',
      message: 'Falha ao comparar assinatura de URL de foto',
      error,
    });
    return false;
  }
}
