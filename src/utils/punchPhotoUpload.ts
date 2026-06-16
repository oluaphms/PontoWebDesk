import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Upload de foto do registro de ponto: validação, multipart (File) e retry em falhas temporárias.
 */

import { messageFromUnknown } from './messageFromUnknown';
import { uploadPhotoViaApi } from '../services/uploadPhotoApi';
import { validateImageDataUrl } from '../shared/upload/validateImageDataUrl';

export type PunchStorage = {
  upload: (bucket: string, path: string, file: File) => Promise<unknown>;
  getPublicUrl: (bucket: string, path: string) => string;
};

export function validatePunchImageDataUrl(dataUrl: string): { ok: true } | { ok: false; message: string } {
  const validated = validateImageDataUrl(dataUrl, 'punchPhoto');
  if (validated.ok === false) {
    return { ok: false, message: validated.message };
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
  _storageModule: PunchStorage,
  userId: string,
  dataUrl: string,
  opts?: { maxRetries?: number }
): Promise<UploadPunchPhotoResult> {
  const validation = validatePunchImageDataUrl(dataUrl);
  if (validation.ok === false) {
    return { publicUrl: null, error: validation.message, transientFailure: false };
  }

  const apiUpload = await uploadPhotoViaApi({ dataUrl, kind: 'punch' });
  observabilityConsole.info('[SELFIE-FLOW] upload iniciado', { userId, ok: apiUpload.ok });
  if (apiUpload.ok) {
    return { publicUrl: apiUpload.url, error: null, transientFailure: false };
  }
  if (!isTransientUploadError(new Error(apiUpload.error))) {
    return { publicUrl: null, error: apiUpload.error, transientFailure: false };
  }

  const maxRetries = opts?.maxRetries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const apiRetry = await uploadPhotoViaApi({
        dataUrl,
        kind: 'punch',
        filename: `punch-${Date.now()}.jpg`,
      });
      if (!apiRetry.ok) {
        throw new Error(apiRetry.error);
      }
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.info('[punchPhotoUpload] OK', { attempt: attempt + 1 });
      }
      return { publicUrl: apiRetry.url, error: null, transientFailure: false };
    } catch (e) {
      lastErr = e;
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.warn('[punchPhotoUpload] tentativa', attempt + 1, e);
      }
      const transient = isTransientUploadError(e);
      if (!transient || attempt === maxRetries - 1) {
        const msg = messageFromUnknown(e, 'Erro ao enviar foto.');
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
