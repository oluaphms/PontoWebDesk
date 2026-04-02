/**
 * Upload de foto do registro de ponto: validação, multipart (File) e retry em falhas temporárias.
 */

export type PunchStorage = {
  upload: (bucket: string, path: string, file: File) => Promise<unknown>;
  getPublicUrl: (bucket: string, path: string) => string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_PREFIXES = ['data:image/jpeg', 'data:image/jpg', 'data:image/png', 'data:image/webp'];

export function validatePunchImageDataUrl(dataUrl: string): { ok: true } | { ok: false; message: string } {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { ok: false, message: 'Imagem inválida.' };
  }
  const head = dataUrl.slice(0, 40).toLowerCase();
  if (!head.startsWith('data:image/')) {
    return { ok: false, message: 'Use uma imagem (JPEG, PNG ou WebP).' };
  }
  const okPrefix = ALLOWED_PREFIXES.some((p) => dataUrl.toLowerCase().startsWith(p));
  if (!okPrefix) {
    return { ok: false, message: 'Formato não permitido. Use JPEG, PNG ou WebP.' };
  }
  const base64 = dataUrl.split(',')[1] || '';
  const approxBytes = (base64.length * 3) / 4;
  if (approxBytes > MAX_BYTES) {
    return { ok: false, message: 'Imagem muito grande (máximo 5 MB).' };
  }
  return { ok: true };
}

function isTransientUploadError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  if (!msg) return true;
  return (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('429') ||
    msg.includes('aborted')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface UploadPunchPhotoResult {
  publicUrl: string | null;
  /** Erro definitivo (não tentar de novo) */
  error: string | null;
  /** Falhou após retries (pode ainda usar fallback base64 no chamador) */
  transientFailure: boolean;
}

/**
 * Envia a imagem como arquivo (multipart no cliente Supabase Storage).
 */
export async function uploadPunchPhotoWithRetry(
  storageModule: PunchStorage,
  userId: string,
  dataUrl: string,
  opts?: { maxRetries?: number }
): Promise<UploadPunchPhotoResult> {
  const validation = validatePunchImageDataUrl(dataUrl);
  if (!validation.ok) {
    return { publicUrl: null, error: validation.message, transientFailure: false };
  }

  const maxRetries = opts?.maxRetries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) {
        throw new Error(`Falha ao ler imagem (${res.status}).`);
      }
      const blob = await res.blob();
      const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `punch-${Date.now()}.${ext}`, { type: mime });
      if (file.size > MAX_BYTES) {
        return { publicUrl: null, error: 'Imagem muito grande (máximo 5 MB).', transientFailure: false };
      }
      const path = `${userId}/${Date.now()}-punch.${ext}`;
      await storageModule.upload('photos', path, file);
      const publicUrl = storageModule.getPublicUrl('photos', path);
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        console.info('[punchPhotoUpload] OK', { attempt: attempt + 1, path });
      }
      return { publicUrl, error: null, transientFailure: false };
    } catch (e) {
      lastErr = e;
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        console.warn('[punchPhotoUpload] tentativa', attempt + 1, e);
      }
      const transient = isTransientUploadError(e);
      if (!transient || attempt === maxRetries - 1) {
        const msg =
          (e as Error)?.message ||
          (typeof e === 'object' && e && 'message' in e ? String((e as any).message) : 'Erro ao enviar foto.');
        return {
          publicUrl: null,
          error: msg,
          transientFailure: transient,
        };
      }
      await sleep(400 * (attempt + 1));
    }
  }

  return {
    publicUrl: null,
    error: String((lastErr as Error)?.message ?? 'Erro ao enviar foto.'),
    transientFailure: true,
  };
}
