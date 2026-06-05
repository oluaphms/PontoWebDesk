import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { isAdminOrHr, requireCompanyId } from '../utils/authContext.js';
import { buildSignedPhotoUrl } from '../services/uploadStorageService.js';
import { sanitizeFilename } from '../upload/sanitizeFilename.js';
import { logger } from '../logger/logger.js';

function parseUploadPhotoPath(raw: unknown): { userId: string; fileName: string } | null {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://internal-upload.local');
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/api\/uploads\/files\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const userId = decodeURIComponent(match[1] ?? '').replace(/[^\w-]/g, '');
  const fileName = sanitizeFilename(decodeURIComponent(match[2] ?? ''));
  if (!userId || !fileName) return null;
  return { userId, fileName };
}

export async function refreshUploadPhotoUrlController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  if (!isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', code: 'PHOTO_ADMIN_REQUIRED' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const photoUrl = String(body.photoUrl ?? body.photo_url ?? '').trim();
  const parsed = parseUploadPhotoPath(photoUrl);
  if (!parsed) {
    res.status(400).json({ ok: false, error: 'invalid_photo_url' });
    return;
  }

  try {
    const result = await pool.query(
      `select 1
         from time_records
        where company_id = $1
          and (
            photo_url = $2
            or raw_data->>'photo_url' = $2
          )
        limit 1`,
      [companyId, photoUrl],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ ok: false, error: 'photo_not_found' });
      return;
    }

    const url = buildSignedPhotoUrl(req, parsed.userId, parsed.fileName);
    logger.info({
      module: 'upload.access',
      action: 'ADMIN_PHOTO_URL_REFRESHED',
      message: 'URL assinada de foto renovada para visualizacao administrativa',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      meta: { photoOwnerId: parsed.userId },
    });
    res.json({ ok: true, url });
  } catch (error) {
    logger.error({
      module: 'upload.access',
      action: 'ADMIN_PHOTO_URL_REFRESH_FAILED',
      message: 'Falha ao renovar URL assinada de foto',
      companyId,
      error,
    });
    res.status(500).json({ ok: false, error: 'photo_url_refresh_failed' });
  }
}
