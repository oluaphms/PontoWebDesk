/**
 * Upload de foto em disco (VPS) — sem Supabase Storage.
 * Usa JWT_SECRET (mesmo token da API VPS) e UPLOAD_DIR.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateImageBuffer, type ValidationResult } from '../../../src/shared/upload/fileValidation.js';
import type { DetectedImageMime } from '../../../src/shared/upload/magicBytes.js';
import { extensionForImageMime } from '../../../src/shared/upload/magicBytes.js';
import { sanitizeFilename } from '../../../src/shared/upload/sanitizeFilename.js';

type UploadKind = 'punch' | 'avatar';

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
}

function signingSecret(): string {
  return (
    process.env.UPLOAD_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    ''
  ).trim();
}

function verifyJwt(token: string): { sub: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const sub = String(json.sub || json.userId || '').trim();
    if (!sub) return null;
    if (json.exp && Number(json.exp) * 1000 < Date.now()) return null;
    return { sub };
  } catch {
    return null;
  }
}

function savePhoto(userId: string, kind: UploadKind, mime: DetectedImageMime, buffer: Buffer): string {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const ext = extensionForImageMime(mime);
  const fileName = `${kind}-${Date.now()}.${ext}`;
  const dir = path.join(uploadRoot(), 'photos', safeUser);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, sanitizeFilename(fileName));
  fs.writeFileSync(full, buffer, { mode: 0o640 });
  return fileName;
}

export function buildSignedPhotoUrlFromRequest(
  request: Request,
  userId: string,
  fileName: string,
): string {
  const secret = signingSecret();
  if (!secret) throw new Error('UPLOAD_SIGNING_SECRET_MISSING');
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  const exp = Math.floor(Date.now() / 1000) + 86400 * 7;
  const payload = `${safeUser}/${safeName}:${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  return `${base}/api/uploads/files/${encodeURIComponent(safeUser)}/${encodeURIComponent(safeName)}?exp=${exp}&sig=${sig}`;
}

export type VpsPhotoUploadInput = {
  request: Request;
  authHeader: string;
  kind: UploadKind;
  buffer: Uint8Array;
  filename: string;
  declaredMime: string;
};

export function processVpsPhotoUpload(
  input: VpsPhotoUploadInput,
): { ok: true; url: string; path: string; mime: string } | { ok: false; result: Extract<ValidationResult, { ok: false }> } | { ok: false; error: string; status: number } {
  const token = input.authHeader.replace(/^Bearer\s+/i, '').trim();
  const user = verifyJwt(token);
  if (!user) {
    return { ok: false, error: 'Unauthorized', status: 401 };
  }
  if (!signingSecret()) {
    return { ok: false, error: 'JWT_SECRET não configurado no servidor.', status: 503 };
  }

  const profile = input.kind === 'avatar' ? 'avatar' : 'punchPhoto';
  const validated = validateImageBuffer({
    filename: input.filename,
    declaredMime: input.declaredMime,
    size: input.buffer.byteLength,
    buffer: input.buffer,
    profile,
  });
  if (validated.ok === false) {
    return { ok: false, result: validated };
  }

  const detected = validated.detectedMime as DetectedImageMime;
  const fileName = savePhoto(user.sub, input.kind, detected, Buffer.from(input.buffer));
  const url = buildSignedPhotoUrlFromRequest(input.request, user.sub, fileName);
  return {
    ok: true,
    url,
    path: `${user.sub}/${fileName}`,
    mime: detected,
  };
}
