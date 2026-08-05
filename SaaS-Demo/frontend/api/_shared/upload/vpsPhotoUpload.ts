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
import { resolveAndAssertWithinRoot } from '../../../src/shared/upload/sanitizeStoragePath.js';
import { validateUploadedFile } from '../../../src/shared/upload/validateUploadedFile.js';
import { logger } from '../../../src/shared/logger/logger.js';

type UploadKind = 'punch' | 'avatar';
const MAX_SIGNED_URL_TTL_SEC = 3600;

function uploadRoot(): string {
  const resolved = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
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
  } catch (error) {
    logger.warn({
      module: 'upload.serverless',
      action: 'UPLOAD_JWT_SIGNATURE_COMPARE_FAILED',
      message: 'Falha ao comparar assinatura do JWT de upload',
      error,
    });
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const sub = String(json.sub || json.userId || '').trim();
    if (!sub) return null;
    if (json.exp && Number(json.exp) * 1000 < Date.now()) return null;
    return { sub };
  } catch (error) {
    logger.warn({
      module: 'upload.serverless',
      action: 'UPLOAD_JWT_PARSE_FAILED',
      message: 'Falha ao decodificar payload JWT de upload',
      error,
    });
    return null;
  }
}

function savePhoto(userId: string, kind: UploadKind, mime: DetectedImageMime, buffer: Buffer): string {
  const safeUser = userId.replace(/[^\w-]/g, '');
  const ext = extensionForImageMime(mime);
  const fileName = `${kind}-${Date.now()}.${ext}`;
  const dir = resolveAndAssertWithinRoot(uploadRoot(), `photos/${safeUser}`);
  fs.mkdirSync(dir, { recursive: true });
  const full = resolveAndAssertWithinRoot(uploadRoot(), `photos/${safeUser}/${sanitizeFilename(fileName)}`);
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
  const exp = Math.floor(Date.now() / 1000) + MAX_SIGNED_URL_TTL_SEC;
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
  const centralized = validateUploadedFile({
    uploadType: profile,
    filename: input.filename,
    mimeType: input.declaredMime,
    size: input.buffer.byteLength,
    buffer: input.buffer,
    storagePath: `photos/${user.sub}/${input.filename}`,
  });
  if (centralized.ok === false) {
    logger.warn({
      module: 'upload.serverless',
      action: 'UPLOAD_REJECTED',
      message: 'Upload rejeitado por validação central',
      meta: {
        endpoint: '/api/uploads/photo',
        uploadType: profile,
        reason: centralized.code.toLowerCase(),
        fileName: input.filename,
        mimeType: input.declaredMime,
        size: input.buffer.byteLength,
      },
    });
    return { ok: false, result: centralized };
  }
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
  logger.info({
    module: 'upload.serverless',
    action: 'UPLOAD_VALIDATED',
    message: 'Upload validado com sucesso',
    meta: { uploadType: profile, mimeType: detected, size: input.buffer.byteLength },
  });
  const fileName = savePhoto(user.sub, input.kind, detected, Buffer.from(input.buffer));
  const url = buildSignedPhotoUrlFromRequest(input.request, user.sub, fileName);
  logger.info({
    module: 'upload.serverless',
    action: 'UPLOAD_COMPLETED',
    message: 'Upload concluido no storage local',
    userId: user.sub,
    meta: { path: `${user.sub}/${fileName}` },
  });
  return {
    ok: true,
    url,
    path: `${user.sub}/${fileName}`,
    mime: detected,
  };
}
