import type { Request, Response } from 'express';
import fs from 'node:fs';
import { resolvePhotoFilePath, verifySignedPhotoUrl } from '../services/uploadStorageService.js';
import { sanitizeFilename } from '../upload/sanitizeFilename.js';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function serveUploadFileController(req: Request, res: Response): void {
  const userId = String(req.params.userId || '');
  const fileName = sanitizeFilename(String(req.params.fileName || ''));
  const exp = String(req.query.exp || '');
  const sig = String(req.query.sig || '');

  if (!verifySignedPhotoUrl(userId, fileName, exp, sig)) {
    res.status(403).send('Forbidden');
    return;
  }

  const filePath = resolvePhotoFilePath(userId, fileName);
  if (!filePath) {
    res.status(404).send('Not found');
    return;
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
}
