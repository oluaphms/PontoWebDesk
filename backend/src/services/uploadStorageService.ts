import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeFilename } from '../upload/sanitizeFilename.js';
import { extensionForImageMime, type DetectedImageMime } from '../upload/magicBytes.js';

function uploadRoot(): string {
  const root = (process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads')).trim();
  return path.resolve(root);
}

function signingSecret(): string {
  return (
    process.env.UPLOAD_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    ''
  ).trim();
}

export function ensureUploadDirs(userId: string): string {
  const dir = path.join(uploadRoot(), 'photos', userId.replace(/[^\w-]/g, ''));
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
  const absolutePath = path.join(dir, fileName);
  fs.writeFileSync(absolutePath, buffer, { mode: 0o640 });
  return { fileName, absolutePath };
}

export function buildSignedPhotoUrl(req: { protocol: string; get: (h: string) => string | undefined }, userId: string, fileName: string): string {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  const exp = Math.floor(Date.now() / 1000) + 86400 * 7;
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
  const full = path.resolve(path.join(uploadRoot(), 'photos', safeUser, safeName));
  const allowedRoot = path.resolve(path.join(uploadRoot(), 'photos', safeUser));
  if (!full.startsWith(allowedRoot + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

export function verifySignedPhotoUrl(userId: string, fileName: string, exp: string, sig: string): boolean {
  const secret = signingSecret();
  if (!secret || !exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  const payload = `${safeUser}/${safeName}:${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
