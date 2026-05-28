/**
 * Upload de fotos via API VPS (PostgreSQL + disco em UPLOAD_DIR).
 * Endpoint: POST {VITE_API_URL}/uploads/photo
 */
import { buildApiUrl } from './api';
import { getToken } from './authToken';
import { validatePunchImageDataUrl } from '../utils/punchPhotoUpload';

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
  const token = getToken();
  if (!token) {
    return { ok: false, error: 'Sessão expirada. Faça login novamente.' };
  }

  let contentBase64: string;
  let filename: string;
  let mimeType: string;

  if ('dataUrl' in input) {
    const validated = validatePunchImageDataUrl(input.dataUrl);
    if (validated.ok === false) {
      return { ok: false, error: validated.message };
    }
    const parts = input.dataUrl.split(',');
    contentBase64 = parts[1] || parts[0];
    const mimeMatch = input.dataUrl.match(/^data:([^;]+);/i);
    mimeType = mimeMatch?.[1] || 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    filename = input.filename || `${kind}-${Date.now()}.${ext}`;
  } else {
    const file = input.file;
    if (!file.type.startsWith('image/')) {
      return { ok: false, error: 'Selecione uma imagem válida.' };
    }
    contentBase64 = await fileToBase64(file);
    filename = file.name || `${kind}-${Date.now()}.jpg`;
    mimeType = file.type || 'image/jpeg';
  }

  const res = await fetch(buildApiUrl('/uploads/photo'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, filename, mimeType, contentBase64 }),
  });

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !data.ok || !data.url) {
    return { ok: false, error: data.error || `Falha no upload (${res.status})` };
  }
  return { ok: true, url: data.url };
}
