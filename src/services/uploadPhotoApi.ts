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
import { compressImageDataUrl } from '../shared/upload/compressImageForUpload';
import { validateImageDataUrl } from '../shared/upload/validateImageDataUrl';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

export type UploadPhotoKind = 'punch' | 'avatar';

function uploadProfile(kind: UploadPhotoKind): 'avatar' | 'punchPhoto' {
  return kind === 'avatar' ? 'avatar' : 'punchPhoto';
}

async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const parts = dataUrl.split(',');
  return parts[1] || parts[0];
}

export async function uploadPhotoViaApi(
  input: { dataUrl: string; kind?: UploadPhotoKind; filename?: string } | { file: File; kind?: UploadPhotoKind },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const kind = input.kind ?? ('file' in input && input.file.name.includes('avatar') ? 'avatar' : 'punch');
  const policy = uploadProfile(kind);
  const token = getToken();

  let contentBase64: string;
  let filename: string;
  let mimeType: string;

  if ('dataUrl' in input) {
    const validated = validateImageDataUrl(input.dataUrl, policy);
    if (validated.ok === false) {
      return { ok: false, error: validated.message };
    }
    mimeType = validated.mimeType;
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    filename = input.filename || `${kind}-${Date.now()}.${ext}`;
    observabilityConsole.info('[uploadPhotoApi] dataUrl antes da compressão', {
      kind,
      filename,
      mimeType,
      size: validated.size,
    });
    const compressed = await compressImageDataUrl(input.dataUrl, policy);
    contentBase64 = dataUrlToBase64(compressed.dataUrl);
    mimeType = compressed.mimeType;
    filename = filename.replace(/\.(png|webp|jpeg)$/i, '.jpg');
    observabilityConsole.info('[uploadPhotoApi] dataUrl comprimido para envio', {
      kind,
      filename,
      mimeType,
      byteLength: compressed.byteLength,
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
    const rawDataUrl = await fileToDataUrl(file);
    const compressed = await compressImageDataUrl(rawDataUrl, policy);
    contentBase64 = dataUrlToBase64(compressed.dataUrl);
    mimeType = compressed.mimeType;
    filename = safeName.includes('.') ? safeName.replace(/\.(png|webp|jpeg)$/i, '.jpg') : `${safeName.split('.')[0] || kind}.jpg`;
    observabilityConsole.info('[uploadPhotoApi] arquivo comprimido para envio', {
      kind,
      filename,
      mimeType,
      originalSize: file.size,
      byteLength: compressed.byteLength,
    });
  }

  const payload = JSON.stringify({ kind, filename, mimeType, contentBase64 });
  observabilityConsole.info('[uploadPhotoApi] payload pronto', {
    kind,
    filename,
    payloadBytes: payload.length,
  });

  let res: Response;
  try {
    res = await fetch(buildApiUrl('/uploads/photo'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...(token && !isCookieSessionToken(token) ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: payload,
    });
  } catch (networkErr) {
    observabilityConsole.warn('[uploadPhotoApi] falha de rede no upload', {
      kind,
      filename,
      payloadBytes: payload.length,
      error: networkErr,
    });
    return {
      ok: false,
      error:
        'Não foi possível enviar a foto (rede ou limite do servidor). Tente uma imagem menor ou contate o suporte.',
    };
  }

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
  observabilityConsole.info('[SELFIE-FLOW] upload concluído', { kind, url: data.url });
  observabilityConsole.info('[SELFIE-FLOW] url gerada', { kind, hasUrl: Boolean(data.url) });
  return { ok: true, url: data.url };
}
