import { detectImageMime } from './magicBytes.js';
import { UPLOAD_LIMITS } from './limits.js';
import { validateUploadByPolicy, type UploadPolicyName } from './uploadPolicies.js';
import { normalizeImageMimeType } from './normalizeMime.js';

function decodeBase64Chunk(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] || '' : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function validateImageDataUrl(
  dataUrl: string,
  policy: UploadPolicyName = 'avatar',
): { ok: true; mimeType: string; size: number } | { ok: false; message: string; code?: string } {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { ok: false, message: 'Imagem inválida.' };
  }
  const head = dataUrl.slice(0, 64).toLowerCase();
  if (!head.startsWith('data:image/')) {
    return { ok: false, message: 'Use uma imagem (JPEG, PNG ou WebP).' };
  }

  const mimeMatch = dataUrl.match(/^data:([^;]+);/i);
  const rawMime = mimeMatch?.[1] || 'image/jpeg';
  const mimeType = normalizeImageMimeType(rawMime) || rawMime.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return { ok: false, message: 'Formato não permitido. Use JPEG, PNG ou WebP.' };
  }

  const base64 = dataUrl.split(',')[1] || '';
  const approxBytes = Math.ceil((base64.length * 3) / 4);
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const policyCheck = validateUploadByPolicy({
    policy,
    fileName: `photo.${ext}`,
    mimeType,
    size: approxBytes,
  });
  if (!policyCheck.ok) {
    return {
      ok: false,
      message:
        policyCheck.code === 'size_exceeded'
          ? `Imagem muito grande. O limite é ${Math.round(UPLOAD_LIMITS[policy] / (1024 * 1024))} MB.`
          : 'Formato não permitido. Use JPEG, PNG ou WebP.',
      code: policyCheck.code,
    };
  }

  try {
    const bytes = decodeBase64Chunk(dataUrl);
    if (!detectImageMime(bytes.subarray(0, 32))) {
      return { ok: false, message: 'Conteúdo da imagem inválido ou corrompido.' };
    }
    return { ok: true, mimeType, size: bytes.byteLength || approxBytes };
  } catch {
    return { ok: false, message: 'Não foi possível ler a imagem selecionada.' };
  }
}
