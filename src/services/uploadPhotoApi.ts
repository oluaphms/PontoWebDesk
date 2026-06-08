/**
 * Upload de fotos via API VPS (PostgreSQL + disco em UPLOAD_DIR).
 * Endpoint: POST {VITE_API_URL}/uploads/photo
 */
import { buildApiUrl } from './api';
import { getToken, isCookieSessionToken } from './authToken';
import { readFileHead } from '../shared/upload/fileValidation';
import { detectImageMime } from '../shared/upload/magicBytes';
import { inferImageExtensionFromMime, normalizeImageMimeType } from '../shared/upload/normalizeMime';
import { validateUploadByPolicy } from '../shared/upload/uploadPolicies';
import { uploadValidationMessage } from '../shared/upload/uploadValidationMessages';
import { validateImageDataUrl } from '../shared/upload/validateImageDataUrl';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

export type UploadPhotoKind = 'punch' | 'avatar';

async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function uploadPhotoViaApi(
  input: { dataUrl: string; kind?: UploadPhotoKind; filename?: string } | { file: File; kind?: UploadPhotoKind },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const kind = input.kind ?? ('file' in input && input.file.name.includes('avatar') ? 'avatar' : 'punch');
  const policy = kind === 'avatar' ? 'avatar' : 'punchPhoto';
  const token = getToken();

  let contentBase64: string;
  let filename: string;
  let mimeType: string;

  if ('dataUrl' in input) {
    const validated = validateImageDataUrl(input.dataUrl, policy);
    if (validated.ok === false) {
      return { ok: false, error: validated.message };
    }
    const parts = input.dataUrl.split(',');
    contentBase64 = parts[1] || parts[0];
    mimeType = validated.mimeType;
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    filename = input.filename || `${kind}-${Date.now()}.${ext}`;
    observabilityConsole.info('[uploadPhotoApi] dataUrl pronto para envio', {
      kind,
      filename,
      mimeType,
      size: validated.size,
    });
  } else {
    const file = input.file;
    const detectedMime = normalizeImageMimeType(file.type || '') || file.type || '';
    const inferredExt = inferImageExtensionFromMime(detectedMime) || 'jpg';
    const safeName = file.name?.trim() || `${kind}.${inferredExt}`;
    const fileCheck = validateUploadByPolicy({
      policy,
      fileName: safeName,
      mimeType: detectedMime || file.type || '',
      size: file.size,
    });
    observabilityConsole.info('[uploadPhotoApi] arquivo selecionado', {
      name: file.name,
      safeName,
      size: file.size,
      type: file.type,
      normalizedMime: detectedMime,
      kind,
      validationCode: fileCheck.ok ? null : fileCheck.code,
    });
    if (!fileCheck.ok) {
      return { ok: false, error: uploadValidationMessage(fileCheck.code, policy) };
    }
    const head = await readFileHead(file, 32);
    const magicMime = detectImageMime(head);
    if (!magicMime) {
      return { ok: false, error: 'Conteúdo da imagem inválido ou corrompido.' };
    }
    contentBase64 = await fileToBase64(file);
    filename = safeName.includes('.') ? safeName : `${safeName.split('.')[0] || kind}.${inferredExt}`;
    mimeType = normalizeImageMimeType(file.type || '') || magicMime;
  }

  const res = await fetch(buildApiUrl('/uploads/photo'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token && !isCookieSessionToken(token) ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, filename, mimeType, contentBase64 }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    url?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.ok || !data.url) {
    observabilityConsole.warn('[uploadPhotoApi] falha no servidor', {
      status: res.status,
      error: data.error,
      code: data.code,
      filename,
      mimeType,
    });
    return { ok: false, error: data.error || `Falha no upload (${res.status})` };
  }
  return { ok: true, url: data.url };
}
