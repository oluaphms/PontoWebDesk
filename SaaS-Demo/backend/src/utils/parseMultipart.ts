import type { Request } from 'express';
import Busboy from 'busboy';
import { UPLOAD_LIMITS } from '../upload/limits.js';

export type ParsedMultipart = {
  fields: Record<string, string>;
  file: { filename: string; mimeType: string; buffer: Buffer } | null;
};

export function parseMultipartRequest(req: Request, maxBytes = UPLOAD_LIMITS.afdImport): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('multipart_required'));
      return;
    }

    const fields: Record<string, string> = {};
    let file: ParsedMultipart['file'] = null;
    let totalBytes = 0;

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: maxBytes, files: 1, fields: 10 },
    });

    busboy.on('field', (name, value) => {
      fields[name] = String(value ?? '');
    });

    busboy.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          reject(new Error('file_too_large'));
          stream.destroy();
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        file = {
          filename: info.filename || 'import.txt',
          mimeType: info.mimeType || 'text/plain',
          buffer: Buffer.concat(chunks),
        };
      });
    });

    busboy.on('error', (err) => reject(err));
    busboy.on('finish', () => resolve({ fields, file }));
    req.pipe(busboy);
  });
}
