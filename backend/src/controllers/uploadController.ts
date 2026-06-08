import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { validateImageBuffer } from '../upload/fileValidation.js';
import type { DetectedImageMime } from '../upload/magicBytes.js';
import { buildSignedPhotoUrl, savePhotoFile } from '../services/uploadStorageService.js';
import { validateUploadedFile } from '../upload/validateUploadedFile.js';
import { logger } from '../logger/logger.js';

type UploadKind = 'punch' | 'avatar';

export async function uploadPhotoController(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.auth?.userId || req.auth?.sub;
  if (!userId) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = req.body as {
      kind?: string;
      filename?: string;
      mimeType?: string;
      contentBase64?: string;
    };
    const kind: UploadKind = body.kind === 'avatar' ? 'avatar' : 'punch';
    const filename = body.filename || 'photo.jpg';
    const declaredMime = body.mimeType || '';
    const raw = String(body.contentBase64 || '').trim();
    const contentLengthHeader = req.headers['content-length'];
    const estimatedSize = raw ? Math.floor((raw.length * 3) / 4) : 0;

    logger.info({
      module: 'upload.controller',
      action: 'UPLOAD_REQUEST_RECEIVED',
      message: 'Requisição de upload recebida',
      userId: String(userId),
      meta: {
        origin: req.headers.origin ?? null,
        contentType: req.headers['content-type'] ?? null,
        contentLength: contentLengthHeader ?? null,
        filename,
        mimeType: declaredMime,
        kind,
        estimatedBytes: estimatedSize,
      },
    });
    if (!raw) {
      res.status(400).json({ ok: false, error: 'content_required' });
      return;
    }
    const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
    const buffer = Buffer.from(b64, 'base64');

    const profile = kind === 'avatar' ? 'avatar' : 'punchPhoto';
    const centralized = validateUploadedFile({
      uploadType: profile,
      filename,
      mimeType: declaredMime,
      size: buffer.byteLength,
      buffer: new Uint8Array(buffer),
      storagePath: `photos/${String(userId)}/${filename}`,
    });
    if (centralized.ok === false) {
      logger.warn({
        module: 'upload.controller',
        action: 'UPLOAD_REJECTED',
        message: 'Upload rejeitado por política de validação',
        userId: String(userId),
        meta: {
          endpoint: '/api/uploads/photo',
          uploadType: profile,
          validationResult: centralized.code,
          fileName: filename,
          mimeType: declaredMime,
          fileSize: buffer.byteLength,
          uploadPath: `photos/${String(userId)}/${filename}`,
        },
      });
      res.status(400).json({ ok: false, error: centralized.message, code: centralized.code });
      return;
    }
    const validated = validateImageBuffer({
      filename,
      declaredMime,
      size: buffer.byteLength,
      buffer: new Uint8Array(buffer),
      profile,
    });
    if (validated.ok === false) {
      logger.warn({
        module: 'upload.controller',
        action: 'UPLOAD_IMAGE_BUFFER_REJECTED',
        message: 'Upload rejeitado na validação de buffer',
        userId: String(userId),
        meta: {
          uploadType: profile,
          validationResult: validated.code,
          fileName: filename,
          mimeType: declaredMime,
          fileSize: buffer.byteLength,
        },
      });
      res.status(400).json({ ok: false, error: validated.message, code: validated.code });
      return;
    }

    const detected = validated.detectedMime as DetectedImageMime;
    logger.info({
      module: 'upload.controller',
      action: 'UPLOAD_VALIDATED',
      message: 'Upload validado com sucesso',
      userId: String(userId),
      meta: {
        uploadType: profile,
        mimeType: detected,
        size: buffer.byteLength,
      },
    });
    const { fileName } = savePhotoFile(userId, kind, detected, buffer);
    const url = buildSignedPhotoUrl(req, userId, fileName);
    logger.info({
      module: 'upload.controller',
      action: 'UPLOAD_COMPLETED',
      message: 'Upload persistido com sucesso',
      userId: String(userId),
      meta: { path: `${userId}/${fileName}` },
    });
    res.json({ ok: true, url, path: `${userId}/${fileName}`, mime: detected });
  } catch (e) {
    logger.error({
      module: 'upload.controller',
      action: 'UPLOAD_FAILED',
      message: 'Falha no fluxo de upload',
      userId: String(userId),
      error: e,
    });
    res.status(500).json({ ok: false, error: 'upload_failed' });
  }
}
