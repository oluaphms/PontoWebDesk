/**
 * GET /api/uploads/files/:userId/:fileName — entrega de arquivo com assinatura HMAC.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSecureCorsHeaders } from '../security.js';
import { noCache } from '../cache.js';
import { sanitizeFilename } from '../../../src/shared/upload/sanitizeFilename.js';
import { resolveAndAssertWithinRoot } from '../../../src/shared/upload/sanitizeStoragePath.js';
import { logger } from '../../../src/shared/logger/logger.js';
const MAX_SIGNED_URL_TTL_SEC = 3600;

function cors(request: Request) {
  return getSecureCorsHeaders(request, { allowMethods: 'GET, OPTIONS', allowHeaders: 'Content-Type' });
}

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
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

export function createSignedUploadUrl(baseUrl: string, userId: string, fileName: string, ttlSec = 86400 * 7): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const safeName = sanitizeFilename(fileName);
  const payload = `${userId}/${safeName}:${exp}`;
  const sig = crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/api/uploads/files/${encodeURIComponent(userId)}/${encodeURIComponent(safeName)}?exp=${exp}&sig=${sig}`;
}

function verifySignature(userId: string, fileName: string, exp: string, sig: string): boolean {
  const secret = signingSecret();
  if (!secret || !exp || !sig) return false;
  const expNum = Number(exp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expNum) || expNum < nowSec) return false;
  if (expNum - nowSec > MAX_SIGNED_URL_TTL_SEC + 60) return false;
  const payload = `${userId}/${fileName}:${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch (error) {
    logger.warn({
      module: 'upload.serve-photo',
      action: 'UPLOAD_SIGNATURE_COMPARE_FAILED',
      message: 'Falha ao comparar assinatura de URL de upload',
      error,
    });
    return false;
  }
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function handleServeUploadFile(
  request: Request,
  userId: string,
  fileName: string,
): Promise<Response> {
  const h = cors(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: h }));
  }
  if (request.method !== 'GET') {
    return noCache(new Response('Method not allowed', { status: 405, headers: h }));
  }

  const url = new URL(request.url);
  const exp = url.searchParams.get('exp') || '';
  const sig = url.searchParams.get('sig') || '';
  const safeUser = userId.replace(/[^\w-]/g, '');
  const safeName = sanitizeFilename(fileName);
  if (!safeUser || !safeName) {
    return noCache(new Response('Not found', { status: 404, headers: h }));
  }
  if (!verifySignature(safeUser, safeName, exp, sig)) {
    return noCache(new Response('Forbidden', { status: 403, headers: h }));
  }

  let resolved: string;
  try {
    resolved = resolveAndAssertWithinRoot(uploadRoot(), `photos/${safeUser}/${safeName}`);
  } catch (error) {
    logger.warn({
      module: 'upload.serve-photo',
      action: 'UPLOAD_PATH_RESOLUTION_FAILED',
      message: 'Falha ao resolver caminho do arquivo solicitado',
      error,
      meta: { userId: safeUser },
    });
    return noCache(new Response('Forbidden', { status: 403, headers: h }));
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return noCache(new Response('Not found', { status: 404, headers: h }));
  }

  const ext = safeName.split('.').pop()?.toLowerCase() || 'jpg';
  const body = fs.readFileSync(resolved);
  return noCache(
    new Response(body, {
      status: 200,
      headers: {
        ...h,
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    }),
  );
}
