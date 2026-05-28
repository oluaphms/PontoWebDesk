/**
 * GET /api/uploads/files/:userId/:fileName — entrega de arquivo com assinatura HMAC.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSecureCorsHeaders } from '../security.js';
import { noCache } from '../cache.js';
import { sanitizeFilename } from '../../../src/shared/upload/sanitizeFilename.js';

function cors(request: Request) {
  return getSecureCorsHeaders(request, { allowMethods: 'GET, OPTIONS', allowHeaders: 'Content-Type' });
}

function uploadRoot(): string {
  return (process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads')).replace(/\\/g, '/');
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
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const payload = `${userId}/${fileName}:${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
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

  const fullPath = path.join(uploadRoot(), 'photos', safeUser, safeName);
  const resolved = path.resolve(fullPath);
  const allowedRoot = path.resolve(path.join(uploadRoot(), 'photos', safeUser));
  if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
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
