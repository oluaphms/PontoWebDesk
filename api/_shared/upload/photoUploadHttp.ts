/**
 * POST /api/uploads/photo — VPS: disco local + JWT da API.
 * Não usa Supabase Storage (banco e API na VPS).
 */
import { getSecureCorsHeaders, requireTrustedOrigin } from '../security.js';
import { noCache } from '../cache.js';
import { processVpsPhotoUpload } from './vpsPhotoUpload.js';
import type { ValidationResult } from '../../../src/shared/upload/fileValidation.js';

type UploadKind = 'punch' | 'avatar';

function cors(request: Request) {
  return getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
}

function fail(request: Request, result: Extract<ValidationResult, { ok: false }>, status = 400): Response {
  const h = cors(request);
  return noCache(
    new Response(JSON.stringify({ ok: false, error: result.message, code: result.code }), {
      status,
      headers: { ...h, 'Content-Type': 'application/json' },
    }),
  );
}

export async function handlePhotoUpload(request: Request): Promise<Response> {
  const h = cors(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: h }));
  }
  if (request.method !== 'POST') {
    return noCache(new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: h }));
  }
  const blocked = requireTrustedOrigin(request, h);
  if (blocked) return blocked;

  const authHeader = request.headers.get('Authorization') || '';
  const contentType = request.headers.get('Content-Type') || '';
  let kind: UploadKind = 'punch';
  let buffer: Uint8Array;
  let filename = 'photo.jpg';
  let declaredMime = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const rawKind = String(form.get('kind') || 'punch').toLowerCase();
    kind = rawKind === 'avatar' ? 'avatar' : 'punch';
    const file = form.get('file');
    if (!(file instanceof File)) {
      return fail(request, { ok: false, code: 'MISSING_FILE', message: 'Arquivo obrigatório.' });
    }
    filename = file.name || filename;
    declaredMime = file.type || '';
    buffer = new Uint8Array(await file.arrayBuffer());
  } else if (contentType.includes('application/json')) {
    const body = (await request.json()) as {
      kind?: string;
      filename?: string;
      mimeType?: string;
      contentBase64?: string;
    };
    kind = body.kind === 'avatar' ? 'avatar' : 'punch';
    filename = body.filename || filename;
    declaredMime = body.mimeType || '';
    const raw = String(body.contentBase64 || '').trim();
    if (!raw) {
      return fail(request, { ok: false, code: 'MISSING_CONTENT', message: 'contentBase64 obrigatório.' });
    }
    const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
    buffer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } else {
    return fail(request, {
      ok: false,
      code: 'INVALID_CONTENT_TYPE',
      message: 'Use multipart/form-data ou application/json.',
    });
  }

  const outcome = processVpsPhotoUpload({
    request,
    authHeader,
    kind,
    buffer,
    filename,
    declaredMime,
  });

  if (!outcome.ok) {
    if ('result' in outcome) return fail(request, outcome.result);
    return noCache(
      new Response(JSON.stringify({ ok: false, error: outcome.error }), {
        status: outcome.status,
        headers: { ...h, 'Content-Type': 'application/json' },
      }),
    );
  }

  return noCache(
    new Response(
      JSON.stringify({
        ok: true,
        url: outcome.url,
        path: outcome.path,
        mime: outcome.mime,
      }),
      { status: 200, headers: { ...h, 'Content-Type': 'application/json' } },
    ),
  );
}
